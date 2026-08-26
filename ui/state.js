export function freshUploadState() {
  return {
    step: 1,
    file: null,
    buffer: null,
    sheets: [],
    selectedSheet: null,
    headers: [],
    rows: [],
    mapping: {},
    confidence: {},
    preflight: null,
    draftId: null
  };
}

export const state = {
  session: null,
  battle: null,
  battleStartedAt: 0,
  contextOpened: false,
  voteId: null,
  selectedReasons: [],
  editingVote: false,
  timeline: [],
  timelineIndex: -1,
  timelineAtEnd: false,
  reviewOpen: false,
  contentsOpen: false,
  activeVersionId: null,
  activeView: "battle",
  coverReturnView: "battle",
  upload: freshUploadState(),
  pendingConfirm: null
};
