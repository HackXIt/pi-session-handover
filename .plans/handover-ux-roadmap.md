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

### Configuration precedence

Resolve settings in this order:

1. Session overrides.
2. Project `.pi` configuration.
3. Global user extension settings.
4. Built-in defaults.

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
- Missing required fields for wizard mode.

Long-form project rules can live in `.pi/handover.md` and be appended to the handover instruction.

### Wizard mode

Wizard mode should exist, but only ask for missing required fields. It should not become the default human flow.

A richer form is mainly for orchestrators such as Hermes, not for a human manually deciding to hand over a session.

### Automatic handover mode

Automatic mode is a future feature.

Desired behavior:

- Can be enabled by project default.
- Can be enabled for a session/plan via `/handover auto`.
- Persists into subsequent sessions via session metadata copied during handover.
- Uses an agent-operated structured checkbox/condition.
- Tracks chain depth in extension-managed state.
- Displays subtle status such as `handover auto 3/15`.

Primary guardrail:

- Maximum chain depth.

Deferred guardrails/conditions:

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

- The custom review overlay shows prompt preview and launches `ctx.ui.editor()` for prompt edits; it is not yet a fully integrated multi-field modal editor.
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

The first usability upgrade is complete and pushed. The first follow-up slice, replacement-session metadata persistence, is also implemented: `handover-continue` appends `pi-agent-handoff:metadata` in the replacement session setup before sending the visible next prompt.

Remaining recommended follow-up slices:

1. Tighten the review UI into a fully integrated editable modal.
2. Implement settings layering.
3. Implement wizard mode.
4. Implement automatic handover mode.

## Later slices

### Settings layering

- Add global settings support.
- Define final project config schema.
- Implement session/project/global/built-in merge behavior.
- Document minimal recommended config.

### Wizard mode

- Implement missing-required-field collection.
- Reuse pi TUI interaction patterns similar to questionnaire-style flows.
- Keep wizard out of the default path unless configured.

### Auto mode

- Implement `/handover auto`.
- Persist chain id/depth/max depth into session metadata.
- Add subtle status footer/widget.
- Include remaining chain budget in agent instructions.
- Add tool/API for agent-operated handover condition checkbox.

### Orchestrator support

- Define a structured handover request schema for systems like Hermes.
- Allow orchestrators to supply continuation target, closure profile, review policy, and auto-chain parameters without human wizard prompts.

## Open questions deferred

- Exact global settings storage location/API.
- Exact UI component implementation for modal prompt + checklist review.
- Whether project config should include executable verification commands or only instructions.
- How to infer max chain depth from plan files.
- Which programmatic auto conditions are worth supporting first.
