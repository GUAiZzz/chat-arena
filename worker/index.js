import {
  REASON_TAGS,
  chooseBalancedSample,
  cleanReasonTags,
  displayReference,
  hashNumber,
  nextStreak,
  remapDisplayedVote,
  shouldSwap,
  todayKey,
  validateVotePayload
} from "../shared/arena-utils.js";
import { MAX_FILE_BYTES, MAX_ROWS } from "../shared/data-adapter.js";
import {
  GENOMES,
  MILESTONES,
  SPECIES,
  analysisToPoints,
  pendingMilestone,
  scoreReasonTags,
  speciesForScores,
  stageForProgress,
  validateReflectionInput
} from "../shared/companion-growth.js";
import { analyzeReflection } from "../shared/companion-model.js";
import { schemaStatements } from "./schema.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

let schemaBinding = null;
let schemaPromise = null;

function responseJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function responseError(message, status = 400, code = "bad_request", details = undefined) {
  return responseJson({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function decodeFullName(request) {
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  const value = request.headers.get("oai-authenticated-user-full-name");
  if (!value || encoding !== "percent-encoded-utf-8") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function getUser(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) return null;
  return { id, email, name: decodeFullName(request) || email };
}

function adminEmails(env) {
  return new Set(String(env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function isAdmin(user, env) {
  return Boolean(user && adminEmails(env).has(user.email.toLowerCase()));
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  if (schemaBinding !== env.DB) {
    schemaBinding = env.DB;
    schemaPromise = env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql))).then(() => env.DB.prepare("PRAGMA optimize").run());
  }
  return schemaPromise;
}

async function readBodyJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Response("invalid_json", { status: 400 });
  }
}

async function all(statement) {
  const result = await statement.all();
  return result.results || [];
}

function versionDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    sourceFilename: row.source_filename,
    sourceType: row.source_type,
    sourceSha256: row.source_sha256,
    sampleCount: Number(row.sample_count || 0),
    summary: parseStoredJson(row.summary_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at
  };
}

async function activeVersion(db) {
  return db.prepare("SELECT * FROM dataset_versions WHERE status = 'active' ORDER BY published_at DESC LIMIT 1").first();
}

function versionGoal(version) {
  return Math.min(9, Math.max(0, Number(version?.sample_count || 0)));
}

async function getCompanion(db, userId) {
  return db.prepare("SELECT * FROM companions WHERE rater_id = ?").bind(userId).first();
}

async function ensureCompanionSeason(db, companion, version) {
  if (!companion || !version) return null;
  let season = await db.prepare("SELECT * FROM companion_seasons WHERE companion_id = ? AND dataset_version_id = ?")
    .bind(companion.id, version.id).first();
  if (season) return season;
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const role = companion.main_season_id ? "echo" : "main";
  try {
    await db.prepare(`INSERT INTO companion_seasons
      (id, companion_id, dataset_version_id, role, stage, empathy_score, exploration_score, discernment_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'birth', 0, 0, 0, ?, ?)`)
      .bind(id, companion.id, version.id, role, createdAt, createdAt).run();
    if (role === "main") {
      await db.prepare("UPDATE companions SET main_season_id = ?, updated_at = ? WHERE id = ? AND main_season_id IS NULL")
        .bind(id, createdAt, companion.id).run();
    }
  } catch (error) {
    if (!/unique/i.test(String(error?.message || error))) throw error;
  }
  season = await db.prepare("SELECT * FROM companion_seasons WHERE companion_id = ? AND dataset_version_id = ?")
    .bind(companion.id, version.id).first();
  return season;
}

async function seasonEventRows(db, seasonId) {
  return all(db.prepare("SELECT * FROM companion_events WHERE season_id = ? ORDER BY created_at, id").bind(seasonId));
}

async function recomputeSeason(db, companion, season, userId) {
  const version = await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(season.dataset_version_id).first();
  const events = await seasonEventRows(db, season.id);
  const scores = events.reduce((total, event) => ({
    empathy: total.empathy + Number(event.empathy_delta || 0),
    exploration: total.exploration + Number(event.exploration_delta || 0),
    discernment: total.discernment + Number(event.discernment_delta || 0)
  }), { empathy: 0, exploration: 0, discernment: 0 });
  const reflected = events.filter((event) => event.source_type === "reflection").map((event) => Number(event.milestone));
  const progress = await db.prepare("SELECT completed FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(season.dataset_version_id, userId).first();
  const completed = Math.min(versionGoal(version), Number(progress?.completed || 0));
  const stage = stageForProgress(completed, reflected);
  const revealedNow = stage.id === "revealed" && !season.revealed_at;
  const species = stage.id === "revealed" ? speciesForScores(scores, companion.genome) : null;
  const updatedAt = nowIso();
  await db.prepare(`UPDATE companion_seasons SET stage = ?, empathy_score = ?, exploration_score = ?, discernment_score = ?,
      species = ?, revealed_at = CASE WHEN ? IS NOT NULL THEN COALESCE(revealed_at, ?) ELSE revealed_at END, updated_at = ? WHERE id = ?`)
    .bind(stage.id, scores.empathy, scores.exploration, scores.discernment, species?.id || null,
      species?.id || null, updatedAt, updatedAt, season.id).run();
  if (revealedNow && species) {
    if (season.role === "main") {
      await db.prepare("UPDATE companions SET main_species = ?, updated_at = ? WHERE id = ?")
        .bind(species.id, updatedAt, companion.id).run();
    } else {
      await db.prepare("UPDATE companions SET lineage_count = lineage_count + 1, updated_at = ? WHERE id = ?")
        .bind(updatedAt, companion.id).run();
    }
  }
}

async function companionSnapshot(db, user, version, createSeason = true) {
  let companion = await getCompanion(db, user.id);
  if (!companion) return { born: false, genomes: Object.values(GENOMES) };
  let season = version
    ? await db.prepare("SELECT * FROM companion_seasons WHERE companion_id = ? AND dataset_version_id = ?").bind(companion.id, version.id).first()
    : null;
  if (!season && createSeason && version) season = await ensureCompanionSeason(db, companion, version);
  companion = await getCompanion(db, user.id);
  if (!season || !version) {
    return { born: true, companion: { genome: companion.genome, mainSpecies: companion.main_species, lineageCount: Number(companion.lineage_count || 0) }, season: null };
  }
  const events = await seasonEventRows(db, season.id);
  const reflected = events.filter((event) => event.source_type === "reflection").map((event) => Number(event.milestone));
  const progress = await db.prepare("SELECT completed FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(version.id, user.id).first();
  const completed = Math.min(versionGoal(version), Number(progress?.completed || 0));
  const stage = stageForProgress(completed, reflected);
  const pending = pendingMilestone(completed, reflected);
  const upcoming = [3, 6, 9].find((milestone) => completed < milestone) || null;
  const latest = events.slice().reverse().find((event) => event.companion_reply);
  const traces = events.filter((event) => event.source_type === "reflection" && event.memory_summary).slice(-3).map((event) => event.memory_summary);
  const species = Object.values(SPECIES).find((item) => item.id === season.species) || null;
  return {
    born: true,
    companion: {
      genome: companion.genome,
      genomeName: GENOMES[companion.genome]?.name || GENOMES.light.name,
      mainSpecies: companion.main_species,
      lineageCount: Number(companion.lineage_count || 0)
    },
    season: {
      id: season.id,
      role: season.role,
      stage: stage.id,
      stageName: stage.name,
      completed,
      total: versionGoal(version),
      nextMilestone: upcoming,
      remaining: upcoming ? Math.max(0, upcoming - completed) : 0,
      pendingReflection: pending ? { ...MILESTONES[pending] } : null,
      latestReply: latest?.companion_reply || null,
      analysisMode: latest?.fallback ? "demo" : latest?.provider || "rules",
      revealed: Boolean(species),
      species: species ? { id: species.id, name: species.name, tagline: species.tagline, sprite: species.sprite } : null,
      traces
    }
  };
}

async function upsertVoteGrowth(db, user, version, voteId, reasonTags) {
  const companion = await getCompanion(db, user.id);
  if (!companion || !version) return companionSnapshot(db, user, version, false);
  const season = await ensureCompanionSeason(db, companion, version);
  const delta = scoreReasonTags(reasonTags);
  const timestamp = nowIso();
  await db.prepare(`INSERT INTO companion_events
      (id, season_id, source_type, source_id, empathy_delta, exploration_delta, discernment_delta, provider, prompt_version, created_at, updated_at)
      VALUES (?, ?, 'vote', ?, ?, ?, ?, 'rules', 'reason-tags-v1', ?, ?)
      ON CONFLICT(season_id, source_type, source_id) DO UPDATE SET
        empathy_delta = excluded.empathy_delta,
        exploration_delta = excluded.exploration_delta,
        discernment_delta = excluded.discernment_delta,
        updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), season.id, voteId, delta.empathy, delta.exploration, delta.discernment, timestamp, timestamp).run();
  await recomputeSeason(db, companion, season, user.id);
  return companionSnapshot(db, user, version, false);
}

async function sessionPayload(db, user, env) {
  const version = await activeVersion(db);
  let progress = { completed: 0, total: 0, goal: 0, remaining: 0, streak: 0 };
  if (version) {
    const row = await db.prepare("SELECT completed, streak, last_active FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
      .bind(version.id, user.id).first();
    const total = versionGoal(version);
    const completed = Math.min(total, Number(row?.completed || 0));
    progress = { completed, total, goal: total, remaining: Math.max(0, total - completed), streak: Number(row?.streak || 0) };
  }
  return {
    user,
    isAdmin: isAdmin(user, env),
    activeVersion: versionDto(version),
    progress,
    companion: await companionSnapshot(db, user, version),
    capabilities: { followUp: false, modelLeaderboard: false }
  };
}

async function handleSession(db, user, env) {
  return responseJson(await sessionPayload(db, user, env));
}

async function handleNextBattle(db, user) {
  const version = await activeVersion(db);
  if (!version) return responseJson({ battle: null, reason: "no_active_dataset" });

  const currentProgress = await db.prepare("SELECT completed FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(version.id, user.id).first();
  const growth = await companionSnapshot(db, user, version);
  if (growth.season?.pendingReflection) return responseJson({ battle: null, reason: "reflection_pending", dataset: versionDto(version), companion: growth });
  if (Number(currentProgress?.completed || 0) >= versionGoal(version)) {
    return responseJson({ battle: null, reason: "complete", dataset: versionDto(version), companion: growth });
  }

  const samples = await all(db.prepare(`SELECT s.* FROM samples s
    WHERE s.dataset_version_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM votes v
        WHERE v.dataset_version_id = s.dataset_version_id
          AND v.sample_id = s.id
          AND v.rater_id = ?
      )
    ORDER BY s.id`).bind(version.id, user.id));

  if (!samples.length) return responseJson({ battle: null, reason: "complete", dataset: versionDto(version) });

  const dimensionRows = await all(db.prepare(`SELECT COALESCE(s.dimension, '未标注') AS dimension, COUNT(*) AS count
    FROM votes v JOIN samples s ON s.id = v.sample_id
    WHERE v.dataset_version_id = ? AND v.rater_id = ?
    GROUP BY COALESCE(s.dimension, '未标注')`).bind(version.id, user.id));
  const dimensionCounts = Object.fromEntries(dimensionRows.map((row) => [row.dimension, Number(row.count || 0)]));
  const sample = chooseBalancedSample(samples, dimensionCounts, `${user.id}|${version.id}|${samples.length}`);
  const swapped = shouldSwap(user.id, version.id, sample.id);
  const token = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO battle_tokens
    (id, dataset_version_id, sample_id, rater_id, swapped, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(token, version.id, sample.id, user.id, swapped ? 1 : 0, expiresAt, createdAt).run();

  const sourceA = { text: sample.response_a };
  const sourceB = { text: sample.response_b };
  const progress = await db.prepare("SELECT completed FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(version.id, user.id).first();

  return responseJson({
    dataset: versionDto(version),
    progress: { current: Number(progress?.completed || 0) + 1, total: versionGoal(version) },
    battle: {
      sampleToken: token,
      query: sample.query,
      context: parseStoredJson(sample.context_json, []),
      responseA: swapped ? sourceB : sourceA,
      responseB: swapped ? sourceA : sourceB,
      dimension: sample.dimension || null,
      difficulty: sample.difficulty || null,
      risk: sample.risk || null
    }
  });
}

async function handleVote(request, db, user) {
  const body = await readBodyJson(request);
  const validationErrors = validateVotePayload(body);
  if (validationErrors.length) return responseError(validationErrors[0], 422, "invalid_vote", validationErrors);

  const token = await db.prepare(`SELECT t.*, s.human_winner, s.dataset_version_id AS sample_version
    FROM battle_tokens t JOIN samples s ON s.id = t.sample_id
    WHERE t.id = ? AND t.rater_id = ?`).bind(body.sampleToken, user.id).first();
  if (!token || token.consumed_at || token.expires_at < nowIso()) return responseError("这道题已经失效，请重新取题。", 409, "expired_battle");

  const existing = await db.prepare("SELECT id FROM votes WHERE dataset_version_id = ? AND sample_id = ? AND rater_id = ?")
    .bind(token.dataset_version_id, token.sample_id, user.id).first();
  if (existing) return responseError("这道题已经投过了。", 409, "duplicate_vote");

  const canonicalWinner = remapDisplayedVote(body.winner, Boolean(token.swapped));
  const previous = await db.prepare("SELECT completed, streak, last_active FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(token.dataset_version_id, user.id).first();
  const today = todayKey();
  const streak = nextStreak(previous, today);
  const completed = Number(previous?.completed || 0) + 1;
  const createdAt = nowIso();
  const voteId = crypto.randomUUID();
  const reasonTags = cleanReasonTags(body.reasonTags || []);

  try {
    await db.batch([
      db.prepare(`INSERT INTO votes
        (id, dataset_version_id, sample_id, rater_id, winner, reason_tags_json, display_swapped, dwell_ms, context_opened, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .bind(voteId, token.dataset_version_id, token.sample_id, user.id, canonicalWinner, JSON.stringify(reasonTags), token.swapped ? 1 : 0, Number(body.dwellMs || 0), body.contextOpened ? 1 : 0, createdAt),
      db.prepare("UPDATE battle_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(createdAt, token.id),
      db.prepare(`INSERT INTO user_progress (dataset_version_id, rater_id, completed, streak, last_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(dataset_version_id, rater_id) DO UPDATE SET
          completed = excluded.completed,
          streak = excluded.streak,
          last_active = excluded.last_active,
          updated_at = excluded.updated_at`)
        .bind(token.dataset_version_id, user.id, completed, streak, today, createdAt)
    ]);
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) return responseError("这道题已经投过了。", 409, "duplicate_vote");
    throw error;
  }

  const version = await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(token.dataset_version_id).first();
  const companion = await upsertVoteGrowth(db, user, version, voteId, reasonTags);
  return responseJson({
    voteId,
    reference: displayReference(token.human_winner, Boolean(token.swapped)),
    progress: { completed: Math.min(completed, versionGoal(version)), total: versionGoal(version), streak },
    companion
  }, 201);
}

async function handleVoteUpdate(request, db, user, voteId) {
  const body = await readBodyJson(request);
  if (body.winner === undefined && body.reasonTags === undefined) return responseError("没有需要修改的内容。", 422, "empty_update");
  const vote = await db.prepare("SELECT * FROM votes WHERE id = ? AND rater_id = ?").bind(voteId, user.id).first();
  if (!vote) return responseError("没有找到这张票。", 404, "vote_not_found");
  let canonicalWinner = vote.winner;
  if (body.winner !== undefined) {
    if (!["A", "B", "tie_good", "tie_bad"].includes(body.winner)) return responseError("投票选项不在允许范围内。", 422, "invalid_vote");
    canonicalWinner = remapDisplayedVote(body.winner, Boolean(vote.display_swapped));
  }
  let tags = parseStoredJson(vote.reason_tags_json, []);
  if (body.reasonTags !== undefined) {
    if (!Array.isArray(body.reasonTags)) return responseError("判断依据格式不对。", 422, "invalid_reasons");
    tags = cleanReasonTags(body.reasonTags);
    if (tags.length !== new Set(body.reasonTags).size) return responseError("判断依据最多选 2 个，并且只能使用页面里的标签。", 422, "invalid_reasons");
  }
  const updatedAt = nowIso();
  await db.prepare("UPDATE votes SET winner = ?, reason_tags_json = ?, updated_at = ? WHERE id = ? AND rater_id = ?")
    .bind(canonicalWinner, JSON.stringify(tags), updatedAt, voteId, user.id).run();
  const version = await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(vote.dataset_version_id).first();
  const companion = await upsertVoteGrowth(db, user, version, voteId, tags);
  return responseJson({
    voteId,
    winner: remapDisplayedVote(canonicalWinner, Boolean(vote.display_swapped)),
    reasonTags: tags,
    updatedAt,
    companion
  });
}

async function handleCompanionBirth(request, db, user) {
  const body = await readBodyJson(request);
  const genome = String(body.genome || "");
  if (!GENOMES[genome]) return responseError("请选择一种出生基因。", 422, "invalid_genome");
  const existing = await getCompanion(db, user.id);
  if (existing && existing.genome !== genome) return responseError("出生基因已经确定。", 409, "genome_locked");
  if (!existing) {
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    await db.prepare(`INSERT INTO companions (id, rater_id, genome, lineage_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)`)
      .bind(id, user.id, genome, createdAt, createdAt).run();
  }
  const version = await activeVersion(db);
  const companion = await getCompanion(db, user.id);
  if (version) await ensureCompanionSeason(db, companion, version);
  return responseJson({ companion: await companionSnapshot(db, user, version) }, existing ? 200 : 201);
}

async function handleCompanionReflection(request, db, user, env) {
  const parsed = validateReflectionInput(await readBodyJson(request));
  if (!parsed.ok) return responseError(parsed.message, 422, "invalid_reflection");
  const version = await activeVersion(db);
  if (!version) return responseError("现在没有可以成长的题库。", 409, "no_active_dataset");
  const companion = await getCompanion(db, user.id);
  if (!companion) return responseError("先选择聊灵的出生基因。", 409, "companion_not_born");
  const season = await ensureCompanionSeason(db, companion, version);
  const sourceId = `milestone:${parsed.milestone}`;
  const duplicate = await db.prepare("SELECT id FROM companion_events WHERE season_id = ? AND source_type = 'reflection' AND source_id = ?")
    .bind(season.id, sourceId).first();
  if (duplicate) return responseJson({ companion: await companionSnapshot(db, user, version, false), alreadySubmitted: true });
  const progress = await db.prepare("SELECT completed FROM user_progress WHERE dataset_version_id = ? AND rater_id = ?")
    .bind(version.id, user.id).first();
  const events = await seasonEventRows(db, season.id);
  const reflected = events.filter((event) => event.source_type === "reflection").map((event) => Number(event.milestone));
  const pending = pendingMilestone(Math.min(versionGoal(version), Number(progress?.completed || 0)), reflected);
  if (pending !== parsed.milestone) return responseError("这个成长阶段还没到，或者已经完成。", 409, "milestone_not_due");

  let analysis;
  let metadata;
  if (parsed.text) {
    metadata = await analyzeReflection({ text: parsed.text, milestone: parsed.milestone, genome: companion.genome }, env);
    analysis = metadata.analysis;
  } else {
    analysis = { empathy: 0, exploration: 0, discernment: 0, toneLabels: [], companionReply: "留白也被我记住了。我们继续往前走。", memorySummary: "你为这一刻保留了一点安静", confidence: 1 };
    metadata = { provider: "skipped", model: null, fallback: false, promptVersion: "liaoling-reflection-v1" };
  }
  const delta = parsed.text ? analysisToPoints(analysis) : { empathy: 0, exploration: 0, discernment: 0 };
  const createdAt = nowIso();
  try {
    await db.prepare(`INSERT INTO companion_events
      (id, season_id, source_type, source_id, milestone, empathy_delta, exploration_delta, discernment_delta,
       tone_labels_json, companion_reply, memory_summary, provider, model, prompt_version, confidence, fallback, created_at, updated_at)
      VALUES (?, ?, 'reflection', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), season.id, sourceId, parsed.milestone, delta.empathy, delta.exploration, delta.discernment,
        JSON.stringify(analysis.toneLabels || []), analysis.companionReply, analysis.memorySummary, metadata.provider, metadata.model,
        metadata.promptVersion, analysis.confidence, metadata.fallback ? 1 : 0, createdAt, createdAt).run();
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) return responseJson({ companion: await companionSnapshot(db, user, version, false), alreadySubmitted: true });
    throw error;
  }
  await recomputeSeason(db, companion, season, user.id);
  return responseJson({ companion: await companionSnapshot(db, user, version, false), reply: analysis.companionReply }, 201);
}

async function handleResults(db, url) {
  const requestedId = url.searchParams.get("version");
  const version = requestedId
    ? await db.prepare("SELECT * FROM dataset_versions WHERE id = ? AND status IN ('active', 'archived')").bind(requestedId).first()
    : await activeVersion(db);
  if (!version) return responseJson({ dataset: null, totalVotes: 0, participants: 0, distribution: { A: 0, B: 0, tie_good: 0, tie_bad: 0 }, dimensions: [], disputed: [] });

  const stats = await db.prepare(`SELECT
      COUNT(*) AS total_votes,
      COUNT(DISTINCT rater_id) AS participants,
      SUM(CASE WHEN winner = 'A' THEN 1 ELSE 0 END) AS a_votes,
      SUM(CASE WHEN winner = 'B' THEN 1 ELSE 0 END) AS b_votes,
      SUM(CASE WHEN winner = 'tie_good' THEN 1 ELSE 0 END) AS tie_good_votes,
      SUM(CASE WHEN winner = 'tie_bad' THEN 1 ELSE 0 END) AS tie_bad_votes
    FROM votes WHERE dataset_version_id = ?`).bind(version.id).first();
  const dimensions = await all(db.prepare(`SELECT COALESCE(s.dimension, '未标注') AS dimension,
      COUNT(DISTINCT s.id) AS samples, COUNT(v.id) AS votes
    FROM samples s LEFT JOIN votes v ON v.sample_id = s.id AND v.dataset_version_id = s.dataset_version_id
    WHERE s.dataset_version_id = ?
    GROUP BY COALESCE(s.dimension, '未标注')
    ORDER BY votes DESC, dimension`).bind(version.id));
  const disputeRows = await all(db.prepare(`SELECT s.id AS sample_id, s.query,
      COUNT(v.id) AS total,
      SUM(CASE WHEN v.winner = 'A' THEN 1 ELSE 0 END) AS a_votes,
      SUM(CASE WHEN v.winner = 'B' THEN 1 ELSE 0 END) AS b_votes,
      SUM(CASE WHEN v.winner = 'tie_good' THEN 1 ELSE 0 END) AS tie_good_votes,
      SUM(CASE WHEN v.winner = 'tie_bad' THEN 1 ELSE 0 END) AS tie_bad_votes
    FROM samples s JOIN votes v ON v.sample_id = s.id
    WHERE s.dataset_version_id = ?
    GROUP BY s.id, s.query
    HAVING COUNT(v.id) >= 2`).bind(version.id));
  const disputed = disputeRows.map((row) => {
    const counts = { A: Number(row.a_votes || 0), B: Number(row.b_votes || 0), tie_good: Number(row.tie_good_votes || 0), tie_bad: Number(row.tie_bad_votes || 0) };
    const total = Number(row.total || 0);
    return { sampleId: row.sample_id, query: row.query, total, counts, disagreement: total ? 1 - Math.max(...Object.values(counts)) / total : 0 };
  }).filter((row) => row.disagreement > 0).sort((a, b) => b.disagreement - a.disagreement || b.total - a.total).slice(0, 8);

  return responseJson({
    dataset: versionDto(version),
    totalVotes: Number(stats?.total_votes || 0),
    participants: Number(stats?.participants || 0),
    distribution: {
      A: Number(stats?.a_votes || 0),
      B: Number(stats?.b_votes || 0),
      tie_good: Number(stats?.tie_good_votes || 0),
      tie_bad: Number(stats?.tie_bad_votes || 0)
    },
    dimensions: dimensions.map((row) => ({ dimension: row.dimension, samples: Number(row.samples || 0), votes: Number(row.votes || 0) })),
    disputed
  });
}

function validateAdminSample(sample, index) {
  const errors = [];
  const row = Number(sample?.source_row || index + 2);
  [["source_uid", "样本 UID"], ["query", "用户问题"], ["response_a", "回复 A"], ["response_b", "回复 B"]].forEach(([field, label]) => {
    if (typeof sample?.[field] !== "string" || !sample[field].trim()) errors.push(`第 ${row} 行缺少「${label}」。`);
  });
  if (!Array.isArray(sample?.context)) errors.push(`第 ${row} 行的上下文格式不对。`);
  if (sample?.human_winner && !["A", "B", "tie"].includes(sample.human_winner)) errors.push(`第 ${row} 行的人工倾向不对。`);
  if (sample?.difficulty !== null && sample?.difficulty !== undefined && (!Number.isInteger(sample.difficulty) || sample.difficulty < 1 || sample.difficulty > 5)) errors.push(`第 ${row} 行的难度不在 1–5。`);
  return errors;
}

async function getEditableVersion(db, id) {
  return db.prepare("SELECT * FROM dataset_versions WHERE id = ? AND status IN ('draft', 'ready')").bind(id).first();
}

async function handleAdminList(db) {
  const versions = await all(db.prepare("SELECT * FROM dataset_versions ORDER BY created_at DESC"));
  return responseJson({ versions: versions.map(versionDto) });
}

async function handleAdminCreate(request, db, user) {
  const body = await readBodyJson(request);
  const displayName = String(body.displayName || "").trim().slice(0, 120);
  if (!displayName) return responseError("给这版题库起个名字。", 422, "missing_name");
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await db.prepare(`INSERT INTO dataset_versions
    (id, display_name, status, mapping_json, summary_json, sample_count, created_by, created_at)
    VALUES (?, ?, 'draft', ?, ?, 0, ?, ?)`)
    .bind(id, displayName, JSON.stringify(body.mapping || {}), JSON.stringify(body.preflightSummary || {}), user.id, createdAt).run();
  return responseJson({ version: versionDto(await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(id).first()) }, 201);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function handleAdminSource(request, db, env, versionId, url) {
  const version = await getEditableVersion(db, versionId);
  if (!version) return responseError("这版题库不能再改了。", 409, "immutable_version");
  if (!env.FILES) return responseError("文件存储还没接好。", 503, "r2_unavailable");
  const filename = String(url.searchParams.get("filename") || "source.xlsx").slice(0, 240);
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) return responseError("只支持 XLSX 和 CSV。", 415, "unsupported_file");
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_FILE_BYTES) return responseError("文件超过 20MB。", 413, "file_too_large");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) return responseError("文件为空，或者超过 20MB。", 413, "file_too_large");
  const sha256 = await sha256Hex(bytes);
  const extension = lower.endsWith(".csv") ? "csv" : "xlsx";
  const key = `datasets/${versionId}/source.${extension}`;
  const contentType = extension === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
  await db.prepare(`UPDATE dataset_versions SET source_filename = ?, source_type = ?, source_sha256 = ?, source_key = ?, status = 'draft'
    WHERE id = ?`).bind(filename, extension, sha256, key, versionId).run();
  return responseJson({ filename, type: extension, sha256, bytes: bytes.byteLength });
}

async function handleAdminSamples(request, db, versionId) {
  const version = await getEditableVersion(db, versionId);
  if (!version) return responseError("这版题库不能再改了。", 409, "immutable_version");
  const body = await readBodyJson(request);
  if (!Array.isArray(body.samples) || !body.samples.length || body.samples.length > 50) return responseError("每批需要 1–50 条样本。", 422, "invalid_batch");
  const errors = body.samples.flatMap(validateAdminSample);
  if (errors.length) return responseError(errors[0], 422, "invalid_samples", errors);
  const existingCount = await db.prepare("SELECT COUNT(*) AS count FROM samples WHERE dataset_version_id = ?").bind(versionId).first();
  if (Number(existingCount?.count || 0) + body.samples.length > MAX_ROWS) return responseError("这版题库最多 500 条。", 422, "row_limit");

  const createdAt = nowIso();
  const statements = body.samples.map((sample) => {
    const contentHash = hashNumber(`${sample.query}\u241f${sample.response_a}\u241f${sample.response_b}`).toString(16).padStart(8, "0");
    return db.prepare(`INSERT INTO samples
      (id, dataset_version_id, source_uid, content_hash, source_row, query, context_json, response_a, response_b,
       task_type, human_winner, model_a_id, model_b_id, dimension, difficulty, risk, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), versionId, sample.source_uid.trim(), contentHash, Number(sample.source_row || 0), sample.query, JSON.stringify(sample.context || []),
        sample.response_a, sample.response_b, sample.task_type || null, sample.human_winner || null, sample.model_a_id || null,
        sample.model_b_id || null, sample.dimension || null, sample.difficulty || null, sample.risk || null, sample.metadata ? JSON.stringify(sample.metadata) : null, createdAt);
  });
  try {
    await db.batch(statements);
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) return responseError("样本 UID 重复。回到预检页确认保留哪一条。", 409, "duplicate_uid");
    throw error;
  }
  return responseJson({ accepted: body.samples.length }, 201);
}

async function handleAdminValidate(db, versionId) {
  const version = await getEditableVersion(db, versionId);
  if (!version) return responseError("这版题库不能再检查了。", 409, "immutable_version");
  const rows = await all(db.prepare("SELECT source_uid, content_hash, model_a_id, model_b_id, dimension, difficulty, response_a, response_b FROM samples WHERE dataset_version_id = ?").bind(versionId));
  const errors = [];
  const warnings = [];
  if (!version.source_key) errors.push("原始文件还没上传。");
  if (!rows.length) errors.push("没有可发布的样本。");
  if (rows.length > MAX_ROWS) errors.push("样本超过 500 条。");
  const contentCounts = new Map();
  rows.forEach((row) => contentCounts.set(row.content_hash, (contentCounts.get(row.content_hash) || 0) + 1));
  const duplicateContent = [...contentCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  if (duplicateContent) warnings.push(`${duplicateContent} 条内容相同但 UID 不同，请确认是否需要保留。`);
  const summary = {
    total_rows: rows.length,
    usable_rows: rows.length,
    excluded_duplicate_rows: Number(parseStoredJson(version.summary_json, {}).excluded_duplicate_rows || 0),
    missing_model_ids: rows.filter((row) => !row.model_a_id || !row.model_b_id).length,
    missing_dimensions: rows.filter((row) => !row.dimension).length,
    missing_difficulty: rows.filter((row) => !row.difficulty).length,
    duplicate_content: duplicateContent,
    has_model_ids: rows.length > 0 && rows.every((row) => row.model_a_id && row.model_b_id)
  };
  if (summary.missing_model_ids) warnings.push(`${summary.missing_model_ids} 条缺少完整模型 ID，结果页不会生成模型榜。`);
  if (summary.missing_dimensions) warnings.push(`${summary.missing_dimensions} 条没有评测维度，统一显示为「未标注」。`);
  if (summary.missing_difficulty) warnings.push(`${summary.missing_difficulty} 条没有有效难度。`);
  const status = errors.length ? "draft" : "ready";
  await db.prepare("UPDATE dataset_versions SET status = ?, summary_json = ?, sample_count = ? WHERE id = ?")
    .bind(status, JSON.stringify(summary), rows.length, versionId).run();
  return responseJson({ valid: errors.length === 0, errors, warnings, summary, status });
}

async function handleAdminPublish(db, user, versionId) {
  const version = await db.prepare("SELECT * FROM dataset_versions WHERE id = ? AND status = 'ready'").bind(versionId).first();
  if (!version) return responseError("这版题库还没通过检查。", 409, "not_ready");
  const publishedAt = nowIso();
  await db.batch([
    db.prepare("UPDATE dataset_versions SET status = 'archived' WHERE status = 'active'"),
    db.prepare("UPDATE dataset_versions SET status = 'active', published_at = ? WHERE id = ? AND status = 'ready'").bind(publishedAt, versionId),
    db.prepare(`INSERT INTO dataset_events (id, dataset_version_id, actor_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, 'published', '{}', ?)`).bind(crypto.randomUUID(), versionId, user.id, publishedAt)
  ]);
  return responseJson({ version: versionDto(await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(versionId).first()) });
}

async function handleAdminActivate(db, user, versionId) {
  const version = await db.prepare("SELECT * FROM dataset_versions WHERE id = ? AND status = 'archived'").bind(versionId).first();
  if (!version) return responseError("只能回滚到已经发布过的版本。", 409, "not_archived");
  const createdAt = nowIso();
  await db.batch([
    db.prepare("UPDATE dataset_versions SET status = 'archived' WHERE status = 'active'"),
    db.prepare("UPDATE dataset_versions SET status = 'active' WHERE id = ? AND status = 'archived'").bind(versionId),
    db.prepare(`INSERT INTO dataset_events (id, dataset_version_id, actor_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, 'reactivated', '{}', ?)`).bind(crypto.randomUUID(), versionId, user.id, createdAt)
  ]);
  return responseJson({ version: versionDto(await db.prepare("SELECT * FROM dataset_versions WHERE id = ?").bind(versionId).first()) });
}

async function handleAdminDelete(db, env, versionId) {
  const version = await getEditableVersion(db, versionId);
  if (!version) return responseError("只能删除还没发布的草稿。", 409, "immutable_version");
  if (version.source_key && env.FILES) await env.FILES.delete(version.source_key);
  await db.prepare("DELETE FROM dataset_versions WHERE id = ?").bind(versionId).run();
  return responseJson({ deleted: versionId });
}

async function handleApi(request, env, url) {
  if (!env.DB) return responseError("共享数据服务还没接好。", 503, "db_unavailable");
  await ensureSchema(env);
  const user = getUser(request);
  if (!user) return responseError("请先登录再继续。", 401, "unauthenticated");
  const db = env.DB;
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/api/session") return handleSession(db, user, env);
  if (method === "GET" && path === "/api/companion") return responseJson({ companion: await companionSnapshot(db, user, await activeVersion(db)) });
  if (method === "POST" && path === "/api/companion/birth") return handleCompanionBirth(request, db, user);
  if (method === "POST" && path === "/api/companion/reflections") return handleCompanionReflection(request, db, user, env);
  if (method === "GET" && path === "/api/battles/next") return handleNextBattle(db, user);
  if (method === "POST" && path === "/api/votes") return handleVote(request, db, user);
  const voteMatch = path.match(/^\/api\/votes\/([^/]+)$/);
  if (method === "PATCH" && voteMatch) return handleVoteUpdate(request, db, user, voteMatch[1]);
  if (method === "GET" && path === "/api/results") return handleResults(db, url);

  if (path.startsWith("/api/admin/")) {
    if (!isAdmin(user, env)) return responseError("你可以参与评测，但不能管理题库。", 403, "forbidden");
    if (method === "GET" && path === "/api/admin/datasets") return handleAdminList(db);
    if (method === "POST" && path === "/api/admin/datasets") return handleAdminCreate(request, db, user);
    const sourceMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)\/source$/);
    if (method === "PUT" && sourceMatch) return handleAdminSource(request, db, env, sourceMatch[1], url);
    const samplesMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)\/samples\/batch$/);
    if (method === "POST" && samplesMatch) return handleAdminSamples(request, db, samplesMatch[1]);
    const validateMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)\/validate$/);
    if (method === "POST" && validateMatch) return handleAdminValidate(db, validateMatch[1]);
    const publishMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)\/publish$/);
    if (method === "POST" && publishMatch) return handleAdminPublish(db, user, publishMatch[1]);
    const activateMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)\/activate$/);
    if (method === "POST" && activateMatch) return handleAdminActivate(db, user, activateMatch[1]);
    const deleteMatch = path.match(/^\/api\/admin\/datasets\/([^/]+)$/);
    if (method === "DELETE" && deleteMatch) return handleAdminDelete(db, env, deleteMatch[1]);
  }

  return responseError("没有这个接口。", 404, "not_found");
}

async function handleAssets(request, env, url) {
  if (url.pathname === "/") url.pathname = "/index.html";
  let response = await env.ASSETS.fetch(new Request(url, request));
  if (response.status === 404 && !url.pathname.includes(".")) {
    url.pathname = "/index.html";
    response = await env.ASSETS.fetch(new Request(url, request));
  }
  const extension = url.pathname.slice(url.pathname.lastIndexOf("."));
  if (MIME[extension] && !response.headers.get("content-type")) {
    const headers = new Headers(response.headers);
    headers.set("content-type", MIME[extension]);
    response = new Response(response.body, { status: response.status, headers });
  }
  if (url.pathname.endsWith(".html") && response.ok) {
    const html = (await response.text()).replaceAll("__SITE_ORIGIN__", url.origin);
    response = new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  return response;
}

function secure(response, url) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "DENY");
  if (url.pathname.endsWith(".html") || url.pathname.startsWith("/api/")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const response = url.pathname.startsWith("/api/") ? await handleApi(request, env, url) : await handleAssets(request, env, url);
      return secure(response, url);
    } catch (error) {
      if (error instanceof Response && error.status === 400) return secure(responseError("请求内容不是有效 JSON。", 400, "invalid_json"), url);
      console.error("arena_worker_error", error);
      return secure(responseError("这次操作没完成，请重试。", 500, "internal_error"), url);
    }
  }
};

export const __test = { getUser, isAdmin, validateAdminSample, versionDto, REASON_TAGS };
