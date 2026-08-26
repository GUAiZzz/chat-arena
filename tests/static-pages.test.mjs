import assert from "node:assert/strict";
import test from "node:test";
import { createLocalApi } from "../scripts/local-api.mjs";

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

async function request(api, pathname, method = "GET", body = null) {
  const bytes = body == null ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
  const result = await api({ url: `https://static.demo${pathname}`, method }, bytes);
  return { status: result.status, body: JSON.parse(result.body) };
}

test("static mode accepts every genome and keeps each result within its two-pet family", async () => {
  const families = {
    light: new Set(["芽啵", "砾尾"]),
    cloud: new Set(["苔角", "暖灯"]),
    alien: new Set(["卷星", "夜墨"])
  };
  for (const genome of Object.keys(families)) {
    const api = createLocalApi({ runtime: "static", storage: new MemoryStorage(), COMPANION_MODEL_PROVIDER: "demo" });
    const born = await request(api, "/api/companion/birth", "POST", { genome });
    assert.equal(born.status, 201);
    assert.equal(born.body.companion.companion.genome, genome);
    assert.equal((await request(api, "/api/demo/reset", "POST")).status, 200);
  }
});

test("GitHub Pages state survives reload and completes nine votes, three reflections, reveal, and results", async () => {
  const storage = new MemoryStorage();
  let api = createLocalApi({ runtime: "static", storage, COMPANION_MODEL_PROVIDER: "demo" });
  const session = await request(api, "/api/session");
  assert.equal(session.body.runtime, "static");
  assert.equal(session.body.activeVersion.sampleCount, 9);
  await request(api, "/api/companion/birth", "POST", { genome: "cloud" });

  for (let index = 1; index <= 9; index += 1) {
    const next = await request(api, "/api/battles/next");
    assert.ok(next.body.battle?.sampleToken, `battle ${index} should load`);
    const vote = await request(api, "/api/votes", "POST", {
      sampleToken: next.body.battle.sampleToken,
      winner: ["A", "B", "tie_good", "tie_bad"][(index - 1) % 4],
      reasonTags: index % 2 ? ["更懂我"] : ["更准确", "更克制"],
      dwellMs: 700,
      contextOpened: index % 3 === 0
    });
    assert.equal(vote.status, 201);
    if ([3, 6, 9].includes(index)) {
      const privateText = `第${index}阶段只在浏览器内分析的原句`;
      const reflected = await request(api, "/api/companion/reflections", "POST", { milestone: index, text: privateText });
      assert.equal(reflected.status, 201);
      assert.doesNotMatch(storage.getItem("chat-arena:pixel-storybook:v1"), new RegExp(privateText));
    }
    if (index === 4) api = createLocalApi({ runtime: "static", storage, COMPANION_MODEL_PROVIDER: "demo" });
  }

  api = createLocalApi({ runtime: "static", storage, COMPANION_MODEL_PROVIDER: "demo" });
  const restored = await request(api, "/api/session");
  assert.equal(restored.body.progress.completed, 9);
  assert.equal(restored.body.companion.season.revealed, false);
  assert.equal(restored.body.companion.season.canFinalize, true);
  const finalized = await request(api, "/api/companion/finalize", "POST");
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.companion.season.revealed, true);
  const results = await request(api, "/api/results");
  assert.equal(results.body.totalVotes, 9);
  assert.equal(results.body.participants, 1);
  assert.equal((await request(api, "/api/battles/next")).body.reason, "complete");
});

test("GitHub Pages exposes only supported three, six, or nine-question seasons", async () => {
  for (const goal of [3, 6, 9]) {
    const api = createLocalApi({ runtime: "static", storage: new MemoryStorage(), COMPANION_MODEL_PROVIDER: "demo" });
    const born = await request(api, "/api/companion/birth", "POST", { genome: "alien", goal });
    assert.equal(born.body.companion.season.goal, goal);
    for (let index = 1; index <= goal; index += 1) {
      const next = await request(api, "/api/battles/next");
      assert.ok(next.body.battle?.sampleToken, `battle ${index} of ${goal} should load`);
      const vote = await request(api, "/api/votes", "POST", { sampleToken: next.body.battle.sampleToken, winner: "A", reasonTags: [], dwellMs: 700, contextOpened: false });
      if (vote.body.companion.season.pendingReflection) {
        const milestone = vote.body.companion.season.pendingReflection.milestone;
        assert.equal((await request(api, "/api/companion/reflections", "POST", { milestone, text: "我想先理解，再一起继续。" })).status, 201);
      }
    }
    assert.equal((await request(api, "/api/companion")).body.companion.season.canFinalize, true);
  }
});

test("the new browser storage key leaves the retired version untouched", async () => {
  const oldState = '{"legacy":"keep-me"}';
  const storage = new MemoryStorage([["chat-arena:static-demo:v1", oldState]]);
  const api = createLocalApi({ runtime: "static", storage, COMPANION_MODEL_PROVIDER: "demo" });
  await request(api, "/api/companion/birth", "POST", { genome: "light", goal: 3 });
  const next = await request(api, "/api/battles/next");
  await request(api, "/api/votes", "POST", { sampleToken: next.body.battle.sampleToken, winner: "A", reasonTags: [], dwellMs: 700, contextOpened: false });
  assert.equal(storage.getItem("chat-arena:static-demo:v1"), oldState);
  assert.ok(storage.getItem("chat-arena:pixel-storybook:v1"));
});
