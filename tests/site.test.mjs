import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = path.join(root, "dist", "client");
const pagesOrigin = String(process.env.PAGES_ORIGIN || "https://guaizzz.github.io/chat-arena").replace(/\/$/, "");

async function assetFetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, "");
  try {
    return new Response(await fs.readFile(path.join(client, pathname)), { status: 200 });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

test("serves the real internal arena without hard-coded rankings", async () => {
  const workerUrl = pathToFileURL(path.join(root, "dist", "server", "index.js"));
  workerUrl.searchParams.set("test", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("https://demo.local/"), { ASSETS: { fetch: assetFetch } });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title>Chat Arena · 互动故事手册<\/title>/);
  assert.match(html, /打开今天的手册/);
  assert.match(html, /题库管理/);
  assert.match(html, /STATIC DEMO/);
  assert.match(html, /开始这一册/);
  assert.match(html, /查看当前聊灵成长状态/);
  assert.match(html, /id="previousBattle"/);
  assert.match(html, /id="editVote"/);
  assert.match(html, /id="closingScreen"/);
  assert.match(html, /id="closeBook"/);
  assert.match(html, /REAL VOTES ONLY/);
  assert.match(html, /xlsx\.full\.min\.js/);
  assert.doesNotMatch(html, /段位榜|Elo 模拟|12,840|ARENA_DATA|追问接力/);
  assert.match(html, new RegExp(`${pagesOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/og\\.png`));
  assert.doesNotMatch(html, /__SITE_ORIGIN__/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("ships accessible controls and isolates browser persistence to the static adapter", async () => {
  const [html, script, companionUi, staticApi, css, noJekyll, vendor, devServer] = await Promise.all([
    fs.readFile(path.join(client, "index.html"), "utf8"),
    fs.readFile(path.join(client, "app.js"), "utf8"),
    fs.readFile(path.join(client, "ui", "companion.js"), "utf8"),
    fs.readFile(path.join(client, "ui", "static-api.js"), "utf8"),
    fs.readFile(path.join(client, "styles.css"), "utf8"),
    fs.readFile(path.join(client, ".nojekyll"), "utf8"),
    fs.readFile(path.join(client, "vendor", "xlsx.full.min.js"), "utf8"),
    fs.readFile(path.join(root, "scripts", "dev.mjs"), "utf8")
  ]);
  assert.match(html, /aria-label="主要导航"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<kbd>1<\/kbd>/);
  assert.match(script, /\/api\/battles\/next/);
  assert.match(companionUi, /\/api\/companion\/birth/);
  assert.match(companionUi, /\/api\/companion\/reflections/);
  assert.match(script, /\/api\/admin\/datasets/);
  assert.match(script, /GitHub Pages · 浏览器本地模式/);
  assert.match(script, /选择已更新，结果中的原票已经被覆盖/);
  assert.match(script, /成长章节：已装订/);
  assert.match(script, /function renderEmptyBattle[\s\S]*?updateProgress\(state\.session\?\.progress\);[\s\S]*?function renderContents/);
  assert.doesNotMatch(`${script}\n${companionUi}`, /localStorage|sessionStorage/);
  assert.match(staticApi, /window\.localStorage/);
  assert.match(staticApi, /chat-arena:pixel-storybook:v1/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /bookCloseArrive/);
  assert.match(script, /const openClosing/);
  assert.match(devServer, /"\.mjs": "text\/javascript; charset=utf-8"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.outcome-actions \.button,[\s\S]*?\.preview-table,[\s\S]*?font-size: 12px/);
  assert.equal(noJekyll, "");
  assert.match(html, /data-runtime="static"/);
  assert.match(vendor, /0\.20\.3/);
});

test("GitHub Pages assets stay relative and all six pixel companions are packaged", async () => {
  const [html, app, css, staticApi, localApi] = await Promise.all([
    fs.readFile(path.join(client, "index.html"), "utf8"),
    fs.readFile(path.join(client, "app.js"), "utf8"),
    fs.readFile(path.join(client, "styles.css"), "utf8"),
    fs.readFile(path.join(client, "ui", "static-api.js"), "utf8"),
    fs.readFile(path.join(client, "scripts", "local-api.mjs"), "utf8")
  ]);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
  assert.match(html, /styles\.css\?v=3\.1\.2/);
  assert.match(html, /app\.js\?v=3\.1\.2/);
  assert.doesNotMatch(html, /liaoling-atlas-pixel-v1\.png"/);
  assert.match(html, /liaoling-atlas-pixel-v1\.png\?v=3\.1\.2/);
  assert.doesNotMatch(`${app}\n${staticApi}\n${localApi}`, /from "\.\.?\/[^"?]+\.(?:js|mjs)"/);
  assert.doesNotMatch(css, /url\("\.\/assets\/[^"?]+"\)/);
  for (const sprite of ["ya-bo.png", "li-wei.png", "tai-jiao.png", "nuan-deng.png", "juan-xing.png", "ye-mo.png"]) {
    const stat = await fs.stat(path.join(client, "assets", "companions", sprite));
    assert.ok(stat.size > 0, `${sprite} should be packaged`);
  }
  for (const asset of ["storybook-cover-pixel-v1.png", "genome-seeds-pixel-v1.png", "liaoling-atlas-pixel-v1.png"]) {
    const stat = await fs.stat(path.join(client, "assets", asset));
    assert.ok(stat.size > 0, `${asset} should be packaged`);
  }
  assert.doesNotMatch(html, /id="queryImage"|id="queryVisual"/);
});

test("packages the Worker with its shared server modules", async () => {
  const [worker, arenaUtils, dataAdapter, growth, model] = await Promise.all([
    fs.readFile(path.join(root, "dist", "server", "index.js"), "utf8"),
    fs.readFile(path.join(root, "dist", "server", "shared", "arena-utils.js"), "utf8"),
    fs.readFile(path.join(root, "dist", "server", "shared", "data-adapter.js"), "utf8"),
    fs.readFile(path.join(root, "dist", "server", "shared", "companion-growth.js"), "utf8"),
    fs.readFile(path.join(root, "dist", "server", "shared", "companion-model.js"), "utf8")
  ]);
  assert.match(worker, /from "\.\/shared\/arena-utils\.js"/);
  assert.match(worker, /from "\.\/shared\/data-adapter\.js"/);
  assert.match(arenaUtils, /export/);
  assert.match(dataAdapter, /export/);
  assert.match(growth, /speciesForScores/);
  assert.match(model, /analyzeReflection/);
});

test("server authorization keeps hosted identity and an explicit admin allowlist", async () => {
  const workerUrl = pathToFileURL(path.join(root, "dist", "server", "index.js"));
  workerUrl.searchParams.set("auth-test", String(Date.now()));
  const { __test } = await import(workerUrl.href);
  const anonymous = new Request("https://demo.local/api/session");
  assert.equal(__test.getUser(anonymous), null);

  const request = new Request("https://demo.local/api/session", { headers: {
    "oai-authenticated-user-id": "user-1",
    "oai-authenticated-user-email": "owner@example.com",
    "oai-authenticated-user-full-name": encodeURIComponent("Harry He"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8"
  } });
  const user = __test.getUser(request);
  assert.deepEqual(user, { id: "user-1", email: "owner@example.com", name: "Harry He" });
  assert.equal(__test.isAdmin(user, { ADMIN_EMAILS: "admin@example.com, owner@example.com" }), true);
  assert.equal(__test.isAdmin(user, { ADMIN_EMAILS: "admin@example.com" }), false);
});

test("migrations contain arena, companion, and editable-vote contracts", async () => {
  const sql = `${await fs.readFile(path.join(root, "drizzle", "0000_real_internal.sql"), "utf8")}\n${await fs.readFile(path.join(root, "drizzle", "0001_liaoling_growth.sql"), "utf8")}`;
  for (const table of ["dataset_versions", "samples", "votes", "user_progress", "battle_tokens", "dataset_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE \(dataset_version_id, source_uid\)/);
  assert.match(sql, /UNIQUE \(dataset_version_id, sample_id, rater_id\)/);
  assert.match(sql, /idx_votes_version_rater/);
  for (const table of ["companions", "companion_seasons", "companion_events"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /display_swapped/);
  assert.match(sql, /updated_at/);
  assert.match(sql, /PRAGMA optimize/);
});
