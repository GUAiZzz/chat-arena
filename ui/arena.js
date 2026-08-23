export function applyVoteSelection(winner, disabled) {
  document.querySelectorAll(".vote-button").forEach((button) => {
    button.disabled = disabled;
    button.classList.toggle("is-selected", button.dataset.vote === winner);
  });
  document.querySelectorAll(".response-card").forEach((card) => {
    const selected = ["A", "B"].includes(winner) && card.dataset.response === winner;
    card.classList.toggle("is-selected", selected);
    card.classList.toggle("is-muted", ["A", "B"].includes(winner) && !selected);
  });
}

export function referenceCopy(reference) {
  if (reference === "A") return "原始人工倾向：A。它只在你投票后出现。";
  if (reference === "B") return "原始人工倾向：B。它只在你投票后出现。";
  if (reference === "tie") return "原始人工倾向：平局。它只在你投票后出现。";
  return "原始数据没有提供人工倾向。";
}

export function renderReasonTagButtons(root, reasonTags, selectedReasons, onToggle) {
  root.replaceChildren();
  reasonTags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.classList.toggle("is-active", selectedReasons.includes(tag));
    button.setAttribute("aria-pressed", String(selectedReasons.includes(tag)));
    button.addEventListener("click", () => onToggle(tag));
    root.append(button);
  });
}
