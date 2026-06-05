import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHandoverCommands } from "./commands.js";
import { registerHandoverTool } from "./handover-tool.js";
import { HandoverRuntimeState } from "./pending-store.js";
import { pendingSummary } from "./review-ui.js";

function makeId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function (pi: ExtensionAPI) {
	const state = new HandoverRuntimeState();

	pi.on("session_start", async (_event, ctx) => {
		const item = state.rememberFromEntries(ctx);
		const auto = state.getAuto(ctx);
		if (item) ctx.ui.notify(`${pendingSummary(item)} Run /handover status to resume or cancel.`, "warning");
		ctx.ui.setStatus("pi-agent-handoff", auto ? `handover auto ${auto.depth}/${auto.maxDepth}` : undefined);
	});

	registerHandoverCommands(pi, state, makeId);
	registerHandoverTool(pi, state, makeId);
}
