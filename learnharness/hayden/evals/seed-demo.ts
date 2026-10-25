/**
 * Seed SCRIPTED demo sessions for screenshots — no model, no tokens.
 *   LH_DATA_DIR=/tmp/lh-demo npx tsx hayden/evals/seed-demo.ts
 * Drives the real chat handler with a scripted faux model (the same seam
 * the test suite uses), so the records are genuine app records. The tutor
 * text is written by hand to illustrate the profile; it is NOT live model
 * output. Refuses to run without an explicit LH_DATA_DIR.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

if (!process.env.LH_DATA_DIR) {
	console.error("Set LH_DATA_DIR to a throwaway directory first.");
	process.exit(2);
}
// The handler's key-presence gate only checks that a key EXISTS; the faux
// model never contacts a provider. Process-local, never written anywhere.
process.env.OPENROUTER_API_KEY ??= "demo-key-presence-only";

const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
const { createPracticeAgent, createTeacherAgent } = await import("../../src/agent/teacher-agent.ts");
const { handleChatRequest } = await import("../../src/server/chat-handler.ts");
const { runningTurn } = await import("../../src/server/turn-runs.ts");
const { chatStore } = await import("../../src/store/chats.ts");
const { buildAnswer, normalizeOptions, resolveCorrect } = await import("../../src/core/question-core.ts");
const { studyRoot } = await import("../../src/agent/tools/fs-shared.ts");
const profile = await import("../profile.ts");
type PiEngine = import("../../src/agent/models.ts").PiEngine;
type Factory = Parameters<typeof handleChatRequest>[1];

function engineOf(replies: Array<() => ReturnType<typeof fauxAssistantMessage>>): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(replies);
	return { model: faux.getModel(), streamFn: faux.streamSimple } as PiEngine;
}
async function turn(chatId: string, input: unknown, factory: Factory) {
	const ack = await handleChatRequest(new Request("http://seed/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, input }) }), factory);
	assert.equal(ack.status, 200, await ack.clone().text());
	const handle = runningTurn(chatId);
	if (handle) await new Response(handle.subscribe()).text();
}
function chat(title: string, kind?: "practice") {
	const c = kind ? chatStore.createChat(title, kind) : chatStore.createChat(title);
	chatStore.saveSettings(c.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	return c;
}

const CHECK = {
	question: "Two schedules give the same tumour BED. For late-responding tissue ($\\alpha/\\beta \\approx 3$ Gy), which delivers the higher BED?",
	options: [{ label: "Fewer, larger fractions" }, { label: "More, smaller fractions" }, { label: "They are equal" }],
	correctAnswer: "Fewer, larger fractions",
	explanation: "$\\text{BED} = nd\\left(1 + \\frac{d}{\\alpha/\\beta}\\right)$: the quadratic term grows with $d$, fastest where $\\alpha/\\beta$ is small.",
	type: "check",
	nodeId: "lq-fractionation",
};
const answer = (values: string[], confidence: number, thinking: string) => {
	const options = normalizeOptions(CHECK.options);
	return buildAnswer({ id: "q", kind: "quiz", question: CHECK.question, mode: "single-select", options, correctIndices: resolveCorrect(CHECK.correctAnswer, options).indices, explanation: CHECK.explanation, createdAt: new Date().toISOString() }, { values, confidence, thinking });
};
const teacher = (e: PiEngine): Factory => (opts) => createTeacherAgent(undefined, { ...opts, engine: e });

profile.enableProfile();
fs.mkdirSync(studyRoot(), { recursive: true });
fs.writeFileSync(path.join(studyRoot(), "README.txt"), "Put study materials (notes, PDFs) here. Learner-file tools cannot see anything outside this folder.\n");

// S2 — a confident misconception, repaired at the prerequisite.
{
	const c = chat("Demo · LQ model — confident misconception");
	const e = engineOf([
		() => fauxAssistantMessage([fauxText("Starting from the survival curve you already hold: $S = e^{-(\\alpha d + \\beta d^2)}$ per fraction. One check before we build on it."), fauxToolCall("quiz", CHECK, { id: "s2-q" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("Not right, and the confidence is what makes it worth fixing.\n\n**The misconception:** $\\alpha/\\beta$ is not a tolerance dose. It is the dose $d$ at which the linear and quadratic kill terms are equal: $\\alpha d = \\beta d^2 \\Rightarrow d = \\alpha/\\beta$.\n\n> [!IMPORTANT]\n> Low $\\alpha/\\beta$ means the quadratic term matters at clinical doses per fraction, so the tissue is *more* sensitive to fraction size, not less.\n\n**Status of the claim:** LQ is an empirical, mechanistically motivated model, not a physical law. Units: $\\alpha$ in Gy⁻¹, $\\beta$ in Gy⁻².\n\nYour turn: for $\\alpha/\\beta = 3$ Gy, at what dose per fraction do the two terms contribute equally?")]),
	]);
	await turn(c.id, { type: "text", text: "Short session (~10 min). Goal: what α/β actually means in the linear-quadratic model." }, teacher(e));
	await turn(c.id, { type: "answer", toolCallId: "s2-q", answer: answer(["More, smaller fractions"], 95, "α/β is the tolerance dose, so high α/β tissue tolerates less and smaller fractions hurt it more.") }, teacher(e));
}

// S3 — interruption with a resume point.
{
	const c = chat("Demo · LQ model — stopped mid-session");
	const e = engineOf([
		() => fauxAssistantMessage([fauxText("> **Resume point**\n> - **Established:** you derived why larger fractions raise late-tissue BED (the $d/(\\alpha/\\beta)$ term), in your own words.\n> - **Open question:** whether LQ still holds above ~8–10 Gy per fraction. You suspected not; that's unresolved.\n> - **Next step:** compare 50 Gy/25 fx with 40 Gy/10 fx at $\\alpha/\\beta = 3$ and $10$.")]),
	]);
	await turn(c.id, { type: "text", text: "Need to go — stopping here." }, teacher(e));
}

// S4 — a transfer problem in practice, solved and revealed.
{
	const c = chat("Demo · Practice — BED transfer problem", "practice");
	const f = (e: PiEngine): Factory => (opts) => createPracticeAgent({ chatId: c.id, chatStore }, { ...opts, engine: e });
	const e = engineOf([
		() => fauxAssistantMessage([fauxToolCall("problem", { statement: "Schedule A: 60 Gy in 30 fractions. Schedule B: 45 Gy in 15 fractions. Using $\\alpha/\\beta = 3$ Gy for late effects, which schedule is harsher on late-responding tissue, and by how much BED?", mode: "recall", modelSolution: "$\\text{BED}_A = 60(1 + 2/3) = 100\\ \\text{Gy}_3$; $\\text{BED}_B = 45(1 + 3/3) = 90\\ \\text{Gy}_3$. A is harsher by $10\\ \\text{Gy}_3$." }, { id: "s4-p" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxToolCall("conclude", { outcome: "solved", verdict: "Both BEDs right; you picked the per-fraction dose first, which is the move that carries it.", rung: null, missClass: null, retest: false }, { id: "s4-c" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("Solved with no hints. The load-bearing move was computing $d$ before anything else.")]),
	]);
	await turn(c.id, { type: "text", text: "Practice: LQ fractionation, new numbers please." }, f(e));
	await turn(c.id, { type: "thinking", problemCallId: "s4-p", text: "A: d = 2 → 60·(5/3) = 100. B: d = 3 → 45·2 = 90. A is harsher by 10 Gy₃." }, f(e));
}

console.log(`Seeded demo sessions into ${process.env.LH_DATA_DIR} (profile: ${JSON.stringify(profile.profileStatus())})`);
