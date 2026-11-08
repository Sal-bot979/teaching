/**
 * Hayden fork — synthetic scenarios through the REAL request path
 * (handleChatRequest → settings → agent build → model request), zero
 * tokens: a scripted faux model plays the tutor, so these prove the
 * PLUMBING — the profile reaches the model in every phase, the learner's
 * signals (thinking, confidence, verdict) reach it, sessions resume from
 * disk, the practice commitment stays hidden until conclude — never that a
 * live model follows the profile. All content is synthetic, non-patient.
 *
 *   S1 correct explanation      (teacher, quiz check, own-words thinking)
 *   S2 confident misconception  (wrong answer at 95% confidence)
 *   S3 interruption + resume    (stop → resume point → fresh process reload)
 *   S4 transfer problem         (practice, changed surface, hidden solution)
 *   S0 profile OFF control      (same path, upstream prompt)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { AssistantMessage, FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-hayden-scenarios-"));
process.env.LH_DATA_DIR = TMP_DATA;
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
const { createPracticeAgent, createProberAgent, createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { jobStore } = await import("../src/store/jobs.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { activeProblemOf } = await import("../src/core/index.ts");
const { projectView } = await import("../src/core/view.ts");
const { buildAnswer, normalizeOptions, resolveCorrect } = await import("../src/core/question-core.ts");
const profile = await import("../hayden/profile.ts");
const { checkTranscript } = await import("../hayden/evals/transcript-checks.ts");

type PiEngine = import("../src/agent/models.ts").PiEngine;
type Factory = Parameters<typeof handleChatRequest>[1];

const GOLDEN = path.join(import.meta.dirname, "..", "hayden", "evals", "golden");
const PROFILE_MARK = "## Learner profile";

/** A scripted model that records the system prompt + transcript of every request. */
function scripted(steps: Array<(ctx: TranscriptContext) => AssistantMessage>) {
	const seen: Array<{ systemPrompt: string; transcript: string }> = [];
	const faux = createFauxCore({});
	faux.setResponses(
		steps.map((step): FauxResponseStep => async (context: TranscriptContext) => {
			// pi folds the system prompt into a leading system message.
			const sys = (context.messages as Array<{ role: string; content: unknown }>).find((m) => m.role === "system")?.content;
			const system = typeof sys === "string" ? sys
				: Array.isArray(sys) ? (sys as Array<{ text?: string }>).map((b) => b.text ?? "").join("")
				: ((context as { systemPrompt?: string }).systemPrompt ?? "");
			seen.push({ systemPrompt: system, transcript: JSON.stringify(context.messages) });
			return step(context);
		}),
	);
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple } as PiEngine, seen };
}

/** The handler hands its real build options (incl. promptSwitches from
 *  settings.json); the test only swaps in the scripted engine. */
const teacherFactory = (engine: PiEngine): Factory => (opts) => createTeacherAgent(undefined, { ...opts, engine });
const practiceFactory = (chatId: string, engine: PiEngine): Factory => (opts) =>
	createPracticeAgent({ chatId, chatStore }, { ...opts, engine });

function post(chatId: string, input: unknown): Request {
	return new Request("http://test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, input }) });
}

async function turn(chatId: string, input: unknown, factory: Factory): Promise<void> {
	const ack = await handleChatRequest(post(chatId, input), factory);
	assert.equal(ack.status, 200, await ack.clone().text());
	const handle = runningTurn(chatId);
	if (handle) await new Response(handle.subscribe()).text();
}

function newChat(title: string, kind?: "practice") {
	const chat = kind ? chatStore.createChat(title, kind) : chatStore.createChat(title);
	chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	return chat;
}

const LQ_CHECK = {
	question: "Two schedules give the same tumour BED. For late-responding tissue ($\\alpha/\\beta \\approx 3$ Gy), which delivers the higher BED?",
	options: [{ label: "Fewer, larger fractions" }, { label: "More, smaller fractions" }, { label: "They are equal" }],
	correctAnswer: "Fewer, larger fractions",
	explanation: "BED = nd(1 + d/(α/β)); the quadratic term grows with d, and grows fastest where α/β is small.",
	type: "check",
	nodeId: "lq-fractionation",
};

function answer(values: string[], confidence: number, thinking: string) {
	const options = normalizeOptions(LQ_CHECK.options);
	return buildAnswer(
		{ id: "q", kind: "quiz", question: LQ_CHECK.question, mode: "single-select", options, correctIndices: resolveCorrect(LQ_CHECK.correctAnswer, options).indices, explanation: LQ_CHECK.explanation, createdAt: new Date().toISOString() },
		{ values, confidence, thinking },
	);
}

const upstreamTeacher = () =>
	fs.readFileSync(path.join(GOLDEN, "upstream-teacher.txt"), "utf-8")
		.replace("Paths resolve against his home directory.", "Paths resolve against his study folder; nothing outside it is reachable — if a file isn't there, ask him to put it there.")
		.replace("find/ls/grep/read, home-anchored", "find/ls/grep/read, anchored to his study folder");

describe("Hayden scenarios (scripted model, real request path)", () => {
	it("S0 control — profile OFF: the teacher's real request carries the upstream prompt", async () => {
		profile.disableProfile();
		const chat = newChat("S0 control");
		const { engine, seen } = scripted([() => fauxAssistantMessage([fauxText("Where do you want to start?")])]);
		await turn(chat.id, { type: "text", text: "LQ model" }, teacherFactory(engine));
		assert.equal(seen[0]!.systemPrompt, upstreamTeacher());
		assert.ok(!seen[0]!.systemPrompt.includes(PROFILE_MARK));
	});

	it("S0b prober — a fresh teaching session builds the PROBER through the handler, and it carries the profile", async () => {
		profile.enableProfile();
		const chat = newChat("S0b prober");
		const { engine, seen } = scripted([() => fauxAssistantMessage([fauxText("What do you want to be able to do with the LQ model?")])]);
		let built: string | undefined;
		const factory: Factory = (opts) => {
			built = opts.teaching ? "teacher" : "prober";
			return opts.teaching
				? createTeacherAgent(undefined, { ...opts, engine })
				: createProberAgent({ chatId: chat.id, chatStore, deliver: () => {}, jobStore, spawn: () => {} }, { ...opts, engine });
		};
		await turn(chat.id, { type: "text", text: "LQ model" }, factory);
		assert.equal(built, "prober", "the handler asked for the probe phase");
		assert.ok(seen[0]!.systemPrompt.startsWith("# The agent"), "shared base first");
		assert.ok(seen[0]!.systemPrompt.includes("# The probe"), "probe doctrine present");
		assert.ok(seen[0]!.systemPrompt.endsWith(profile.PROFILE_TEXT.trim()), "profile appended last");
	});

	it("S1 correct explanation — the profile and the learner's own-words reasoning both reach the model", async () => {
		profile.enableProfile();
		const chat = newChat("S1 correct");
		const { engine, seen } = scripted([
			() => fauxAssistantMessage([fauxToolCall("quiz", LQ_CHECK, { id: "call-s1" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("Correct, and the reason you gave is the load-bearing one. Next: what happens to that argument at 20 Gy per fraction?")]),
		]);
		await turn(chat.id, { type: "text", text: "Normal session (~25 min). Goal: why fractionation spares late-responding tissue." }, teacherFactory(engine));
		await turn(chat.id, { type: "answer", toolCallId: "call-s1", answer: answer(["Fewer, larger fractions"], 90, "The d/(α/β) term is bigger when α/β is small, so big fractions hurt late tissue more.") }, teacherFactory(engine));
		for (const s of seen) assert.equal(s.systemPrompt, upstreamTeacher() + "\n\n---\n\n" + profile.PROFILE_TEXT.trim(), "profile appended to the real request");
		assert.ok(seen[1]!.transcript.includes("d/(α/β) term is bigger"), "the learner's own-words thinking reached the model");
		assert.ok(seen[1]!.transcript.includes('\\"correct\\":true'), "the verdict reached the model");
		assert.deepEqual(checkTranscript(chatStore.getChat(chat.id)!.messages).findings, []);
	});

	it("S2 confident misconception — wrong at 95% confidence reaches the model as the strongest signal", async () => {
		const chat = newChat("S2 misconception");
		const { engine, seen } = scripted([
			() => fauxAssistantMessage([fauxToolCall("quiz", LQ_CHECK, { id: "call-s2" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("That's a misconception: α/β is not a tolerance dose. It is the dose at which the linear and quadratic kill terms are equal. Before going on — what does $\\alpha d = \\beta d^2$ give you?")]),
		]);
		await turn(chat.id, { type: "text", text: "LQ model, short session" }, teacherFactory(engine));
		await turn(chat.id, { type: "answer", toolCallId: "call-s2", answer: answer(["More, smaller fractions"], 95, "α/β is the tolerance dose, so a high α/β tissue is more fragile.") }, teacherFactory(engine));
		const t = seen[1]!.transcript;
		assert.ok(t.includes('\\"correct\\":false'), "verdict: wrong");
		assert.ok(t.includes('\\"confidence\\":95'), "confidence: 95");
		assert.ok(t.includes("tolerance dose"), "the misconception's wording reached the model");
		assert.ok(seen[1]!.systemPrompt.includes("Confidently wrong is the most valuable signal"));
		assert.ok(seen[1]!.systemPrompt.includes("Wrong + high confidence"), "upstream confidence doctrine still present");
	});

	it("S3 interruption — stop yields a resume point; a fresh request rebuilt from disk carries it forward", async () => {
		const chat = newChat("S3 interruption");
		const resume = "> **Resume point**\n> - **Established:** you derived why large fractions raise late-tissue BED.\n> - **Open question:** whether LQ holds above ~10 Gy per fraction.\n> - **Next step:** compare 60 Gy/30 fx with 45 Gy/15 fx at α/β = 3.";
		const first = scripted([() => fauxAssistantMessage([fauxText(resume)])]);
		await turn(chat.id, { type: "text", text: "Need to go — stopping here." }, teacherFactory(first.engine));
		const report = checkTranscript(chatStore.getChat(chat.id)!.messages);
		assert.equal(report.resumePointRequired, true);
		assert.equal(report.resumePointPresent, true);
		assert.deepEqual(report.findings, []);
		// A new engine + factory: nothing in memory survives but the record.
		const second = scripted([() => fauxAssistantMessage([fauxText("Picking up at the open question.")])]);
		await turn(chat.id, { type: "text", text: "Back. Continue." }, teacherFactory(second.engine));
		assert.ok(second.seen[0]!.transcript.includes("Open question"), "the resume point is in the reloaded transcript");
		assert.ok(second.seen[0]!.transcript.includes("Need to go"), "the full session history reloaded");
	});

	it("S3b the checker catches a stop WITHOUT a resume point (the rule has teeth)", async () => {
		const chat = newChat("S3b no resume");
		const { engine } = scripted([() => fauxAssistantMessage([fauxText("Great question! See you next time.")])]);
		await turn(chat.id, { type: "text", text: "gotta go" }, teacherFactory(engine));
		const rules = checkTranscript(chatStore.getChat(chat.id)!.messages).findings.map((f) => f.rule).sort();
		assert.deepEqual(rules, ["no-performed-praise", "resume-point-on-stop"]);
	});

	it("S4 transfer problem — practice gets doctrine + profile; the committed solution stays hidden until conclude", async () => {
		const chat = newChat("S4 transfer", "practice");
		const POSE = {
			statement: "Schedule A: 60 Gy in 30 fractions. Schedule B: 45 Gy in 15 fractions. Using $\\alpha/\\beta = 3$ Gy for late effects, which schedule is harsher on late-responding tissue, by how much BED?",
			mode: "recall",
			modelSolution: "BED_A = 60(1 + 2/3) = 100 Gy_3; BED_B = 45(1 + 3/3) = 90 Gy_3. A is harsher by 10 Gy_3.",
		};
		const { engine, seen } = scripted([
			() => fauxAssistantMessage([fauxToolCall("problem", POSE, { id: "call-s4" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxToolCall("conclude", { outcome: "solved", verdict: "Both BEDs computed correctly.", rung: null, missClass: null, retest: false }, { id: "call-c4" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("Solved without hints; the d/(α/β) term carried it.")]),
		]);
		await turn(chat.id, { type: "text", text: "Practice: LQ, changed surface please" }, practiceFactory(chat.id, engine));
		const system = seen[0]!.systemPrompt;
		assert.ok(system.includes("# The practice session"), "practice doctrine present");
		assert.ok(system.includes(PROFILE_MARK), "profile reached the practice agent's real request");
		assert.ok(system.indexOf("# The practice session") < system.indexOf(PROFILE_MARK), "profile appended after the doctrine");
		// Before conclude: active, and the projected view carries no reveal.
		const live = chatStore.getChat(chat.id)!.messages;
		assert.equal(activeProblemOf(live)?.toolCallId, "call-s4");
		assert.ok(!JSON.stringify(projectView(live).flatMap((m) => m.parts.map((p) => (p as { reveal?: unknown }).reveal))).includes("100 Gy_3"), "no reveal before conclude");
		await turn(chat.id, { type: "thinking", problemCallId: "call-s4", text: "A: 2 Gy/fx → 60·(5/3)=100. B: 3 Gy/fx → 45·2=90. A by 10." }, practiceFactory(chat.id, engine));
		const done = chatStore.getChat(chat.id)!.messages;
		assert.equal(activeProblemOf(done), null);
		const reveals = projectView(done).flatMap((m) => m.parts.map((p) => (p as { reveal?: string }).reveal)).filter(Boolean);
		assert.deepEqual(reveals, [POSE.modelSolution], "the reveal is exactly the committed solution, after conclude");
	});
});
