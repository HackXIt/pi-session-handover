import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { getSelectListTheme, keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, getKeybindings, type Component, type EditorTheme, type Focusable, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PendingHandover } from "./domain.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
type CustomFactory = Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0];
type CustomTheme = Parameters<CustomFactory>[1];

const MIN_REVIEW_WIDTH = 60;
const OUTER_PADDING_X = 1;
const OUTER_HORIZONTAL_INSET = 2 + OUTER_PADDING_X * 2;

function visibleLength(text: string): number {
	return stripVTControlCharacters(text).length;
}

function truncate(text: string, width: number): string {
	if (visibleLength(text) <= width) return text;
	return `${stripVTControlCharacters(text).slice(0, Math.max(0, width - 1))}…`;
}

function fitAnsi(text: string, width: number): string {
	const fitted = truncateToWidth(text, Math.max(0, width), "…", true);
	return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}

function wrapPlainLine(line: string, width: number): string[] {
	if (!line) return [""];
	const words = line.split(/(\s+)/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (!word) continue;
		if (visibleLength(current + word) <= width) {
			current += word;
			continue;
		}
		if (current.trim()) lines.push(current.trimEnd());
		current = word.trimStart();
		while (visibleLength(current) > width) {
			lines.push(current.slice(0, width));
			current = current.slice(width);
		}
	}
	if (current || lines.length === 0) lines.push(current.trimEnd());
	return lines;
}

function wrapPlainText(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => wrapPlainLine(line, width));
}

function checklistLine(item: PendingHandover["checklist"][number]): string {
	const status = item.status === "done" ? "✓" : item.status === "blocked" ? "!" : "-";
	return `${status} ${item.name}${item.notes ? ` — ${item.notes}` : ""}`;
}

function pluralStatus(count: number, label: string): string | undefined {
	return count > 0 ? `${count} ${label}` : undefined;
}

export function pendingSummary(item: PendingHandover): string {
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	return `Pending handover ${item.id}: ${item.checklist.length} checklist item(s), ${blocked} blocked.`;
}

export function buildReviewHeaderLines(item: PendingHandover, textWidth: number): string[] {
	const done = item.checklist.filter((step) => step.status === "done").length;
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	const skipped = item.checklist.length - done - blocked;
	const openItems = item.checklist.filter((step) => step.status !== "done");
	const checklistSummary =
		openItems.length === 0
			? `Checklist: all ${item.checklist.length} item(s) done.`
			: `Checklist: ${[pluralStatus(done, "done"), pluralStatus(blocked, "blocked"), pluralStatus(skipped, "skipped")]
					.filter((part): part is string => part !== undefined)
					.join(", ")}.`;
	return [
		pendingSummary(item),
		"",
		"Summary",
		...(item.summary ? wrapPlainText(item.summary, textWidth).slice(0, 4) : ["(none)"]),
		"",
		checklistSummary,
		...openItems.flatMap((entry) => wrapPlainText(checklistLine(entry), textWidth)).slice(0, 5),
		"",
		"Next-session prompt",
	];
}

function styleReviewLine(theme: CustomTheme, line: string): string {
	if (line === "Summary" || line === "Next-session prompt") return theme.fg("accent", line);
	if (line.startsWith("Checklist:")) return theme.fg("accent", line);
	return line;
}

function renderTitleLine(width: number, title: string, paintBorder: (text: string) => string, paintTitle: (text: string) => string): string {
	const innerWidth = Math.max(0, width - 2);
	const titleText = ` ${title} `;
	const fittedTitle = truncate(titleText, innerWidth);
	const titleWidth = visibleLength(fittedTitle);
	const right = Math.max(0, innerWidth - titleWidth);
	return `${paintBorder("╭")}${paintTitle(fittedTitle)}${paintBorder("─".repeat(right))}${paintBorder("╮")}`;
}

function renderBottomLine(width: number, help: string, paintBorder: (text: string) => string, paintHelp: (text: string) => string): string {
	const innerWidth = Math.max(0, width - 2);
	const helpText = ` ${help} `;
	const fittedHelp = truncate(helpText, Math.max(0, innerWidth - 1));
	const fill = Math.max(0, innerWidth - visibleLength(fittedHelp));
	return `${paintBorder("╰")}${paintHelp(fittedHelp)}${paintBorder("─".repeat(fill))}${paintBorder("╯")}`;
}

export function renderReviewFrameLines(
	width: number,
	contentLines: readonly string[],
	options: {
		title?: string;
		help?: string;
		paintBorder?: (text: string) => string;
		paintTitle?: (text: string) => string;
		paintHelp?: (text: string) => string;
	} = {},
): string[] {
	const frameWidth = Math.max(MIN_REVIEW_WIDTH, width);
	const contentWidth = Math.max(1, frameWidth - OUTER_HORIZONTAL_INSET);
	const paintBorder = options.paintBorder ?? ((text: string) => text);
	const paintTitle = options.paintTitle ?? ((text: string) => text);
	const paintHelp = options.paintHelp ?? ((text: string) => text);
	return [
		renderTitleLine(frameWidth, options.title ?? "Handover review", paintBorder, paintTitle),
		...contentLines.map((line) => `${paintBorder("│")}${" ".repeat(OUTER_PADDING_X)}${fitAnsi(line, contentWidth)}${" ".repeat(OUTER_PADDING_X)}${paintBorder("│")}`),
		renderBottomLine(frameWidth, options.help ?? "enter submit • shift+enter newline • escape/ctrl+c cancel", paintBorder, paintHelp),
	];
}

function createEditorTheme(theme: CustomTheme): EditorTheme {
	return {
		borderColor: (text: string) => theme.fg("borderAccent", text),
		selectList: getSelectListTheme(),
	};
}

async function openExternalEditor(tui: Parameters<CustomFactory>[0], editor: Editor): Promise<void> {
	const editorCmd = process.env.VISUAL || process.env.EDITOR;
	if (!editorCmd) return;

	const tmpFile = path.join(os.tmpdir(), `pi-handover-review-${Date.now()}.md`);
	try {
		fs.writeFileSync(tmpFile, editor.getText(), "utf-8");
		tui.stop();
		const [command, ...args] = editorCmd.split(" ");
		process.stdout.write(`Launching external editor: ${editorCmd}\nPi will resume when the editor exits.\n`);
		const status = await new Promise<number | null>((resolve) => {
			const child = spawn(command, [...args, tmpFile], {
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code));
		});
		if (status === 0) editor.setText(fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, ""));
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors.
		}
		tui.start();
		tui.requestRender(true);
	}
}

export async function reviewPendingHandover(ctx: CommandContext, item: PendingHandover): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const editor = new Editor(tui, createEditorTheme(theme), { paddingX: 1 });
		editor.setText(item.nextPrompt);
		editor.onSubmit = (value) => done(value);

		return {
			get focused() {
				return editor.focused;
			},
			set focused(value: boolean) {
				editor.focused = value;
			},
			render(width: number) {
				const frameWidth = Math.max(MIN_REVIEW_WIDTH, width);
				const contentWidth = Math.max(1, frameWidth - OUTER_HORIZONTAL_INSET);
				const header = buildReviewHeaderLines(item, contentWidth).map((line) => styleReviewLine(theme, truncate(line, contentWidth)));
				const editorLines = editor.render(contentWidth);
				const content = [...header, ...editorLines];
				const hasExternalEditor = !!(process.env.VISUAL || process.env.EDITOR);
				const help =
					keyHint("tui.select.confirm", "submit") +
					"  " +
					keyHint("tui.input.newLine", "newline") +
					"  " +
					keyHint("tui.select.cancel", "cancel") +
					(hasExternalEditor ? `  ${keyHint("app.editor.external", "external editor")}` : "");
				return renderReviewFrameLines(frameWidth, content, {
					title: "Handover review",
					help,
					paintBorder: (text) => theme.fg("borderAccent", text),
					paintTitle: (text) => theme.fg("accent", theme.bold(text)),
					paintHelp: (text) => theme.fg("dim", text),
				});
			},
			handleInput(data: string) {
				const kb = getKeybindings();
				if (kb.matches(data, "tui.select.cancel")) {
					done(undefined);
					return;
				}
				if (keybindings.matches(data, "app.editor.external")) {
					void openExternalEditor(tui, editor);
					return;
				}
				editor.handleInput(data);
				tui.requestRender();
			},
			invalidate() {
				editor.invalidate();
			},
		} satisfies Component & Focusable;
	}, { overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", minWidth: MIN_REVIEW_WIDTH } });
}
