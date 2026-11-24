// Type-only imports: erased at build time, so no server code reaches the browser bundle.
import type { CraneGeometry, CraneParams } from "../../server/src/domain/crane.ts";
import type { ErrorBody, ErrorDetail } from "../../server/src/errors.ts";

export type { CraneGeometry, CraneParams, ErrorDetail };

export interface Design {
  id: number;
  name: string;
  params: CraneParams;
  version: number;
  createdAt: string;
  updatedAt: string;
  geometry: CraneGeometry;
}

export type DesignSummary = Omit<Design, "geometry">;

export interface CraneOptions {
  capacitiesKg: number[];
  limits: {
    spanMm: { min: number; max: number };
    railHeightMm: { min: number; max: number };
    liftingHeightMm: { min: number };
  };
  hookTopBelowRailMm: number;
}

/** Any failed request. `code` is the server's stable error code, or NETWORK_ERROR. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];

  constructor(status: number, code: string, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "NETWORK_ERROR", "Cannot reach the server. Is it running?");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const e = (data as ErrorBody | undefined)?.error;
    if (e) throw new ApiRequestError(res.status, e.code, e.message, e.details);
    throw new ApiRequestError(res.status, "NETWORK_ERROR", `Server responded ${res.status}. Is the API running?`);
  }
  return data as T;
}

export const api = {
  options: () => request<CraneOptions>("GET", "/api/crane-options"),
  list: () => request<{ items: DesignSummary[]; total: number }>("GET", "/api/designs?limit=100"),
  get: (id: number) => request<Design>("GET", `/api/designs/${id}`),
  create: (name: string, params: CraneParams) => request<Design>("POST", "/api/designs", { name, params }),
  update: (id: number, version: number, name: string, params: CraneParams) =>
    request<Design>("PUT", `/api/designs/${id}`, { name, params, version }),
  preview: (params: CraneParams, signal: AbortSignal) =>
    request<{ geometry: CraneGeometry; svg: string }>("POST", "/api/preview", { params }, signal),
  drawingUrl: (id: number) => `/api/designs/${id}/drawing.svg`,
};
