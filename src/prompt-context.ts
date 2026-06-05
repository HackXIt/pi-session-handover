import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HandoverPromptContext } from "./prompt.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
type PromptContextField = { name: string; prompt: string; multiline: boolean; required: boolean; default?: string };

export async function collectPromptContext(
	ctx: CommandContext,
	config: { promptContextFields: PromptContextField[] },
): Promise<HandoverPromptContext | undefined> {
	const context: HandoverPromptContext = {};
	for (const field of config.promptContextFields) {
		const initialValue = field.default ?? "";
		const value = field.multiline ? await ctx.ui.editor(field.prompt, initialValue) : await ctx.ui.input(field.prompt, initialValue);
		if (value === undefined) return undefined;
		const trimmed = value.trim();
		if (!trimmed) {
			if (field.default !== undefined) {
				context[field.name] = field.default.trim();
				continue;
			}
			if (field.required === false) continue;
			ctx.ui.notify(`Handover field ${field.name} is required`, "error");
			return undefined;
		}
		context[field.name] = trimmed;
	}
	return context;
}
