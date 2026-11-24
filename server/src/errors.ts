import type { z } from "zod";

/** Stable, documented error codes. Clients should branch on these, never on messages. */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "MALFORMED_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "DESIGN_NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "HOST_NOT_ALLOWED"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Parses untrusted input or throws a 400 with one detail per failing field. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, prefix = ""): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }));
  throw new ApiError(400, "VALIDATION_FAILED", "Request validation failed", details);
}
