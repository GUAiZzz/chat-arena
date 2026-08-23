import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = process.argv.includes("--pages");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");
const server = path.join(dist, "server");
const shared = path.join(dist, "shared");
const ui = path.join(dist, "client", "ui");
const publicFiles = ["index.html", "styles.css", "app.js"];

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(client, { recursive: true });
await fs.mkdir(server, { recursive: true });
await fs.mkdir(shared, { recursive: true });
await fs.mkdir(ui, { recursive: true });
await Promise.all(publicFiles.filter((file) => file !== "index.html").map((file) => fs.copyFile(path.join(root, file), path.join(client, file))));
const sourceHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
await fs.writeFile(path.join(client, "index.html"), pages
  ? sourceHtml.replace('data-runtime="server"', 'data-runtime="static"').replace('>LOCAL DEMO<', '>STATIC DEMO<')
  : sourceHtml);
await fs.cp(path.join(root, "shared"), path.join(client, "shared"), { recursive: true });
await fs.cp(path.join(root, "shared"), shared, { recursive: true });
await fs.cp(path.join(root, "shared"), path.join(server, "shared"), { recursive: true });
await fs.cp(path.join(root, "ui"), ui, { recursive: true });
await fs.mkdir(path.join(client, "scripts"), { recursive: true });
await fs.mkdir(path.join(client, "fixtures"), { recursive: true });
await fs.copyFile(path.join(root, "scripts", "local-api.mjs"), path.join(client, "scripts", "local-api.mjs"));
await fs.copyFile(path.join(root, "fixtures", "demo-dataset.js"), path.join(client, "fixtures", "demo-dataset.js"));
try {
  await fs.cp(path.join(root, "public"), client, { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const workerSource = await fs.readFile(path.join(root, "worker", "index.js"), "utf8");
await fs.writeFile(path.join(server, "index.js"), workerSource.replaceAll('"../shared/', '"./shared/'));
await fs.copyFile(path.join(root, "db", "schema.ts"), path.join(server, "schema.js"));
if (pages) await fs.writeFile(path.join(client, ".nojekyll"), "");
try {
  const openai = path.join(dist, ".openai");
  await fs.mkdir(openai, { recursive: true });
  await fs.copyFile(path.join(root, ".openai", "hosting.json"), path.join(openai, "hosting.json"));
  await fs.cp(path.join(root, "drizzle"), path.join(openai, "drizzle"), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log(`Built Chat Arena ${pages ? "for GitHub Pages" : "with server modules"}.`);
