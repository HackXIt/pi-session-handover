# pi-session-handover

Pi package that adds `/handover` for plan-driven agent handoffs.

`/handover` asks the current agent to close its turn, write a self-contained prompt for the next agent, then calls `handover_complete`. The extension creates a fresh pi session and sends that prompt as the first user message.

## Install

Install a pinned release from git:

```bash
pi install git:github.com/HackXIt/pi-session-handover@v0.1.0
```

Or install from the homelab GitLab npm Package Registry after a tagged release has been published:

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

## Configuration

Configuration is resolved in this order:

1. Built-in defaults.
2. Global user config at `~/.pi/agent/extensions/pi-session-handover.json` (`session-handover.json` and `pi-agent-handoff.json` are still read as legacy fallbacks).
3. Project config in `.pi/handover.json` plus `.pi/handover.md`.
4. Session metadata overrides used by task-specific commands and orchestrators.

Create `.pi/handover.json` to configure project behavior:

```json
{
  "taskInputPrompt": "What should the next agent continue?",
  "taskInputMultiline": false,
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

Create `.pi/handover.md` for longer project-specific rules. Its contents are appended to the handover instruction sent to the current agent.

`promptContextFields` is optional. When configured, `/handover` prompts for each field before it sends the handover instruction to the current agent. Fields are required by default; set `"required": false` to allow blanks. Set a non-empty `"default"` to prefill the input/editor and use that value when the field is left blank.

`reviewPromptBeforeStart` controls manual handovers. It also forces review when a closure checklist item is blocked. `autoReviewPromptBeforeStart` controls automatic handover chains separately and defaults to `false`, so auto mode continues without showing the prompt-review modal unless the project explicitly opts in.

Use the same JSON shape for global user config when you want defaults across projects. Keep global config minimal, for example:

```json
{
  "reviewPromptBeforeStart": true,
  "nextPromptInstructions": "Write a self-contained prompt with context, changed files, verification status, risks, and exact next steps."
}
```

## Commands and tools

- `/handover <description>` — ask the current agent to close and prepare a new-session prompt.
- `/handover auto [maxDepth]` — arm bounded automatic handover carry-forward for this session. This is not an independent trigger system: the current agent still completes work and calls `handover_complete`, and the extension carries auto metadata into replacement sessions until `maxDepth` is reached. If `maxDepth` is omitted, the extension tries to infer it from configured plan/task context, then asks.
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

`npm run ci` is the same validation used by GitLab CI: tests, TypeScript checking, and an npm package dry run.

## Release and deployment

This repository includes GitLab CI for homelab automation:

- test every branch and tag;
- build an `npm pack` tarball artifact;
- publish tagged semantic versions to the GitLab npm Package Registry.

See [docs/release.md](docs/release.md) for versioning, deployment, and installation details.
