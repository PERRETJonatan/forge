import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't forward rejected promises from async handlers to error
// middleware on its own — this wrapper does that so unexpected errors (e.g. a
// DB failure) reach the 500 handler instead of hanging the request.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
