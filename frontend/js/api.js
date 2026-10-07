/* --------------------------------------------------------------------------
   API client — consistent JSON envelopes, session handling, error mapping.
   -------------------------------------------------------------------------- */

import { toast } from "./ui/feedback.js";

let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

class ApiError extends Error {
  constructor(message, status, code, payload) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request(method, path, { body, params, silent = false } = {}) {
  const url = new URL(path, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  const options = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    throw new ApiError("Cannot reach the server. Check your connection.", 0, "network");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message || `Request failed (${response.status})`;
    const error = new ApiError(message, response.status, payload?.error?.code, payload);

    if (response.status === 401 && onUnauthorized) onUnauthorized();
    if (!silent && response.status !== 401) toast.error("Request failed", message);
    throw error;
  }

  /* Some endpoints answer with a message only (`data: null`). Returning the
     envelope for those keeps `result.message` usable at the call site. */
  const data = payload && payload.data !== undefined && payload.data !== null ? payload.data : payload;
  if (data === null || data === undefined) return data;

  /* Expose the envelope's human message (e.g. "Booking confirmed") on the
     returned object without polluting its JSON serialisation. */
  if (typeof data === "object" && !Array.isArray(data) && !("message" in data)) {
    try {
      Object.defineProperty(data, "message", {
        value: payload?.message,
        enumerable: false,
        configurable: true,
      });
    } catch { /* frozen payload — fall back to no message */ }
  }

  return data;
}

export const api = {
  get: (path, options) => request("GET", path, options),
  post: (path, body, options) => request("POST", path, { ...options, body }),
  put: (path, body, options) => request("PUT", path, { ...options, body }),
  patch: (path, body, options) => request("PATCH", path, { ...options, body }),
  delete: (path, options) => request("DELETE", path, options),
};

export { ApiError };
