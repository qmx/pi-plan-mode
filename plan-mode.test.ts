/**
 * Tests for plan-mode extension whitelist functionality.
 * 
 * These tests document the current bugs where safe commands are incorrectly blocked.
 */

import { describe, it, expect, vi } from "vitest";
import { isWhitelisted } from "./plan-mode.js";

describe("plan-mode whitelist", () => {
	describe("commands without trailing space", () => {
		it("should whitelist ls alone", () => {
			expect(isWhitelisted("ls")).toBe(true);
		});

		it("should whitelist git log", () => {
			expect(isWhitelisted("git log")).toBe(true);
		});

		it("should whitelist git status", () => {
			expect(isWhitelisted("git status")).toBe(true);
		});

		it("should whitelist git diff", () => {
			expect(isWhitelisted("git diff")).toBe(true);
		});

		it("should whitelist git show", () => {
			expect(isWhitelisted("git show")).toBe(true);
		});

		it("should whitelist git branch", () => {
			expect(isWhitelisted("git branch")).toBe(true);
		});
	});

	describe("safe pipe operations", () => {
		it("should whitelist ls piped to grep", () => {
			expect(isWhitelisted("ls -la | grep test")).toBe(true);
		});

		it("should whitelist find piped to wc", () => {
			expect(isWhitelisted("find . -name '*.ts' | wc -l")).toBe(true);
		});

		it("should whitelist cat piped to grep", () => {
			expect(isWhitelisted("cat file.ts | grep pattern")).toBe(true);
		});

		it("should whitelist find piped to grep", () => {
			expect(isWhitelisted("find . -type f | grep .ts$")).toBe(true);
		});
	});

	describe("commands that should work (baseline)", () => {
		it("should whitelist pwd", () => {
			expect(isWhitelisted("pwd")).toBe(true);
		});

		it("should whitelist env", () => {
			expect(isWhitelisted("env")).toBe(true);
		});

		it("should whitelist ls with flags", () => {
			expect(isWhitelisted("ls -la")).toBe(true);
		});

		it("should whitelist grep with arguments", () => {
			expect(isWhitelisted("grep pattern file.ts")).toBe(true);
		});

		it("should whitelist cat with file", () => {
			expect(isWhitelisted("cat file.ts")).toBe(true);
		});
	});

	describe("commands that should be blocked", () => {
		it("should block file redirects", () => {
			expect(isWhitelisted("cat file > output")).toBe(false);
		});

		it("should block append redirects", () => {
			expect(isWhitelisted("echo test >> file")).toBe(false);
		});

		it("should block command substitution", () => {
			expect(isWhitelisted("rm $(find . -name '*.log')")).toBe(false);
		});

		it("should block semicolon commands", () => {
			expect(isWhitelisted("ls; rm -rf .")).toBe(false);
		});

		it("should block unsafe pipe to rm", () => {
			// This should be blocked - piping to rm is dangerous
			expect(isWhitelisted("find . -name '*.log' | xargs rm")).toBe(false);
		});
	});

	describe("whitelist and tool blocking", () => {
		const mockPi: any = {
			on: vi.fn(),
			registerCommand: vi.fn(),
			appendEntry: vi.fn(),
			setActiveTools: vi.fn(),
			getAllTools: vi.fn().mockReturnValue([
				{ name: "read" },
				{ name: "bash" },
				{ name: "write" },
				{ name: "edit" },
				{ name: "vibe_check" }
			]),
		};

		const mockCtx: any = {
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
				confirm: vi.fn(),
				theme: {
					fg: vi.fn().mockReturnValue("warning"),
				},
			},
			sessionManager: {
				getEntries: vi.fn().mockReturnValue([]),
			},
			settingsManager: {
				settings: {
					"planMode.toolWhitelist": ["vibe_check", "write"]
				}
			}
		};

		it("should filter whitelist tools correctly (excluding write/edit)", async () => {
			const { default: planModeExtension } = await import("./plan-mode.js");
			planModeExtension(mockPi);
			const beforeAgentStartHandler = mockPi.on.mock.calls.find((call: any) => call[0] === "before_agent_start")[1];
			const planCommandHandler = mockPi.registerCommand.mock.calls.find((call: any) => call[0] === "plan")[1].handler;
			await planCommandHandler(null, mockCtx);

			await beforeAgentStartHandler({ systemPrompt: "test" }, mockCtx);

			expect(mockPi.setActiveTools).toHaveBeenCalledWith(
				expect.arrayContaining(["read", "bash", "vibe_check"])
			);
			expect(mockPi.setActiveTools).not.toHaveBeenCalledWith(
				expect.arrayContaining(["write"])
			);
		});

		it("should allow whitelisted tools in tool_call hook", async () => {
			const { default: planModeExtension } = await import("./plan-mode.js");
			const mockPiLocal: any = {
				on: vi.fn(),
				registerCommand: vi.fn(),
				appendEntry: vi.fn(),
				setActiveTools: vi.fn(),
				getAllTools: vi.fn().mockReturnValue([
					{ name: "read" },
					{ name: "bash" },
					{ name: "write" },
					{ name: "vibe_check" }
				]),
			};
			planModeExtension(mockPiLocal);
			const toolCallHandler = mockPiLocal.on.mock.calls.find((call: any) => call[0] === "tool_call")[1];
			const planCommandHandler = mockPiLocal.registerCommand.mock.calls.find((call: any) => call[0] === "plan")[1].handler;
			await planCommandHandler(null, mockCtx);

			const vibeCheckResult = await toolCallHandler({ toolName: "vibe_check" }, mockCtx);
			expect(vibeCheckResult).toBeUndefined();

			const writeResult = await toolCallHandler({ toolName: "write" }, mockCtx);
			expect(writeResult).toEqual({
				block: true,
				reason: "Plan mode active. Use /plan to enable write/edit tools."
			});
		});
	});
});
