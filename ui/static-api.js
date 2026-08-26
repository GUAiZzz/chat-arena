import { createLocalApi } from "../scripts/local-api.mjs?v=3.1.5";

let api;

function getApi() {
  api ||= createLocalApi({
    runtime: "static",
    storage: window.localStorage,
    storageKey: "chat-arena:pixel-storybook:v1",
    COMPANION_MODEL_PROVIDER: "demo"
  });
  return api;
}

function encodeBody(body) {
  if (body == null) return new Uint8Array();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new TextEncoder().encode(String(body));
}

export async function requestStatic(path, options = {}) {
  const result = await getApi()({ url: `https://static.demo${path}`, method: options.method || "GET" }, encodeBody(options.body));
  const payload = JSON.parse(result.body || "{}");
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(payload?.error?.message || "这次操作没完成，请重试。");
    error.status = result.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
}
