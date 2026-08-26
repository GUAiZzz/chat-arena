import { AXES, GENOMES, PROMPT_VERSION, TONE_LABELS, demoAnalyzeReflection, milestoneDefinition, validateModelAnalysis } from "./companion-growth.js?v=3.1.5";

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: [...AXES, "toneLabels", "companionReply", "memorySummary", "confidence"],
  properties: {
    empathy: { type: "integer", minimum: 0, maximum: 100 },
    exploration: { type: "integer", minimum: 0, maximum: 100 },
    discernment: { type: "integer", minimum: 0, maximum: 100 },
    toneLabels: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: TONE_LABELS } },
    companionReply: { type: "string", minLength: 1, maxLength: 36 },
    memorySummary: { type: "string", minLength: 1, maxLength: 40 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

function promptFor({ text, milestone, genome, goal = 9 }) {
  const stage = milestoneDefinition(goal, milestone) || milestoneDefinition(9, milestone);
  const genomeRow = GENOMES[genome] || GENOMES.light;
  return {
    system: `你是“聊灵”成长分析器。只分析用户这一次自愿写下的中文回答，不推断身份、心理疾病、政治、健康或其他敏感属性。三个分数必须是整数且总和为 100：empathy=共感，exploration=探索，discernment=分辨。回应温暖、克制、无评判。memorySummary 只能概括沟通偏好，不得复述原句。聊灵出生气质：${genomeRow.name}（${genomeRow.tone}）。`,
    user: `成长阶段：${stage.stageName}\n问题：${stage.prompt}\n用户回答：${text}`
  };
}

function extractOpenAI(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) if (typeof content?.text === "string") return content.text;
  }
  return "";
}

async function fetchJson(url, options, fetchImpl, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(input, env, fetchImpl) {
  if (!env.OPENAI_API_KEY) throw new Error("openai_key_missing");
  const prompt = promptFor(input);
  const payload = await fetchJson(env.OPENAI_BASE_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      text: { format: { type: "json_schema", name: "liaoling_reflection", strict: true, schema: analysisSchema } }
    })
  }, fetchImpl);
  return { analysis: validateModelAnalysis(JSON.parse(extractOpenAI(payload))), model: payload.model || env.OPENAI_MODEL || "gpt-5.6-luna" };
}

async function callQwen(input, env, fetchImpl) {
  if (!env.DASHSCOPE_API_KEY) throw new Error("qwen_key_missing");
  const prompt = promptFor(input);
  const base = String(env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const model = env.QWEN_MODEL || "qwen3.7-plus";
  const payload = await fetchJson(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      response_format: { type: "json_schema", json_schema: { name: "liaoling_reflection", strict: true, schema: analysisSchema } }
    })
  }, fetchImpl);
  return { analysis: validateModelAnalysis(JSON.parse(payload?.choices?.[0]?.message?.content || "")), model: payload.model || model };
}

export async function analyzeReflection(input, env = {}, fetchImpl = fetch) {
  const provider = String(env.COMPANION_MODEL_PROVIDER || "demo").toLowerCase();
  try {
    const result = provider === "openai"
      ? await callOpenAI(input, env, fetchImpl)
      : provider === "qwen"
        ? await callQwen(input, env, fetchImpl)
        : null;
    if (!result?.analysis) throw new Error("model_output_invalid");
    return { ...result, provider, fallback: false, promptVersion: PROMPT_VERSION };
  } catch {
    return {
      analysis: demoAnalyzeReflection(input.text, input.milestone, input.genome),
      provider: "demo",
      model: "deterministic-v1",
      fallback: true,
      promptVersion: PROMPT_VERSION
    };
  }
}

export const __test = { analysisSchema, extractOpenAI, promptFor };
