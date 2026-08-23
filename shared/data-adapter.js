export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 500;

export const FIELD_DEFINITIONS = Object.freeze([
  { key: "source_uid", label: "样本 UID", required: true },
  { key: "query", label: "用户问题", required: true },
  { key: "response_a", label: "回复 A", required: true },
  { key: "response_b", label: "回复 B", required: true },
  { key: "messages", label: "上下文", required: false },
  { key: "task_type", label: "任务类型", required: false },
  { key: "extra_info", label: "扩展信息", required: false },
  { key: "human_winner", label: "人工倾向", required: false },
  { key: "model_a_id", label: "模型 A ID", required: false },
  { key: "model_b_id", label: "模型 B ID", required: false },
  { key: "dimension", label: "评测维度", required: false },
  { key: "difficulty", label: "难度", required: false },
  { key: "risk", label: "风险标签", required: false }
]);

const ALIASES = Object.freeze({
  source_uid: ["source_uid", "uid", "id", "query_id", "sample_id", "样本id", "样本uid", "题目id"],
  query: ["query", "prompt", "user_query", "question", "用户问题", "问题", "最新一句"],
  response_a: ["response_a", "model_a_resp", "answer_a", "model_a_response", "回复a", "回答a", "候选a"],
  response_b: ["response_b", "model_b_resp", "answer_b", "model_b_response", "回复b", "回答b", "候选b"],
  messages: ["messages", "context", "history", "conversation", "上下文", "对话历史"],
  task_type: ["task_type", "rm_system_task_type", "category", "scene", "任务类型", "场景"],
  extra_info: ["extra_info", "metadata", "meta", "扩展信息", "元数据"],
  human_winner: ["human_winner", "winner", "chosen_model", "human_choice", "人工倾向", "人工结果"],
  model_a_id: ["model_a_id", "model_a", "model_a_version", "模型a", "模型a_id"],
  model_b_id: ["model_b_id", "model_b", "model_b_version", "模型b", "模型b_id"],
  dimension: ["dimension", "eval_dimension", "rubric", "评测维度", "维度"],
  difficulty: ["difficulty", "level", "难度", "难度等级"],
  risk: ["risk", "risk_level", "has_risk", "风险", "风险标签"]
});

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s.\-\/]+/g, "_")
    .replace(/[（）()]/g, "");
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseJsonValue(value, field, sourceRow, errors) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    errors.push({
      type: "invalid_json",
      row: sourceRow,
      field,
      message: `第 ${sourceRow} 行的「${field === "messages" ? "上下文" : "扩展信息"}」不是有效 JSON。`
    });
    return null;
  }
}

function normalizeWinner(value) {
  const normalized = normalizeHeader(value);
  if (["a", "model_a", "response_a", "answer_a", "chosen_a", "a胜", "a更好"].includes(normalized)) return "A";
  if (["b", "model_b", "response_b", "answer_b", "chosen_b", "b胜", "b更好"].includes(normalized)) return "B";
  if (["tie", "draw", "equal", "平局", "都好", "都不好", "tie_good", "tie_bad"].includes(normalized)) return "tie";
  return null;
}

function roleName(value) {
  const role = String(value ?? "").toLowerCase();
  if (["assistant", "bot", "model"].includes(role)) return "assistant";
  if (["user", "human"].includes(role)) return "user";
  return role;
}

export function extractContext(messages, query) {
  if (!Array.isArray(messages)) return [];
  const clean = messages
    .map((item) => ({ role: roleName(item?.role), content: text(item?.content) }))
    .filter((item) => ["user", "assistant"].includes(item.role) && item.content.trim());
  const last = clean.at(-1);
  if (last?.role === "user" && last.content.trim() === text(query).trim()) clean.pop();
  return clean.slice(-4);
}

export function stableHash(value) {
  let hash = 0x811c9dc5;
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function suggestMapping(headers) {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const mapping = {};
  const confidence = {};

  FIELD_DEFINITIONS.forEach((field) => {
    const aliases = ALIASES[field.key] || [];
    const match = aliases.find((alias) => normalizedHeaders.has(normalizeHeader(alias)));
    mapping[field.key] = match ? normalizedHeaders.get(normalizeHeader(match)) : "";
    confidence[field.key] = !match ? "missing" : normalizeHeader(match) === normalizeHeader(field.key) ? "exact" : "alias";
  });

  return { mapping, confidence };
}

export function scoreSheet(headers) {
  const { mapping } = suggestMapping(headers);
  const requiredMatches = FIELD_DEFINITIONS.filter((field) => field.required && mapping[field.key]).length;
  const optionalMatches = FIELD_DEFINITIONS.filter((field) => !field.required && mapping[field.key]).length;
  return { requiredMatches, optionalMatches, score: requiredMatches * 100 + optionalMatches };
}

export function validateMapping(mapping) {
  return FIELD_DEFINITIONS
    .filter((field) => field.required && !mapping[field.key])
    .map((field) => ({ type: "missing_mapping", field: field.key, message: `还没找到「${field.label}」对应的列。` }));
}

function valueFor(row, mapping, field) {
  const header = mapping[field];
  return header ? row?.[header] : "";
}

function sampleContentHash(sample) {
  return stableHash(`${sample.query}\u241f${sample.response_a}\u241f${sample.response_b}`);
}

export function normalizeRows(rows, mapping, options = {}) {
  const maxRows = options.maxRows ?? MAX_ROWS;
  const errors = [...validateMapping(mapping)];
  const warnings = [];
  const duplicateGroups = [];
  const samples = [];
  const seenUids = new Map();
  const seenContent = new Map();
  const rawRows = Array.isArray(rows) ? rows : [];

  if (rawRows.length > maxRows) {
    errors.push({ type: "row_limit", message: `这份表有 ${rawRows.length} 行，第一版最多处理 ${maxRows} 行。` });
  }

  rawRows.slice(0, maxRows).forEach((row, index) => {
    const sourceRow = index + 2;
    const rowErrors = [];
    const sourceUid = text(valueFor(row, mapping, "source_uid")).trim();
    const query = text(valueFor(row, mapping, "query"));
    const responseA = text(valueFor(row, mapping, "response_a"));
    const responseB = text(valueFor(row, mapping, "response_b"));

    [["source_uid", "样本 UID", sourceUid], ["query", "用户问题", query], ["response_a", "回复 A", responseA], ["response_b", "回复 B", responseB]].forEach(([field, label, value]) => {
      if (!String(value).trim()) rowErrors.push({ type: "missing_value", row: sourceRow, field, message: `第 ${sourceRow} 行缺少「${label}」。` });
    });

    const messages = parseJsonValue(valueFor(row, mapping, "messages"), "messages", sourceRow, rowErrors);
    const extraInfo = parseJsonValue(valueFor(row, mapping, "extra_info"), "extra_info", sourceRow, rowErrors);
    errors.push(...rowErrors);
    if (rowErrors.length) return;

    const explicitWinner = normalizeWinner(valueFor(row, mapping, "human_winner"));
    const winnerFromExtra = normalizeWinner(extraInfo?.chosen_model);
    const difficultyRaw = text(valueFor(row, mapping, "difficulty")).trim();
    const difficultyNumber = difficultyRaw ? Number(difficultyRaw) : null;
    const difficulty = Number.isInteger(difficultyNumber) && difficultyNumber >= 1 && difficultyNumber <= 5 ? difficultyNumber : null;

    if (difficultyRaw && difficulty === null) {
      warnings.push({ type: "invalid_difficulty", row: sourceRow, message: `第 ${sourceRow} 行的难度不在 1–5，已按「未提供」处理。` });
    }

    const sample = {
      source_uid: sourceUid,
      source_row: sourceRow,
      query,
      context: extractContext(messages, query),
      response_a: responseA,
      response_b: responseB,
      task_type: text(valueFor(row, mapping, "task_type")).trim() || null,
      human_winner: explicitWinner || winnerFromExtra,
      model_a_id: text(valueFor(row, mapping, "model_a_id")).trim() || null,
      model_b_id: text(valueFor(row, mapping, "model_b_id")).trim() || null,
      dimension: text(valueFor(row, mapping, "dimension")).trim() || null,
      difficulty,
      risk: text(valueFor(row, mapping, "risk")).trim() || null,
      metadata: extraInfo || null
    };
    sample.content_hash = sampleContentHash(sample);

    if (seenUids.has(sourceUid)) {
      const existing = seenUids.get(sourceUid);
      let group = duplicateGroups.find((item) => item.uid === sourceUid);
      if (!group) {
        group = { uid: sourceUid, rows: [existing.source_row] };
        duplicateGroups.push(group);
      }
      group.rows.push(sourceRow);
      return;
    }

    if (seenContent.has(sample.content_hash)) {
      warnings.push({
        type: "duplicate_content",
        row: sourceRow,
        message: `第 ${sourceRow} 行和第 ${seenContent.get(sample.content_hash)} 行内容相同，但 UID 不同。`
      });
    } else {
      seenContent.set(sample.content_hash, sourceRow);
    }

    if (!sample.model_a_id || !sample.model_b_id) {
      warnings.push({ type: "missing_model_id", row: sourceRow, message: `第 ${sourceRow} 行缺少完整模型 ID。` });
    }
    if (!sample.dimension) warnings.push({ type: "missing_dimension", row: sourceRow, message: `第 ${sourceRow} 行没有评测维度。` });
    if (!sample.difficulty) warnings.push({ type: "missing_difficulty", row: sourceRow, message: `第 ${sourceRow} 行没有有效难度。` });
    if (responseA.length > 8000 || responseB.length > 8000) warnings.push({ type: "long_response", row: sourceRow, message: `第 ${sourceRow} 行有超过 8,000 字的回复。` });

    seenUids.set(sourceUid, sample);
    samples.push(sample);
  });

  if (!rawRows.length) errors.push({ type: "empty_sheet", message: "这个工作表没有可用数据。" });
  if (rawRows.length && !samples.length && !errors.length) errors.push({ type: "no_valid_rows", message: "没有找到可以发布的样本。" });

  const missingModelIds = samples.filter((sample) => !sample.model_a_id || !sample.model_b_id).length;
  const missingDimensions = samples.filter((sample) => !sample.dimension).length;
  const missingDifficulty = samples.filter((sample) => !sample.difficulty).length;

  return {
    samples,
    errors,
    warnings,
    duplicateGroups,
    summary: {
      total_rows: rawRows.length,
      usable_rows: samples.length,
      excluded_duplicate_rows: duplicateGroups.reduce((sum, group) => sum + group.rows.length - 1, 0),
      missing_model_ids: missingModelIds,
      missing_dimensions: missingDimensions,
      missing_difficulty: missingDifficulty,
      has_model_ids: samples.length > 0 && missingModelIds === 0
    }
  };
}

export function acceptedFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".csv");
}
