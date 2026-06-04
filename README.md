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

## Project configuration

Create `.pi/handover.json` to configure behavior:

```json
{
  "taskInputPrompt": "What should the next agent continue?",
  "taskInputMultiline": false,
  "taskInputRequired": true,
  "reviewPromptBeforeStart": true,
  "agentInstructions": "Close this turn according to the project rules before handing over.",
  "nextPromptInstructions": "Write a self-contained prompt with context, files, verification, risks, and exact next steps.",
  "completionSteps": [
    { "name": "Build", "description": "Run a successful build or test suite." },
    { "name": "Commit", "description": "Create the configured commit or changelist." },
    { "name": "Publish", "description": "Push or submit according to project rules." },
    { "name": "Summary", "description": "Summarize completion and remaining work." }
  ]
}
```

Create `.pi/handover.md` for longer project-specific rules. Its contents are appended to the handover instruction sent to the current agent.

## Commands and tools

- `/handover <description>` — ask the current agent to close and prepare a new-session prompt.
- `/handover-continue <id>` — internal command queued by the tool.
- `handover_complete` — tool the current agent calls with the final `nextPrompt`.

## Verify

```bash
npm test
npm run typecheck
```
