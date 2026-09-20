import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

    // Client errors raised before our code runs: body-parser's malformed
  // JSON (400), body over the 32kb limit (413), bad charset (415)... They
  // are http-errors with a 4xx `status` and `expose: true`. Answer with
  // that status and a fixed message, and DON'T log a stack trace: they're
  // the client's fault, and logging each one lets anyone flood the error
  // log with junk requests and bury real alerts.
  if (isClientHttpError(err)) {
    const known = CLIENT_ERRORS[err.type ?? ""];
    const code = known?.code ?? "BAD_REQUEST";
    const message = known?.message ?? "Bad request.";
    return res.status(err.status).json({ error: { code, message } });
  }

  // Unexpected error: log full detail server-side, never send it to the
  // client — stack traces and DB error text are an information leak.
  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please contact your local Fra representative and ask them to contact the site Admin (aka Drakstik)!" } });
}

// Our own codes/messages for the common parser errors. Deliberately not
// echoing the library's err.message, so its wording can never leak.
const CLIENT_ERRORS: Record<string, { code: string; message: string }> = {
  "entity.parse.failed": { code: "INVALID_JSON", message: "Request body is not valid JSON." },
  "entity.too.large": { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
};

function isClientHttpError(err: unknown): err is { status: number; type?: string } {
  if (typeof err !== "object" || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return typeof status === "number" && status >= 400 && status < 500 && expose === true;
}