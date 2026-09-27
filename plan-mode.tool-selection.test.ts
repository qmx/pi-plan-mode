/**
 * Tests for how plan mode changes the active tool selection.
 *
 * Plan mode only hides `write` and `edit`. It must not replace the whole
 * selection, because `pi.setActiveTools` is a full replace: doing so drops
 * read-only tools such as grep, find, and MCP tools, and it discards the
 * selection other extensions maintain. The disabled branch previously called
 * `setActiveTools(getAllTools())`, which reactivated tools that extensions such
 * as pi-mcp-adapter deliberately hold inactive to save context.
 */

import { describe, it, expect } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import planModeExtension, { PLAN_MODE_BLOCKED_TOOLS } from "./plan-mode.js";

const ALL_REGISTERED_TOOLS = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"mcp",
	"atlassian_getJiraIssue",
	"observability_search_logs",
];

function createHarness(options: { active: string[]; registered?: string[] }) {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	let active = [...options.active];
	let allToolsCalls = 0;
	const setActiveCalls: string[][] = [];

	const pi = {
		on: (event: string, handler: (event: any, ctx: any) => any) => {
			handlers.set(event, handler);
		},
		registerCommand: (name: string, command: any) => {
			commands.set(name, command);
		},
		registerShortcut: () => {},
		registerFlag: () => {},
		appendEntry: () => {},
		getActiveTools: () => [...active],
		getAllTools: () => {
			allToolsCalls += 1;
			return (options.registered ?? ALL_REGISTERED_TOOLS).map((name) => ({ name }));
		},
		setActiveTools: (names: string[]) => {
			active = [...names];
			setActiveCalls.push([...names]);
		},
	} as unknown as ExtensionAPI;

	planModeExtension(pi);

	const ctx = {
		ui: {
			setStatus: () => {},
			notify: () => {},
			confirm: async () => false,
			theme: { fg: () => "" },
		},
		sessionManager: { getEntries: () => [] },
		model: undefined,
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false }) },
	} as any;

	return {
		ctx,
		getActive: () => [...active],
		setActive: (names: string[]) => {
			active = [...names];
		},
		setActiveCalls,
		getAllToolsCalls: () => allToolsCalls,
		startSession: async () => {
			await handlers.get("session_start")?.({}, ctx);
		},
		beforeAgentStart: async () => handlers.get("before_agent_start")?.({ systemPrompt: "base" }, ctx),
		togglePlanMode: async () => {
			await commands.get("plan")!.handler("", ctx);
		},
		callTool: async (toolName: string, input: Record<string, unknown> = {}) =>
			handlers.get("tool_call")?.({ type: "tool_call", toolName, input }, ctx),
	};
}

describe("plan mode tool selection", () => {
	it("removes only write and edit while plan mode is active", async () => {
		const harness = createHarness({ active: ALL_REGISTERED_TOOLS });
		await harness.startSession();
		await harness.togglePlanMode();

		await harness.beforeAgentStart();

		expect(harness.getActive()).toEqual(
			ALL_REGISTERED_TOOLS.filter((name) => !PLAN_MODE_BLOCKED_TOOLS.includes(name)),
		);
		expect(harness.getActive()).not.toContain("write");
		expect(harness.getActive()).not.toContain("edit");
	});

	it("leaves the selection untouched while plan mode is off", async () => {
		const selection = ["read", "bash", "write", "edit", "atlassian_getJiraIssue"];
		const harness = createHarness({ active: selection });
		await harness.startSession();

		await harness.beforeAgentStart();

		expect(harness.getActive()).toEqual(selection);
		expect(harness.setActiveCalls).toHaveLength(0);
	});

	it("never reactivates tools another extension keeps inactive", async () => {
		// pi-mcp-adapter registers these but holds them inactive for context.
		const heldInactive = ["atlassian_getJiraIssue", "observability_search_logs"];
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();

		await harness.beforeAgentStart();

		for (const name of heldInactive) {
			expect(harness.getActive()).not.toContain(name);
		}
		expect(harness.getAllToolsCalls()).toBe(0);
	});

	it("restores write and edit after plan mode ends", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();
		await harness.togglePlanMode();
		await harness.beforeAgentStart();
		expect(harness.getActive()).toEqual(["read", "bash"]);

		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		expect([...harness.getActive()].sort()).toEqual(["bash", "edit", "read", "write"]);
	});

	it("does not restore a blocked tool that was already inactive", async () => {
		// For example, the user excluded `edit` with --exclude-tools.
		const harness = createHarness({ active: ["read", "bash", "write"] });
		await harness.startSession();
		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		expect(harness.getActive()).toContain("write");
		expect(harness.getActive()).not.toContain("edit");
	});

	it("keeps a tool another extension activates while plan mode is active", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();
		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		harness.setActive(["read", "bash", "extra_tool"]);

		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		expect(harness.getActive()).toContain("extra_tool");
		expect(harness.getActive()).toContain("write");
		expect(harness.getActive()).toContain("edit");
	});

	it("is idempotent across turns while plan mode stays active", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();
		await harness.togglePlanMode();
		await harness.beforeAgentStart();

		await harness.beforeAgentStart();

		expect(harness.setActiveCalls).toHaveLength(1);
	});

	it("still blocks write and edit calls while plan mode is active", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();
		await harness.togglePlanMode();

		await expect(harness.callTool("write")).resolves.toMatchObject({ block: true });
		await expect(harness.callTool("edit")).resolves.toMatchObject({ block: true });
	});

	it("does not block write when plan mode is off", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();

		await expect(harness.callTool("write")).resolves.toBeUndefined();
	});

	it("tells the agent which tools are disabled without listing an allowlist", async () => {
		const harness = createHarness({ active: ["read", "bash", "write", "edit"] });
		await harness.startSession();
		await harness.togglePlanMode();

		const result = await harness.beforeAgentStart();

		expect(result.systemPrompt).toContain("write and edit tools are disabled");
		expect(result.systemPrompt).not.toContain("Available tools:");
	});
});
