import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import {
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./jwt.js";
import { hashToken } from "./tokenHash.js";

const BCRYPT_ROUNDS = 12;

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

export async function signup(email: string, password: string, name: string) {
  const existing = await prisma.athlete.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError("An account with this email already exists", 409);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const athlete = await prisma.athlete.create({
    data: { email, passwordHash, name },
  });
  const tokens = await issueTokens(athlete.id);
  return { athlete, tokens };
}

export async function login(email: string, password: string) {
  const athlete = await prisma.athlete.findUnique({ where: { email } });
  if (!athlete) {
    throw new AuthError("Invalid email or password", 401);
  }
  const valid = await bcrypt.compare(password, athlete.passwordHash);
  if (!valid) {
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
