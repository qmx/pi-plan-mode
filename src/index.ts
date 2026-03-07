/**
 * Plan Mode Extension
 *
 * Read-only exploration mode with a persistent plan file.
 * Forces planning phase before code execution.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Configuration ────────────────────────────────────────────────────────────

const PLANS_DIR = path.join(process.env.HOME!, ".pi", "agent", "sessions", "plans");

// Pet naming arrays (Terraform-style)
const ADJECTIVES = ["fuzzy", "sunny", "brave", "swift", "gentle", "happy", "clever", "quiet", "wild", "cozy"];
const ANIMALS = ["otter", "panda", "fox", "tiger", "falcon", "koala", "wolf", "rabbit", "dolphin", "yak"];

// Whitelist of safe bash commands
const SAFE_COMMAND_PATTERNS: RegExp[] = [
	/^\s*cat\s/,
	/^\s*ls\s/,
	/^\s*grep\s/,
	/^\s*find\s/,
	/^\s*head\s/,
	/^\s*tail\s/,
	/^\s*wc\s/,
	/^\s*pwd\s*$/,
	/^\s*echo\s/,
	/^\s*printf\s/,
	/^\s*git\s+(status|log|diff|show|branch)\s/,
	/^\s*file\s/,
	/^\s*stat\s/,
	/^\s*du\s/,
	/^\s*df\s/,
	/^\s*which\s/,
	/^\s*type\s/,
	/^\s*env\s*$/,
	/^\s*printenv\s*$/,
	/^\s*uname\s*$/,
	/^\s*whoami\s*$/,
	/^\s*date\s*$/,
];

// Shell metacharacters that indicate mutation
const UNSAFE_SHELL_CHARS = /[|;&`\n]/;
const REDIRECT_PATTERN = />{1,2}/;

// ── Helper Functions ─────────────────────────────────────────────────────────

function generatePlanName(): string {
	const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
	const random = Math.random().toString(36).slice(2, 7);
	return `${adjective}-${animal}-${random}.md`;
}

function createPlanFile(summary?: string): string {
	if (!fs.existsSync(PLANS_DIR)) {
		fs.mkdirSync(PLANS_DIR, { recursive: true });
	}

	const planName = generatePlanName();
	const planPath = path.join(PLANS_DIR, planName);
	const title = summary ? summary.trim() : "Untitled Plan";

	const template = `# Plan: ${title}

## Overview
[What we're building and why]

## Approach
[How we're going to do it]

## Decisions
[Key decisions made during discussion]

## Considerations
[Constraints, trade-offs, notes]
`;

	fs.writeFileSync(planPath, template);
	return planPath;
}

function isWhitelisted(command: string): boolean {
	const trimmed = command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
	if (UNSAFE_SHELL_CHARS.test(trimmed)) return false;
	if (REDIRECT_PATTERN.test(trimmed)) return false;
	return SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
}

function getPlanEntry(entries: any[]): any | null {
	return entries.find((e) => e.type === "custom" && e.customType === "plan-mode") || null;
}

function getBashOverride(entries: any[], command: string): boolean {
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "plan-mode-bash-override") {
			if (entry.data?.command === command) return true;
		}
	}
	return false;
}

function computeDiff(oldText: string, newText: string): string {
	// Simple line-by-line diff
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const diffLines: string[] = [];

	const maxLen = Math.max(oldLines.length, newLines.length);
	for (let i = 0; i < maxLen; i++) {
		const oldLine = oldLines[i];
		const newLine = newLines[i];

		if (oldLine === newLine) continue;

		if (oldLine === undefined) {
			diffLines.push(`+ ${newLine}`);
		} else if (newLine === undefined) {
			diffLines.push(`- ${oldLine}`);
		} else {
			diffLines.push(`- ${oldLine}`);
			diffLines.push(`+ ${newLine}`);
		}
	}

	return diffLines.join("\n");
}

async function summarizePlan(planContent: string, ctx: ExtensionContext): Promise<string> {
	try {
		const model = ctx.model;
		if (!model) {
			return "";
		}
		const result = await complete(model, {
			messages: [
				{
					role: "user",
					content:
						"Summarize this plan in exactly 2 lines. Focus on what's being built and the key approach.\n\n" +
						planContent,
					timestamp: Date.now(),
				},
			],
		});

		const summary = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (summary && summary.length > 0 && !summary.includes("[")) {
			return summary.length > 100 ? summary.slice(0, 97) + "..." : summary;
		}
	} catch (error) {
		console.error("Plan summary failed:", error);
	}

	// Fallback: extract from Overview section
	const overviewMatch = planContent.match(/## Overview\s*\n([\s\S]*?)(?:##|\Z)/);
	if (overviewMatch && overviewMatch[1]) {
		const overview = overviewMatch[1].trim().split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");
		if (overview && !overview.includes("[")) {
			return overview.length > 100 ? overview.slice(0, 97) + "..." : overview;
		}
	}

	// Last resort: first two non-empty, non-placeholder lines
	const lines = planContent
		.split("\n")
		.filter(
			(l) =>
				l.trim() &&
				!l.startsWith("#") &&
				!l.includes("[What we're building") &&
				!l.includes("[How we're going") &&
				!l.includes("[Key decisions") &&
				!l.includes("[Constraints"),
		)
		.slice(0, 2);

	return lines.join(" ").length > 100 ? lines.join(" ").slice(0, 97) + "..." : lines.join(" ");
}

// ── Extension Entry Point ────────────────────────────────────────────────────

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let currentPlanPath: string | null = null;

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled && currentPlanPath) {
			const filename = path.basename(currentPlanPath);
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", `planning: ${filename}`));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	async function updateWidget(ctx: ExtensionContext): Promise<void> {
		if (!planModeEnabled || !currentPlanPath) {
			ctx.ui.setWidget("plan-summary", undefined);
			return;
		}

		try {
			const content = fs.readFileSync(currentPlanPath, "utf-8");
			const summary = await summarizePlan(content, ctx);
			ctx.ui.setWidget("plan-summary", summary.split("\n").slice(0, 2));
		} catch {
			ctx.ui.setWidget("plan-summary", ["Plan file not found"]);
		}
	}

	function persistState(ctx: ExtensionContext): void {
		if (planModeEnabled && currentPlanPath) {
			pi.appendEntry("plan-mode", {
				planPath: currentPlanPath,
				active: true,
				createdAt: new Date().toISOString(),
			});
		} else {
			// Clear state but keep the plan file for reference
			pi.appendEntry("plan-mode", {
				planPath: null,
				active: false,
				concludedAt: new Date().toISOString(),
			});
		}
	}

	function enterPlanMode(planPath: string, ctx: ExtensionContext): void {
		planModeEnabled = true;
		currentPlanPath = planPath;

		const filename = path.basename(planPath);
		ctx.ui.notify(`✅ Plan mode enabled: ${filename}`, "info");

		updateStatus(ctx);
		updateWidget(ctx);
		persistState(ctx);

		// Notify user that plan mode is active
		pi.sendMessage(
			{
				customType: "plan-mode-active",
				content: `Plan mode is now active. I can only write to the plan file: ${filename}`,
				display: true,
			},
			{ deliverAs: "steer", triggerTurn: false },
		);
	}

	function exitPlanMode(ctx: ExtensionContext, keepPlan: boolean): void {
		planModeEnabled = false;
		const planPath = currentPlanPath;
		currentPlanPath = null;

		ctx.ui.setStatus("plan-mode", undefined);
		ctx.ui.setWidget("plan-summary", undefined);

		if (keepPlan && planPath) {
			ctx.ui.notify(`✅ Plan mode exited. Plan saved: ${path.basename(planPath)}`, "info");
		} else {
			ctx.ui.notify("✅ Plan mode exited", "info");
		}

		persistState(ctx);
	}

	// ── Commands ──────────────────────────────────────────────────────────────

	pi.registerCommand("plan", {
		description: "Enter plan mode (read-only exploration)",
		handler: async (args, ctx) => {
			if (planModeEnabled) {
				ctx.ui.notify("Already in plan mode. Use /plan:cancel first.", "error");
				return;
			}

			const planPath = createPlanFile(args);
			enterPlanMode(planPath, ctx);
		},
	});

	pi.registerCommand("plan:approve", {
		description: "Approve plan and start execution",
		handler: async (_args, ctx) => {
			if (!planModeEnabled || !currentPlanPath) {
				ctx.ui.notify("No active plan", "error");
				return;
			}

			let planContent: string;
			try {
				planContent = fs.readFileSync(currentPlanPath, "utf-8");
			} catch (error) {
				ctx.ui.notify(`Failed to read plan: ${error}`, "error");
				return;
			}

			exitPlanMode(ctx, true);

			// Inject plan into system prompt
			const planContext = `[APPROVED PLAN]

The following plan has been approved and is now being executed:

${planContent}

Follow this plan during execution.`;

			pi.sendMessage(
				{ customType: "plan-approved", content: planContext, display: false },
				{ deliverAs: "nextTurn" },
			);

			// Auto-start execution
			pi.sendUserMessage("Starting execution based on the plan...", { deliverAs: "steer" });
		},
	});

	pi.registerCommand("plan:cancel", {
		description: "Exit plan mode without approving",
		handler: async (_args, ctx) => {
			if (!planModeEnabled) {
				ctx.ui.notify("Not in plan mode", "error");
				return;
			}

			exitPlanMode(ctx, true);
		},
	});

	pi.registerCommand("plan:resume", {
		description: "Resume planning from a specific plan file",
		handler: async (args, ctx) => {
			if (planModeEnabled) {
				ctx.ui.notify("Already in plan mode. Use /plan:cancel first.", "error");
				return;
			}

			if (!args || !args.trim()) {
				ctx.ui.notify("Usage: /plan:resume <plan file>", "error");
				return;
			}

			const planPath = args.trim().startsWith("/") ? args.trim() : path.join(PLANS_DIR, args.trim());

			if (!fs.existsSync(planPath)) {
				ctx.ui.notify(`Plan file not found: ${planPath}`, "error");
				return;
			}

			enterPlanMode(planPath, ctx);
		},
	});

	// ── System Prompt Injection ──────────────────────────────────────────────

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!planModeEnabled || !currentPlanPath) return;

		const planInstructions = `[PLAN MODE ACTIVE - DO NOT EXECUTE]

You are in plan mode. This is a PLANNING PHASE only. Rules:

1. You can READ any file to understand the codebase
2. You can ONLY WRITE to the plan file: ${currentPlanPath}
3. You can also write to /tmp/ for temporary files
4. You can ONLY EDIT the plan file: ${currentPlanPath}
5. Do NOT use write, edit, or destructive bash commands for other files
6. Help the user think through the problem and update the plan file as you discuss
7. The plan file is the shared understanding of what we're building
8. After updating the plan file, show a diff of what changed and ask the user for feedback

CRITICAL: Plan mode ONLY exits when the user explicitly runs the /plan:approve command.
- Do NOT start implementing or executing when the user says "go for it", "start", "begin", "proceed", "let's do it", etc.
- Do NOT interpret casual language as approval to start execution
- ONLY the /plan:approve command exits plan mode and starts execution
- If the user seems to want to start, remind them: "Use /plan:approve to exit plan mode and start execution"

Plan file format:
\`\`\`markdown
# Plan: [Summary]

## Overview
[What we're building and why]

## Approach
[How we're going to do it]

## Decisions
[Key decisions made during discussion]

## Considerations
[Constraints, trade-offs, notes]
\`\`\`

Update the plan file as we discuss, keeping it current and well-organized.
When the plan is complete, remind the user to use /plan:approve to start execution.`;

		return {
			systemPrompt: _event.systemPrompt + "\n\n" + planInstructions,
		};
	});

	// ── Session Lifecycle ─────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const planEntry = getPlanEntry(entries);

		// Only re-enter plan mode if it's still active (not approved or cancelled)
		if (planEntry?.data?.active === true && planEntry?.data?.planPath) {
			const planPath = planEntry.data.planPath;
			if (fs.existsSync(planPath)) {
				planModeEnabled = true;
				currentPlanPath = planPath;

				updateStatus(ctx);
				await updateWidget(ctx);
			}
		}
	});

	// ── Tool Blocking ─────────────────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!planModeEnabled) return;

		// Block write tool (except plan file and /tmp)
		if (event.toolName === "write") {
			const inputPath = (event.input as any)?.path;
			if (inputPath) {
				const resolvedPath = inputPath.startsWith("/") ? inputPath : path.resolve(inputPath);
				const isPlanFile = resolvedPath === currentPlanPath;
				const isTmp = resolvedPath.startsWith("/tmp/");

				if (!isPlanFile && !isTmp) {
					return {
						block: true,
						reason: "Plan mode active. You can only write to the plan file or /tmp. Use /plan:approve to start execution.",
					};
				}

				// If writing to plan file, read old content for diff
				if (isPlanFile && currentPlanPath) {
					try {
						(event as any)._oldPlanContent = fs.readFileSync(currentPlanPath, "utf-8");
					} catch {}
				}
			}
		}

		// Block edit tool (except plan file)
		if (event.toolName === "edit") {
			const inputPath = (event.input as any)?.path;
			if (inputPath) {
				const resolvedPath = inputPath.startsWith("/") ? inputPath : path.resolve(inputPath);
				const isPlanFile = resolvedPath === currentPlanPath;

				if (!isPlanFile) {
					return {
						block: true,
						reason: "Plan mode active. You can only edit the plan file. Use /plan:approve to start execution.",
					};
				}
			}
		}

		// Handle bash tool
		if (event.toolName === "bash") {
			const command = (event.input as any)?.command || "";

			// Check override memory
			const entries = ctx.sessionManager.getEntries();
			if (getBashOverride(entries, command)) {
				return; // Already approved
			}

			// Whitelist check
			if (isWhitelisted(command)) {
				return; // Safe command
			}

			// AI review
			try {
				// Use the current model for review
				const currentModel = ctx.model;
				if (!currentModel) {
					return; // No model available, allow
				}

				const apiKey = await ctx.modelRegistry.getApiKey(currentModel);
				if (!apiKey) {
					return; // No API key, allow
				}

				const response = await complete(
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
					{ apiKey, maxTokens: 256 },
				);

				const text = response.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join(" ")
					.toLowerCase();

				if (text.includes("mutating")) {
					// Show confirmation dialog
					const allowed = await ctx.ui.confirm(
						"Plan mode: command blocked",
						`This command would mutate state:\n\n  $ ${command}\n\nAllow anyway?`,
					);

					if (allowed) {
						// Store override
						pi.appendEntry("plan-mode-bash-override", {
							command,
							timestamp: Date.now(),
						});
						return;
					}

					return {
						block: true,
						reason: "Plan mode: command would mutate state. Use /plan:approve to start execution.",
					};
				}
			} catch (error) {
				// On error, allow but notify
				console.error(`Plan mode AI review failed:`, error);
				if (ctx.hasUI) {
					ctx.ui.notify("⚠️ AI review failed, allowing command anyway", "warning");
				}
				return; // Allow on error to avoid blocking legitimate commands
			}
		}
	});

	// ── Plan File Updates ─────────────────────────────────────────────────────

	pi.on("tool_result", async (event, ctx) => {
		if (!planModeEnabled || !currentPlanPath) return;

		if (event.toolName === "write" && event.input?.path === currentPlanPath) {
			// Plan file was just written, show what changed
			try {
				const newContent = fs.readFileSync(currentPlanPath, "utf-8");
				const oldContent = (event as any)._oldPlanContent || "";

				if (oldContent && newContent !== oldContent) {
					// Show simplified diff
					const diff = computeDiff(oldContent, newContent);
					if (diff) {
						pi.sendMessage(
							{
								customType: "plan-update",
								content: `**Plan updated:**\n\`\`\`diff\n${diff}\`\`\``,
								display: true,
							},
							{ deliverAs: "nextTurn" },
						);
					}

					// Update widget
					await updateWidget(ctx);
				}
			} catch {
				// Ignore read errors
			}
		}
	});

	// ── Message Rendering ─────────────────────────────────────────────────────

	pi.registerMessageRenderer("plan-mode-context", (_message, _options, theme) => {
		return {
			render: (width: number) => [theme.fg("dim", "[Plan mode instructions - hidden]")],
			invalidate: () => {},
		};
	});

	pi.registerMessageRenderer("plan-approved", (_message, _options, theme) => {
		return {
			render: (width: number) => [theme.fg("success", "[Plan approved - execution started]")],
			invalidate: () => {},
		};
	});
}
