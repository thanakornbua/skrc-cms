import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { ApiError } from "../errors.js";

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// CORS headers are added by the Lambda Function URL's own CORS config
// (see ops/create-regweek.ts) — not duplicated here.
export function errorResponse(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof ApiError) {
    return jsonResponse(err.status, {
      error: { code: err.code, message: err.message },
      ...(err.fields ? { fields: err.fields } : {}),
    });
  }
  console.error("Unhandled regweek error:", err);
  return jsonResponse(500, {
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
}
