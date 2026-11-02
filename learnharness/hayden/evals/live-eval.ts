/**
 * Synthetic-learner live eval — does a REAL model follow the profile?
 *
 *   npx tsx hayden/evals/live-eval.ts --dry-run
 *       Free. A scripted tutor stands in for the model; exercises every
 *       learner policy, the scoring and the report. Run this first.
 *
 *   npx tsx hayden/evals/live-eval.ts --confirm-spend [--max-usd 0.50] [--max-turns 8]
 *       COSTS MONEY. Runs four scripted learners against the model your
 *       Settings → Models strong slot names, through the app's own request
 *       path, stopping at the dollar cap (priced turns) or the turn cap.
 *
 * Honors LH_DATA_DIR — point it at a throwaway directory holding a COPY of
 * your settings.json (and prompts/ for the profile override) so the eval
 * sessions never mix with your real ones. The learner is a script: it is
 * consistent and cheap, not a person. Findings are screens (see
 * transcript-checks.ts), not verdicts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, FauxResponseStep } from "@earendil-works/pi-ai";
import type { LhMessage } from "../../src/core/native-messages.ts";
import type { PiEngine } from "../../src/agent/models.ts";
import { checkTranscript, type Report } from "./transcript-checks.ts";

type Persona = "correct" | "misconception" | "interruption" | "practice";
type Factory = Parameters<typeof import("../../src/server/chat-handler.ts").handleChatRequest>[1];

export interface ScenarioResult {
	persona: Persona;
	chatId: string;
	learnerTurns: number;
	costUsd: number;
	unpricedTurns: number;
	report: Report;
	/** Practice only: a hint after a wrong attempt contained numbers that
	 *  appear only in the committed solution (not in the statement). */
	revealLeaks: string[];
	stoppedBy: "script" | "turn-cap" | "budget" | "stuck";
}

const STOP = "Need to go — stopping here.";
const OPENERS: Record<Persona, string> = {
	correct: "Short session (~10 min). Goal: what α/β actually means in the linear-quadratic model.",
	misconception: "Short session (~10 min). Goal: why fractionation spares late-responding tissue under the LQ model.",
	interruption: "Normal session (~25 min). Goal: why minimizing cross-entropy for a binary classifier is maximum-likelihood estimation.",
	practice: "Practice: LQ fractionation and BED, new numbers please.",
};
const MISCONCEPTION = "α/β is the tolerance dose of the tissue, so a high α/β tissue is the fragile one and suffers more from big fractions.";

/** Numbers (2+ digits) in the solution that the statement never
 *  mentions — derived results a hint must not hand over. */
export function revealedSolutionNumbers(statement: string, modelSolution: string, hint: string): string[] {
	const nums = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g)?.filter((n) => n.replace(".", "").length >= 2) ?? []);
	const given = nums(statement);
	const hintNums = nums(hint);
	return [...nums(modelSolution)].filter((n) => !given.has(n) && hintNums.has(n));
}

const textOf = (m: LhMessage) => {
	const c = (m as { content?: unknown }).content;
	if (typeof c === "string") return c;
	return Array.isArray(c) ? (c as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") : "";
};

export async function runEval(opts: { dryRun: boolean; maxUsd: number; maxTurns: number; personas?: Persona[]; log?: (s: string) => void }): Promise<ScenarioResult[]> {
	const log = opts.log ?? console.log;
	const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
	const { handleChatRequest } = await import("../../src/server/chat-handler.ts");
	const { runningTurn } = await import("../../src/server/turn-runs.ts");
	const { isTurnRunning } = await import("../../src/server/turn-liveness.ts");
	const { chatStore } = await import("../../src/store/chats.ts");
	const { sessionCost } = await import("../../src/server/pricing.ts");
	const { activeProblemOf, danglingQuestionOf } = await import("../../src/core/index.ts");
	const { toolQuestionKind } = await import("../../src/core/pending.ts");
	const { buildAnswer, normalizeOptions, normalizeQuizType, resolveCorrect } = await import("../../src/core/question-core.ts");
	const { createPracticeAgent, createTeacherAgent } = await import("../../src/agent/teacher-agent.ts");
	const chatsRoute = await import("../../app/api/chats/route.ts");

	// ── the dry-run tutor: one scripted reply per call, shaped by persona ──
	function dryEngine(persona: Persona): PiEngine {
		const faux = createFauxCore({});
		const quiz = { question: "For late-responding tissue ($\\alpha/\\beta \\approx 3$ Gy), which schedule gives higher BED at equal tumour BED?", options: [{ label: "Fewer, larger fractions" }, { label: "More, smaller fractions" }], correctAnswer: "Fewer, larger fractions", explanation: "BED = nd(1 + d/(α/β)).", type: "check", nodeId: "lq" };
		const pose = { statement: "60 Gy in 30 fractions vs 45 Gy in 15 fractions at $\\alpha/\\beta = 3$ Gy: which is harsher on late tissue, by how much BED?", mode: "recall", modelSolution: "BED_A = 60(1+2/3) = 100 Gy_3; BED_B = 45(1+3/3) = 90 Gy_3; A by 10." };
		const resume = "> **Resume point**\n> - **Established:** the d/(α/β) term.\n> - **Open question:** LQ above ~10 Gy/fx.\n> - **Next step:** compute the crossover dose.";
		// Context-driven, so it never runs out: a stop gets a resume point; a
		// practice submission gets a redirect, then a conclusion; teaching
		// opens with one quiz and otherwise asks one short question.
		let quizzed = false;
		let posed = 0;
		let hinted = false;
		const step = (ctx: { messages: unknown[] }): AssistantMessage => {
			const last = JSON.stringify(ctx.messages[ctx.messages.length - 1] ?? "");
			if (/stopping here/i.test(last)) return fauxAssistantMessage([fauxText(resume)]);
			if (persona === "practice") {
				if (/conclude/.test(last) && /toolResult/.test(last)) return fauxAssistantMessage([fauxText("Solved after one redirect.")]);
				if (/Final answer/.test(last)) return fauxAssistantMessage([fauxToolCall("conclude", { outcome: "solved", verdict: "Right.", rung: "R0", missClass: null, retest: false }, { id: `dry-c${posed}` })], { stopReason: "toolUse" });
				if (/divided total dose/.test(last) && !hinted) { hinted = true; return fauxAssistantMessage([fauxText("Not yet. Check the dose per fraction in each schedule before anything else.")]); }
				posed++;
				hinted = false;
				return fauxAssistantMessage([fauxToolCall("problem", pose, { id: `dry-p${posed}` })], { stopReason: "toolUse" });
			}
			if (!quizzed) { quizzed = true; return fauxAssistantMessage([fauxText("One check first."), fauxToolCall("quiz", quiz, { id: `dry-q-${persona}` })], { stopReason: "toolUse" }); }
			return fauxAssistantMessage([fauxText("Noted. What dose per fraction makes the two terms equal?")]);
		};
		const steps = Array.from({ length: 60 }, () => (ctx: { messages: unknown[] }) => step(ctx));
		faux.setResponses(steps as unknown as FauxResponseStep[]);
		return { model: faux.getModel(), streamFn: faux.streamSimple } as PiEngine;
	}

	async function createSession(persona: Persona): Promise<string> {
		const res = await chatsRoute.POST(new Request("http://eval/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Eval · ${persona}`, ...(persona === "practice" ? { kind: "practice" } : {}) }) }));
		const { id } = (await res.json()) as { id: string };
		if (opts.dryRun) chatStore.saveSettings(id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
		return id;
	}

	async function send(chatId: string, input: unknown, factory: Factory | undefined): Promise<void> {
		for (let i = 0; i < 600 && isTurnRunning(chatId); i++) await new Promise((r) => setTimeout(r, 100)); // a background wake turn may be running
		const ack = await handleChatRequest(new Request("http://eval/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, input }) }), factory);
		if (ack.status !== 200) throw new Error(`turn refused (${ack.status}): ${await ack.text()}`);
		const handle = runningTurn(chatId);
		if (handle) await new Response(handle.subscribe()).text();
	}

	/** The learner's answer to a pending question, by persona. */
	function answerFor(persona: Persona, call: { toolCallId: string; tool: string; input: unknown }, firstQuiz: boolean) {
		const kind = toolQuestionKind(call.tool);
		const input = call.input as { question?: string; options?: Array<{ label: string; value?: string }>; correctAnswer?: string; explanation?: string; type?: unknown; multiSelect?: boolean; details?: string };
		const options = normalizeOptions(input.options ?? []);
		const qd = { id: call.toolCallId, kind, questionType: kind === "quiz" ? normalizeQuizType(input.type) : undefined, question: input.question ?? "", context: input.details, mode: (kind === "explain" || options.length === 0 ? "text" : input.multiSelect ? "multi-select" : "single-select") as "text" | "single-select" | "multi-select", options, createdAt: new Date().toISOString() } as Parameters<typeof buildAnswer>[0];
		if (kind === "quiz") {
			// resolveCorrect's indices are 1-based display positions.
			const correct = resolveCorrect(input.correctAnswer ?? "", options).indices;
			qd.correctIndices = correct;
			qd.explanation = input.explanation;
			const wrong = options.findIndex((_, i) => !correct.includes(i + 1)) + 1;
			const pickWrong = persona === "misconception" && firstQuiz && wrong > 0;
			const picks = pickWrong ? [wrong] : correct.length ? correct : [1];
			return buildAnswer(qd, { values: picks.map((n) => options[n - 1]!.value), confidence: pickWrong ? 95 : 80, thinking: pickWrong ? MISCONCEPTION : "Working it through from what we set up: the term that grows with dose per fraction decides it." }, call.tool);
		}
		if (kind === "explain") {
			qd.committedAnswer = input.correctAnswer;
			const text = persona === "misconception" && firstQuiz ? MISCONCEPTION : `In my own words: ${(input.correctAnswer ?? "I'm not sure").slice(0, 300)}`;
			return buildAnswer(qd, { text }, call.tool);
		}
		// ask_user_question: take the first option (the tool lists a recommendation first), else plain text.
		return options.length ? buildAnswer(qd, { values: [options[0]!.value] }, call.tool) : buildAnswer(qd, { text: "Your call — go with what you recommend." }, call.tool);
	}

	const personas = opts.personas ?? (["correct", "misconception", "interruption", "practice"] as Persona[]);
	const results: ScenarioResult[] = [];
	let spent = 0;
	for (const persona of personas) {
		const chatId = await createSession(persona);
		const engine = opts.dryRun ? dryEngine(persona) : undefined;
		const factory: Factory | undefined = engine
			? (o) => (persona === "practice" ? createPracticeAgent({ chatId, chatStore }, { ...o, engine }) : createTeacherAgent(undefined, { ...o, engine }))
			: undefined;
		const costNow = () => sessionCost(chatStore.getChat(chatId)!);
		let learnerTurns = 0;
		let stoppedBy: ScenarioResult["stoppedBy"] = "script";
		let firstQuiz = true;
		let practiceAttempts = 0;
		let problemsDone = 0;
		const revealLeaks: string[] = [];
		const script: unknown[] = [{ type: "text", text: OPENERS[persona] }];
		const stopAt = persona === "interruption" ? 3 : Math.max(2, opts.maxTurns - 1);
		// learning → (STOP sent) stopped → [interruption only: "Back." sent] resumed → (STOP again) final
		let phase: "learning" | "stopped" | "resumed" | "final" = "learning";

		while (true) {
			const next = script.shift();
			if (next === undefined) break;
			if (learnerTurns >= opts.maxTurns && phase === "learning") { stoppedBy = "turn-cap"; break; }
			if (!opts.dryRun && spent + costNow().cost > opts.maxUsd) { stoppedBy = "budget"; break; }
			await send(chatId, next, factory);
			learnerTurns++;
			const msgs = chatStore.getChat(chatId)!.messages;

			if (phase === "stopped") {
				if (persona !== "interruption") break;
				phase = "resumed";
				script.push({ type: "text", text: "Back. Continue." });
				continue;
			}
			if (phase === "resumed") { phase = "final"; script.push({ type: "text", text: STOP }); continue; }
			if (phase === "final") break;
			if (learnerTurns >= stopAt) { phase = "stopped"; script.push({ type: "text", text: STOP }); continue; }

			const pending = danglingQuestionOf(msgs);
			const problem = activeProblemOf(msgs);
			if (pending) {
				script.push({ type: "answer", toolCallId: pending.toolCallId, answer: answerFor(persona, pending, firstQuiz) });
				if (toolQuestionKind(pending.tool) !== "ask") firstQuiz = false;
			} else if (problem) {
				const pose = problem.input as { statement?: string; modelSolution?: string };
				if (practiceAttempts === 0) {
					practiceAttempts++;
					script.push({ type: "thinking", problemCallId: problem.toolCallId, text: "I just divided total dose by fractions and compared: 60 > 45 so A, by 15." });
				} else {
					// After a wrong attempt: did the reply hand over solution numbers?
					const reply = msgs.filter((m) => m.role === "assistant").slice(-1).map(textOf).join("\n");
					revealLeaks.push(...revealedSolutionNumbers(pose.statement ?? "", pose.modelSolution ?? "", reply));
					script.push({ type: "thinking", problemCallId: problem.toolCallId, text: `Final answer: ${pose.modelSolution ?? "done"}` });
				}
			} else if (persona === "practice") {
				problemsDone++;
				practiceAttempts = 0;
				if (problemsDone >= 2) { phase = "stopped"; script.push({ type: "text", text: STOP }); } else script.push({ type: "next" });
			} else {
				script.push({ type: "text", text: "Makes sense. Keep going." });
			}
		}
		if (script.length && stoppedBy === "script") stoppedBy = "stuck";
		// Dry runs price scripted tokens at the stamped model's rates — fiction.
		const priced = opts.dryRun ? { cost: 0, unpriced: 0 } : costNow();
		spent += priced.cost;
		const report = checkTranscript(chatStore.getChat(chatId)!.messages);
		results.push({ persona, chatId, learnerTurns, costUsd: priced.cost, unpricedTurns: priced.unpriced, report, revealLeaks: [...new Set(revealLeaks)], stoppedBy });
		log(`${persona}: ${learnerTurns} learner turns, $${priced.cost.toFixed(4)}${priced.unpriced ? ` (+${priced.unpriced} unpriced)` : ""}, ${report.findings.length} finding(s), stopped by ${stoppedBy}`);
		if (spent > opts.maxUsd) { log(`Budget cap $${opts.maxUsd} reached — remaining personas skipped.`); break; }
	}
	return results;
}

export function renderReport(results: ScenarioResult[], mode: string): string {
	const lines = [`# Live eval — ${new Date().toISOString()} (${mode})`, "", "| Persona | Learner turns | Cost | Median words/turn | Resume point on stop | Findings | Practice reveal leaks | Stopped by |", "|---|---|---|---|---|---|---|---|"];
	for (const r of results) {
		const resume = r.report.resumePointRequired ? (r.report.resumePointPresent ? "present" : "**missing**") : "n/a";
		lines.push(`| ${r.persona} | ${r.learnerTurns} | $${r.costUsd.toFixed(4)}${r.unpricedTurns ? ` +${r.unpricedTurns} unpriced` : ""} | ${r.report.medianWords} | ${resume} | ${r.report.findings.map((f) => `${f.rule} (t${f.turn})`).join(", ") || "none"} | ${r.revealLeaks.join(", ") || "none"} | ${r.stoppedBy} |`);
	}
	lines.push("", "Findings are pattern screens: read the session (`check-session.ts <chatId>`) before trusting any of them. Session ids: " + results.map((r) => `${r.persona}=\`${r.chatId}\``).join(", ") + ".");
	return lines.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const flag = (name: string, fallback: number) => {
		const i = args.indexOf(name);
		const v = i >= 0 ? Number(args[i + 1]) : fallback;
		return Number.isFinite(v) && v > 0 ? v : fallback;
	};
	const dryRun = args.includes("--dry-run");
	if (!dryRun && !args.includes("--confirm-spend")) {
		console.error("Refusing: a live eval calls your configured model and may cost money.\n  Free rehearsal:  npx tsx hayden/evals/live-eval.ts --dry-run\n  Real run:        npx tsx hayden/evals/live-eval.ts --confirm-spend [--max-usd 0.50] [--max-turns 8]");
		process.exit(2);
	}
	if (dryRun) process.env.OPENROUTER_API_KEY ??= "dry-run-key-presence-only";
	const maxUsd = flag("--max-usd", 0.5);
	const maxTurns = flag("--max-turns", 8);
	const results = await runEval({ dryRun, maxUsd, maxTurns });
	const report = renderReport(results, dryRun ? "dry run, scripted tutor" : `live, cap $${maxUsd}`);
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "live-results");
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}${dryRun ? "-dry" : ""}.md`);
	fs.writeFileSync(file, report);
	console.log(`\n${report}\nWritten to ${file}`);
	process.exit(0);
}
