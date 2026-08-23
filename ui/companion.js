const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let latestSnapshot = null;

function setSprite(element, species = null) {
  if (!element) return;
  const sprite = species?.sprite;
  element.classList.toggle("is-unrevealed", !sprite);
  element.style.setProperty("--companion-sprite", sprite ? `url("./assets/companions/${sprite}")` : "none");
  element.dataset.species = species?.id || "";
}

function stageCopy(season) {
  if (!season) return { title: "等待与你相遇", message: "选好出生基因，它才会在 Chat Arena 醒来。" };
  if (season.revealed && season.species) return { title: season.species.name, message: season.species.tagline };
  if (season.stage === "forming") return { title: "轮廓正在成形", message: season.latestReply || "它开始认出你在一句话里珍惜的东西。" };
  if (season.stage === "awakening") return { title: "它第一次睁开眼", message: season.latestReply || "有些偏好不必说破，也会慢慢长出形状。" };
  return { title: "一只正在孵化的聊灵", message: "每一次认真判断，都会让它长出一点自己的轮廓。" };
}

export function renderCompanion(snapshot, { runtime = "hosted" } = {}) {
  latestSnapshot = snapshot;
  const born = Boolean(snapshot?.born);
  const season = snapshot?.season || null;
  const companion = snapshot?.companion || null;
  const copy = stageCopy(season);
  const species = season?.species || null;
  const genome = companion?.genome || "light";
  const card = $("#companionCard");
  if (card) {
    card.dataset.genome = genome;
    card.dataset.stage = season?.stage || "birth";
    card.dataset.revealed = String(Boolean(species));
  }
  setSprite($("#companionArt"), species);
  setSprite($("#companionCapsuleArt"), species);
  $("#companionGenome").textContent = born ? `${companion.genomeName || "澄光"}基因` : "尚未出生";
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
    : season?.revealed
      ? `星谱里已有 ${Number(companion?.lineageCount || 0)} 个回声分身`
      : `再完成 ${Number(season?.remaining ?? 3)} 次判断，进入下一阶段`;
  $("#companionNext").textContent = next;
  const mode = $("#analysisMode");
  mode.hidden = season?.analysisMode !== "demo";
  mode.textContent = "演示分析";
  $("#companionCapsuleName").textContent = season?.revealed ? season.species.name : `${season?.stageName || "出生"} · ${companion?.genomeName || "聊灵"}`;
  $("#companionCapsuleMeta").textContent = next;
  $("#demoReset").hidden = !["local", "static"].includes(runtime);
}

export function openReflection(snapshot) {
  const pending = snapshot?.season?.pendingReflection;
  if (!pending) return false;
  const dialog = $("#reflectionDialog");
  dialog.dataset.milestone = String(pending.milestone);
  $("#reflectionStage").textContent = `${pending.stageName} · 第 ${pending.milestone} 次判断`;
  $("#reflectionPrompt").textContent = pending.prompt;
  $("#reflectionText").value = "";
  $("#reflectionCount").textContent = "0 / 180";
  $("#reflectionError").hidden = true;
  if (!dialog.open) dialog.showModal();
  setTimeout(() => $("#reflectionText").focus(), 0);
  return true;
}

export function openReveal(snapshot) {
  const season = snapshot?.season;
  if (!season?.revealed || !season.species) return false;
  const dialog = $("#revealDialog");
  setSprite($("#revealArt"), season.species);
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

export function bindCompanionUi({ api, showToast, onBirth, onReflection, onReset, onResults }) {
  $$('input[name="genome"]').forEach((input) => input.addEventListener("change", () => {
    $$("[data-genome-card]").forEach((card) => {
      const selected = card.dataset.genomeCard === input.value;
      card.classList.toggle("is-selected", selected);
      card.querySelector("em").textContent = selected ? "已选择" : "选择";
    });
  }));

  $("#enterArena").addEventListener("click", async () => {
    const button = $("#enterArena");
    button.disabled = true;
    try {
      const genome = $('input[name="genome"]:checked')?.value || "light";
      const payload = await api("/api/companion/birth", { method: "POST", body: JSON.stringify({ genome }) });
      onBirth(payload.companion);
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
    const dialog = $("#reflectionDialog");
    const button = $("#submitReflection");
    button.disabled = true;
    $("#skipReflection").disabled = true;
    $("#reflectionError").hidden = true;
    try {
      const payload = await api("/api/companion/reflections", {
        method: "POST",
        body: JSON.stringify({ milestone: Number(dialog.dataset.milestone), text })
      });
      dialog.close();
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
    if (!window.confirm("重置当前本地体验？投票、成长和出生基因都会清空，题库不会改变。")) return;
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
