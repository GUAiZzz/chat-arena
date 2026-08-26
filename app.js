import {
  FIELD_DEFINITIONS,
  MAX_FILE_BYTES,
  acceptedFile,
  normalizeRows,
  scoreSheet,
  spreadsheetReadSource,
  suggestMapping,
  validateMapping
} from "./shared/data-adapter.js";
import { REASON_TAGS } from "./shared/arena-utils.js";
import { requestJson as api } from "./ui/api-client.js";
import { formatDate, formatPercent, versionStatusLabel } from "./ui/admin.js";
import { applyVoteSelection, renderReasonTagButtons } from "./ui/arena.js";
import { bindCompanionUi, openReflection, openReveal, renderCompanion } from "./ui/companion.js";
import { freshUploadState, state } from "./ui/state.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let pendingRevealSnapshot = null;

function milestonesForBook(total) {
  const safeTotal = Math.max(0, Number(total) || 0);
  return safeTotal ? [...new Set([Math.ceil(safeTotal / 3), Math.ceil(safeTotal * 2 / 3), safeTotal])] : [];
}

function updateGoalPreview(total) {
  const milestones = milestonesForBook(total).join("、");
  const copy = $("#goalMilestones");
  const seal = $(".preview-seal");
  if (copy) copy.textContent = milestones ? `会落在第 ${milestones} 页` : "当前题库还没有足够题目";
  if (seal) seal.textContent = String(total || 0).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setInlineError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
  if (message) element.focus();
}

function setBusy(element, busy) {
  element.toggleAttribute("aria-busy", busy);
  element.classList.toggle("is-loading", busy);
}

function resetTimeline() {
  state.timeline = [];
  state.timelineIndex = -1;
  state.timelineAtEnd = false;
  state.battle = null;
  state.voteId = null;
  state.editingVote = false;
}

function currentTimelineEntry() {
  return state.timeline[state.timelineIndex] || null;
}

function updateBattleNavigation() {
  const local = ["local", "static"].includes(state.session?.runtime);
  const navigation = $("#battleNavigation");
  navigation.hidden = !local;
  if (!local) return;
  const previous = $("#previousBattle");
  previous.disabled = state.timelineAtEnd ? state.timeline.length === 0 : state.timelineIndex <= 0;
  const completed = Number(state.session?.progress?.completed || 0);
  const total = Number(state.session?.progress?.total || 0);
  const position = state.timelineAtEnd ? total : Math.max(1, state.timelineIndex + 1);
  $("#battlePosition").textContent = `第 ${Math.min(position, total || position)} 题 · 已完成 ${completed} / ${total}`;
}

function updateEmber() {
  renderCompanion(state.session?.companion, { runtime: state.session?.runtime });
}

function updateCompanionSnapshot(snapshot) {
  if (!snapshot || !state.session) return;
  state.session.companion = snapshot;
  const resultsNav = $('.nav-item[data-view="results"]');
  if (resultsNav) resultsNav.hidden = !snapshot?.season?.revealed;
  updateEmber();
}

function animatePageTurn() {
  const page = $("#battleShell");
  if (!page || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  page.classList.remove("is-page-turning");
  void page.offsetWidth;
  page.classList.add("is-page-turning");
  window.setTimeout(() => page.classList.remove("is-page-turning"), 560);
}

function showView(view) {
  if (view === "admin" && !state.session?.isAdmin) view = "battle";
  if (view === "results" && !state.session?.companion?.season?.revealed) {
    showToast("先完成整本书并确认装订，结果页才会打开。");
    view = "battle";
  }
  state.activeView = view;
  $$('[data-view-panel]').forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "results") loadResults();
  if (view === "mechanism") renderMechanism();
  if (view === "admin") loadVersions();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSession() {
  const session = state.session;
  const versionId = session.activeVersion?.id || null;
  if (state.activeVersionId !== null && state.activeVersionId !== versionId) resetTimeline();
  state.activeVersionId = versionId;
  $("#userName").textContent = session.user.name || session.user.email;
  const browserDemo = session.runtime === "static";
  $("#userRole").textContent = browserDemo ? "GitHub Pages · 浏览器本地模式" : session.runtime === "local" ? "离线演示 · 本地管理员" : session.isAdmin ? "题库管理员" : "评测成员";
  $("#localDemoNotice").hidden = !["local", "static"].includes(session.runtime);
  $("#runtimeNoticeLabel").textContent = browserDemo ? "STATIC DEMO" : "LOCAL DEMO";
  $("#runtimeNoticeText").textContent = browserDemo
    ? "投票、成长与题库只保存在当前浏览器；清除网站数据后会重置，不会上传到服务器。"
    : "当前使用脱敏 Demo Case；默认采用可见的演示分析。投票、成长和新上传题库会在关闭服务后清空。";
  $("#adminNav").hidden = !session.isAdmin;
  const resultsNav = $('.nav-item[data-view="results"]');
  if (resultsNav) resultsNav.hidden = !session.companion?.season?.revealed;
  $("#emptyAdminButton").hidden = !session.isAdmin;

  const version = session.activeVersion;
  const strip = $("#datasetStrip");
  strip.classList.toggle("is-empty", !version);
  $("#activeDatasetName").textContent = version?.displayName || "还没有已发布题库";
  $("#activeDatasetMeta").textContent = version ? `${version.sampleCount} 道题 · ${formatDate(version.publishedAt)}` : "管理员发布后开始评测";
  updateProgress(session.progress);
  updateEmber();
  updateBattleNavigation();
  renderMechanism();
}

function updateProgress(progress) {
  const completed = Number(progress?.completed || 0);
  const total = Number(progress?.total || 0);
  const goal = total || 9;
  const currentPage = state.timelineAtEnd
    ? Math.max(1, goal || 1)
    : Math.min(goal || 1, Math.max(1, state.timelineIndex + 1));
  $("#battleProgressText").textContent = `PAGE ${String(currentPage).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  $("#battleKicker").textContent = `CHAPTER 01 · PAGE 01—${String(goal).padStart(2, "0")}`;
  const pageNumber = $("#bookPageNumber");
  if (pageNumber) pageNumber.textContent = `PAGE ${String(currentPage).padStart(2, "0")}`;
  const track = $("#battleProgressTrack");
  track.setAttribute("aria-valuemax", String(total));
  track.setAttribute("aria-valuenow", String(completed));
  $("#battleProgressFill").style.width = total ? `${Math.min(100, completed / total * 100)}%` : "0%";
  const nextMilestone = state.session?.companion?.season?.nextMilestone;
  const remaining = state.session?.companion?.season?.remaining;
  const distance = $("#growthDistance");
  if (distance) {
    distance.textContent = nextMilestone
      ? `下一次成长：还有 ${remaining} 页`
      : state.session?.companion?.season?.revealed
        ? "成长章节：已装订"
        : "成长章节：等待装订";
  }
  const route = $("#pixelRoute");
  if (route) {
    const milestones = new Set(milestonesForBook(total));
    route.setAttribute("aria-valuemax", String(total));
    route.setAttribute("aria-valuenow", String(completed));
    $$(".route-step", route).forEach((step, index) => {
      const page = index + 1;
      step.classList.toggle("is-active", page <= total);
      step.classList.toggle("is-complete", page <= completed);
      step.classList.toggle("is-current", page === completed + 1 && completed < total);
      step.classList.toggle("is-milestone", milestones.has(page));
    });
  }
  updateBattleNavigation();
}

async function loadSession() {
  state.session = await api("/api/session");
  renderSession();
}

async function loadReviewTimeline() {
  const payload = await api("/api/companion/review");
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!pages.length) return;
  state.timeline = pages;
  state.timelineIndex = pages.length - 1;
  state.timelineAtEnd = false;
}

function renderEmptyBattle(reason) {
  $("#battleShell").hidden = true;
  const empty = $("#battleEmpty");
  empty.hidden = false;
  const button = $("#emptyAdminButton");
  const reviewButton = $("#reviewBookButton");
  reviewButton.hidden = true;
  if (reason === "complete") {
    state.timelineAtEnd = true;
    state.timelineIndex = state.timeline.length;
    $("#battleEmptyTitle").textContent = "这版题你已经评完了。";
    $("#battleEmptyCopy").textContent = "每道题只记一票。去结果页看真实汇总。";
    button.hidden = false;
    button.textContent = "看结果";
    button.dataset.view = "results";
  } else if (reason === "ready_to_reveal") {
    state.timelineAtEnd = true;
    state.timelineIndex = state.timeline.length;
    $("#battleEmptyTitle").textContent = "最后一页已经写好。";
    $("#battleEmptyCopy").textContent = "先校对整本书，确认装订后才会揭晓最终聊灵。";
    button.hidden = true;
    reviewButton.hidden = false;
  } else {
    $("#battleEmptyTitle").textContent = "现在没有可评测的题。";
    $("#battleEmptyCopy").textContent = "请让管理员先发布一版题库。";
    button.hidden = !state.session?.isAdmin;
    button.textContent = "去管理题库";
    button.dataset.view = "admin";
  }
  updateProgress(state.session?.progress);
}

function renderContents() {
  const root = $("#contentsList");
  if (!root) return;
  root.replaceChildren();
  const total = Number(state.session?.progress?.total || state.timeline.length || 0);
  if (!state.timeline.length) {
    root.innerHTML = '<p class="contents-empty">还没有写下第一张票。翻开第一题，目录会在这里出现。</p>';
    return;
  }
  state.timeline.forEach((entry, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "contents-item";
    const label = entry.winner ? ({ A: "A", B: "B", tie_good: "都挺好", tie_bad: "都不行" }[entry.winner] || "已选择") : "未选择";
    item.innerHTML = `<span class="contents-page">${String(index + 1).padStart(2, "0")}</span><span><b>第 ${index + 1} 页</b><small>${escapeHtml(entry.payload?.battle?.query || "匿名对话")}</small></span><em>${escapeHtml(label)}</em>`;
    item.disabled = !entry.winner;
    item.addEventListener("click", () => {
      state.timelineAtEnd = false;
      state.timelineIndex = index;
      renderTimelineEntry();
      $("#contentsDialog").close();
      $("#battleShell").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    root.append(item);
  });
  if (total > state.timeline.length) {
    const note = document.createElement("p");
    note.className = "contents-empty";
    note.textContent = `还剩 ${total - state.timeline.length} 页，完成后会继续写入目录。`;
    root.append(note);
  }
}

function openContents() {
  renderContents();
  $("#contentsDialog").showModal();
}

function openBookReview() {
  const summary = $("#reviewSummary");
  const total = Number(state.session?.progress?.total || 0);
  const completed = Number(state.session?.progress?.completed || 0);
  const reflections = state.session?.companion?.season?.traces?.length || 0;
  const reflectionGoal = milestonesForBook(total).length;
  summary.replaceChildren();
  [
    ["书页", `${completed} / ${total}`, completed >= total ? "已完成" : "还需要继续阅读"],
    ["成长章节", `${reflections} / ${reflectionGoal}`, reflections >= reflectionGoal ? "已完成" : "可以跳过，但还未全部写下"],
    ["揭晓", state.session?.companion?.season?.revealed ? "已揭晓" : "装订后开启", state.session?.companion?.season?.revealed ? "已锁定" : "等待确认"]
  ].forEach(([label, value, copy]) => {
    const item = document.createElement("div");
    item.className = "review-row";
    item.innerHTML = `<span><small>${label}</small><b>${value}</b></span><em>${copy}</em>`;
    summary.append(item);
  });
  $("#reviewError").hidden = true;
  $("#finalizeBook").disabled = !state.session?.companion?.season?.canFinalize;
  $("#reviewDialog").showModal();
}

async function finalizeBook() {
  const button = $("#finalizeBook");
  button.disabled = true;
  $("#reviewError").hidden = true;
  try {
    const payload = await api("/api/companion/finalize", { method: "POST" });
    updateCompanionSnapshot(payload.companion);
    $("#reviewDialog").close();
    renderEmptyBattle("complete");
    pendingRevealSnapshot = payload.companion;
    $("#battleView").hidden = true;
    $("#growthChapter").hidden = true;
    $("#bindingChapter").hidden = false;
    document.body.classList.add("is-binding");
    const total = Number(payload.companion?.season?.total || 9);
    $("#bindingTitle").innerHTML = `把今天的 ${total} 次判断<br /><em>装订成一册。</em>`;
    $("#bindingContinue").focus();
  } catch (error) {
    $("#reviewError").textContent = error.message;
    $("#reviewError").hidden = false;
  } finally {
    button.disabled = false;
  }
}

function resetBattleUi() {
  state.contextOpened = false;
  state.voteId = null;
  state.editingVote = false;
  state.selectedReasons = [];
  $("#contextPanel").hidden = true;
  $("#contextToggle").setAttribute("aria-expanded", "false");
  $("#contextIcon").textContent = "＋";
  $("#voteOutcome").hidden = true;
  $("#referenceText").textContent = "这页已经记下。参考与统计会在整本书装订后打开。";
  $("#editVote").disabled = false;
  $("#editVote").textContent = "修改这一题选择";
  $("#nextBattle").disabled = false;
  $("#nextBattle").innerHTML = '下一题 <span aria-hidden="true">→</span>';
  $("#voteTitle").textContent = "如果是你，你会接着跟谁聊？";
  $$('.vote-button').forEach((button) => { button.disabled = false; button.classList.remove("is-selected"); });
  $$('.response-card').forEach((card) => card.classList.remove("is-selected", "is-muted"));
  $$('.response-copy').forEach((copy) => copy.classList.remove("is-expanded"));
  $$('.expand-response').forEach((button) => { button.textContent = "展开全文"; button.setAttribute("aria-expanded", "false"); });
}

function renderContext(context) {
  const panel = $("#contextPanel");
  panel.replaceChildren();
  const rows = Array.isArray(context) ? context : [];
  rows.forEach((message) => {
    const item = document.createElement("div");
    item.className = `chat-line ${message.role === "assistant" ? "assistant" : "user"}`;
    item.textContent = message.content;
    panel.append(item);
  });
  $("#contextCount").textContent = `${rows.length} 条`;
  $("#contextToggle").disabled = rows.length === 0;
}

function renderBattle(payload, entry = null) {
  state.battle = payload.battle;
  state.battleStartedAt = performance.now();
  state.timelineAtEnd = false;
  resetBattleUi();
  $("#battleEmpty").hidden = true;
  $("#battleShell").hidden = false;
  $("#queryText").textContent = payload.battle.query;
  $("#responseA").textContent = payload.battle.responseA.text;
  $("#responseB").textContent = payload.battle.responseB.text;
  $("#dimensionBadge").textContent = payload.battle.dimension || "维度未提供";
  $("#difficultyBadge").textContent = payload.battle.difficulty ? `难度 ${payload.battle.difficulty} / 5` : "难度未提供";
  renderContext(payload.battle.context);
  if (entry?.voteId) {
    state.voteId = entry.voteId;
    state.selectedReasons = [...entry.reasons];
    applyVoteSelection(entry.winner, true);
    $("#referenceText").textContent = "这页已经记下。参考与统计会在整本书装订后打开。";
    renderReasonTags();
    $("#voteOutcome").hidden = false;
  }
  updateProgress(state.session?.progress || payload.progress);
  updateEmber();
  updateBattleNavigation();
}

function renderTimelineEntry() {
  const entry = currentTimelineEntry();
  if (!entry) return;
  renderBattle(entry.payload, entry);
}

async function loadBattle() {
  if (state.session?.companion?.season?.pendingReflection) {
    openReflection(state.session.companion);
    return;
  }
  const shell = $("#battleShell");
  shell.hidden = false;
  $("#battleEmpty").hidden = true;
  setBusy(shell, true);
  try {
    const payload = await api("/api/battles/next");
    if (payload.companion) updateCompanionSnapshot(payload.companion);
    if (!payload.battle && payload.reason === "reflection_pending") openReflection(payload.companion || state.session.companion);
    else if (!payload.battle) renderEmptyBattle(payload.reason);
    else {
      state.timeline = state.timeline.slice(0, state.timelineIndex + 1);
      state.timeline.push({ payload, voteId: null, winner: null, reference: null, reasons: [] });
      state.timelineIndex = state.timeline.length - 1;
      renderTimelineEntry();
    }
  } catch (error) {
    renderEmptyBattle("error");
    $("#battleEmptyTitle").textContent = "题目没有取到。";
    $("#battleEmptyCopy").textContent = error.message;
  } finally {
    setBusy(shell, false);
  }
}

function previousBattle() {
  if (state.timelineAtEnd) {
    if (!state.timeline.length) return;
    state.timelineAtEnd = false;
    state.timelineIndex = state.timeline.length - 1;
  } else if (state.timelineIndex > 0) {
    state.timelineIndex -= 1;
  } else {
    return;
  }
  renderTimelineEntry();
  $("#battleShell").scrollTo({ top: 0, behavior: "smooth" });
}

function nextBattle() {
  if (state.session?.companion?.season?.canFinalize) {
    openBookReview();
    return;
  }
  if (state.session?.companion?.season?.pendingReflection) {
    openReflection(state.session.companion);
    return;
  }
  if (state.timelineIndex < state.timeline.length - 1) {
    state.timelineIndex += 1;
    animatePageTurn();
    renderTimelineEntry();
    $("#battleShell").scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  animatePageTurn();
  loadBattle();
}

function beginVoteEdit() {
  if (!state.voteId) return;
  state.editingVote = true;
  $("#voteOutcome").hidden = true;
  applyVoteSelection(currentTimelineEntry()?.winner, false);
  $("#editVote").disabled = true;
  $("#editVote").textContent = "请选择新的结果";
  $("#nextBattle").disabled = true;
  $("#voteTitle").textContent = "重新选择后，会覆盖原来的票";
  $(`.vote-button[data-vote="${currentTimelineEntry()?.winner}"]`)?.focus();
}

function renderReasonTags() {
  renderReasonTagButtons($("#reasonTags"), REASON_TAGS, state.selectedReasons, toggleReason);
}

async function toggleReason(tag) {
  const previous = [...state.selectedReasons];
  if (state.selectedReasons.includes(tag)) state.selectedReasons = state.selectedReasons.filter((item) => item !== tag);
  else if (state.selectedReasons.length < 2) state.selectedReasons.push(tag);
  else {
    showToast("判断依据最多选 2 个。");
    return;
  }
  renderReasonTags();
  try {
    const result = await api(`/api/votes/${encodeURIComponent(state.voteId)}`, { method: "PATCH", body: JSON.stringify({ reasonTags: state.selectedReasons }) });
    updateCompanionSnapshot(result.companion);
    const entry = currentTimelineEntry();
    if (entry) entry.reasons = [...state.selectedReasons];
  } catch (error) {
    state.selectedReasons = previous;
    renderReasonTags();
    showToast(error.message);
  }
}

async function submitVote(winner) {
  if (!state.battle || (state.voteId && !state.editingVote)) return;
  const editing = Boolean(state.voteId);
  const entry = currentTimelineEntry();
  const previousWinner = entry?.winner || null;
  const buttons = $$('.vote-button');
  applyVoteSelection(winner, true);
  try {
    const result = editing
      ? await api(`/api/votes/${encodeURIComponent(state.voteId)}`, { method: "PATCH", body: JSON.stringify({ winner, reasonTags: state.selectedReasons }) })
      : await api("/api/votes", {
        method: "POST",
        body: JSON.stringify({
          sampleToken: state.battle.sampleToken,
          winner,
          reasonTags: [],
          dwellMs: Math.round(performance.now() - state.battleStartedAt),
          contextOpened: state.contextOpened
        })
      });
    state.voteId = result.voteId || state.voteId;
    state.editingVote = false;
    if (entry) {
      entry.voteId = state.voteId;
      entry.winner = winner;
      entry.reference = result.reference ?? entry.reference;
      entry.reasons = [...state.selectedReasons];
    }
    $("#referenceText").textContent = "这页已经记下。参考与统计会在整本书装订后打开。";
    renderReasonTags();
    $("#voteOutcome").hidden = false;
    $("#editVote").disabled = false;
    $("#editVote").textContent = "修改这一题选择";
    $("#nextBattle").disabled = false;
    $("#voteTitle").textContent = "如果是你，你会接着跟谁聊？";
    if (result.progress) {
      state.session.progress = { ...state.session.progress, ...result.progress };
      updateProgress(state.session.progress);
    }
    updateCompanionSnapshot(result.companion);
    if (result.companion?.season?.pendingReflection) {
      $("#nextBattle").textContent = `完成${result.companion.season.pendingReflection.stageName}对话 →`;
    } else {
      $("#nextBattle").innerHTML = '下一题 <span aria-hidden="true">→</span>';
    }
    if (editing) showToast("选择已更新，结果中的原票已经被覆盖。");
    $("#nextBattle").focus();
  } catch (error) {
    if (editing && previousWinner) applyVoteSelection(previousWinner, false);
    else {
      buttons.forEach((button) => { button.disabled = false; button.classList.remove("is-selected"); });
      $$('.response-card').forEach((card) => card.classList.remove("is-selected", "is-muted"));
    }
    showToast(error.message);
  }
}

function renderResults(payload) {
  const version = payload.dataset;
  const summary = version?.summary || {};
  const sampleCount = Number(version?.sampleCount || 0);
  const labelled = Math.max(0, sampleCount - Number(summary.missing_dimensions || 0));
  $("#metricVotes").textContent = Number(payload.totalVotes || 0).toLocaleString("zh-CN");
  $("#metricParticipants").textContent = Number(payload.participants || 0).toLocaleString("zh-CN");
  $("#metricSamples").textContent = sampleCount.toLocaleString("zh-CN");
  $("#metricVersion").textContent = version?.displayName || "暂无版本";
  $("#metricCoverage").textContent = sampleCount ? `${Math.round(labelled / sampleCount * 100)}%` : "0%";
  $("#modelGapNotice").hidden = Boolean(summary.has_model_ids);

  const total = Number(payload.totalVotes || 0);
  $("#distributionTotal").textContent = `${total.toLocaleString("zh-CN")} 票`;
  const labels = { A: "A 更好", B: "B 更好", tie_good: "都挺好", tie_bad: "都不行" };
  const distribution = $("#distributionList");
  distribution.replaceChildren();
  Object.entries(labels).forEach(([key, label]) => {
    const count = Number(payload.distribution?.[key] || 0);
    const percent = total ? count / total : 0;
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `<div><b>${escapeHtml(label)}</b><span>${count.toLocaleString("zh-CN")} · ${formatPercent(percent)}</span></div><span class="bar-track"><i style="width:${percent * 100}%"></i></span>`;
    distribution.append(row);
  });

  const dimensions = $("#dimensionList");
  dimensions.replaceChildren();
  if (!payload.dimensions?.length) {
    dimensions.innerHTML = '<div class="empty-inline">还没有维度数据。</div>';
  } else {
    const maxVotes = Math.max(1, ...payload.dimensions.map((item) => Number(item.votes || 0)));
    payload.dimensions.forEach((item) => {
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `<div><b>${escapeHtml(item.dimension)}</b><span>${Number(item.samples)} 题 · ${Number(item.votes)} 票</span></div><span class="bar-track"><i style="width:${Number(item.votes || 0) / maxVotes * 100}%"></i></span>`;
      dimensions.append(row);
    });
  }

  const disputed = $("#disputedList");
  disputed.replaceChildren();
  if (!payload.disputed?.length) {
    disputed.innerHTML = '<div class="empty-inline">至少要有两张不同意见的票，才能判断一题是否有分歧。</div>';
  } else {
    payload.disputed.forEach((item) => {
      const row = document.createElement("div");
      row.className = "disputed-row";
      row.innerHTML = `<b title="${escapeHtml(item.query)}">${escapeHtml(item.query)}</b><span>${Number(item.total)} 票</span><em>分歧 ${formatPercent(item.disagreement)}</em>`;
      disputed.append(row);
    });
  }
}

async function loadResults() {
  try {
    renderResults(await api("/api/results"));
  } catch (error) {
    showToast(error.message);
  }
}

function renderMechanism() {
  const version = state.session?.activeVersion;
  const summary = version?.summary || {};
  $("#healthTitle").textContent = version?.displayName || "还没有已发布题库";
  $("#healthCopy").textContent = version ? "这些数字来自当前已发布版本。没有提供的字段，不补猜。" : "管理员发布后，这里会显示真实缺口。";
  const metrics = [
    ["可用样本", Number(version?.sampleCount || 0)],
    ["缺模型 ID", Number(summary.missing_model_ids || 0)],
    ["缺评测维度", Number(summary.missing_dimensions || 0)],
    ["缺有效难度", Number(summary.missing_difficulty || 0)]
  ];
  $("#healthMetrics").innerHTML = metrics.map(([label, value]) => `<article><small>${escapeHtml(label)}</small><b>${Number(value).toLocaleString("zh-CN")}</b></article>`).join("");
}

function setUploadStep(step) {
  state.upload.step = step;
  $$('[data-upload-step]').forEach((section) => { section.hidden = Number(section.dataset.uploadStep) !== step; });
  $$('[data-step-indicator]').forEach((item) => {
    const itemStep = Number(item.dataset.stepIndicator);
    item.classList.toggle("is-active", itemStep === step);
    item.classList.toggle("is-complete", itemStep < step);
  });
  $(`[data-upload-step="${step}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function resetUpload() {
  state.upload = freshUploadState();
  $("#datasetFile").value = "";
  $("#duplicateConfirm").checked = false;
  setInlineError($("#fileError"), "");
  setInlineError($("#publishError"), "");
  setUploadStep(1);
}

function sheetData(workbook, name) {
  const worksheet = workbook.Sheets[name];
  const matrix = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, blankrows: false });
  const headers = (matrix[0] || []).map((header) => String(header).trim()).filter(Boolean);
  const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: true, blankrows: false });
  return { name, headers, rows, ...scoreSheet(headers) };
}

async function handleFile(file) {
  setInlineError($("#fileError"), "");
  if (!file || !acceptedFile(file)) return setInlineError($("#fileError"), "只支持 XLSX 和 CSV。" );
  if (!file.size || file.size > MAX_FILE_BYTES) return setInlineError($("#fileError"), "文件为空，或者超过 20MB。" );
  if (!window.XLSX) return setInlineError($("#fileError"), "表格解析组件没有载入，请刷新页面后重试。" );
  try {
    const buffer = await file.arrayBuffer();
    const source = spreadsheetReadSource(buffer, file.name);
    const workbook = window.XLSX.read(source.data, { type: source.type, cellDates: false });
    const sheets = workbook.SheetNames.map((name) => sheetData(workbook, name)).sort((left, right) => right.score - left.score);
    if (!sheets.length) throw new Error("这个文件没有可用工作表。");
    state.upload = { ...freshUploadState(), file, buffer, sheets };
    selectSheet(sheets[0].name);
    const stem = file.name.replace(/\.(xlsx|csv)$/i, "");
    $("#versionName").value = `${stem} · ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date())}`;
    setUploadStep(2);
  } catch (error) {
    setInlineError($("#fileError"), error.message || "文件没有解析成功。" );
  }
}

function selectSheet(name) {
  const sheet = state.upload.sheets.find((item) => item.name === name) || state.upload.sheets[0];
  state.upload.selectedSheet = sheet.name;
  state.upload.headers = sheet.headers;
  state.upload.rows = sheet.rows;
  const suggestion = suggestMapping(sheet.headers);
  state.upload.mapping = suggestion.mapping;
  state.upload.confidence = suggestion.confidence;
  renderSheetPicker();
  renderMapping();
  renderPreview();
}

function renderSheetPicker() {
  const row = $("#sheetRow");
  const select = $("#sheetSelect");
  row.hidden = state.upload.sheets.length <= 1;
  select.innerHTML = state.upload.sheets.map((sheet) => `<option value="${escapeHtml(sheet.name)}" ${sheet.name === state.upload.selectedSheet ? "selected" : ""}>${escapeHtml(sheet.name)} · ${sheet.rows.length} 行 · ${sheet.requiredMatches}/4 必填字段</option>`).join("");
}

function renderMapping() {
  const grid = $("#mappingGrid");
  grid.replaceChildren();
  FIELD_DEFINITIONS.forEach((field) => {
    const label = document.createElement("label");
    const confidence = state.upload.confidence[field.key];
    label.className = "field-row";
    if (confidence === "alias") label.classList.add("needs-review");
    if (confidence === "missing" && field.required) label.classList.add("is-missing");
    const copy = document.createElement("span");
    copy.innerHTML = `<b>${escapeHtml(field.label)}${field.required ? " *" : ""}</b><small>${field.required ? "发布必填" : "没有也能发布"}${confidence === "alias" ? " · 已按别名匹配" : ""}</small>`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${field.label}对应列`);
    select.innerHTML = `<option value="">${field.required ? "请选择列" : "未提供"}</option>${state.upload.headers.map((header) => `<option value="${escapeHtml(header)}" ${state.upload.mapping[field.key] === header ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}`;
    select.addEventListener("change", () => {
      state.upload.mapping[field.key] = select.value;
      state.upload.confidence[field.key] = select.value ? "confirmed" : "missing";
      renderMapping();
      renderPreview();
    });
    label.append(copy, select);
    grid.append(label);
  });
}

function renderPreview() {
  const mapped = FIELD_DEFINITIONS.filter((field) => state.upload.mapping[field.key]).slice(0, 7);
  $("#previewMeta").textContent = `${state.upload.rows.length} 行 · 当前展示 ${mapped.length} 列`;
  $("#previewHead").innerHTML = `<tr>${mapped.map((field) => `<th>${escapeHtml(field.label)}</th>`).join("")}</tr>`;
  $("#previewBody").innerHTML = state.upload.rows.slice(0, 5).map((row) => `<tr>${mapped.map((field) => `<td title="${escapeHtml(row[state.upload.mapping[field.key]])}">${escapeHtml(row[state.upload.mapping[field.key]])}</td>`).join("")}</tr>`).join("");
}

function groupWarnings(warnings) {
  const groups = new Map();
  warnings.forEach((warning) => {
    const group = groups.get(warning.type) || { count: 0, message: warning.message };
    group.count += 1;
    groups.set(warning.type, group);
  });
  const labels = {
    missing_model_id: "条缺少完整模型 ID，结果页不会生成模型榜。",
    missing_dimension: "条没有评测维度，统一显示为「未标注」。",
    missing_difficulty: "条没有有效难度。",
    invalid_difficulty: "条难度不在 1–5，已按「未提供」处理。",
    duplicate_content: "条内容相同但 UID 不同，请确认是否需要保留。",
    long_response: "条包含超过 8,000 字的回复。"
  };
  return [...groups.entries()].map(([type, group]) => labels[type] ? `${group.count} ${labels[type]}` : group.message);
}

function renderIssues(root, issues, type) {
  root.replaceChildren();
  issues.slice(0, 12).forEach((message) => {
    const row = document.createElement("div");
    row.className = `issue ${type}`;
    row.textContent = message;
    root.append(row);
  });
  if (issues.length > 12) {
    const row = document.createElement("div");
    row.className = `issue ${type}`;
    row.textContent = `还有 ${issues.length - 12} 条同类问题。`;
    root.append(row);
  }
}

function renderPreflight() {
  const result = state.upload.preflight;
  const summary = result.summary;
  const blockingCount = result.errors.length;
  const duplicateCount = Number(summary.excluded_duplicate_rows || 0);
  const cards = [
    ["可发布样本", summary.usable_rows, ""],
    ["阻断问题", blockingCount, blockingCount ? "is-bad" : ""],
    ["重复 UID", duplicateCount, duplicateCount ? "is-warn" : ""],
    ["缺模型 ID", summary.missing_model_ids, summary.missing_model_ids ? "is-warn" : ""],
    ["缺评测维度", summary.missing_dimensions, summary.missing_dimensions ? "is-warn" : ""]
  ];
  $("#checkGrid").innerHTML = cards.map(([label, value, className]) => `<article class="${className}"><small>${escapeHtml(label)}</small><b>${Number(value).toLocaleString("zh-CN")}</b></article>`).join("");
  $("#preflightState").textContent = blockingCount ? "先修完阻断问题" : duplicateCount ? "确认重复项后可继续" : "可以准备发布";
  renderIssues($("#blockingIssues"), result.errors.map((item) => item.message), "error");
  renderIssues($("#warningIssues"), groupWarnings(result.warnings), "warning");
  const duplicateWrap = $("#duplicateConfirmWrap");
  duplicateWrap.hidden = duplicateCount === 0;
  $("#duplicateCopy").textContent = duplicateCount ? `共排除 ${duplicateCount} 条。每组都会保留最前面的一条。` : "";
  $("#confirmPreflight").disabled = blockingCount > 0;
}

function runPreflight() {
  const mappingErrors = validateMapping(state.upload.mapping);
  if (mappingErrors.length) {
    showToast(mappingErrors[0].message);
    const firstMissing = $(".field-row.is-missing select");
    firstMissing?.focus();
    return;
  }
  state.upload.preflight = normalizeRows(state.upload.rows, state.upload.mapping);
  $("#duplicateConfirm").checked = false;
  renderPreflight();
  setUploadStep(3);
}

function preparePublish() {
  const result = state.upload.preflight;
  if (result.errors.length) {
    $("#blockingIssues .issue")?.focus();
    showToast("阻断问题还没处理完。");
    return;
  }
  if (result.duplicateGroups.length && !$("#duplicateConfirm").checked) {
    $("#duplicateConfirm").focus();
    showToast("先确认重复 UID 怎么处理。");
    return;
  }
  const summary = result.summary;
  $("#publishSummary").innerHTML = [
    ["文件", state.upload.file.name],
    ["工作表", state.upload.selectedSheet],
    ["发布样本", `${summary.usable_rows} 条`],
    ["排除重复", `${summary.excluded_duplicate_rows} 条`],
    ["模型榜", summary.has_model_ids ? "字段已齐，本版仍不排名" : "不生成" ]
  ].map(([label, value]) => `<article><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></article>`).join("");
  setUploadStep(4);
}

function updatePublishProgress(percent, message) {
  $("#publishProgress").hidden = false;
  $("#publishProgressFill").style.width = `${percent}%`;
  $("#publishProgressText").textContent = message;
}

async function publishDataset() {
  const button = $("#publishDataset");
  const name = $("#versionName").value.trim();
  if (!name) {
    $("#versionName").focus();
    showToast("给这版题库起个名字。");
    return;
  }
  button.disabled = true;
  setInlineError($("#publishError"), "");
  try {
    if (state.upload.draftId) {
      updatePublishProgress(5, "正在清理上次没完成的草稿…");
      await api(`/api/admin/datasets/${encodeURIComponent(state.upload.draftId)}`, { method: "DELETE" });
      state.upload.draftId = null;
    }
    updatePublishProgress(10, "正在创建草稿…");
    const created = await api("/api/admin/datasets", { method: "POST", body: JSON.stringify({ displayName: name, mapping: state.upload.mapping, preflightSummary: state.upload.preflight.summary }) });
    state.upload.draftId = created.version.id;

    updatePublishProgress(25, "正在保存原始文件…");
    await api(`/api/admin/datasets/${encodeURIComponent(state.upload.draftId)}/source?filename=${encodeURIComponent(state.upload.file.name)}`, {
      method: "PUT",
      headers: { "content-type": state.upload.file.type || "application/octet-stream" },
      body: state.upload.buffer
    });

    const samples = state.upload.preflight.samples;
    for (let index = 0; index < samples.length; index += 25) {
      const batch = samples.slice(index, index + 25);
      const percent = 30 + Math.round((index + batch.length) / samples.length * 40);
      updatePublishProgress(percent, `正在写入样本 ${Math.min(index + batch.length, samples.length)} / ${samples.length}…`);
      await api(`/api/admin/datasets/${encodeURIComponent(state.upload.draftId)}/samples/batch`, { method: "POST", body: JSON.stringify({ samples: batch }) });
    }

    updatePublishProgress(76, "服务端正在复查数据…");
    const checked = await api(`/api/admin/datasets/${encodeURIComponent(state.upload.draftId)}/validate`, { method: "POST" });
    if (!checked.valid) throw new Error(checked.errors?.[0] || "服务端检查没有通过。");

    updatePublishProgress(88, "正在切换到新版本…");
    await api(`/api/admin/datasets/${encodeURIComponent(state.upload.draftId)}/publish`, { method: "POST" });
    state.upload.draftId = null;
    updatePublishProgress(100, "发布完成。新评测已经使用这版题库。" );
    await loadSession();
    await loadVersions();
    showToast("新题库已经发布。旧投票没有混进来。" );
    setTimeout(async () => {
      resetUpload();
      showView("battle");
      await loadReviewTimeline();
      await loadBattle();
    }, 500);
  } catch (error) {
    setInlineError($("#publishError"), `${error.message} 草稿已经保留，再点一次发布会先清理它。` );
    await loadVersions().catch(() => {});
  } finally {
    button.disabled = false;
  }
}

function renderVersions(versions) {
  const root = $("#versionList");
  root.replaceChildren();
  if (!versions.length) {
    root.innerHTML = '<div class="empty-inline">还没有题库版本。</div>';
    return;
  }
  versions.forEach((version) => {
    const row = document.createElement("div");
    row.className = "version-row";
    const actions = version.status === "archived"
      ? `<button type="button" data-version-action="activate" data-version-id="${escapeHtml(version.id)}" data-version-name="${escapeHtml(version.displayName)}">回滚到这版</button>`
      : ["draft", "ready"].includes(version.status)
        ? `<button type="button" data-version-action="delete" data-version-id="${escapeHtml(version.id)}" data-version-name="${escapeHtml(version.displayName)}">删除草稿</button>`
        : "";
    row.innerHTML = `<div><b>${escapeHtml(version.displayName)}</b><small>${escapeHtml(version.sourceFilename || "没有源文件")}</small></div><span class="version-badge ${version.status === "active" ? "active" : ""}">${escapeHtml(versionStatusLabel(version.status))}</span><span>${Number(version.sampleCount)} 条 · ${escapeHtml(formatDate(version.publishedAt || version.createdAt))}</span><div class="version-actions">${actions}</div>`;
    root.append(row);
  });
}

async function loadVersions() {
  if (!state.session?.isAdmin) return;
  try {
    const payload = await api("/api/admin/datasets");
    renderVersions(payload.versions || []);
  } catch (error) {
    $("#versionList").innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  }
}

function askConfirm({ title, copy, action }) {
  state.pendingConfirm = action;
  $("#confirmTitle").textContent = title;
  $("#confirmCopy").textContent = copy;
  $("#confirmDialog").showModal();
}

async function runVersionAction(button) {
  const id = button.dataset.versionId;
  const name = button.dataset.versionName;
  if (button.dataset.versionAction === "activate") {
    askConfirm({
      title: `切回「${name}」？`,
      copy: "新评测会立刻使用这版题库。当前版本和它的票据都会保留。",
      action: async () => api(`/api/admin/datasets/${encodeURIComponent(id)}/activate`, { method: "POST" })
    });
  } else {
    askConfirm({
      title: `删除草稿「${name}」？`,
      copy: "草稿和已上传的源文件会一起删除。已经发布过的版本不能这样删除。",
      action: async () => api(`/api/admin/datasets/${encodeURIComponent(id)}`, { method: "DELETE" })
    });
  }
}

function bindEvents() {
  const leaveWelcome = () => {
    $("#welcomeScreen").hidden = true;
    $("#setupScreen").hidden = true;
    document.body.classList.remove("is-welcome");
    document.body.classList.remove("is-setup");
    document.body.dataset.flowState = "READING";
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#main-content").focus({ preventScroll: true });
  };
  const openSetup = () => {
    $("#welcomeScreen").hidden = true;
    $("#setupScreen").hidden = false;
    document.body.classList.remove("is-welcome");
    document.body.classList.add("is-setup");
    document.body.dataset.flowState = "SETUP";
    $("#setupTitle")?.focus?.({ preventScroll: true });
  };
  $("#openSetup").addEventListener("click", openSetup);
  $("#coverObject").addEventListener("click", openSetup);
  bindCompanionUi({
    api,
    showToast,
    onBirth: (snapshot) => {
      updateCompanionSnapshot(snapshot);
      if (snapshot?.season && state.session) {
        state.session.progress = { ...state.session.progress, completed: Number(snapshot.season.completed || 0), total: Number(snapshot.season.total || 9), goal: Number(snapshot.season.goal || snapshot.season.total || 9), remaining: Number(snapshot.season.remaining || 0) };
        updateProgress(state.session.progress);
      }
      leaveWelcome();
      if (!state.battle) loadBattle();
    },
    onReflection: (snapshot) => {
      updateCompanionSnapshot(snapshot);
      if (snapshot?.season?.canFinalize) {
        renderEmptyBattle("ready_to_reveal");
        openBookReview();
      } else if (snapshot?.season?.revealed) {
        renderEmptyBattle("complete");
        openReveal(snapshot);
      } else {
        $("#nextBattle").innerHTML = '下一题 <span aria-hidden="true">→</span>';
        loadBattle();
      }
    },
    onReset: () => window.location.reload(),
    onResults: () => showView("results"),
    onGoalChange: updateGoalPreview
  });
  $("#bindingContinue").addEventListener("click", () => {
    $("#bindingChapter").hidden = true;
    $("#battleView").hidden = false;
    document.body.classList.remove("is-binding");
    document.body.dataset.flowState = "REVEAL";
    if (pendingRevealSnapshot) openReveal(pendingRevealSnapshot);
  });
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) showView(viewButton.dataset.view);
  });
  $$('.vote-button').forEach((button) => button.addEventListener("click", () => submitVote(button.dataset.vote)));
  $("#nextBattle").addEventListener("click", nextBattle);
  $("#previousBattle").addEventListener("click", previousBattle);
  $("#openContents").addEventListener("click", openContents);
  $("#closeContents").addEventListener("click", () => $("#contentsDialog").close());
  $("#reviewBookButton").addEventListener("click", openBookReview);
  $("#closeReview").addEventListener("click", () => $("#reviewDialog").close());
  $("#finalizeBook").addEventListener("click", finalizeBook);
  $("#editVote").addEventListener("click", beginVoteEdit);
  $("#refreshResults").addEventListener("click", loadResults);
  $("#contextToggle").addEventListener("click", () => {
    const panel = $("#contextPanel");
    const open = panel.hidden;
    panel.hidden = !open;
    state.contextOpened ||= open;
    $("#contextToggle").setAttribute("aria-expanded", String(open));
    $("#contextIcon").textContent = open ? "−" : "＋";
  });
  $$('.expand-response').forEach((button) => button.addEventListener("click", () => {
    const copy = $(`#${button.dataset.target}`);
    const expanded = !copy.classList.contains("is-expanded");
    copy.classList.toggle("is-expanded", expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "收起" : "展开全文";
  }));

  document.addEventListener("keydown", (event) => {
    if (state.activeView !== "battle" || (state.voteId && !state.editingVote) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const winner = ({ "1": "A", "2": "tie_good", "3": "tie_bad", "4": "B" })[event.key];
    if (winner) { event.preventDefault(); submitVote(winner); }
  });

  const dropzone = $("#dropzone");
  $("#datasetFile").addEventListener("change", (event) => handleFile(event.target.files?.[0]));
  ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("is-dragging"); }));
  dropzone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));
  $("#sheetSelect").addEventListener("change", (event) => selectSheet(event.target.value));
  $("#confirmMapping").addEventListener("click", runPreflight);
  $("#confirmPreflight").addEventListener("click", preparePublish);
  $("#publishDataset").addEventListener("click", publishDataset);
  $("#resetUpload").addEventListener("click", resetUpload);
  $$('[data-upload-back]').forEach((button) => button.addEventListener("click", () => setUploadStep(Number(button.dataset.uploadBack))));
  $("#refreshVersions").addEventListener("click", loadVersions);
  $("#versionList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-version-action]");
    if (button) runVersionAction(button);
  });
  $("#confirmDialog").addEventListener("close", async () => {
    if ($("#confirmDialog").returnValue !== "confirm" || !state.pendingConfirm) { state.pendingConfirm = null; return; }
    const action = state.pendingConfirm;
    state.pendingConfirm = null;
    try {
      await action();
      await loadSession();
      await loadReviewTimeline();
      await loadVersions();
      await loadBattle();
      showToast("版本已经切换。历史票据还在原版本里。" );
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function boot() {
  bindEvents();
  try {
    await loadSession();
    if (state.session?.companion?.born) {
      $("#welcomeScreen").hidden = true;
      $("#setupScreen").hidden = true;
      document.body.classList.remove("is-welcome");
      document.body.classList.remove("is-setup");
      document.body.dataset.flowState = "READING";
      await loadReviewTimeline();
      await loadBattle();
    }
  } catch (error) {
    $("#activeDatasetName").textContent = "数据服务没有连接";
    $("#activeDatasetMeta").textContent = error.message;
    renderEmptyBattle("error");
    $("#battleEmptyTitle").textContent = "现在还不能开始评测。";
    $("#battleEmptyCopy").textContent = error.message;
  }
}

boot();
