import { createHash } from "node:crypto";

// Refresh tokens are stored hashed (never in plaintext) so a DB leak alone
// doesn't let an attacker replay sessions.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
