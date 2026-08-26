import { aggregateVotes, chooseBalancedSample, cleanReasonTags, displayReference, hashNumber, nextStreak, remapDisplayedVote, shouldSwap, todayKey, validateVotePayload } from "../shared/arena-utils.js?v=3.1.4";
import { MAX_FILE_BYTES, MAX_ROWS } from "../shared/data-adapter.js?v=3.1.4";
import {
  GENOMES,
  SPECIES,
  addScores,
  analysisToPoints,
  milestoneDefinition,
  milestonesForGoal,
  normalizeSessionGoal,
  pendingMilestone,
  scoreReasonTags,
  speciesForScores,
  stageForProgress,
  validateReflectionInput
} from "../shared/companion-growth.js?v=3.1.4";
import { analyzeReflection } from "../shared/companion-model.js?v=3.1.4";
import { demoSamples, demoSummary } from "../fixtures/demo-dataset.js?v=3.1.4";

function json(data, status = 200) {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(data) };
}

function error(message, status = 400, code = "bad_request", details) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

function versionDto(version) {
  if (!version) return null;
  return {
    id: version.id,
    displayName: version.display_name,
    status: version.status,
    sourceFilename: version.source_filename || null,
    sourceType: version.source_type || null,
    sourceSha256: version.source_sha256 || null,
    sampleCount: version.samples.length,
    summary: version.summary,
    createdBy: version.created_by,
    createdAt: version.created_at,
    publishedAt: version.published_at || null
  };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

function bodySize(value) {
  return toBytes(value).byteLength;
}

function bodyText(value) {
  return new TextDecoder().decode(toBytes(value));
}

export function createLocalApi(runtimeEnv = {}) {
  const now = new Date().toISOString();
  const storage = runtimeEnv.storage || null;
  const storageKey = runtimeEnv.storageKey || "chat-arena:pixel-storybook:v1";
  const runtime = runtimeEnv.runtime || "local";
  const freshState = () => ({
    versions: [{
      id: "local-demo-v1",
      display_name: runtime === "static" ? "Chat Arena Demo Case · 浏览器演示" : "Chat Arena Demo Case · 离线演示",
      status: "active",
      source_filename: "chat-arena-demo.xlsx",
      source_type: "xlsx",
      source_sha256: null,
      created_by: "local-admin",
      created_at: now,
      published_at: now,
      summary: structuredClone(demoSummary),
      samples: structuredClone(demoSamples)
    }],
    votes: [],
    tokens: new Map(),
    progress: new Map(),
    companion: null
  });
  let state = freshState();
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || "null");
      if (saved?.versions && Array.isArray(saved.votes)) {
        state = { ...saved, tokens: new Map(saved.tokens || []), progress: new Map(saved.progress || []) };
      }
    } catch {
      state = freshState();
    }
  }
  const persist = () => {
    if (!storage) return;
    storage.setItem(storageKey, JSON.stringify({
      ...state,
      tokens: [...state.tokens.entries()],
      progress: [...state.progress.entries()]
    }));
  };
  const user = runtimeEnv.user || (runtime === "static"
    ? { id: "browser-demo", email: "browser@local.test", name: "浏览器访客" }
    : { id: "local-admin", email: "local@demo.test", name: "本地管理员" });

  const active = () => state.versions.find((version) => version.status === "active") || null;
  const progressKey = (versionId) => `${versionId}:${user.id}`;
  const defaultGoal = (version) => Math.min(9, version?.samples.length || 0);
  const progressFor = (version) => version ? state.progress.get(progressKey(version.id)) : null;
  const versionGoal = (version, progress = progressFor(version)) => normalizeSessionGoal(progress?.goal, version?.samples.length || 0) || defaultGoal(version);

  const ensureSeason = (version) => {
    if (!state.companion || !version) return null;
    let season = state.companion.seasons.find((item) => item.dataset_version_id === version.id);
    if (season) return season;
    season = {
      id: crypto.randomUUID(),
      dataset_version_id: version.id,
      role: state.companion.main_season_id ? "echo" : "main",
      stage: "birth",
      scores: { empathy: 0, exploration: 0, discernment: 0 },
      species: null,
      revealed_at: null,
      events: []
    };
    state.companion.seasons.push(season);
    if (!state.companion.main_season_id) state.companion.main_season_id = season.id;
    return season;
  };

  const recomputeSeason = (season, version) => {
    const previousReveal = Boolean(season.revealed_at);
    season.scores = addScores(...season.events.map((event) => event.delta));
    const progress = progressFor(version);
    const goal = versionGoal(version, progress);
    const reflected = season.events.filter((event) => event.source_type === "reflection").map((event) => event.milestone);
    const completed = Math.min(goal, progress?.completed || 0);
    const stage = stageForProgress(completed, reflected, goal, previousReveal);
    season.stage = stage.id;
    if (stage.id === "revealed") {
      const species = speciesForScores(season.scores, state.companion.genome);
      season.species = species.id;
      season.revealed_at ||= new Date().toISOString();
      if (!previousReveal) {
        if (season.role === "main") state.companion.main_species = species.id;
        else state.companion.lineage_count += 1;
      }
    }
  };

  const companionSnapshot = (version = active(), createSeason = true) => {
    if (!state.companion) return { born: false, genomes: Object.values(GENOMES) };
    const season = createSeason ? ensureSeason(version) : state.companion.seasons.find((item) => item.dataset_version_id === version?.id);
    if (!season || !version) return { born: true, companion: { genome: state.companion.genome, mainSpecies: state.companion.main_species, lineageCount: state.companion.lineage_count }, season: null };
    const progress = progressFor(version);
    const goal = versionGoal(version, progress);
    const reflected = season.events.filter((event) => event.source_type === "reflection").map((event) => event.milestone);
    const completed = Math.min(goal, progress?.completed || 0);
    const stage = stageForProgress(completed, reflected, goal, Boolean(season.revealed_at));
    const pending = pendingMilestone(completed, reflected, goal);
    const upcoming = milestonesForGoal(goal).find((milestone) => completed < milestone) || null;
    const latest = season.events.slice().reverse().find((event) => event.companion_reply);
    const species = Object.values(SPECIES).find((item) => item.id === season.species) || null;
    return {
      born: true,
      companion: { genome: state.companion.genome, genomeName: GENOMES[state.companion.genome].name, mainSpecies: state.companion.main_species, lineageCount: state.companion.lineage_count },
      season: {
        id: season.id,
        role: season.role,
        stage: stage.id,
        stageName: stage.name,
        completed,
        total: goal,
        goal,
        nextMilestone: upcoming,
        remaining: upcoming ? Math.max(0, upcoming - completed) : 0,
        pendingReflection: pending ? milestoneDefinition(goal, pending) : null,
        latestReply: latest?.companion_reply || null,
        analysisMode: latest?.fallback ? "demo" : latest?.provider || "rules",
        revealed: Boolean(species),
        finalized: Boolean(season.revealed_at),
        canFinalize: stage.id === "ready_to_reveal",
        species: species ? { id: species.id, name: species.name, tagline: species.tagline, sprite: species.sprite } : null,
        traces: season.events.filter((event) => event.source_type === "reflection" && event.memory_summary).slice(-3).map((event) => event.memory_summary)
      }
    };
  };

  const upsertVoteGrowth = (version, voteId, reasonTags) => {
    const season = ensureSeason(version);
    if (!season) return companionSnapshot(version, false);
    const event = season.events.find((item) => item.source_type === "vote" && item.source_id === voteId);
    const row = { source_type: "vote", source_id: voteId, delta: scoreReasonTags(reasonTags), provider: "rules", fallback: false };
    if (event) Object.assign(event, row);
    else season.events.push(row);
    recomputeSeason(season, version);
    return companionSnapshot(version, false);
  };

  const session = () => {
    const version = active();
    const progress = progressFor(version);
    const total = versionGoal(version, progress);
    const completed = Math.min(total, progress?.completed || 0);
    return { user, isAdmin: true, runtime, activeVersion: versionDto(version), progress: { completed, total, goal: total, remaining: Math.max(0, total - completed), streak: progress?.streak || 0 }, companion: companionSnapshot(version), capabilities: { followUp: false, modelLeaderboard: false } };
  };

  const handle = async function localApi(request, bodyBuffer = new Uint8Array()) {
    const url = new URL(request.url, "http://127.0.0.1");
    const method = request.method || "GET";
    const parseBody = () => {
      try { return JSON.parse(bodyText(bodyBuffer) || "{}"); } catch { return null; }
    };

    if (method === "GET" && url.pathname === "/api/session") return json(session());

    if (method === "GET" && url.pathname === "/api/companion") return json({ companion: companionSnapshot() });

    if (method === "POST" && url.pathname === "/api/companion/birth") {
      const body = parseBody();
      const genome = String(body?.genome || "");
      if (!GENOMES[genome]) return error("请选择一种出生基因。", 422, "invalid_genome");
      if (state.companion && state.companion.genome !== genome) return error("出生基因已经确定。", 409, "genome_locked");
      const version = active();
      const requestedGoal = normalizeSessionGoal(body?.goal, version?.samples.length || 0) || defaultGoal(version);
      const existingProgress = progressFor(version);
      if (existingProgress?.goal && Number(existingProgress.goal) !== requestedGoal) return error("本轮题数已经确定，请先重置当前体验。", 409, "goal_locked");
      const existed = Boolean(state.companion);
      state.companion ||= { id: crypto.randomUUID(), genome, main_species: null, main_season_id: null, lineage_count: 0, seasons: [] };
      ensureSeason(version);
      if (version) state.progress.set(progressKey(version.id), {
        ...(existingProgress || {}),
        completed: existingProgress?.completed || 0,
        goal: requestedGoal,
        streak: existingProgress?.streak || 0,
        last_active: existingProgress?.last_active || null
      });
      return json({ companion: companionSnapshot() }, existed ? 200 : 201);
    }

    if (method === "POST" && url.pathname === "/api/companion/reflections") {
      const version = active();
      const goal = versionGoal(version);
      const parsed = validateReflectionInput(parseBody(), goal);
      if (!parsed.ok) return error(parsed.message, 422, "invalid_reflection");
      if (!state.companion) return error("先选择聊灵的出生基因。", 409, "companion_not_born");
      const season = ensureSeason(version);
      const duplicate = season.events.find((item) => item.source_type === "reflection" && item.milestone === parsed.milestone);
      if (duplicate) return json({ companion: companionSnapshot(version, false), alreadySubmitted: true });
      const reflected = season.events.filter((item) => item.source_type === "reflection").map((item) => item.milestone);
      const completed = Math.min(goal, state.progress.get(progressKey(version.id))?.completed || 0);
      if (pendingMilestone(completed, reflected, goal) !== parsed.milestone) return error("这个成长阶段还没到，或者已经完成。", 409, "milestone_not_due");
      let analysis;
      let metadata;
      if (parsed.text) {
        const nodeEnv = globalThis.process?.env || {};
        metadata = await analyzeReflection({ text: parsed.text, milestone: parsed.milestone, goal, genome: state.companion.genome }, { ...nodeEnv, COMPANION_MODEL_PROVIDER: runtimeEnv.COMPANION_MODEL_PROVIDER || nodeEnv.COMPANION_MODEL_PROVIDER || "demo" });
        analysis = metadata.analysis;
      } else {
        analysis = { empathy: 0, exploration: 0, discernment: 0, toneLabels: [], companionReply: "留白也被我记住了。我们继续往前走。", memorySummary: "你为这一刻保留了一点安静", confidence: 1 };
        metadata = { provider: "skipped", model: null, fallback: false, promptVersion: "liaoling-reflection-v1" };
      }
      season.events.push({
        source_type: "reflection",
        source_id: `milestone:${parsed.milestone}`,
        milestone: parsed.milestone,
        delta: parsed.text ? analysisToPoints(analysis) : { empathy: 0, exploration: 0, discernment: 0 },
        tone_labels: analysis.toneLabels,
        companion_reply: analysis.companionReply,
        memory_summary: analysis.memorySummary,
        provider: metadata.provider,
        model: metadata.model,
        prompt_version: metadata.promptVersion,
        confidence: analysis.confidence,
        fallback: metadata.fallback
      });
      recomputeSeason(season, version);
      return json({ companion: companionSnapshot(version, false), reply: analysis.companionReply }, 201);
    }

    if (method === "POST" && url.pathname === "/api/companion/finalize") {
      const version = active();
      if (!state.companion) return error("先选择聊灵的出生基因。", 409, "companion_not_born");
      const season = ensureSeason(version);
      const progress = progressFor(version);
      const goal = versionGoal(version, progress);
      const reflected = season.events.filter((item) => item.source_type === "reflection").map((item) => item.milestone);
      const completed = Math.min(goal, Number(progress?.completed || 0));
      if (completed < goal || pendingMilestone(completed, reflected, goal) !== null) return error("请先完成全部书页和成长章节。", 409, "not_ready_to_finalize");
      if (!season.revealed_at) {
        const species = speciesForScores(season.scores, state.companion.genome);
        season.species = species.id;
        season.revealed_at = new Date().toISOString();
        if (season.role === "main") state.companion.main_species = species.id;
        else state.companion.lineage_count += 1;
      }
      recomputeSeason(season, version);
      return json({ companion: companionSnapshot(version, false), finalized: true });
    }

    if (method === "POST" && url.pathname === "/api/demo/reset") {
      state.votes.length = 0;
      state.tokens.clear();
      state.progress.clear();
      state.companion = null;
      return json({ reset: true, session: session() });
    }

    if (method === "GET" && url.pathname === "/api/companion/review") {
      const version = active();
      const pages = state.votes
        .filter((vote) => vote.dataset_version_id === version?.id && vote.rater_id === user.id)
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
        .map((vote) => {
          const sample = version.samples.find((item) => item.id === vote.sample_id);
          if (!sample) return null;
          const swapped = Boolean(vote.display_swapped);
          return {
            voteId: vote.id,
            winner: remapDisplayedVote(vote.winner, swapped),
            reasons: [...(vote.reason_tags || [])],
            reference: null,
            payload: {
              dataset: versionDto(version),
              battle: {
                sampleToken: null,
                query: sample.query,
                context: sample.context || [],
                responseA: { text: swapped ? sample.response_b : sample.response_a },
                responseB: { text: swapped ? sample.response_a : sample.response_b },
                dimension: sample.dimension || null,
                difficulty: sample.difficulty || null,
                risk: sample.risk || null
              }
            }
          };
        }).filter(Boolean);
      return json({ pages });
    }

    if (method === "GET" && url.pathname === "/api/battles/next") {
      const version = active();
      if (!version) return json({ battle: null, reason: "no_active_dataset" });
      const current = state.progress.get(progressKey(version.id));
      const total = versionGoal(version, current);
      const growth = companionSnapshot(version);
      if (growth.season?.pendingReflection) return json({ battle: null, reason: "reflection_pending", dataset: versionDto(version), companion: growth });
    if ((current?.completed || 0) >= total) return json({ battle: null, reason: growth.season?.canFinalize ? "ready_to_reveal" : "complete", dataset: versionDto(version), companion: growth });
      const voted = new Set(state.votes.filter((vote) => vote.dataset_version_id === version.id && vote.rater_id === user.id).map((vote) => vote.sample_id));
      const available = version.samples.filter((sample) => !voted.has(sample.id));
      if (!available.length) return json({ battle: null, reason: "complete", dataset: versionDto(version) });
      const counts = {};
      state.votes.filter((vote) => vote.dataset_version_id === version.id && vote.rater_id === user.id).forEach((vote) => {
        const dimension = version.samples.find((sample) => sample.id === vote.sample_id)?.dimension || "未标注";
        counts[dimension] = (counts[dimension] || 0) + 1;
      });
      const sample = chooseBalancedSample(available, counts, `${user.id}|${version.id}|${available.length}`);
      const swapped = shouldSwap(user.id, version.id, sample.id);
      const token = crypto.randomUUID();
      state.tokens.set(token, { sampleToken: token, dataset_version_id: version.id, sample_id: sample.id, rater_id: user.id, swapped, consumed: false });
      const progress = state.progress.get(progressKey(version.id));
      return json({ dataset: versionDto(version), progress: { current: (progress?.completed || 0) + 1, total }, battle: {
        sampleToken: token,
        query: sample.query,
        context: sample.context || [],
        responseA: { text: swapped ? sample.response_b : sample.response_a },
        responseB: { text: swapped ? sample.response_a : sample.response_b },
        dimension: sample.dimension || null,
        difficulty: sample.difficulty || null,
        risk: sample.risk || null
      } });
    }

    if (method === "POST" && url.pathname === "/api/votes") {
      const body = parseBody();
      if (!body) return error("请求内容不是有效 JSON。", 400, "invalid_json");
      const errors = validateVotePayload(body);
      if (errors.length) return error(errors[0], 422, "invalid_vote", errors);
      const token = state.tokens.get(body.sampleToken);
      if (!token || token.consumed) return error("这道题已经失效，请重新取题。", 409, "expired_battle");
      if (state.votes.some((vote) => vote.dataset_version_id === token.dataset_version_id && vote.sample_id === token.sample_id && vote.rater_id === user.id)) return error("这道题已经投过了。", 409, "duplicate_vote");
      const version = state.versions.find((item) => item.id === token.dataset_version_id);
      const sample = version.samples.find((item) => item.id === token.sample_id);
      const previous = state.progress.get(progressKey(version.id));
      const today = todayKey();
      const total = versionGoal(version, previous);
      const progress = { completed: (previous?.completed || 0) + 1, goal: total, streak: nextStreak(previous, today), last_active: today };
      state.progress.set(progressKey(version.id), progress);
      token.consumed = true;
      const voteId = crypto.randomUUID();
      const reasonTags = cleanReasonTags(body.reasonTags || []);
      state.votes.push({ id: voteId, dataset_version_id: version.id, sample_id: sample.id, rater_id: user.id, winner: remapDisplayedVote(body.winner, token.swapped), display_swapped: token.swapped, reason_tags: reasonTags, created_at: new Date().toISOString(), updated_at: null });
      const companion = upsertVoteGrowth(version, voteId, reasonTags);
      return json({ voteId, reference: displayReference(sample.human_winner, token.swapped), progress: { completed: Math.min(progress.completed, total), total, goal: total, streak: progress.streak }, companion }, 201);
    }

    const voteMatch = url.pathname.match(/^\/api\/votes\/([^/]+)$/);
    if (method === "PATCH" && voteMatch) {
      const body = parseBody();
      if (!body) return error("请求内容不是有效 JSON。", 400, "invalid_json");
      const vote = state.votes.find((item) => item.id === voteMatch[1] && item.rater_id === user.id);
      if (!vote) return error("没有找到这张票。", 404, "vote_not_found");
      const lockedVersion = state.versions.find((item) => item.id === vote.dataset_version_id);
      const lockedSeason = state.companion?.seasons.find((item) => item.dataset_version_id === lockedVersion?.id);
      if (lockedSeason?.revealed_at) return error("这本书已经装订，答案只能阅读不能修改。", 409, "season_locked");
      if (body.winner !== undefined) {
        if (!["A", "B", "tie_good", "tie_bad"].includes(body.winner)) return error("投票选项不在允许范围内。", 422, "invalid_vote");
        vote.winner = remapDisplayedVote(body.winner, Boolean(vote.display_swapped));
      }
      if (body.reasonTags !== undefined) {
        if (!Array.isArray(body.reasonTags)) return error("判断依据格式不对。", 422, "invalid_reasons");
        const tags = cleanReasonTags(body.reasonTags);
        if (tags.length !== new Set(body.reasonTags).size) return error("判断依据最多选 2 个。", 422, "invalid_reasons");
        vote.reason_tags = tags;
      }
      vote.updated_at = new Date().toISOString();
      const version = state.versions.find((item) => item.id === vote.dataset_version_id);
      const companion = upsertVoteGrowth(version, vote.id, vote.reason_tags);
      return json({ voteId: vote.id, winner: body.winner === undefined ? remapDisplayedVote(vote.winner, Boolean(vote.display_swapped)) : body.winner, reasonTags: vote.reason_tags, updatedAt: vote.updated_at, companion });
    }

    if (method === "GET" && url.pathname === "/api/results") {
      const requested = url.searchParams.get("version");
      const version = requested ? state.versions.find((item) => item.id === requested && ["active", "archived"].includes(item.status)) : active();
      if (!version) return json({ dataset: null, totalVotes: 0, participants: 0, distribution: { A: 0, B: 0, tie_good: 0, tie_bad: 0 }, dimensions: [], disputed: [] });
      const relevantVotes = state.votes.filter((vote) => vote.dataset_version_id === version.id);
      const aggregate = aggregateVotes(relevantVotes, version.samples);
      return json({ dataset: versionDto(version), totalVotes: aggregate.total_votes, participants: aggregate.participants, distribution: aggregate.distribution, dimensions: aggregate.dimensions, disputed: aggregate.disputed.map((item) => ({ sampleId: item.sample_id, query: item.query, total: item.total, counts: item.counts, disagreement: item.disagreement })) });
    }

    if (method === "GET" && url.pathname === "/api/admin/datasets") return json({ versions: state.versions.slice().reverse().map(versionDto) });

    if (method === "POST" && url.pathname === "/api/admin/datasets") {
      const body = parseBody();
      const displayName = String(body?.displayName || "").trim().slice(0, 120);
      if (!displayName) return error("给这版题库起个名字。", 422, "missing_name");
      const version = { id: crypto.randomUUID(), display_name: displayName, status: "draft", source_filename: null, source_type: null, source_sha256: null, mapping: body.mapping || {}, summary: body.preflightSummary || {}, samples: [], created_by: user.id, created_at: new Date().toISOString(), published_at: null };
      state.versions.push(version);
      return json({ version: versionDto(version) }, 201);
    }

    const sourceMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)\/source$/);
    if (method === "PUT" && sourceMatch) {
      const version = state.versions.find((item) => item.id === sourceMatch[1] && ["draft", "ready"].includes(item.status));
      if (!version) return error("这版题库不能再改了。", 409, "immutable_version");
      const filename = String(url.searchParams.get("filename") || "source.xlsx");
      if (!/\.(xlsx|csv)$/i.test(filename)) return error("只支持 XLSX 和 CSV。", 415, "unsupported_file");
      if (!bodySize(bodyBuffer) || bodySize(bodyBuffer) > MAX_FILE_BYTES) return error("文件为空，或者超过 20MB。", 413, "file_too_large");
      version.source_filename = filename;
      version.source_type = filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
      version.source_sha256 = await sha256Hex(bodyBuffer);
      version.source_bytes = bodySize(bodyBuffer);
      return json({ filename, type: version.source_type, sha256: version.source_sha256, bytes: bodySize(bodyBuffer) });
    }

    const samplesMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)\/samples\/batch$/);
    if (method === "POST" && samplesMatch) {
      const version = state.versions.find((item) => item.id === samplesMatch[1] && ["draft", "ready"].includes(item.status));
      const body = parseBody();
      if (!version) return error("这版题库不能再改了。", 409, "immutable_version");
      if (!Array.isArray(body?.samples) || !body.samples.length || body.samples.length > 50) return error("每批需要 1–50 条样本。", 422, "invalid_batch");
      if (version.samples.length + body.samples.length > MAX_ROWS) return error("这版题库最多 500 条。", 422, "row_limit");
      const incoming = new Set();
      for (const sample of body.samples) {
        if (!sample.source_uid || !sample.query || !sample.response_a || !sample.response_b) return error("有样本缺少必填内容。", 422, "invalid_samples");
        if (incoming.has(sample.source_uid) || version.samples.some((item) => item.source_uid === sample.source_uid)) return error("样本 UID 重复。", 409, "duplicate_uid");
        incoming.add(sample.source_uid);
      }
      version.samples.push(...body.samples.map((sample) => ({ ...structuredClone(sample), id: crypto.randomUUID(), content_hash: hashNumber(`${sample.query}|${sample.response_a}|${sample.response_b}`).toString(16) })));
      return json({ accepted: body.samples.length }, 201);
    }

    const validateMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)\/validate$/);
    if (method === "POST" && validateMatch) {
      const version = state.versions.find((item) => item.id === validateMatch[1] && ["draft", "ready"].includes(item.status));
      if (!version) return error("这版题库不能再检查了。", 409, "immutable_version");
      const errors = [];
      if (!version.source_sha256) errors.push("原始文件还没上传。");
      if (!version.samples.length) errors.push("没有可发布的样本。");
      const summary = { total_rows: version.samples.length, usable_rows: version.samples.length, excluded_duplicate_rows: Number(version.summary.excluded_duplicate_rows || 0), missing_model_ids: version.samples.filter((sample) => !sample.model_a_id || !sample.model_b_id).length, missing_dimensions: version.samples.filter((sample) => !sample.dimension).length, missing_difficulty: version.samples.filter((sample) => !sample.difficulty).length };
      summary.has_model_ids = version.samples.length > 0 && summary.missing_model_ids === 0;
      version.summary = summary;
      version.status = errors.length ? "draft" : "ready";
      const warnings = [];
      if (summary.missing_model_ids) warnings.push(`${summary.missing_model_ids} 条缺少完整模型 ID，结果页不会生成模型榜。`);
      if (summary.missing_dimensions) warnings.push(`${summary.missing_dimensions} 条没有评测维度。`);
      if (summary.missing_difficulty) warnings.push(`${summary.missing_difficulty} 条没有有效难度。`);
      return json({ valid: !errors.length, errors, warnings, summary, status: version.status });
    }

    const publishMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)\/publish$/);
    if (method === "POST" && publishMatch) {
      const version = state.versions.find((item) => item.id === publishMatch[1] && item.status === "ready");
      if (!version) return error("这版题库还没通过检查。", 409, "not_ready");
      state.versions.forEach((item) => { if (item.status === "active") item.status = "archived"; });
      version.status = "active";
      version.published_at = new Date().toISOString();
      return json({ version: versionDto(version) });
    }

    const activateMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)\/activate$/);
    if (method === "POST" && activateMatch) {
      const version = state.versions.find((item) => item.id === activateMatch[1] && item.status === "archived");
      if (!version) return error("只能回滚到已经发布过的版本。", 409, "not_archived");
      state.versions.forEach((item) => { if (item.status === "active") item.status = "archived"; });
      version.status = "active";
      return json({ version: versionDto(version) });
    }

    const deleteMatch = url.pathname.match(/^\/api\/admin\/datasets\/([^/]+)$/);
    if (method === "DELETE" && deleteMatch) {
      const index = state.versions.findIndex((item) => item.id === deleteMatch[1] && ["draft", "ready"].includes(item.status));
      if (index < 0) return error("只能删除还没发布的草稿。", 409, "immutable_version");
      state.versions.splice(index, 1);
      return json({ deleted: deleteMatch[1] });
    }

    return error("没有这个接口。", 404, "not_found");
  };

  return async function persistedLocalApi(request, bodyBuffer) {
    const result = await handle(request, bodyBuffer);
    if ((request.method || "GET") !== "GET" && result.status < 400) persist();
    return result;
  };
}
