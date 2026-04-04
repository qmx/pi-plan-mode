/**
 * Plan Mode Extension
 *
 * Toggleable read-only mode that blocks write/edit tools.
 * Smart bash filtering with whitelist and AI review.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";

export const SAFE_COMMAND_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*ls\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*wc\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*git\s+(status|log|diff|show|branch)\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*which\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*date\b/,
];

export const MUTATING_GIT_COMMANDS: RegExp[] = [
	/^\s*git\s+commit/,
	/^\s*git\s+push/,
	/^\s*git\s+pull/,
	/^\s*git\s+merge/,
	/^\s*git\s+rebase/,
	/^\s*git\s+reset/,
	/^\s*git\s+cherry-pick/,
	/^\s*git\s+branch\s+-D/,
	/^\s*git\s+branch\s+-d/,
	/^\s*git\s+tag\s+-d/,
];

// Block dangerous shell constructs (but allow pipes for safe command chaining)
export const UNSAFE_SHELL_CHARS = /[;&`\n]/;
export const REDIRECT_PATTERN = />{1,2}/;

// Patterns for unsafe pipe targets
const UNSAFE_PIPE_PATTERNS: RegExp[] = [
	/\|\s*rm\b/,
	/\|\s*xargs.*rm\b/,
	/\|\s*sudo\b/,
	/\|\s*chmod\b/,
	/\|\s*chown\b/,
	/\|\s*mv\b/,
	/\|\s*cp\b/,
	/\|\s*wget\b/,
	/\|\s*curl\b/,
];

function hasUnsafePipe(command: string): boolean {
	return UNSAFE_PIPE_PATTERNS.some((p) => p.test(command));
}

export function isWhitelisted(command: string): boolean {
	const trimmed = command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
	if (UNSAFE_SHELL_CHARS.test(trimmed)) return false;
	if (REDIRECT_PATTERN.test(trimmed)) return false;
	if (hasUnsafePipe(trimmed)) return false;
	return SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
}

function getBashOverride(entries: any[], command: string): boolean {
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "plan-mode-bash-override") {
			if (entry.data?.command === command) return true;
		}
	}
	return false;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan", ctx.ui.theme.fg("warning", "⚠️ planning"));
		} else {
			ctx.ui.setStatus("plan", undefined);
		}
	}

	function persistState(ctx: ExtensionContext): void {
		pi.appendEntry("plan-mode", {
			active: planModeEnabled,
			timestamp: new Date().toISOString(),
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (blocks write/edit tools)",
		handler: async (_args, ctx) => {
			planModeEnabled = !planModeEnabled;

			if (planModeEnabled) {
				ctx.ui.notify("✅ Plan mode enabled - writes blocked", "info");
			} else {
				ctx.ui.notify("✅ Plan mode disabled - writes enabled", "info");
			}

			updateStatus(ctx);
			persistState(ctx);
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (planModeEnabled) {
			// Hide write/edit tools entirely from the agent
			pi.setActiveTools(["read", "bash"]);
		} else {
			// Restore all tools
			const allTools = pi.getAllTools().map((t) => t.name);
			pi.setActiveTools(allTools);
		}

		if (!planModeEnabled) return;

		const instructions = `[PLAN MODE ACTIVE]

You are in plan mode. This is a PLANNING PHASE only.

Available tools:
- read: Read files to understand the codebase
- bash: Run commands for exploration (safe commands allowed, others reviewed)

Note: write and edit tools are disabled in plan mode.

Help the user plan what needs to be done:
- Explore the codebase
- Discuss the approach
- Identify files that need changes
- When ready, remind the user to run /plan to exit plan mode`;

		return {
			systemPrompt: _event.systemPrompt + "\n\n" + instructions,
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const planEntries = entries.filter(
			(e) => e.type === "custom" && e.customType === "plan-mode",
		);
		const lastEntry = planEntries.length > 0 ? planEntries[planEntries.length - 1] : null;

		if (lastEntry && "data" in lastEntry && (lastEntry as any).data?.active === true) {
			planModeEnabled = true;
			updateStatus(ctx);
			ctx.ui.notify("i️ Plan mode restored", "info");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!planModeEnabled) return;

		// Block write/edit tools
		if (event.toolName === "write" || event.toolName === "edit") {
			return {
				block: true,
				reason: "Plan mode active. Use /plan to enable write/edit tools.",
			};
		}

		if (event.toolName === "bash") {
			const command = (event.input as any)?.command || "";

			const entries = ctx.sessionManager.getEntries();
			if (getBashOverride(entries, command)) return;

			if (MUTATING_GIT_COMMANDS.some((p) => p.test(command))) {
				return {
					block: true,
					reason: "Plan mode: mutating git commands are not allowed.",
				};
			}

			// Block commands with shell redirects (>, >>) - these write to files
			if (REDIRECT_PATTERN.test(command)) {
				return {
					block: true,
					reason: "Plan mode: file redirects are not allowed.",
				};
			}

			if (isWhitelisted(command)) return;

			try {
				const currentModel = ctx.model;
				if (!currentModel) {
					return {
						block: true,
						reason: "Plan mode: cannot review command (no model available).",
					};
				}

				const authResult = await ctx.modelRegistry.getApiKeyAndHeaders(currentModel);
				if (!authResult.ok) {
					return {
						block: true,
						reason: "Plan mode: cannot review command (auth failed).",
					};
				}

				const response = await completeSimple(
					currentModel,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text:
											"Is this bash command EXPLORATORY (read-only, safe in plan mode) or MUTATING (writes, deletes, or changes state)?\n\n" +
											`$ ${command}\n\nRespond with a single word: EXPLORATORY or MUTATING`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ apiKey: authResult.apiKey, headers: authResult.headers, maxTokens: 256 },
				);

				const text = response.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join(" ")
					.toLowerCase();

				if (text.includes("mutating")) {
					const allowed = await ctx.ui.confirm(
						"Plan mode: command blocked",
						`This command would mutate state:\n\n  $ ${command}\n\nAllow anyway?`,
					);

					if (allowed) {
						pi.appendEntry("plan-mode-bash-override", { command, timestamp: Date.now() });
						return;
					}

					return {
						block: true,
						reason: "Plan mode: command would mutate state. Use /plan to exit plan mode.",
					};
				}

				return;
			} catch (error: any) {
				console.error(`Plan mode AI review failed:`, error);

				const allowed = await ctx.ui.confirm(
					"Plan mode: AI review failed",
					`Could not review command due to error:\n\n  ${error.message}\n\n  $ ${command}\n\nAllow anyway?`,
				);

				if (allowed) {
					pi.appendEntry("plan-mode-bash-override", { command, timestamp: Date.now() });
					return;
				}

				return {
					block: true,
					reason: "Plan mode: AI review failed. Command blocked for safety.",
				};
			}
		}
	});
}
