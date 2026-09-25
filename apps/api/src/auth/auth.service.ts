import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import {
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./jwt.js";
import { hashToken } from "./tokenHash.js";

/** Cost 12 (~250 ms per hash) everywhere except the test runner, where every test creates and
 * logs in athletes and the production cost pushes the suite past its timeouts. */
const BCRYPT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;
export const MIN_PASSWORD_LENGTH = 12;

/** Compared against when the email doesn't exist, so an unknown email takes as long as a wrong
 * password -- otherwise response time alone reveals which emails have accounts. */
const TIMING_EQUALIZER_HASH = bcrypt.hashSync("forge-timing-equalizer", BCRYPT_ROUNDS);

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(athleteId: string): Promise<AuthTokens> {
  const accessToken = signAccessToken(athleteId);
  const refreshToken = signRefreshToken(athleteId);
  await prisma.refreshToken.create({
    data: {
      athleteId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiryDate(),
    },
  });
  return { accessToken, refreshToken };
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }
}

/** Accounts are created by an operator (src/cli/athlete.ts), never by public signup. */
export async function createAthlete(email: string, password: string, name: string) {
  checkPassword(password);
  const existing = await prisma.athlete.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError("An account with this email already exists", 409);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return prisma.athlete.create({ data: { email, passwordHash, name } });
}

/** Sets a new password and signs the athlete out everywhere (every refresh token revoked). */
export async function setPassword(email: string, password: string): Promise<void> {
  checkPassword(password);
  const athlete = await prisma.athlete.findUnique({ where: { email } });
  if (!athlete) {
    throw new AuthError("No account with this email", 404);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.athlete.update({ where: { id: athlete.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { athleteId: athlete.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function login(email: string, password: string) {
  const athlete = await prisma.athlete.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, athlete?.passwordHash ?? TIMING_EQUALIZER_HASH);
  if (!athlete || !valid) {
    throw new AuthError("Invalid email or password", 401);
  }
  const tokens = await issueTokens(athlete.id);
  return { athlete, tokens };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AuthError("Invalid refresh token", 401);
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AuthError("Invalid refresh token", 401);
  }

  // Rotate: revoke the used token and issue a fresh pair, so a stolen refresh
  // token stops working the next time the legitimate client refreshes.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  return issueTokens(payload.sub);
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
