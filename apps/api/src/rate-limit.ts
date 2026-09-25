import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { env } from "./env.js";

/**
 * Per-client request limits (in-memory: fine for the single API instance this app runs as).
 * Clients are keyed by IP, which relies on `trust proxy` being set to the real number of
 * proxies in front of the API -- see env.trustProxy.
 */

const MINUTE = 60 * 1000;

function limiter(options: Partial<Options> & { message: string }) {
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => !env.rateLimitEnabled,
    ...options,
    message: { error: options.message },
  });
}

/** Overall ceiling per IP across the whole API: far above what the app itself sends. */
export const apiLimiter = limiter({
  windowMs: MINUTE,
  limit: 300,
  message: "Too many requests. Slow down and try again in a minute.",
});

/** Login attempts per IP, successful or not. */
export const loginIpLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 20,
  message: "Too many login attempts from this network. Try again in 15 minutes.",
});

/**
 * Failed logins per account, whatever IP they come from, so password guessing can't be spread
 * across many addresses. A successful login doesn't count. The trade-off: someone who knows
 * your email can lock that account out for 15 minutes; the per-IP limit caps how often.
 */
export const loginAccountLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email ? `account:${email}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: "Too many failed logins for this account. Try again in 15 minutes.",
});

/** Token refreshes per IP: the web app refreshes every ~15 minutes, so this is generous. */
export const refreshLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  message: "Too many session refreshes. Try again in 15 minutes.",
});
