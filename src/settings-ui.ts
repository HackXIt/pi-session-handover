import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

function truncate(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

export async function openHandoverSettingsShell(ctx: CommandContext): Promise<void> {
	if (typeof ctx.ui.custom !== "function") {
		ctx.ui.notify("Settings UI is unavailable in this context. Run /handover settings from an interactive pi session.", "error");
		return;
	}

	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => ({
		focused: true,
		render(width: number) {
			const bodyWidth = Math.max(20, width - 4);
			return [
				theme.fg("accent", theme.bold("Handover settings")),
				"Settings editor shell is ready.",
				"Global and Project tab editing will be added in the next slice.",
				"Press Escape to close.",
			].map((line) => truncate(line, bodyWidth));
		},
		handleInput(data: string) {
			if (data === "\u001b") {
				done();
				return;
			}
			tui.requestRender();
		},
		invalidate() {},
	}), { overlay: true, overlayOptions: { width: "70%", maxHeight: "60%", minWidth: 50 } });
}
