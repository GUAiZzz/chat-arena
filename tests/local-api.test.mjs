import assert from "node:assert/strict";
import test from "node:test";
import { createLocalApi } from "../scripts/local-api.mjs";
import { normalizeRows, suggestMapping } from "../shared/data-adapter.js";
import { demoSamples } from "../fixtures/demo-dataset.js";

async function request(api, pathname, method = "GET", body = null) {
  let buffer = Buffer.alloc(0);
  if (body instanceof Buffer) buffer = body;
  else if (body instanceof ArrayBuffer) buffer = Buffer.from(body);
  else if (body !== null) buffer = Buffer.from(JSON.stringify(body));
  const result = await api({ url: `http://127.0.0.1${pathname}`, method }, buffer);
  return { status: result.status, body: JSON.parse(result.body) };
}

async function normalizedWorkbook() {
  const rows = demoSamples.map((sample) => ({
    uid: sample.source_uid,
    query: sample.query,
    model_a_resp: sample.response_a,
    model_b_resp: sample.response_b,
    messages: JSON.stringify(sample.context || [])
  }));
  rows.splice(1, 0, { ...rows[0] });
  const normalized = normalizeRows(rows, suggestMapping(Object.keys(rows[0])).mapping);
  return { file: Buffer.from("self-contained Chat Arena fixture"), normalized };
}

test("local demo starts offline with all twelve supplied cases and admin access", async () => {
  const session = await request(createLocalApi(), "/api/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.runtime, "local");
  assert.equal(session.body.isAdmin, true);
  assert.equal(session.body.activeVersion.sampleCount, 12);
  assert.equal(session.body.activeVersion.sourceFilename, "chat-arena-demo.xlsx");
  assert.equal(session.body.activeVersion.summary.total_rows, 13);
  assert.equal(session.body.activeVersion.summary.excluded_duplicate_rows, 1);
});

test("pre-vote battle payload excludes model ids and the human reference", async () => {
  const api = createLocalApi();
  const next = await request(api, "/api/battles/next");
  assert.equal(next.status, 200);
  assert.ok(next.body.battle.sampleToken);
  const serialized = JSON.stringify(next.body.battle);
  assert.doesNotMatch(serialized, /human_winner|model_a_id|model_b_id|metadata/);
});

test("a companion grows at 3/6/9, reveals once, and never returns reflection source text", async () => {
  const api = createLocalApi({ COMPANION_MODEL_PROVIDER: "demo" });
  const born = await request(api, "/api/companion/birth", "POST", { genome: "alien" });
  assert.equal(born.status, 201);
  assert.equal(born.body.companion.companion.genome, "alien");

  let latest;
  let firstVoteId;
  for (let index = 1; index <= 9; index += 1) {
    const next = await request(api, "/api/battles/next");
    assert.equal(next.status, 200);
    assert.ok(next.body.battle?.sampleToken);
    const vote = await request(api, "/api/votes", "POST", {
      sampleToken: next.body.battle.sampleToken,
      winner: index % 2 ? "A" : "B",
      reasonTags: index % 3 === 0 ? ["更懂我", "有增量"] : ["更准确"],
      dwellMs: 800,
      contextOpened: false
    });
    latest = vote.body.companion;
    firstVoteId ||= vote.body.voteId;
    if ([3, 6, 9].includes(index)) {
      assert.equal(latest.season.pendingReflection.milestone, index);
      const sourceText = `只用于第${index}阶段的秘密原句`;
      const reflected = await request(api, "/api/companion/reflections", "POST", { milestone: index, text: sourceText });
      assert.equal(reflected.status, 201);
      assert.doesNotMatch(JSON.stringify(reflected.body), new RegExp(sourceText));
      latest = reflected.body.companion;
      const duplicate = await request(api, "/api/companion/reflections", "POST", { milestone: index, text: "另一句不应覆盖" });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.alreadySubmitted, true);
    }
  }

  assert.equal(latest.season.revealed, false);
  assert.equal(latest.season.canFinalize, true);
  const finalized = await request(api, "/api/companion/finalize", "POST");
  assert.equal(finalized.status, 200);
  latest = finalized.body.companion;
  assert.equal(latest.season.revealed, true);
  const review = await request(api, "/api/companion/review");
  assert.equal(review.body.pages.length, 9);
  const locked = await request(api, `/api/votes/${firstVoteId}`, "PATCH", { reasonTags: ["更懂我"] });
  assert.equal(locked.status, 409);
  assert.ok(latest.season.species.name);
  assert.equal(latest.season.traces.length, 3);
  assert.equal((await request(api, "/api/battles/next")).body.reason, "complete");
  const reset = await request(api, "/api/demo/reset", "POST");
  assert.equal(reset.status, 200);
  assert.equal(reset.body.session.companion.born, false);
  assert.equal(reset.body.session.progress.completed, 0);
});

test("a battle token is one-time, duplicate votes are blocked, and results use stored tickets", async () => {
  const api = createLocalApi();
  const next = await request(api, "/api/battles/next");
  const payload = { sampleToken: next.body.battle.sampleToken, winner: "A", reasonTags: [], dwellMs: 1200, contextOpened: false };
  const vote = await request(api, "/api/votes", "POST", payload);
  assert.equal(vote.status, 201);
  const duplicate = await request(api, "/api/votes", "POST", payload);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "expired_battle");
  const patch = await request(api, `/api/votes/${vote.body.voteId}`, "PATCH", { reasonTags: ["更自然", "会接话"] });
  assert.equal(patch.status, 200);
  const beforeEdit = await request(api, "/api/results");
  const changed = await request(api, `/api/votes/${vote.body.voteId}`, "PATCH", { winner: "B", reasonTags: ["更自然"] });
  assert.equal(changed.status, 200);
  const results = await request(api, "/api/results");
  assert.equal(results.body.totalVotes, 1);
  assert.equal(results.body.participants, 1);
  assert.notDeepEqual(results.body.distribution, beforeEdit.body.distribution);
});

test("the supplied XLSX completes draft, source upload, batch validation, publish, isolation, and rollback", async () => {
  const api = createLocalApi();
  const oldNext = await request(api, "/api/battles/next");
  await request(api, "/api/votes", "POST", { sampleToken: oldNext.body.battle.sampleToken, winner: "B", reasonTags: [], dwellMs: 1000, contextOpened: false });

  const { file, normalized } = await normalizedWorkbook();
  const created = await request(api, "/api/admin/datasets", "POST", { displayName: "闲聊偏好 · 首版", mapping: {}, preflightSummary: normalized.summary });
  const versionId = created.body.version.id;
  assert.equal((await request(api, `/api/admin/datasets/${versionId}/source?filename=${encodeURIComponent("闲聊偏好数据.xlsx")}`, "PUT", file)).status, 200);
  assert.equal((await request(api, `/api/admin/datasets/${versionId}/samples/batch`, "POST", { samples: normalized.samples })).status, 201);
  const checked = await request(api, `/api/admin/datasets/${versionId}/validate`, "POST");
  assert.equal(checked.body.valid, true);
  assert.equal(checked.body.summary.usable_rows, 12);
  assert.equal(checked.body.summary.excluded_duplicate_rows, 1);
  assert.equal(checked.body.summary.missing_model_ids, 12);
  assert.equal((await request(api, `/api/admin/datasets/${versionId}/publish`, "POST")).status, 200);

  const session = await request(api, "/api/session");
  assert.equal(session.body.activeVersion.id, versionId);
  assert.equal(session.body.activeVersion.sampleCount, 12);
  assert.equal(session.body.progress.completed, 0);
  assert.equal((await request(api, "/api/results")).body.totalVotes, 0);
  assert.equal((await request(api, "/api/results?version=local-demo-v1")).body.totalVotes, 1);

  assert.equal((await request(api, "/api/admin/datasets/local-demo-v1/activate", "POST")).status, 200);
  assert.equal((await request(api, "/api/session")).body.activeVersion.id, "local-demo-v1");
});
