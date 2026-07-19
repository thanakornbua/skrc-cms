import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";

// The six generic codes are the norm; a route may document a more specific
// code for one particular error case (e.g. NOT_CHECKED_IN, COMPETITION_CONCLUDED)
// per API.md — the `string & {}` trick keeps autocomplete without forbidding those.
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | (string & {});

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Array<{ field: string; message: string }>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fields?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function zodToFields(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

export function notFoundHandler(_req: Request, res: Response): void {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message },
      ...(err.fields ? { fields: err.fields } : {}),
    });
    return;
  }

  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
