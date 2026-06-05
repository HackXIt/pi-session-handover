import { ExtensionEditorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PendingHandover } from "./domain.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

function truncate(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function checklistLine(item: PendingHandover["checklist"][number]): string {
	const status = item.status === "done" ? "✓" : item.status === "blocked" ? "!" : "-";
	const evidence = item.evidence === undefined ? "" : ` evidence=${JSON.stringify(item.evidence)}`;
	return `${status} ${item.name}${item.notes ? ` — ${item.notes}` : ""}${evidence}`;
}

export function pendingSummary(item: PendingHandover): string {
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	return `Pending handover ${item.id}: ${item.checklist.length} checklist item(s), ${blocked} blocked.`;
}

export async function reviewPendingHandover(ctx: CommandContext, item: PendingHandover): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const editor = new ExtensionEditorComponent(
			tui,
			keybindings,
			"Edit next-session prompt",
			item.nextPrompt,
			(value) => done(value),
			() => done(undefined),
		);
		return {
			get focused() {
				return editor.focused;
			},
			set focused(value: boolean) {
				editor.focused = value;
			},
			render(width: number) {
				const bodyWidth = Math.max(20, width - 4);
				const header = [
					theme.fg("accent", theme.bold("Handover review")),
					pendingSummary(item),
					"Accept by submitting the editor; cancel with the editor cancel keybinding.",
					"",
					theme.fg("accent", "Summary"),
					...(item.summary ? item.summary.split("\n") : ["(none)"]),
					"",
					theme.fg("accent", "Checklist"),
					...(item.checklist.length > 0 ? item.checklist.map(checklistLine) : ["(none supplied)"]),
					"",
					theme.fg("accent", "Next-session prompt"),
				];
				return [...header.map((line) => truncate(line, bodyWidth)), ...editor.render(width)];
			},
			handleInput(data: string) {
				editor.handleInput(data);
				tui.requestRender();
			},
			invalidate() {
				editor.invalidate();
			},
		};
	}, { overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", minWidth: 60 } });
}
