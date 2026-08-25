import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisToPoints,
  demoAnalyzeReflection,
  milestoneDefinition,
  milestonesForGoal,
  normalizeSessionGoal,
  scoreReasonTags,
  speciesForScores,
  stageForProgress,
  validateModelAnalysis
} from "../shared/companion-growth.js";
import { analyzeReflection } from "../shared/companion-model.js";

test("reason tags always contribute six points without rewarding extra selections", () => {
  assert.deepEqual(scoreReasonTags(["更懂我"]), { empathy: 6, exploration: 0, discernment: 0 });
  assert.deepEqual(scoreReasonTags(["更懂我", "有增量"]), { empathy: 3, exploration: 3, discernment: 0 });
  assert.deepEqual(scoreReasonTags(["更懂我", "会接话"]), { empathy: 6, exploration: 0, discernment: 0 });
  assert.equal(Object.values(scoreReasonTags(["更准确", "更自然"])).reduce((sum, value) => sum + value, 0), 6);
});

test("reflection proportions become exactly ten deterministic points", () => {
  const points = analysisToPoints({ empathy: 33, exploration: 33, discernment: 34 });
  assert.deepEqual(points, { empathy: 3, exploration: 3, discernment: 4 });
  assert.equal(Object.values(points).reduce((sum, value) => sum + value, 0), 10);
});

test("each life genome reveals one of its two companion species", () => {
  assert.equal(speciesForScores({ empathy: 36, exploration: 12, discernment: 15 }, "light").id, "sprout-pop");
  assert.equal(speciesForScores({ empathy: 12, exploration: 36, discernment: 15 }, "light").id, "grit-tail");
  assert.equal(speciesForScores({ empathy: 12, exploration: 36, discernment: 15 }, "cloud").id, "moss-antler");
  assert.equal(speciesForScores({ empathy: 12, exploration: 15, discernment: 36 }, "cloud").id, "warm-lantern");
  assert.equal(speciesForScores({ empathy: 36, exploration: 12, discernment: 15 }, "alien").id, "star-coil");
  assert.equal(speciesForScores({ empathy: 12, exploration: 15, discernment: 36 }, "alien").id, "night-ink");
});

test("stages require their due reflection before the companion advances", () => {
  assert.equal(stageForProgress(3, []).id, "birth");
  assert.equal(stageForProgress(3, [3]).id, "awakening");
  assert.equal(stageForProgress(9, [3, 6]).id, "forming");
  assert.equal(stageForProgress(9, [3, 6, 9]).id, "ready_to_reveal");
  assert.equal(stageForProgress(9, [3, 6, 9], 9, true).id, "revealed");
});

test("every supported session length maps to exactly three growth milestones", () => {
  assert.deepEqual(milestonesForGoal(3), [1, 2, 3]);
  assert.deepEqual(milestonesForGoal(6), [2, 4, 6]);
  assert.deepEqual(milestonesForGoal(9), [3, 6, 9]);
  assert.deepEqual(milestonesForGoal(12), [4, 8, 12]);
  assert.equal(milestoneDefinition(12, 4).stageName, "初醒");
  assert.equal(milestoneDefinition(12, 8).stageName, "成形");
  assert.equal(milestoneDefinition(12, 12).stageName, "定型");
  assert.equal(normalizeSessionGoal(12, 12), 12);
  assert.equal(normalizeSessionGoal(12, 9), null);
});

test("structured analysis rejects invalid totals and demo fallback is stable", async () => {
  assert.equal(validateModelAnalysis({ empathy: 30, exploration: 30, discernment: 30, toneLabels: ["温柔"], companionReply: "好", memorySummary: "摘要", confidence: .5 }), null);
  const first = demoAnalyzeReflection("我想先理解你，再一起看看为什么。", 3, "light");
  const second = demoAnalyzeReflection("我想先理解你，再一起看看为什么。", 3, "light");
  assert.deepEqual(first, second);
  assert.equal(first.empathy + first.exploration + first.discernment, 100);
  const fallback = await analyzeReflection({ text: "这是一段不会被保存的回答", milestone: 3, genome: "alien" }, { COMPANION_MODEL_PROVIDER: "openai" }, async () => { throw new Error("offline"); });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.provider, "demo");
  assert.equal(fallback.analysis.empathy + fallback.analysis.exploration + fallback.analysis.discernment, 100);
});
