# dsh-rewind

Checkpoint / rewind extension for the **DeepSeek Harness (DSH)** coding agent, adapted from [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind).

Git-based snapshots of the session workspace, one checkpoint per agent turn, with a unified diff preview, safe restore, and undo/redo stacks — plus a browser timeline panel and a `rewind` model tool.

> 中文说明见 [README.md](./README.md)。

## Features

- **Automatic checkpoints** — one snapshot after each agent turn that changes files (`agent/turn-stopping`), with a 60 s timer fallback.
- **Smart dedup** — read-only turns create no checkpoint (tree-hash comparison).
- **Descriptive labels** — `"<user prompt>" → write:file.ts, edit:other.ts`.
- **Diff preview before restore** — `git diff --stat` + unified patch, oriented as "what restoring would apply".
- **Safe restore** — creates a `before-restore` safety checkpoint first, then restores files without deleting pre-existing untracked files or skipped large items.
- **Undo / redo stacks** (multi-level).
- **Smart filtering** — 13 ignored dirs (`node_modules`, `dist`, `.venv`, …), files > 10 MiB, dirs with ≥ 200 new files.
- **Works anywhere** — a shadow git repo at `<workspace>/.dsh-rewind/` snapshots even non-git workspaces and never touches a real repo's refs/branches.
- **Per-session pruning** — 50 checkpoints max per session; safety checkpoints are exempt.
- **Refs survive restarts** — metadata is also recoverable from commit messages.
- **UI** — draggable floating pill + timeline panel (`shell.overlay`) and a run-card strip (`tool.view.cordis`).

## Install

`dsh-rewind` is a **dynamic Cordis plugin** — it is installed by loading `src/host.js` (Host half) and `src/client.js` (Client half) as one Package:

1. `cordis_define` — new Plugin (any 3–6 lowercase-letter `idPrefix`), paste the two file contents as `code.host` / `code.client`.
2. `cordis_run` — activate the returned `packageId`. Approve the Client half in the Run card.

Both files are plain-JavaScript **function bodies** (each `return`s a Cordis Plugin object). They use only the DSH Host/Client sandbox surface: `subprocess`, `fs`, `agents`, `timer`, `harness`, `slots`, `styles`, `React`, `host` — no Node/browser globals, no bundler.

> Dynamic plugins are process-local: re-install after a process restart.

## Usage

### Browser UI

- Bottom-right floating pill **`⏪ N`** (draggable) opens the timeline; the run-card strip opens it too.
- Click a checkpoint to preview its diff; buttons: **Checkpoint now**, **Undo**, **Redo**, **Restore selected** (two-click confirm).

### Model tool

The agent registers a `rewind` tool. Natural-language requests route to it:

| Action | Effect |
| --- | --- |
| `list` | show checkpoints |
| `preview <id>` | show the diff that restoring `<id>` would apply |
| `restore <id>` | restore files to `<id>` (safety checkpoint created first) |
| `undo` | undo the last restore |
| `redo` | redo it |
| `checkpoint` | snapshot now |

### Data location

`<workspace>/.dsh-rewind/` — a shadow git repo plus `meta.json`. Excluded from snapshots via `info/exclude`.

## Limitations

- Files-only restore; conversation state is not rewound (unsafe to truncate a live DSH session log from a plugin).
- `node_modules`/`dist`/`.venv` and other ignored dirs are never snapshotted.

## License

MIT — see [LICENSE](./LICENSE). Lineage: [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind) (MIT), [checkpoint-pi](https://github.com/prateekmedia/pi-hooks) and [pi-rewind-hook](https://github.com/nicobailon/pi-rewind-hook).
