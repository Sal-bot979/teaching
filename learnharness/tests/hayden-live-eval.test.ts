/**
 * Hayden fork — the synthetic-learner live eval (hayden/evals/live-eval.ts),
 * exercised in its free dry-run mode: a scripted tutor stands in for the
 * model, so every learner policy, the scoring and the report run for real
 * through the app's request path with zero tokens. Also pins the CLI's
 * refusal to spend without --confirm-spend, and the practice-leak screen.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-hayden-live-eval-"));
process.env.LH_DATA_DIR = TMP_DATA;
process.env.LH_AUTH_FILE = path.join(TMP_DATA, "auth.json");
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";
// "Free" is proven, not assumed: any network call fails the run and is counted.
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown) => {
	fetchCalls++;
	throw new Error(`unexpected network call: ${String(input)}`);
};
after(() => {
	globalThis.fetch = originalFetch;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const { runEval, renderReport, revealedSolutionNumbers } = await import("../hayden/evals/live-eval.ts");
const { chatStore } = await import("../src/store/chats.ts");

const quizResults = (chatId: string) =>
	chatStore.getChat(chatId)!.messages
		.filter((m) => (m as { toolName?: string }).toolName === "quiz")
		.map((m) => JSON.parse(((m as { content: Array<{ text: string }> }).content[0]!).text) as { correct: boolean; confidence?: number; thinking?: string });

describe("live eval — dry run through the real request path", async () => {
	const results = await runEval({ dryRun: true, maxUsd: 0.5, maxTurns: 6, log: () => {} });
	const by = Object.fromEntries(results.map((r) => [r.persona, r]));

	it("runs all four personas to their scripted stop, with zero network calls", () => {
		assert.equal(fetchCalls, 0, "a dry run must never reach the network");
		assert.deepEqual(results.map((r) => r.persona), ["correct", "misconception", "interruption", "practice"]);
		for (const r of results) {
			assert.equal(r.stoppedBy, "script", r.persona);
			assert.equal(r.costUsd, 0, "dry runs report no spend");
			assert.equal(r.report.resumePointRequired, true, `${r.persona} ended on a stop`);
		}
	});

	it("the correct learner answers right; the misconception learner answers wrong at 95% with its wrong model", () => {
		const right = quizResults(by.correct!.chatId)[0]!;
		assert.equal(right.correct, true);
		const wrong = quizResults(by.misconception!.chatId)[0]!;
		assert.equal(wrong.correct, false);
		assert.equal(wrong.confidence, 95);
		assert.match(wrong.thinking ?? "", /tolerance dose/);
	});

	it("the interruption learner stops, resumes and stops again (two resume points demanded)", () => {
		const texts = chatStore.getChat(by.interruption!.chatId)!.messages
			.filter((m) => m.role === "user")
			.map((m) => JSON.stringify((m as { content: unknown }).content));
		assert.equal(texts.filter((t) => t.includes("stopping here")).length, 2);
		assert.ok(texts.some((t) => t.includes("Back. Continue.")));
	});

	it("the practice learner submits a wrong attempt, then the answer, and moves on with `next`", () => {
		const msgs = chatStore.getChat(by.practice!.chatId)!.messages as Array<{ role: string; customType?: string; toolName?: string }>;
		assert.ok(msgs.some((m) => m.customType === "practice-thinking"));
		assert.ok(msgs.some((m) => m.toolName === "conclude"), "a problem was concluded");
		assert.ok(msgs.some((m) => m.customType === "practice-next"), "the learner moved on explicitly");
		assert.deepEqual(by.practice!.revealLeaks, [], "the scripted hint reveals nothing");
	});

	it("the report names every persona and session", () => {
		const md = renderReport(results, "dry run");
		for (const r of results) {
			assert.ok(md.includes(`| ${r.persona} |`));
			assert.ok(md.includes(r.chatId));
		}
	});
});

describe("live eval — practice reveal screen", () => {
	const statement = "60 Gy in 30 fractions vs 45 Gy in 15 fractions at alpha/beta = 3 Gy.";
	const solution = "BED_A = 60(1 + 2/3) = 100 Gy_3; BED_B = 45(1 + 3/3) = 90 Gy_3. A is harsher by 10.";
	it("flags derived numbers in a hint, not the statement's own numbers", () => {
		assert.deepEqual(revealedSolutionNumbers(statement, solution, "Close — schedule A comes to 100."), ["100"]);
		assert.deepEqual(revealedSolutionNumbers(statement, solution, "Re-read: 60 Gy over 30 fractions — what is d?"), []);
		assert.deepEqual(revealedSolutionNumbers(statement, solution, "Check the dose per fraction first."), []);
	});
	it("catches derived single digits and reformatted values (critic round 4)", () => {
		// d = 2 Gy is derived, not given; "100.0" is the same number as "100".
		assert.deepEqual(revealedSolutionNumbers(statement, "d = 2 Gy; BED_A = 100 Gy_3", "Hint: you need d = 2 here."), ["2"]);
		assert.deepEqual(revealedSolutionNumbers(statement, solution, "That works out to 100.0 Gy_3."), ["100"]);
	});
});

describe("live eval — runEval never spends by accident", () => {
	it("a live run without confirmSpend throws before anything happens", async () => {
		const before = chatStore.listChats().length;
		await assert.rejects(() => runEval({ dryRun: false, maxUsd: 0.5, maxTurns: 2, log: () => {} }), /confirmSpend: true/);
		assert.equal(chatStore.listChats().length, before, "no session was created");
	});
	it("invalid caps are refused", async () => {
		await assert.rejects(() => runEval({ dryRun: true, maxUsd: -1, maxTurns: 2, log: () => {} }), /maxUsd must be/);
		await assert.rejects(() => runEval({ dryRun: true, maxUsd: 0.5, maxTurns: 0, log: () => {} }), /maxTurns/);
	});
});

describe("live eval — CLI never spends by accident", () => {
	it("refuses without --confirm-spend or --dry-run (exit 2, nothing run)", () => {
		const r = spawnSync(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "..", "hayden", "evals", "live-eval.ts")], {
			env: { ...process.env, LH_DATA_DIR: TMP_DATA },
			encoding: "utf-8",
			timeout: 60_000,
		});
		assert.equal(r.status, 2, r.stderr);
		assert.match(r.stderr, /Refusing: a live eval calls your configured model and may cost money/);
	});

	const cli = (args: string[], env: Record<string, string | undefined>) =>
		spawnSync(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "..", "hayden", "evals", "live-eval.ts"), ...args], { env: { ...process.env, ...env }, encoding: "utf-8", timeout: 60_000 });

	it("refuses a live run without a throwaway LH_DATA_DIR", () => {
		const r = cli(["--confirm-spend"], { LH_DATA_DIR: undefined });
		assert.equal(r.status, 2, r.stderr);
		assert.match(r.stderr, /needs LH_DATA_DIR/);
	});

	it("refuses a cap it cannot honor (0, negative, non-numeric) instead of defaulting", () => {
		for (const bad of ["0", "-1", "abc"]) {
			const r = cli(["--dry-run", "--max-usd", bad], { LH_DATA_DIR: TMP_DATA });
			assert.equal(r.status, 2, `--max-usd ${bad}: ${r.stderr}`);
			assert.match(r.stderr, /--max-usd needs a number/);
		}
	});
});
