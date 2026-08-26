const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let latestSnapshot = null;
const STAGE_ATLAS = Object.freeze({ birth: [0, 0], awakening: [1, 0], forming: [2, 0], ready_to_reveal: [3, 0] });

function setAtlas(element, atlas = [0, 0]) {
  if (!element) return;
  const [column, row] = atlas;
  element.classList.remove("is-final-sprite");
  element.style.removeProperty("--companion-sprite");
  element.style.setProperty("--atlas-x", `${Number(column || 0) * 33.3333}%`);
  element.style.setProperty("--atlas-y", `${Number(row || 0) * 50}%`);
  element.style.setProperty("--atlas-img-x", `${Number(column || 0) * -100}%`);
  element.style.setProperty("--atlas-img-y", `${Number(row || 0) * -100}%`);
}

function setSpecies(element, species) {
  if (!element || !species?.sprite) return;
  element.classList.add("is-final-sprite");
  element.style.setProperty("--companion-sprite", `url("./assets/companions/${species.sprite}?v=3.1.3")`);
  element.dataset.species = species.id || "";
}

function setCompanionVisual(element, season, stage = season?.stage) {
  if (season?.revealed && season.species) setSpecies(element, season.species);
  else setAtlas(element, STAGE_ATLAS[stage] || STAGE_ATLAS.birth);
}

function stageCopy(season) {
  if (!season) return { title: "等待与你相遇", message: "选好出生基因，它才会在聊力场醒来。" };
  if (season.revealed && season.species) return { title: season.species.name, message: season.species.tagline };
  if (season.stage === "forming") return { title: "轮廓正在成形", message: season.latestReply || "它开始认出你在一句话里珍惜的东西。" };
  if (season.stage === "ready_to_reveal") return { title: "最后一页已经写好", message: "先校对整本书，再让它长成自己的最终形状。" };
  if (season.stage === "awakening") return { title: "它第一次睁开眼", message: season.latestReply || "有些偏好不必说破，也会慢慢长出形状。" };
  return { title: "一颗正在听的种子", message: "每一次认真判断，都会让它多一点光。" };
}

export function renderCompanion(snapshot, { runtime = "hosted" } = {}) {
  latestSnapshot = snapshot;
  const born = Boolean(snapshot?.born);
  const season = snapshot?.season || null;
  const companion = snapshot?.companion || null;
  const copy = stageCopy(season);
  const genome = companion?.genome || "light";
  const card = $("#companionCard");
  if (card) {
    card.dataset.genome = genome;
    card.dataset.stage = season?.stage || "birth";
  }
  setCompanionVisual($("#companionArt"), season);
  setCompanionVisual($("#companionCapsuleArt"), season);
  setCompanionVisual($("#resultsCompanionArt"), season);
  $("#companionGenome").textContent = born ? `${companion.genomeName || "澄光"} · 页角` : "尚未出生";
  $("#companionRole").textContent = season?.role === "echo" ? "回声分身" : "主伙伴";
  $("#companionTitle").textContent = copy.title;
  $("#companionMessage").textContent = copy.message;
  $("#companionStage").textContent = season?.stageName || "出生";
  $("#companionEnergyText").textContent = `${Number(season?.completed || 0)} / ${Number(season?.total || 9)}`;
  const progress = season?.total ? Math.min(100, Number(season.completed || 0) / Number(season.total) * 100) : 0;
  $("#companionFill").style.width = `${progress}%`;
  $("#companionProgressTrack").setAttribute("aria-valuemax", String(season?.total || 9));
  $("#companionProgressTrack").setAttribute("aria-valuenow", String(season?.completed || 0));
  const next = season?.pendingReflection
    ? `一段成长对话正在等你`
    : season?.canFinalize
      ? "整本书已完成，等你确认装订"
    : season?.revealed
      ? `星谱里已有 ${Number(companion?.lineageCount || 0)} 个回声分身`
      : `再完成 ${Number(season?.remaining ?? 3)} 次判断，进入下一阶段`;
  $("#companionNext").textContent = next;
  const mode = $("#analysisMode");
  mode.hidden = season?.analysisMode !== "demo";
  mode.textContent = "演示分析";
  $("#companionCapsuleName").textContent = season?.revealed ? season.species.name : `${season?.stageName || "出生"} · ${companion?.genomeName || "聊灵"}`;
  $("#companionCapsuleMeta").textContent = next;
  const resultsName = $("#resultsCompanionName");
  const resultsMessage = $("#resultsCompanionMessage");
  if (resultsName) resultsName.textContent = copy.title;
  if (resultsMessage) resultsMessage.textContent = copy.message;
  $("#demoReset").hidden = !["local", "static"].includes(runtime);
}

export function openReflection(snapshot) {
  const pending = snapshot?.season?.pendingReflection;
  if (!pending) return false;
  const chapter = $("#growthChapter");
  chapter.dataset.milestone = String(pending.milestone);
  $("#reflectionStage").textContent = `${pending.stageName} · 第 ${pending.milestone} 次判断`;
  $("#reflectionPrompt").textContent = pending.prompt;
  $("#reflectionText").value = "";
  $("#reflectionCount").textContent = "0 / 180";
  $("#reflectionError").hidden = true;
  setCompanionVisual($("#growthArt"), snapshot?.season, pending.stage);
  const chapterIndex = Math.max(1, Math.min(3, Math.round(Number(pending.milestone) / (Number(snapshot?.season?.total || 9) / 3))));
  $("#chapterNumber").textContent = String(chapterIndex).padStart(2, "0");
  $("#battleView").hidden = true;
  chapter.hidden = false;
  document.body.classList.add("is-growth");
  document.body.dataset.flowState = "GROWTH_CHAPTER";
  window.scrollTo({ top: 0, behavior: "instant" });
  setTimeout(() => $("#reflectionText").focus(), 0);
  return true;
}

export function openReveal(snapshot) {
  const season = snapshot?.season;
  if (!season?.revealed || !season.species) return false;
  const dialog = $("#revealDialog");
  setSpecies($("#revealArt"), season.species);
  $("#revealGenome").textContent = `${snapshot.companion.genomeName}基因 · ${season.role === "echo" ? "回声分身" : "主伙伴"}`;
  $("#revealName").textContent = season.species.name;
  $("#revealTagline").textContent = season.species.tagline;
  const traces = $("#revealTraces");
  traces.replaceChildren();
  const rows = season.traces?.length ? season.traces : ["你愿意认真分辨一句话有没有接住人", "你让理解、好奇和分寸长出了自己的比例", "九次选择共同留下了这道形状"];
  rows.slice(0, 3).forEach((trace) => {
    const item = document.createElement("li");
    item.textContent = trace;
    traces.append(item);
  });
  if (!dialog.open) dialog.showModal();
  return true;
}

export function bindCompanionUi({ api, showToast, onBirth, onReflection, onReset, onResults, onGoalChange }) {
  $$('input[name="genome"]').forEach((input) => input.addEventListener("change", () => {
    $$("[data-genome-card]").forEach((card) => {
      const selected = card.dataset.genomeCard === input.value;
      card.classList.toggle("is-selected", selected);
      card.querySelector("em").textContent = selected ? "已选择" : "选择";
    });
  }));
  $$("input[name=\"sessionGoal\"]").forEach((input) => input.addEventListener("change", () => {
    $$("[data-goal-card]").forEach((card) => card.classList.toggle("is-selected", card.querySelector("input")?.checked));
    onGoalChange?.(Number(input.value));
  }));

  $("#enterArena").addEventListener("click", async () => {
    const button = $("#enterArena");
    button.disabled = true;
    try {
      const genome = $('input[name="genome"]:checked')?.value || "light";
      const goal = Number($('input[name="sessionGoal"]:checked')?.value || 9);
      const payload = await api("/api/companion/birth", { method: "POST", body: JSON.stringify({ genome, goal }) });
      await onBirth?.(payload.companion);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#reflectionText").addEventListener("input", (event) => {
    $("#reflectionCount").textContent = `${event.target.value.length} / 180`;
  });

  async function submitReflection(text) {
    const chapter = $("#growthChapter");
    const button = $("#submitReflection");
    button.disabled = true;
    $("#skipReflection").disabled = true;
    $("#reflectionError").hidden = true;
    try {
      const payload = await api("/api/companion/reflections", {
        method: "POST",
        body: JSON.stringify({ milestone: Number(chapter.dataset.milestone), text })
      });
      chapter.hidden = true;
      $("#battleView").hidden = false;
      document.body.classList.remove("is-growth");
      document.body.dataset.flowState = "READING";
      onReflection(payload.companion);
    } catch (error) {
      $("#reflectionError").textContent = error.message;
      $("#reflectionError").hidden = false;
    } finally {
      button.disabled = false;
      $("#skipReflection").disabled = false;
    }
  }

  $("#reflectionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitReflection($("#reflectionText").value.trim());
  });
  $("#skipReflection").addEventListener("click", () => submitReflection(""));
  $("#demoReset").addEventListener("click", async () => {
    if (!window.confirm("重新打开一册？当前浏览器里的投票、成长和出生基因会清空，题库版本仍会保留。")) return;
    try {
      await api("/api/demo/reset", { method: "POST" });
      onReset();
    } catch (error) { showToast(error.message); }
  });
  $("#companionCapsule").addEventListener("click", () => {
    if (latestSnapshot?.season?.pendingReflection) openReflection(latestSnapshot);
    else showToast($("#companionCapsuleMeta").textContent);
  });
  $("#revealClose").addEventListener("click", () => $("#revealDialog").close());
  $("#revealResults").addEventListener("click", () => { $("#revealDialog").close(); onResults(); });
}
