import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { normalizeRows, scoreSheet, spreadsheetReadSource, suggestMapping } from "../shared/data-adapter.js";
import { aggregateVotes, chooseBalancedSample, remapDisplayedVote, shouldSwap, validateVotePayload } from "../shared/arena-utils.js";
import { demoSamples, demoSummary } from "../fixtures/demo-dataset.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadVendorXlsx() {
  const source = await fs.readFile(path.join(root, "public", "vendor", "xlsx.full.min.js"), "utf8");
  const context = vm.createContext({ console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder });
  vm.runInContext(source, context, { filename: "xlsx.full.min.js" });
  return context.XLSX;
}

test("the supplied workbook maps automatically, detects its duplicate UID, and yields nine unique samples", async () => {
  const XLSX = await loadVendorXlsx();
  const sourceRows = demoSamples.map((sample) => ({
    uid: sample.source_uid,
    query: sample.query,
    model_a_resp: sample.response_a,
    model_b_resp: sample.response_b,
    messages: JSON.stringify(sample.context || []),
    human_winner: sample.human_winner || ""
  }));
  sourceRows.splice(1, 0, { ...sourceRows[0] });
  const sheetSource = XLSX.utils.json_to_sheet(sourceRows);
  const bookSource = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bookSource, sheetSource, "Chat Arena");
  const workbook = XLSX.read(XLSX.write(bookSource, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true, blankrows: false });
  const headers = Object.keys(rows[0]);
  const { mapping } = suggestMapping(headers);
  const result = normalizeRows(rows, mapping);

  assert.equal(rows.length, 10);
  assert.equal(result.errors.length, 0);
  assert.equal(result.samples.length, 9);
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.summary.excluded_duplicate_rows, 1);
  assert.equal(result.summary.missing_model_ids, 9);
  assert.equal(result.summary.has_model_ids, false);
  assert.ok(result.samples.every((sample) => sample.context.every((message) => message.role !== "system")));
  assert.equal(demoSamples.length, 9);
  assert.deepEqual(demoSummary, result.summary);
  assert.deepEqual(demoSamples.map((sample) => sample.source_uid), result.samples.map((sample) => sample.source_uid));
  assert.deepEqual(demoSamples.map((sample) => sample.query), result.samples.map((sample) => sample.query));
});

test("UTF-8 CSV keeps Chinese text intact", async () => {
  const XLSX = await loadVendorXlsx();
  const bytes = new TextEncoder().encode('"uid","query","model_a_resp","model_b_resp"\n"csv-001","中文问题","回复 A","回复 B"');
  const source = spreadsheetReadSource(bytes.buffer, "fixture.csv");
  assert.equal(source.type, "string");
  const workbook = XLSX.read(source.data, { type: source.type });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
  assert.equal(rows[0].query, "中文问题");
  assert.equal(rows[0].model_a_resp, "回复 A");
});

test("aliases support Chinese headers and never infer missing dimensions or model ids", () => {
  const headers = ["样本ID", "用户问题", "回复A", "回复B", "对话历史"];
  const score = scoreSheet(headers);
  assert.equal(score.requiredMatches, 4);
  const { mapping } = suggestMapping(headers);
  const result = normalizeRows([{ 样本ID: "1", 用户问题: "你好", 回复A: "A", 回复B: "B", 对话历史: "[]" }], mapping);
  assert.equal(result.errors.length, 0);
  assert.equal(result.samples[0].dimension, null);
  assert.equal(result.samples[0].model_a_id, null);
  assert.equal(result.samples[0].difficulty, null);
});

test("missing required values and malformed JSON block publication", () => {
  const mapping = suggestMapping(["uid", "query", "model_a_resp", "model_b_resp", "messages"]).mapping;
  const result = normalizeRows([
    { uid: "1", query: "", model_a_resp: "A", model_b_resp: "B", messages: "[]" },
    { uid: "2", query: "Q", model_a_resp: "A", model_b_resp: "B", messages: "not-json" }
  ], mapping);
  assert.equal(result.samples.length, 0);
  assert.ok(result.errors.some((error) => error.type === "missing_value"));
  assert.ok(result.errors.some((error) => error.type === "invalid_json"));
});

test("display randomization is stable and displayed votes map back to canonical sides", () => {
  assert.equal(shouldSwap("user", "version", "sample"), shouldSwap("user", "version", "sample"));
  assert.equal(remapDisplayedVote("A", true), "B");
  assert.equal(remapDisplayedVote("B", true), "A");
  assert.equal(remapDisplayedVote("tie_good", true), "tie_good");
  assert.equal(remapDisplayedVote(remapDisplayedVote("A", true), true), "A");
});

test("vote payloads reject unknown choices, reason tags, and implausible dwell time", () => {
  assert.equal(validateVotePayload({ sampleToken: "t", winner: "A", reasonTags: ["更自然"], dwellMs: 3000, contextOpened: true }).length, 0);
  assert.ok(validateVotePayload({ sampleToken: "t", winner: "left", reasonTags: [], dwellMs: 0 }).length);
  assert.ok(validateVotePayload({ sampleToken: "t", winner: "A", reasonTags: ["编造标签"], dwellMs: 0 }).length);
  assert.ok(validateVotePayload({ sampleToken: "t", winner: "A", reasonTags: [], dwellMs: 9_000_000 }).length);
});

test("real vote aggregation returns exact distributions, coverage, and disputed samples", () => {
  const samples = [
    { id: "s1", query: "Q1", dimension: "自然人味" },
    { id: "s2", query: "Q2", dimension: null }
  ];
  const votes = [
    { sample_id: "s1", rater_id: "u1", winner: "A" },
    { sample_id: "s1", rater_id: "u2", winner: "B" },
    { sample_id: "s2", rater_id: "u1", winner: "tie_good" }
  ];
  const result = aggregateVotes(votes, samples);
  assert.equal(result.total_votes, 3);
  assert.equal(result.participants, 2);
  assert.deepEqual(result.distribution, { A: 1, B: 1, tie_good: 1, tie_bad: 0 });
  assert.equal(result.disputed.length, 1);
  assert.equal(result.disputed[0].disagreement, 0.5);
  assert.equal(chooseBalancedSample(samples, { 自然人味: 2, 未标注: 0 }, "seed").id, "s2");
});
