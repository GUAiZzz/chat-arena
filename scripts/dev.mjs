import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalApi } from "./local-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

const port = Number(process.env.PORT || optionValue("--port") || 4173);
const host = process.env.HOST || optionValue("--host") || "127.0.0.1";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};
const localApi = createLocalApi();

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 21 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (url.pathname.startsWith("/api/")) {
      const result = await localApi(request, await readRequestBody(request));
      response.writeHead(result.status, result.headers);
      response.end(result.body);
      return;
    }
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const safePath = path.normalize(pathname).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
    let filePath = path.resolve(root, safePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    let contents;
    try {
      contents = await fs.readFile(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      filePath = path.resolve(root, "public", safePath);
      const publicRoot = path.resolve(root, "public");
      if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) throw new Error("Invalid public path");
      contents = await fs.readFile(filePath);
    }
    response.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(contents);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Local: http://${host}:${port}`);
});
