import { describe, expect, it, vi } from "vitest";
import { collectPromptContext } from "../src/prompt-context.js";

function ctx() {
	return {
		ui: {
			input: vi.fn(),
			editor: vi.fn(),
			notify: vi.fn(),
		},
	} as any;
}

describe("collectPromptContext", () => {
	it("collects single-line and multiline context fields", async () => {
		const context = ctx();
		context.ui.input.mockResolvedValue(" docs/PLAN.md ");
		context.ui.editor.mockResolvedValue(" risk details ");

		await expect(
			collectPromptContext(context, {
				promptContextFields: [
					{ name: "plan", prompt: "Plan?", multiline: false, required: true },
					{ name: "risk", prompt: "Risk?", multiline: true, required: true },
				],
			}),
		).resolves.toEqual({ plan: "docs/PLAN.md", risk: "risk details" });
		expect(context.ui.input).toHaveBeenCalledWith("Plan?", "");
		expect(context.ui.editor).toHaveBeenCalledWith("Risk?", "");
	});

	it("returns undefined when a prompt is cancelled", async () => {
		const context = ctx();
		context.ui.input.mockResolvedValue(undefined);

		await expect(
			collectPromptContext(context, { promptContextFields: [{ name: "plan", prompt: "Plan?", multiline: false, required: true }] }),
		).resolves.toBeUndefined();
		expect(context.ui.notify).not.toHaveBeenCalled();
	});

	it("rejects blank required fields", async () => {
		const context = ctx();
		context.ui.input.mockResolvedValue("   ");

		await expect(
			collectPromptContext(context, { promptContextFields: [{ name: "plan", prompt: "Plan?", multiline: false, required: true }] }),
		).resolves.toBeUndefined();
		expect(context.ui.notify).toHaveBeenCalledWith("Handover field plan is required", "error");
	});

	it("omits blank optional fields", async () => {
		const context = ctx();
		context.ui.input.mockResolvedValue("   ");

		await expect(
			collectPromptContext(context, { promptContextFields: [{ name: "risk", prompt: "Risk?", multiline: false, required: false }] }),
		).resolves.toEqual({});
		expect(context.ui.notify).not.toHaveBeenCalled();
	});

	it("uses configured defaults when a field is left blank", async () => {
		const context = ctx();
		context.ui.input.mockResolvedValue("   ");

		await expect(
			collectPromptContext(context, {
				promptContextFields: [{ name: "branch", prompt: "Branch?", multiline: false, required: false, default: "main" }],
			}),
		).resolves.toEqual({ branch: "main" });
		expect(context.ui.input).toHaveBeenCalledWith("Branch?", "main");
	});
});
