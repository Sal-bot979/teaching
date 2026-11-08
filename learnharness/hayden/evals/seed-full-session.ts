/**
 * Seed ONE complete scripted teaching session — probe → probe_done → plan
 * map → predict → teach → check — through the real handler and the real
 * prober/teacher tools, for a UI walkthrough. No model, no tokens: a
 * scripted faux model plays the tutor; the text is written by hand to show
 * what the profile asks for, NOT live model output.
 *   LH_DATA_DIR=/tmp/lh-demo npx tsx hayden/evals/seed-full-session.ts
 */

import assert from "node:assert/strict";

if (!process.env.LH_DATA_DIR) {
	console.error("Set LH_DATA_DIR to a throwaway directory first.");
	process.exit(2);
}
process.env.OPENROUTER_API_KEY ??= "demo-key-presence-only";

const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
const { createProberAgent, createTeacherAgent } = await import("../../src/agent/teacher-agent.ts");
const { handleChatRequest } = await import("../../src/server/chat-handler.ts");
const { runningTurn } = await import("../../src/server/turn-runs.ts");
const { chatStore } = await import("../../src/store/chats.ts");
const { jobStore } = await import("../../src/store/jobs.ts");
const { buildAnswer, normalizeOptions, resolveCorrect } = await import("../../src/core/question-core.ts");
const profile = await import("../profile.ts");
type PiEngine = import("../../src/agent/models.ts").PiEngine;
type Factory = Parameters<typeof handleChatRequest>[1];

profile.enableProfile();
const chat = chatStore.createChat("Demo · LQ model — full session (probe → plan → teach)");
chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });

const PROBE = {
	question: "Without the formula: if you split a fixed total dose into more, smaller fractions, what happens to cell kill in the tumour?",
	options: [{ label: "Kill falls — sparing grows with fraction number" }, { label: "Kill is unchanged — only total dose matters" }, { label: "Kill rises — more fractions, more hits" }],
	correctAnswer: "Kill falls — sparing grows with fraction number",
	explanation: "Sublethal damage repairs between fractions, so each extra split removes some of the quadratic (two-hit) kill.",
};
const PREDICT = {
	question: "Predict before we derive it: tissue A has $\\alpha/\\beta = 3$ Gy, tissue B has $\\alpha/\\beta = 10$ Gy. Going from 2 Gy to 4 Gy per fraction at equal total dose — which tissue's effect rises more?",
	options: [{ label: "A (low α/β)" }, { label: "B (high α/β)" }, { label: "Both rise equally" }],
	correctAnswer: "A (low α/β)",
	explanation: "The fraction-size term is $d/(\\alpha/\\beta)$: the smaller $\\alpha/\\beta$, the more a larger $d$ matters.",
	type: "predict",
	nodeId: "sensitivity",
};
const CHECK = {
	question: "Changed surface: a schedule moves from 30 × 2 Gy to 20 × 3 Gy. For late tissue ($\\alpha/\\beta = 3$ Gy), what happens to BED?",
	options: [{ label: "Rises from 100 to 120 Gy₃" }, { label: "Stays at 100 Gy₃ — same total dose" }, { label: "Falls from 100 to 80 Gy₃" }],
	correctAnswer: "Rises from 100 to 120 Gy₃",
	explanation: "$30 \\cdot 2(1 + 2/3) = 100$; $20 \\cdot 3(1 + 3/3) = 120$ Gy₃.",
	type: "check",
	nodeId: "bed",
};
const MAP = `graph TD
  survival["Cell survival: S = exp(−αd − βd²)"] --> repair["Repair between fractions"]
  repair --> bed["BED = nd(1 + d/(α/β))"]
  survival --> ab["α/β: where the two kill terms are equal"]
  ab --> sensitivity["Fraction-size sensitivity"]
  bed --> sensitivity
  sensitivity --> goal["Why fractionation spares late tissue"]`;

const answer = (q: typeof PROBE, id: string, value: string, confidence: number, thinking: string) => {
	const options = normalizeOptions(q.options);
	return buildAnswer({ id, kind: "quiz", question: q.question, mode: "single-select", options, correctIndices: resolveCorrect(q.correctAnswer, options).indices, explanation: q.explanation, createdAt: new Date().toISOString() }, { values: [value], confidence, thinking });
};

const replies = [
	// ── prober ──
	() => fauxAssistantMessage([fauxText("Measuring where you stand first — one question."), fauxToolCall("probe", PROBE, { id: "p-1" })], { stopReason: "toolUse" }),
	() => fauxAssistantMessage([fauxToolCall("probe_done", { assessment: { strands: [{ strand: "Cell survival and repair", assessment: "Floor: knows sublethal repair spares cells between fractions (answered at 90%). Ceiling: not yet tied to the quadratic term. Build from repair." }, { strand: "α/β as a quantity", assessment: "Untested directly; treat as the lesson's centre. Watch for the 'tolerance dose' misconception." }], summary: "Goal: why fractionation spares late-responding tissue. Enter at the survival curve; go to α/β and BED." } }, { id: "pd-1" })], { stopReason: "toolUse" }),
	() => fauxAssistantMessage([fauxText("Probe done.")]),
	// ── teacher ──
	() => fauxAssistantMessage([fauxToolCall("plan_init", { mermaid: MAP }, { id: "plan-1" })], { stopReason: "toolUse" }),
	() => fauxAssistantMessage([fauxText("**Approach.** You already hold repair between fractions, so we start from the survival curve you accept and derive α/β and BED from it, one step at a time, ending at why late tissue is spared. The map beside this message is the whole route. Good to go?")]),
	() => fauxAssistantMessage([fauxToolCall("quiz", PREDICT, { id: "q-predict" })], { stopReason: "toolUse" }),
	() => fauxAssistantMessage([
		fauxText("You predicted A — right, and here is why it *had* to be A.\n\nPer fraction, $-\\ln S = \\alpha d + \\beta d^2 = \\alpha d\\left(1 + \\frac{d}{\\alpha/\\beta}\\right)$. Over $n$ fractions, the effect per unit $\\alpha$ is\n\n$$\\text{BED} = nd\\left(1 + \\frac{d}{\\alpha/\\beta}\\right)$$\n\n> [!IMPORTANT]\n> The only place fraction size enters is $d/(\\alpha/\\beta)$. A small $\\alpha/\\beta$ makes that term large — so low-α/β (late) tissue is the one punished by big fractions.\n\n**Kind of claim:** LQ is an empirical, mechanistically motivated model, not a law. Units: BED in Gy, written Gy₃ for $\\alpha/\\beta = 3$. It assumes full repair between fractions and no repopulation."),
		fauxToolCall("quiz", CHECK, { id: "q-check" }),
	], { stopReason: "toolUse" }),
	() => fauxAssistantMessage([fauxText("Correct, and the load-bearing move was computing $d/(\\alpha/\\beta)$ first. Next on the map: whether LQ still holds at large doses per fraction — what would you expect to break first?")]),
];
const faux = createFauxCore({});
faux.setResponses(replies);
const engine = { model: faux.getModel(), streamFn: faux.streamSimple } as PiEngine;
const ctx = { chatId: chat.id, chatStore, deliver: () => {}, jobStore, spawn: () => {}, searchAvailable: () => false };
const factory: Factory = (opts) => (opts.teaching ? createTeacherAgent(ctx, { ...opts, engine }) : createProberAgent(ctx, { ...opts, engine }));

async function turn(input: unknown) {
	const ack = await handleChatRequest(new Request("http://seed/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat.id, input }) }), factory);
	assert.equal(ack.status, 200, await ack.clone().text());
	const handle = runningTurn(chat.id);
	if (handle) await new Response(handle.subscribe()).text();
}

await turn({ type: "text", text: "Normal session (~25 min). Goal: why fractionation spares late-responding tissue relative to tumour under the LQ model." });
await turn({ type: "answer", toolCallId: "p-1", answer: answer(PROBE, "p-1", "Kill falls — sparing grows with fraction number", 90, "Cells repair sublethal damage between fractions, so splitting gives them time to repair.") });
await turn({ type: "text", text: "Ready." });
await turn({ type: "text", text: "Looks good, go." });
await turn({ type: "answer", toolCallId: "q-predict", answer: answer(PREDICT, "q-predict", "A (low α/β)", 70, "Low α/β means the quadratic term matters earlier, so bigger fractions hit A harder.") });
await turn({ type: "answer", toolCallId: "q-check", answer: answer(CHECK, "q-check", "Rises from 100 to 120 Gy₃", 85, "d/(α/β) goes from 2/3 to 1, so BED goes 60·5/3=100 → 60·2=120.") });

console.log(`Seeded full session ${chat.id}`);
process.exit(0);
