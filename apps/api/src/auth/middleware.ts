import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      athleteId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.athleteId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
