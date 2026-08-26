import { cleanReasonTags, hashNumber, isRecord } from "./arena-utils.js";

export const GENOMES = Object.freeze({
  light: { id: "light", name: "澄光", tone: "矿植、透亮、好奇" },
  cloud: { id: "cloud", name: "绒云", tone: "苔绒、夜林、陪伴" },
  alien: { id: "alien", name: "异星", tone: "洞穴、星孢、探索" }
});

export const AXES = Object.freeze(["empathy", "exploration", "discernment"]);
export const TONE_LABELS = Object.freeze(["温柔", "直接", "好奇", "克制", "幽默", "理性"]);
export const PROMPT_VERSION = "liaoling-reflection-v1";
export const SESSION_GOALS = Object.freeze([3, 6, 9, 12]);

const MILESTONE_TEMPLATES = Object.freeze([
  { stage: "awakening", stageName: "初醒", prompt: "如果我今天没接住你，你会怎么对我说？" },
  { stage: "forming", stageName: "成形", prompt: "一句话走偏时，你会先在意什么？" },
  { stage: "revealed", stageName: "定型", prompt: "如果我们只剩最后一句，你想留给我什么？" }
]);

export const MILESTONES = Object.freeze({
  3: { milestone: 3, ...MILESTONE_TEMPLATES[0] },
  6: { milestone: 6, ...MILESTONE_TEMPLATES[1] },
  9: { milestone: 9, ...MILESTONE_TEMPLATES[2] }
});

export function normalizeSessionGoal(value, available = 12) {
  const goal = Number(value);
  if (!SESSION_GOALS.includes(goal)) return null;
  return goal <= Number(available || 0) ? goal : null;
}

export function milestonesForGoal(goal = 9) {
  const normalized = Math.max(1, Math.floor(Number(goal) || 9));
  return [...new Set([Math.ceil(normalized / 3), Math.ceil(normalized * 2 / 3), normalized])];
}

export function milestoneDefinition(goal = 9, milestone) {
  const milestones = milestonesForGoal(goal);
  const index = milestones.indexOf(Number(milestone));
  if (index < 0) return null;
  const templateIndex = index === milestones.length - 1 ? 2 : Math.min(index, 1);
  return { milestone: Number(milestone), ...MILESTONE_TEMPLATES[templateIndex] };
}

export const SPECIES = Object.freeze({
  sprout_pop: { id: "sprout-pop", name: "芽啵", tagline: "先把情绪接进来，再让一句话慢慢发芽。", sprite: "ya-bo.png" },
  grit_tail: { id: "grit-tail", name: "砾尾", tagline: "沿着细节跳一跳，替你找到更清楚的落点。", sprite: "li-wei.png" },
  moss_antler: { id: "moss-antler", name: "苔角", tagline: "把一点好奇放软，陪你往前探一探。", sprite: "tai-jiao.png" },
  warm_lantern: { id: "warm-lantern", name: "暖灯", tagline: "先点亮你在意的地方，再慢慢接住它。", sprite: "nuan-deng.png" },
  star_coil: { id: "star-coil", name: "卷星", tagline: "把没有说完的话，卷成下一次靠近的路。", sprite: "juan-xing.png" },
  night_ink: { id: "night-ink", name: "夜墨", tagline: "在陌生的角落里，也替你留一盏冷静的光。", sprite: "ye-mo.png" }
});

const REASON_AXIS = Object.freeze({
  "更懂我": "empathy",
  "会接话": "empathy",
  "更自然": "exploration",
  "有增量": "exploration",
  "更准确": "discernment",
  "更克制": "discernment"
});

export function emptyScores() {
  return { empathy: 0, exploration: 0, discernment: 0 };
}

export function addScores(...rows) {
  return rows.reduce((total, row) => {
    AXES.forEach((axis) => { total[axis] += Number(row?.[axis] || 0); });
    return total;
  }, emptyScores());
}

export function largestRemainder(values, total) {
  const source = AXES.map((axis) => Math.max(0, Number(values?.[axis] || 0)));
  const sum = source.reduce((value, item) => value + item, 0);
  if (!sum || total <= 0) return emptyScores();
  const exact = source.map((value) => value / sum * total);
  const result = exact.map(Math.floor);
  let remaining = total - result.reduce((value, item) => value + item, 0);
  exact.map((value, index) => ({ index, fraction: value - result[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
    .forEach(({ index }) => { if (remaining > 0) { result[index] += 1; remaining -= 1; } });
  return Object.fromEntries(AXES.map((axis, index) => [axis, result[index]]));
}

export function scoreReasonTags(value) {
  const tags = cleanReasonTags(value);
  if (!tags.length) return emptyScores();
  const weights = emptyScores();
  tags.forEach((tag) => { weights[REASON_AXIS[tag]] += 1; });
  return largestRemainder(weights, 6);
}

export function analysisToPoints(analysis) {
  return largestRemainder(analysis, 10);
}

export function speciesForScores(scores, genome = "light") {
  const values = Object.fromEntries(AXES.map((axis) => [axis, Number(scores?.[axis] || 0)]));
  if (genome === "cloud") return values.discernment > values.exploration ? SPECIES.warm_lantern : SPECIES.moss_antler;
  if (genome === "alien") return values.empathy > values.discernment ? SPECIES.star_coil : SPECIES.night_ink;
  return values.exploration > values.empathy ? SPECIES.grit_tail : SPECIES.sprout_pop;
}

export function stageForProgress(completed, reflected = [], goal = 9, finalized = false) {
  const done = new Set(reflected.map(Number));
  const milestones = milestonesForGoal(goal);
  const finalMilestone = milestones.at(-1);
  const formingMilestone = milestones.length >= 3 ? milestones[1] : null;
  const awakeningMilestone = milestones.length >= 2 ? milestones[0] : null;
  if (Number(completed) >= finalMilestone && done.has(finalMilestone)) return finalized
    ? { id: "revealed", name: "定型", level: 4 }
    : { id: "ready_to_reveal", name: "待装订", level: 4 };
  if (formingMilestone && Number(completed) >= formingMilestone && done.has(formingMilestone)) return { id: "forming", name: "成形", level: 3 };
  if (awakeningMilestone && Number(completed) >= awakeningMilestone && done.has(awakeningMilestone)) return { id: "awakening", name: "初醒", level: 2 };
  return { id: "birth", name: "出生", level: 1 };
}

export function pendingMilestone(completed, reflected = [], goal = 9) {
  const done = new Set(reflected.map(Number));
  return milestonesForGoal(goal).find((milestone) => Number(completed) >= milestone && !done.has(milestone)) || null;
}

export function nextMilestone(completed, goal = 9) {
  return milestonesForGoal(goal).find((milestone) => Number(completed) < milestone) || null;
}

export function validateReflectionInput(value, goal = 9) {
  if (!isRecord(value)) return { ok: false, message: "成长回答格式不对。" };
  const milestone = Number(value.milestone);
  if (!milestoneDefinition(goal, milestone)) return { ok: false, message: "成长阶段不对。" };
  if (typeof value.text !== "string") return { ok: false, message: "成长回答格式不对。" };
  const text = value.text.trim();
  if (text.length > 180) return { ok: false, message: "最多写 180 个字。" };
  return { ok: true, milestone, text };
}

export function validateModelAnalysis(value) {
  if (!isRecord(value)) return null;
  const axes = Object.fromEntries(AXES.map((axis) => [axis, Number(value[axis])]));
  if (AXES.some((axis) => !Number.isInteger(axes[axis]) || axes[axis] < 0 || axes[axis] > 100)) return null;
  if (AXES.reduce((sum, axis) => sum + axes[axis], 0) !== 100) return null;
  const toneLabels = Array.isArray(value.toneLabels) ? [...new Set(value.toneLabels.filter((item) => TONE_LABELS.includes(item)))].slice(0, 2) : [];
  if (!toneLabels.length || typeof value.companionReply !== "string" || typeof value.memorySummary !== "string") return null;
  const companionReply = value.companionReply.trim().slice(0, 36);
  const memorySummary = value.memorySummary.trim().slice(0, 40);
  const confidence = Number(value.confidence);
  if (!companionReply || !memorySummary || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { ...axes, toneLabels, companionReply, memorySummary, confidence };
}

function normalizeHundred(values) {
  return largestRemainder(values, 100);
}

export function demoAnalyzeReflection(text, milestone, genome = "light") {
  const source = String(text || "").trim();
  const scores = { empathy: 34, exploration: 33, discernment: 33 };
  const lexicons = {
    empathy: ["理解", "感受", "陪", "抱歉", "谢谢", "难过", "没关系", "听见", "接住", "在意"],
    exploration: ["为什么", "怎样", "试试", "也许", "可能", "如果", "想知道", "好奇", "继续", "一起"],
    discernment: ["准确", "事实", "边界", "先", "但是", "确认", "清楚", "具体", "分寸", "判断"]
  };
  AXES.forEach((axis) => lexicons[axis].forEach((word) => { if (source.includes(word)) scores[axis] += 7; }));
  scores.exploration += (source.match(/[？?]/g) || []).length * 3;
  scores.empathy += (source.match(/[。！!～~]/g) || []).length;
  scores.discernment += source.length > 0 && source.length <= 24 ? 3 : 0;
  const jitter = hashNumber(`${source}|${milestone}|${genome}`) % 3;
  scores[AXES[jitter]] += 2;
  const normalized = normalizeHundred(scores);
  const top = AXES.slice().sort((a, b) => normalized[b] - normalized[a])[0];
  const replies = {
    empathy: "我听见了。下一句，我会先把你接稳。",
    exploration: "我记下这阵风了。我们再往前看一点。",
    discernment: "我会靠近，也会替这句话留住分寸。"
  };
  const summaries = {
    empathy: "你更常从理解与回应开始一段对话",
    exploration: "你愿意为一句话保留新的可能",
    discernment: "你在靠近时也珍惜准确与边界"
  };
  return {
    ...normalized,
    toneLabels: top === "empathy" ? ["温柔", "克制"] : top === "exploration" ? ["好奇", "幽默"] : ["理性", "直接"],
    companionReply: replies[top],
    memorySummary: summaries[top],
    confidence: source ? 0.58 : 0.35
  };
}
