# Code Review Remediation Plan

Status: Complete. The prioritized remediation work below has been implemented and verified in the current codebase. This file is retained as historical context for the review findings and their acceptance criteria.

## Context

A repository review was performed for `pi-session-handover`, focusing on architecture, modularization, readability, slash-command usability, pending recovery behavior, wizard/context fields, auto-mode behavior, tests, README alignment, and future developer experience.

Verification during review:

- `npm test` passed: 19 tests.
- `npm run typecheck` passed.

Overall assessment at the time: the extension was small and coherent, with a useful separation between config, domain helpers, and prompt construction. The main risk was that `src/index.ts` coordinated too many concerns and hid edge-case bugs around session-scoped pending state, cancellation recovery, and command parsing.

## Goals

- Keep the current feature set intact.
- Fix correctness issues that can surprise users or lose recoverability.
- Reduce future feature friction by separating command/tool/UI/session concerns.
- Align docs with actual behavior.
- Add tests around the highest-risk extension flows.

## Non-goals

- Do not redesign the handover product.
- Do not add new auto-trigger mechanisms.
- Do not build a rich multi-field wizard unless explicitly planned later.
- Do not rewrite unrelated code or change public behavior beyond bug fixes and clarified UX.

## Findings

### What is working well

- `src/config.ts` handles config loading and merge precedence.
- `src/domain.ts` contains pure domain/state helpers for checklist normalization, pending recovery, auto-state lookup, and metadata construction.
- `src/prompt.ts` isolates agent-facing prompt construction.
- Config precedence is implemented and tested: built-in defaults → global config → project config/markdown → session override.
- Checklist normalization and review policy are understandable and covered by tests.
- Pending handover entries are persisted before continuation, allowing reload recovery in the common path.
- README is concise and generally useful for install, config, usage, and verification.

### Top risks / design smells

1. `src/index.ts` carries too much behavior.
   - It currently includes tool schema, command parsing, auto-depth inference, wizard field collection, review modal rendering, pending cache handling, session switching, and tool execution.
   - This makes future features such as richer auto mode, optional wizard fields, and review UI improvements harder to place and test.

2. Pending state is cached in-memory without session scoping.
   - `pending` is an extension-level `Map` in `src/index.ts`.
   - `rememberFromEntries` adds pending entries from the current session but never clears stale values.
   - `getPending` can fall back to stale in-memory pending state if the current session has no pending entry.
   - This can make `/handover status` or `/handover-continue <id>` act on a handover from another session.

3. New-session cancellation resolves pending handover too early.
   - `/handover-continue` deletes pending state and appends a resolved entry before calling `ctx.newSession`.
   - If new session creation is cancelled, the user is notified but the pending handover is no longer recoverable via `/handover status`.

4. Slash-command parsing is fragile.
   - `subcommand.startsWith("auto")` means `/handover automatic cleanup` arms auto mode instead of starting a normal handover description.

5. Docs overstate wizard/context-field behavior. (Remediated.)
   - README said configured prompt context asks only for missing required context fields.
   - Implementation now prompts for every configured field, keeps fields required by default, and supports `required: false` plus non-empty `default` values.

## Prioritized remediation tasks

All P0–P3 tasks in this plan are complete unless explicitly noted otherwise.

### P0 — Fix correctness and recovery issues now

#### 1. Scope pending state to the current session — complete

Problem:

- In-memory pending state can leak across sessions.

Acceptance criteria:

- `/handover status` only reports pending handovers present in the current session entries.
- `/handover-continue <id>` only resumes a handover belonging to the current session.
- Switching/reloading into a session with no pending handover does not expose stale pending state.
- Regression tests cover stale pending state across mocked sessions.

Implementation notes:

- Prefer deriving pending state from `ctx.sessionManager.getEntries()` on demand.
- If retaining a cache, key it by current session file and clear/rebuild on `session_start`.
- Avoid `Array.from(pending.values()).at(-1)` fallback unless the cache is proven session-scoped.

#### 2. Preserve pending recovery when new-session creation is cancelled — complete

Problem:

- `/handover-continue` marks pending resolved before `ctx.newSession` succeeds.

Acceptance criteria:

- If review is accepted but `ctx.newSession` returns `cancelled`, `/handover status` can still resume or cancel the pending handover.
- A resolved entry is appended only after successful continuation, or cancellation explicitly restores pending state.
- Regression test covers `ctx.newSession({ ... })` returning `{ cancelled: true }`.

Implementation notes:

- Move `HANDOVER_RESOLVED_ENTRY` append until after successful session creation.
- If Pi requires pre-resolution to avoid duplicate recovery, add a compensating pending/reopened entry on cancellation and test it.

#### 3. Parse slash subcommands by exact first token — complete

Problem:

- Descriptions beginning with `auto` are misclassified.

Acceptance criteria:

- `/handover auto` and `/handover auto 5` arm auto mode.
- `/handover automatic cleanup` starts a normal handover with description `automatic cleanup`.
- `/handover status` and `/handover cancel` still work.
- Invalid auto depth gives clear feedback.

Implementation notes:

- Parse `const [command, ...rest] = args.trim().split(/\s+/)`.
- Match `command === "auto"`, `command === "status"`, `command === "cancel"`.
- Treat all other input as the original handover description.

#### 4. Clear stale auto footer status — complete

Problem:

- `session_start` sets the footer when auto state exists but does not explicitly clear it when absent.

Acceptance criteria:

- Entering a session without armed auto state clears `pi-agent-handoff` status.
- Cancelling auto state clears status.
- Regression test or mocked UI assertion covers status clearing.

### P1 — Add tests around extension flows — complete

#### 5. Add mocked ExtensionAPI command/tool tests for `src/index.ts` — complete

Problem:

- Current tests cover helpers only. The riskiest behavior is in command/tool/session orchestration.

Acceptance criteria:

- Tests exercise:
  - `/handover <description>` sends the expected agent request.
  - `/handover automatic cleanup` is treated as a description.
  - `/handover auto [maxDepth]` arms auto state and appends metadata.
  - `/handover status` resumes/cancels current-session pending state only.
  - `/handover cancel` cancels pending and auto state.
  - `handover_complete` persists pending state and queues continuation.
  - `/handover-continue <id>` review, new session setup, metadata copy, auto carry-forward, and cancellation recovery.

Implementation notes:

- Build a lightweight fake `ExtensionAPI` that captures registered commands/tools, appended entries, sent user messages, UI calls, and `ctx.newSession` behavior.
- Keep tests behavior-focused rather than duplicating implementation internals.

### P2 — Modularize `src/index.ts` — complete

#### 6. Split `src/index.ts` into smaller modules — complete

Problem:

- `index.ts` is difficult to reason about and will slow future feature work.

Suggested module split:

- `src/index.ts`
  - extension factory and registration only.
- `src/commands.ts`
  - `/handover`, `/handover status`, `/handover cancel`, `/handover auto`, `/handover-continue` handlers.
- `src/handover-tool.ts`
  - `handover_complete` schema and tool handler.
- `src/review-ui.ts`
  - review modal rendering and editor integration.
- `src/auto.ts`
  - auto-depth parsing, source inference, auto summaries.
- `src/pending-store.ts`
  - session-scoped pending lookup, resolve/cancel helpers, recovery decisions.

Acceptance criteria:

- `src/index.ts` contains minimal wiring.
- Pure or semi-pure modules are independently testable.
- No behavior changes except those covered by P0 fixes.
- Existing tests still pass, and new flow tests continue to pass.

### P3 — Improve usability and documentation — complete

#### 7. Clarify review modal controls — complete

Problem:

- Review modal shows prompt/checklist but does not visibly explain accept/cancel controls.

Acceptance criteria:

- Review UI includes a small help line describing how to accept and cancel using actual Pi editor keybindings.
- Checklist and evidence remain visible above the editable prompt.

#### 8. Align README with actual wizard/context-field behavior — implemented

Problem:

- README said only missing required fields are asked, while implementation asked every configured field.

Acceptance criteria:

- README documents current behavior: every configured `promptContextFields` item is prompted, fields are required by default, `required: false` allows blanks, and non-empty `default` values prefill/fallback blank input.

#### 9. Clarify auto mode behavior — complete

Problem:

- `/handover auto` sounds fully autonomous, but currently it arms carry-forward metadata and instructs the agent to continue handover chaining when appropriate.

Acceptance criteria:

- README explains that auto mode is bounded carry-forward, not an independent trigger system.
- The docs mention max depth and that the agent still uses `handover_complete`.

#### 10. De-emphasize `/handover-continue` — complete

Problem:

- README lists `/handover-continue <id>` alongside user-facing commands, while roadmap says internal continuation commands should not be emphasized.

Acceptance criteria:

- Move `/handover-continue` to an internal/debug note, or remove it from the main command list.

#### 11. Clean up roadmap wording — complete

Problem:

- Roadmap contains some stale/conflicting wording around config precedence and implemented status.

Acceptance criteria:

- Roadmap distinguishes merge order from precedence, or removes outdated sections now that implementation slices are complete.

## Deferred ideas

These are not needed for the immediate remediation pass:

- Field defaults or prefilled values from session metadata.
- Rich multi-field wizard UI.
- Richer review UI actions beyond the current embedded editor.
- Programmatic auto triggers based on token usage, file events, or plan status.
- Executable verification commands in config.

## Suggested implementation order

1. Add focused failing tests for pending leakage and cancellation recovery.
2. Fix pending lookup/session scoping.
3. Fix cancellation recovery.
4. Add/fix tests for exact subcommand parsing and auto status clearing.
5. Refactor `src/index.ts` into smaller modules once behavior is locked by tests.
6. Update README and roadmap.
7. Run `npm test`, `npm run typecheck`, and `npm run ci`.

## Success criteria

- No stale pending handover can be resumed from the wrong session.
- Cancelling new-session creation leaves the handover recoverable.
- Descriptions beginning with `auto` work normally unless the first token is exactly `auto`.
- Auto footer status accurately reflects the current session.
- `src/index.ts` is reduced to extension wiring and no longer carries UI, parsing, session, and tool behavior together.
- README accurately describes current UX and configuration behavior, including optional/default prompt context fields.
- Flow-level tests cover the main command/tool lifecycle.
