// One explicit state object is shared by controllers and views. Increment generation to ignore late responses after selection changes.
export const state = {
  collecting: false,
  packageBusy: false,
  current: null,
  generation: 0,
  proposal: null,
  draftSource: "사용자 입력",
  draftAssumptions: [],
  displayKey: null,
  llmEnabled: false,
};
