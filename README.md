# pi-session-handover

Pi package that adds `/handover` for plan-driven agent handoffs.

`/handover` asks the current agent to close its turn, write a self-contained prompt for the next agent, then calls `handover_complete`. The extension creates a fresh pi session and sends that prompt as the first user message.

## Install

Install a pinned release from git:

```bash
pi install git:github.com/HackXIt/pi-session-handover@0.1.0
```

Or install from a configured npm package registry after a tagged release has been published:

```bash
pi install npm:@hackxit/pi-session-handover@0.1.0
```

Or test from a checkout:

```bash
npm install
npm exec -- pi --extension ./src/index.ts
```

## Usage

```text
/handover phase 2 of docs/PLAN.md
```

If no argument is supplied, the extension prompts for what the next agent should continue.

Open the interactive settings UI with:

```text
/handover settings
```

The settings UI has Global and Project tabs. Confirmed edits autosave immediately to the selected target.

## Configuration

You can edit configuration from inside Pi with `/handover settings`, or by editing the files below directly.

Configuration is resolved in this order:

1. Built-in defaults.
2. Global user config at `~/.pi/agent/extensions/pi-session-handover.json` (`session-handover.json` and `pi-agent-handoff.json` are still read as legacy fallbacks).
3. Project config in `.pi/handover.json` plus `.pi/handover.md`.
4. Session metadata overrides used by task-specific commands and orchestrators.

Create `.pi/handover.json` to configure project behavior:

```json
{
  "taskInputPrompt": "What should the next agent continue?",
  "taskInputMultiline": true,
  "taskInputRequired": true,
  "reviewPromptBeforeStart": true,
  "autoReviewPromptBeforeStart": false,
  "agentInstructions": "Close this turn according to the project rules before handing over.",
  "nextPromptInstructions": "Write a self-contained prompt with context, files, verification, risks, and exact next steps.",
  "promptContextFields": [
    { "name": "plan", "label": "Plan file", "prompt": "Which plan or issue should the next agent follow?" },
    { "name": "risk", "label": "Known risk", "prompt": "What risk should the next agent keep in mind?", "multiline": true, "required": false, "default": "none" }
  ],
  "completionSteps": [
    { "name": "Build", "description": "Run a successful build or test suite." },
    { "name": "Commit", "description": "Create the configured commit or changelist." },
    { "name": "Publish", "description": "Push or submit according to project rules." },
    { "name": "Summary", "description": "Summarize completion and remaining work." }
  ]
}
```

Create `.pi/handover.md` for longer project-specific rules. Its contents are appended to the handover instruction sent to the current agent. In `/handover settings`, this appears on the Project tab as “Project handover rules”; saving an empty editor value leaves an empty `.pi/handover.md` file.

`promptContextFields` is optional. When configured, `/handover` prompts for each field before it sends the handover instruction to the current agent. Fields are required by default; set `"required": false` to allow blanks. Set a non-empty `"default"` to prefill the input/editor and use that value when the field is left blank. The settings UI provides structured add/edit/delete/reorder forms for both `promptContextFields` and `completionSteps`.

`reviewPromptBeforeStart` controls manual handovers. It also forces review when a closure checklist item is blocked. `autoReviewPromptBeforeStart` controls automatic handover chains separately and defaults to `false`, so auto mode continues without showing the prompt-review modal unless the project explicitly opts in.

Project `nextPromptInstructions` should describe the substantive handover content the next agent needs. They do not need to repeat the `/handover auto` continuation wording; auto mode injects that guardrail automatically.

Use the same JSON shape for global user config when you want defaults across projects. Keep global config minimal, for example:

```json
{
  "reviewPromptBeforeStart": true,
  "nextPromptInstructions": "Write a self-contained prompt with context, changed files, verification status, risks, and exact next steps."
}
```

## Commands and tools

- `/handover <description>` — ask the current agent to close and prepare a new-session prompt.
- `/handover settings` — open the Global/Project settings editor for JSON settings and project markdown handover rules.
- `/handover auto [maxDepth]` — arm bounded automatic handover carry-forward for this session. This is not an independent trigger system: the current agent still completes work and calls `handover_complete`, and the extension carries auto metadata into replacement sessions until `maxDepth` is reached. While auto mode has remaining depth, the extension also appends a canonical `## Automatic handover continuation` block to each replacement prompt so the next agent is explicitly told to continue the chain with `handover_complete`. If the chain is already at max depth, the extension appends a stop note instead and does not carry auto metadata forward. If `maxDepth` is omitted, the extension tries to infer it from configured plan/task context, then asks.
- `/handover status` — inspect pending handover state and armed auto mode, then resume/cancel after reload.
- `/handover cancel` — cancel pending handover and armed auto state.
- `handover_complete` — tool the current agent calls with the final `nextPrompt`, summary, and closure checklist.

Internal/debug command: `/handover-continue <id>` is queued by `handover_complete` to start the replacement session and is mainly useful for recovery debugging.

## Development and verification

```bash
npm test
npm run typecheck
npm run package:check
npm run ci
```

`npm run ci` is the same validation used by CI: tests, TypeScript checking, and an npm package dry run.

## Release and deployment

This repository includes CI for both public GitHub releases and GitLab package publishing:

- test every branch and pull request;
- build an `npm pack` package;
- create GitHub Releases with package assets for tagged semantic versions;
- publish tagged semantic versions to a configured GitLab npm Package Registry when GitLab CI is enabled.

See [docs/release.md](docs/release.md) for versioning, deployment, and installation details.
