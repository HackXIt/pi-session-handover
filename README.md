# pi-agent-handoff

Pi package that adds `/handover` for plan-driven agent handoffs.

`/handover` asks the current agent to close its turn, write a self-contained prompt for the next agent, then calls `handover_complete`. The extension creates a fresh pi session and sends that prompt as the first user message.

## Install

```bash
pi install git:github.com/HackXIt/pi-agent-handoff
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
2. Global user config at `~/.pi/agent/extensions/pi-agent-handoff.json`.
3. Project config in `.pi/handover.json` plus `.pi/handover.md`.
4. Session metadata overrides used by task-specific commands and orchestrators.

Create `.pi/handover.json` to configure project behavior:

```json
{
  "taskInputPrompt": "What should the next agent continue?",
  "taskInputMultiline": false,
  "taskInputRequired": true,
  "reviewPromptBeforeStart": true,
  "agentInstructions": "Close this turn according to the project rules before handing over.",
  "nextPromptInstructions": "Write a self-contained prompt with context, files, verification, risks, and exact next steps.",
  "promptContextFields": [
    { "name": "plan", "label": "Plan file", "prompt": "Which plan or issue should the next agent follow?" },
    { "name": "risk", "label": "Known risk", "prompt": "What risk should the next agent keep in mind?", "multiline": true }
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

`promptContextFields` is optional. When configured, `/handover` asks only for those missing required context fields before it sends the handover instruction to the current agent.

Use the same JSON shape for global user config when you want defaults across projects. Keep global config minimal, for example:

```json
{
  "reviewPromptBeforeStart": true,
  "nextPromptInstructions": "Write a self-contained prompt with context, changed files, verification status, risks, and exact next steps."
}
```

## Commands and tools

- `/handover <description>` — ask the current agent to close and prepare a new-session prompt.
- `/handover status` — inspect pending handover state and resume/cancel after reload.
- `/handover cancel` — cancel pending handover state.
- `/handover-continue <id>` — internal command queued by the tool.
- `handover_complete` — tool the current agent calls with the final `nextPrompt`, summary, and closure checklist.

## Verify

```bash
npm test
npm run typecheck
```
