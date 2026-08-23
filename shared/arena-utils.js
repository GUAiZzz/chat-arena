export const VALID_VOTES = Object.freeze(["A", "B", "tie_good", "tie_bad"]);
export const REASON_TAGS = Object.freeze(["更懂我", "更自然", "有增量", "会接话", "更准确", "更克制"]);

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function clampInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

export function todayKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function yesterdayKey(today) {
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return todayKey(date);
}

export function hashNumber(value) {
  let hash = 0x811c9dc5;
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shouldSwap(userId, datasetVersionId, sampleId) {
  return hashNumber(`${userId}|${datasetVersionId}|${sampleId}`) % 2 === 1;
}

export function remapDisplayedVote(vote, swapped) {
  if (!swapped || !["A", "B"].includes(vote)) return vote;
  return vote === "A" ? "B" : "A";
}

export function displayReference(winner, swapped) {
  if (!["A", "B"].includes(winner)) return winner || null;
  return remapDisplayedVote(winner, swapped);
}

export function cleanReasonTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag) => REASON_TAGS.includes(tag)))].slice(0, 2);
}

export function validateVotePayload(payload) {
  const errors = [];
  if (!isRecord(payload)) return ["请求内容不是有效对象。"];
  if (!VALID_VOTES.includes(payload.winner)) errors.push("请选择 A、B、都挺好或都不行。");
  if (typeof payload.sampleToken !== "string" || !payload.sampleToken.trim()) errors.push("这道题已经失效，请重新取题。");
  if (payload.reasonTags !== undefined && (!Array.isArray(payload.reasonTags) || cleanReasonTags(payload.reasonTags).length !== new Set(payload.reasonTags).size)) {
    errors.push("判断依据包含无效标签，或超过 2 个。");
  }
  const dwellMs = Number(payload.dwellMs ?? 0);
  if (!Number.isFinite(dwellMs) || dwellMs < 0 || dwellMs > 3_600_000) errors.push("停留时间不在有效范围内。");
  if (payload.contextOpened !== undefined && typeof payload.contextOpened !== "boolean") errors.push("上下文状态无效。");
  return errors;
}

export function nextStreak(previous, today = todayKey()) {
  if (!previous?.last_active) return 1;
  if (previous.last_active === today) return Math.max(1, Number(previous.streak) || 1);
  return previous.last_active === yesterdayKey(today) ? Math.max(1, (Number(previous.streak) || 0) + 1) : 1;
}

export function chooseBalancedSample(samples, dimensionCounts, seed) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const counts = isRecord(dimensionCounts) ? dimensionCounts : {};
  const minimum = Math.min(...samples.map((sample) => Number(counts[sample.dimension || "未标注"] || 0)));
  const candidates = samples.filter((sample) => Number(counts[sample.dimension || "未标注"] || 0) === minimum);
  return candidates[hashNumber(seed) % candidates.length];
}

export function aggregateVotes(votes, samples = []) {
  const distribution = { A: 0, B: 0, tie_good: 0, tie_bad: 0 };
  const raters = new Set();
  const sampleMap = new Map(samples.map((sample) => [sample.id, sample]));
  const dimensions = new Map();
  const perSample = new Map();

  votes.forEach((vote) => {
    if (Object.hasOwn(distribution, vote.winner)) distribution[vote.winner] += 1;
    if (vote.rater_id) raters.add(vote.rater_id);
    const sample = sampleMap.get(vote.sample_id);
    const dimension = sample?.dimension || "未标注";
    const dimensionRow = dimensions.get(dimension) || { dimension, samples: 0, votes: 0 };
    dimensionRow.votes += 1;
    dimensions.set(dimension, dimensionRow);

    const dispute = perSample.get(vote.sample_id) || { sample_id: vote.sample_id, total: 0, counts: { A: 0, B: 0, tie_good: 0, tie_bad: 0 } };
    dispute.total += 1;
    if (Object.hasOwn(dispute.counts, vote.winner)) dispute.counts[vote.winner] += 1;
    perSample.set(vote.sample_id, dispute);
  });

  samples.forEach((sample) => {
    const dimension = sample.dimension || "未标注";
    const row = dimensions.get(dimension) || { dimension, samples: 0, votes: 0 };
    row.samples += 1;
    dimensions.set(dimension, row);
  });

  const disputed = [...perSample.values()]
    .map((item) => {
      const maximum = Math.max(...Object.values(item.counts));
      const sample = sampleMap.get(item.sample_id);
      return { ...item, disagreement: item.total ? 1 - maximum / item.total : 0, query: sample?.query || "" };
    })
    .filter((item) => item.total >= 2 && item.disagreement > 0)
    .sort((left, right) => right.disagreement - left.disagreement || right.total - left.total)
    .slice(0, 8);

  return {
    total_votes: votes.length,
    participants: raters.size,
    distribution,
    dimensions: [...dimensions.values()].sort((left, right) => right.votes - left.votes || left.dimension.localeCompare(right.dimension, "zh-CN")),
    disputed
  };
}
