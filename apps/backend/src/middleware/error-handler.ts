import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  // Unexpected error: log full detail server-side, never send it to the
  // client — stack traces and DB error text are an information leak.
  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please contact your local Fra representative and ask them to contact the site Admin (aka Drakstik)!" } });
}