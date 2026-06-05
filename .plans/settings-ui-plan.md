# Settings UI plan

## Goal

Add a first-class `/handover settings` UI for editing `pi-session-handover` configuration inside pi-coding-agent.

The UI should make extension settings discoverable, editable, and immediately persisted without requiring users to hand-edit JSON or remember config paths.

## Decisions from grill session

- Entrypoint: `/handover settings`.
- Scope: all current config fields, not a reduced subset.
- Config targets: two tabs, `Global` and `Project`.
  - Global writes `~/.pi/agent/extensions/pi-session-handover.json`.
  - Project writes `.pi/handover.json` and `.pi/handover.md`.
- No separate merged-preview tab.
- Show informational override badges instead:
  - Global tab shows when a value is overridden by project or session config.
  - Project tab shows when a value is overridden by session config.
- Save model: activate a setting, edit it, confirm the edit, and autosave immediately.
- Complex fields should get real form UI, not raw JSON-only editing.
- Research/reuse existing pi UI components before implementing.

## Existing UI/API research

Relevant existing components and examples:

- `@earendil-works/pi-coding-agent/docs/tui.md`
  - `ctx.ui.custom(...)` supports focused custom TUI overlays/components.
  - Built-in TUI components include `Container`, `Editor`, `Input`, `Markdown`, etc.
- `examples/extensions/tools.ts`
  - Shows the existing `SettingsList` component from `@earendil-works/pi-tui`.
  - Uses `getSettingsListTheme()` from `@earendil-works/pi-coding-agent`.
  - Persists changes immediately from the `SettingsList` change callback.
- `pi-grill-session/src/questionnaire-runtime.ts`
  - Demonstrates a richer tabbed custom UI with `Editor`, focus handling, keyboard navigation, and per-item editing.
- `docs/settings.md`
  - Pi settings use global/project precedence and nested object merging.

Conclusion: start from `SettingsList` for scalar fields and reuse the questionnaire-runtime style for tabbed navigation and structured array editors.

## Config fields to expose

### JSON config

- `taskInputPrompt` — string editor.
- `taskInputMultiline` — boolean toggle.
- `taskInputRequired` — boolean toggle.
- `reviewPromptBeforeStart` — boolean toggle.
- `autoReviewPromptBeforeStart` — boolean toggle.
- `agentInstructions` — multiline editor.
- `nextPromptInstructions` — multiline editor.
- `promptContextFields` — structured list editor.
- `completionSteps` — structured list editor.
- `projectRules` display note: represented by `.pi/handover.md`, not JSON.

### Markdown project rules

- Project tab includes `.pi/handover.md` as a multiline markdown/text editor.
- Global tab does not expose markdown rules unless a future global markdown path is added.

## Proposed implementation slices

### Slice 1 — Config IO model

Create pure helpers for loading/saving editable config targets.

Files likely involved:

- `src/config.ts`
- new `src/settings-ui/config-files.ts` or `src/settings-config.ts`
- tests under `test/`

Responsibilities:

- Read global editable JSON from `getGlobalHandoverConfigPath()`.
- Read project editable JSON from `.pi/handover.json`.
- Read project markdown rules from `.pi/handover.md`.
- Create parent directories on save.
- Preserve unknown JSON keys where feasible.
- Write stable, pretty JSON with trailing newline.
- Surface parse errors as UI-friendly validation errors.

Tests:

- Missing files produce empty editable config.
- Saving creates directories/files.
- Unknown keys survive scalar field updates.
- Invalid JSON returns a recoverable error and does not overwrite the file.

### Slice 2 — Settings schema/view model

Create a typed settings schema that maps config fields to UI items.

Responsibilities:

- Define scalar item descriptors: label, help text, type, current value, effective/overridden status.
- Define list descriptors for `promptContextFields` and `completionSteps`.
- Compute override badges without a merged-preview tab.
- Keep all logic testable without TUI.

Tests:

- Global item is marked overridden when project/session has a value.
- Project item is marked overridden when session has a value.
- Defaults are distinguished from explicitly configured values.
- List items render useful summaries.

### Slice 3 — `/handover settings` command shell

Extend command parsing so `/handover settings` opens the settings UI.

Responsibilities:

- Keep existing `/handover`, `/handover auto`, `/handover status`, and `/handover cancel` behavior unchanged.
- Add discoverable command description/help text.
- Use `ctx.ui.custom(...)` only when UI is available; otherwise show an actionable notification.

Tests:

- `/handover settings` dispatches to the settings UI.
- Existing subcommands still work.
- No-UI context gets a clean error.

### Slice 4 — Tabbed scalar editor

Build the first custom UI with two tabs: Global and Project.

Recommended approach:

- Use a small tab controller modeled after `pi-grill-session` questionnaire runtime.
- Use `SettingsList` for scalar boolean/string rows where it fits.
- For string/multiline rows, activation opens an `Editor` overlay or in-place editor.
- On editor submit, validate and save immediately.
- Notify on successful save and keep the displayed value in sync.

Keyboard expectations:

- Left/right or tab/shift-tab changes Global/Project tab.
- Up/down changes selected setting.
- Enter edits/toggles selected setting.
- Escape closes.

Tests:

- Use pure reducer tests for tab/focus/edit state.
- Use fake save callbacks to verify immediate persistence after confirm.

### Slice 5 — Structured list editors

Add form builders for arrays.

`completionSteps` editor:

- List of steps with add/edit/delete/reorder.
- Fields: `name`, `description`.
- Validate non-empty `name`.

`promptContextFields` editor:

- List of fields with add/edit/delete/reorder.
- Fields: `name`, `label`, `prompt`, `multiline`, `required`, `default`.
- Validate non-empty `name`.
- Prefer safe field-name characters, but do not over-restrict unless current config loading requires it.

Tests:

- Add/edit/delete/reorder produces expected JSON.
- Invalid item blocks save and shows a validation message.
- Existing valid arrays round-trip.

### Slice 6 — Project rules editor

Add a Project-tab row for `.pi/handover.md`.

Responsibilities:

- Opens multiline editor.
- Autosaves on submit.
- Supports clearing the file by saving an empty value, or explicitly deleting the file if that UX is clearer during implementation.

Tests:

- Saves markdown to `.pi/handover.md`.
- Empty rules behavior is explicit and tested.

## Non-goals for V1

- A third merged-preview tab.
- Editing session metadata overrides directly.
- Migrating all config into Pi core `.pi/settings.json`.
- A generic settings framework for other extensions.
- Publishing a reusable component package.

## Risks and mitigations

- `SettingsList` may only handle simple enumerated values.
  - Mitigation: use it for booleans/enums and custom `Editor` flows for strings/lists.
- Autosave can surprise users if activation is ambiguous.
  - Mitigation: only save after explicit edit confirmation, not on navigation.
- Config parse errors could trap users.
  - Mitigation: show parse errors and offer raw editor/recovery later if needed.
- Session overrides are not file-backed.
  - Mitigation: badges are informational only; do not try to edit session overrides in V1.

## Acceptance criteria

- `/handover settings` opens a TUI settings editor.
- Global and Project tabs are editable.
- All current config fields are represented.
- Confirmed edits are saved immediately to the correct file.
- Structured arrays are editable through forms, not raw JSON only.
- Override badges indicate when a setting is superseded by a higher-precedence source.
- Existing handover flows remain unchanged.
- Unit tests cover config IO, view-model override badges, list editing reducers, and command dispatch.
- `npm run ci` passes.
