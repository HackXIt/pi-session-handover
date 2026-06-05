# Handover UX Roadmap

## Context

This plan captures the outcome of the handover tool UX grill session. The extension currently provides a basic `/handover <description>` flow and `handover_complete` tool that can start a fresh pi session with a generated prompt.

The desired product direction is a configurable, low-friction handover system for plan-driven agentic development: agents finish one slice or phase, close their current turn according to project rules, generate a self-contained prompt, and continue work in a fresh session.

## Goals

- Make `/handover` pleasant for daily human-driven use with minimal UI interruption.
- Make closure proof structured enough to trust and review.
- Support project-specific handover rules without requiring repetitive user prompts.
- Support future automatic handover chains for multi-slice plans.
- Preserve recoverability if pi exits or reloads during handover.

## Non-goals for the next slice

- Full automatic handover chaining.
- Programmatic trigger conditions such as token usage.
- Full orchestrator/Hermes handover schema.
- A rich wizard/form for every human handover run.

## UX decisions

### Command shape

Use a single command family:

- `/handover <description>` — start normal handover.
- `/handover auto` — enable automatic handover for this session/chain.
- `/handover status` — show pending/armed handover state and allow recovery.
- `/handover cancel` — cancel pending or armed handover state.

Internal continuation commands should not be emphasized in user docs.

### Default flow

The initial default remains minimal:

```text
/handover <what to continue>
```

The command injects instructions into the current agent. The agent should:

1. Close the current turn according to configured project rules.
2. Generate a self-contained prompt for the next agent session.
3. Call `handover_complete` with the prompt and structured closure checklist.

### Configuration layering

Settings are merged from lowest to highest precedence:

1. Built-in defaults.
2. Global user extension settings.
3. Project `.pi` configuration and rules.
4. Session metadata overrides.

Avoid creating many conflicting settings. Prefer a small set of coarse-grained modes and clear project-specific instruction injection.

### Review behavior

Prompt review is configurable, but review must be an actual extension UI surface before the new session starts, not just text in the assistant response.

The preferred review surface is a modal/editor UI that shows:

- Editable next-session prompt.
- Closure checklist.
- Turn summary.
- Evidence/notes for each closure step.
- Clear accept/cancel behavior.

Blocked closure steps force review even when the configured default would otherwise auto-continue.

### Closure proof

`handover_complete` should accept structured checklist items instead of plain strings.

Each closure item should include:

- `id` or `name`.
- `status`: `done`, `blocked`, or `skipped`.
- `notes`.
- Optional `evidence`, such as commands run, commit refs, changelist ids, pushed branches, or validation output.

Blocked steps are allowed only when explained. A blocked step should not silently prevent all handover, but it should force user review.

### Project customization

Project-level `.pi` configuration should be able to adjust:

- Handover mode.
- Completion steps.
- Agent closure instructions.
- Next-prompt instructions.
- Whether review is required by default.
- Required or optional context fields for wizard mode.

Long-form project rules can live in `.pi/handover.md` and be appended to the handover instruction.

### Wizard mode

Wizard mode exists for configured `promptContextFields`. Current behavior prompts for every configured field. Fields are required by default, but individual fields can be optional with `required: false` or prefilled/fallbacked with a non-empty `default`.

A richer form is mainly for orchestrators such as Hermes, not for a human manually deciding to hand over a session.

### Automatic handover mode

Automatic mode is implemented as bounded carry-forward metadata, not as an independent trigger system.

Current behavior:

- Can be enabled for a session/plan via `/handover auto [maxDepth]`.
- Persists into subsequent sessions via session metadata copied during handover.
- Still relies on the agent completing closure work and calling `handover_complete`.
- Tracks chain depth in extension-managed state.
- Displays subtle status such as `handover auto 3/15`.

Primary guardrail:

- Maximum chain depth.

Deferred guardrails/conditions:

- Project-default auto mode.
- Token usage triggers.
- File/event triggers.
- Machine-verifiable conditions.

### State and recovery

Pending handover state should be persisted into pi session metadata so it survives reloads or exits between `handover_complete` and session creation.

`/handover status` should allow the user to:

- Inspect pending prompt/checklist.
- Resume pending handover.
- Cancel pending handover.
- See auto-chain state when armed.

### New session context

The new session should receive the generated next-session prompt as the first visible user message.

Additional handover data should be stored as extension metadata, not necessarily visible text:

- Parent session file.
- Chain id.
- Chain depth and max depth.
- Closure checklist.
- Turn summary.

The generated prompt must still be self-contained and should not rely on hidden metadata being visible to the new agent.

## Recommended next implementation slice

Implement the first usability upgrade:

> Structured checklist schema + modal review UI + blocked-step handling + persisted pending recovery.

### UX grill follow-up decisions

Resolved before implementation:

- Review UI should be a custom TUI modal/overlay now, not only a plain editor review surface.
- `/handover status` should show pending state and offer Resume, Cancel, and Dismiss; Resume should reuse the existing continuation flow.
- Blocked checklist items without notes should be rejected. Blocked steps are allowed only when explained.

### Acceptance criteria status

Implemented in commit `a2babdd` (`Implement structured handover recovery`):

- [x] `handover_complete` accepts structured closure checklist items with status, notes, and optional evidence.
- [x] Existing plain-string `completedSteps` sessions are accepted as a compatibility path and normalized as `done` items.
- [x] Any blocked checklist item forces prompt review before a new session starts.
- [x] Blocked checklist items without notes are rejected.
- [x] Review UI is a custom overlay showing next prompt preview, summary, checklist statuses, notes, and evidence.
- [x] Review flow allows accept/cancel and opens an editable prompt editor when the user chooses edit.
- [x] Pending handover data is persisted in session entries before switching sessions.
- [x] Pending handover data is rehydrated from session entries on `session_start`.
- [x] `/handover status` can show and resume/cancel a pending handover after reload.
- [x] `/handover cancel` cancels pending handover state.
- [x] Tests cover prompt construction, checklist validation/normalization, blocked-step review policy, and pending-state persistence helpers.
- [x] Verification passed: `npm test`, `npm run typecheck`, and `npm run ci`.

### Known gaps / follow-up refinements

These are intentionally left for a follow-up slice rather than expanding the first slice:

- The review UI was tightened in a follow-up slice: the custom overlay now embeds an editable next-session prompt editor directly beneath summary and checklist details, instead of launching a separate editor step.
- Replacement-session handover metadata was added in follow-up commit: the new session now stores parent session, turn summary, closure checklist, creation time, and receipt time as extension metadata before the first visible user prompt is sent.
- The existing config merge tests remain in place; no new config-layering work was added because global/session settings layering is a later slice.

### Suggested implementation steps status

1. [x] Add domain types for handover checklist, pending handover, and review policy.
2. [x] Update `handover_complete` schema to use structured checklist items.
3. [x] Add compatibility normalization for old `completedSteps: string[]` shape.
4. [x] Persist pending handover state with `pi.appendEntry` before queuing continuation.
5. [x] Rehydrate pending state on `session_start` from the current branch/session entries.
6. [x] Implement `/handover status` and `/handover cancel` for pending state.
7. [x] Replace simple editor review with a custom review overlay that includes checklist and summary.
8. [x] Force review when any step is `blocked`.
9. [x] Add tests for schema normalization, review-policy decisions, and pending-state helpers.
10. [x] Run `npm test`, `npm run typecheck`, and `npm run ci`.

## Current implementation position

The first usability upgrade and all planned follow-up slices are complete and pushed:

- Replacement-session metadata persistence: `handover-continue` appends `pi-agent-handoff:metadata` in the replacement session setup before sending the visible next prompt.
- Integrated review editing: the handover review overlay now embeds the editable next-session prompt directly in the review modal.
- Settings layering: configuration now resolves in built-in → global user file → project file/markdown → session metadata order. Global config lives at `${getAgentDir()}/extensions/pi-agent-handoff.json`; session overrides are metadata-only for orchestrator/task-specific command support, not a generic user-facing config mutation command.
- Wizard/context fields: config can define `promptContextFields`; `/handover` collects those required fields before constructing the agent handover request and includes them in a dedicated context section.
- Automatic handover mode: `/handover auto [maxDepth]` arms a bounded chain, persists chain id/depth/max depth, carries armed state into replacement sessions, shows footer status, and includes chain budget instructions in the agent handover request.

Remaining work is product hardening rather than the original roadmap slices.

## Later slices

### Settings layering

Implemented:

- [x] Add global settings support via `${getAgentDir()}/extensions/pi-agent-handoff.json`.
- [x] Reuse the existing project config schema for global, project, and session metadata overrides.
- [x] Implement built-in → global → project → session precedence.
- [x] Keep session overrides metadata-only; user-facing slash commands should perform task-specific actions instead of arbitrary config mutation.

Documentation:

- [x] Document minimal recommended config and precedence in README.

### Wizard mode

Implemented:

- [x] Add configurable `promptContextFields` for handover context.
- [x] Collect configured fields only when present, keeping wizard behavior out of the default path.
- [x] Support required fields by default, optional fields with `required: false`, and non-empty `default` values used as prefill/fallback.
- [x] Include collected fields in the agent handover request under `## Handover context`.
- [x] Document field configuration in README.

Deferred:

- [ ] Rich multi-field form UI; current implementation uses existing input/editor dialogs per field.

### Auto mode

Implemented:

- [x] Implement `/handover auto [maxDepth]`.
- [x] Infer max depth from configured plan/task context when possible; otherwise ask.
- [x] Persist chain id/depth/max depth into session metadata.
- [x] Carry armed auto state into replacement sessions and increment depth until max depth.
- [x] Add subtle footer status (`handover auto depth/maxDepth`).
- [x] Include remaining chain budget in agent instructions.

Deferred:

- [ ] Add a richer agent-operated handover condition checkbox/tool beyond the existing `handover_complete` flow.

### Orchestrator support

- Define a structured handover request schema for systems like Hermes.
- Allow orchestrators to supply continuation target, closure profile, review policy, and auto-chain parameters without human wizard prompts.

## Open questions deferred

- Exact global settings storage location/API.
- Exact UI component implementation for modal prompt + checklist review.
- Whether project config should include executable verification commands or only instructions.
- How to infer max chain depth from plan files.
- Which programmatic auto conditions are worth supporting first.
