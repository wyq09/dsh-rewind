// Model-facing text lives here so behavior can be tuned without touching the
// checkpoint engine. Keep the tool contract factual: the engine, not the model,
// owns safety checkpoints and restore semantics.

export const REWIND_TOOL_DESCRIPTION = [
  'Inspect and restore Git-backed checkpoints for the current DSH workspace.',
  'The plugin automatically records the workspace before the first agent turn and after every turn that changes files.',
  'Actions: list shows checkpoint ids; preview shows what restoring one would change; restore changes workspace files after creating a safety checkpoint; undo reverses the last restore; redo reapplies it; checkpoint records the current workspace now.',
  'Use preview before restore unless the user explicitly asks for an immediate restore.',
].join(' ')
