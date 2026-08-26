import { requestStatic } from "./static-api.js?v=3.1.5";

export async function requestJson(path, options = {}) {
  if (document.documentElement.dataset.runtime === "static") return requestStatic(path, options);
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof ArrayBuffer) && !ArrayBuffer.isView(options.body) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "这次操作没完成，请重试。");
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
}
