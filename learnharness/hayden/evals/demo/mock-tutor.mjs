// A scripted stand-in for an AI provider, for recording a UI demo with no
// model and no spend. It speaks the OpenAI-compatible chat-completions API
// (the app's "custom endpoint" provider) and streams scripted replies word
// by word. The tutor text is written by hand to illustrate the learner
// profile; it is NOT live model output. Every other part of the app — the
// handler, tools, validation, persistence, UI — runs for real.
//   node hayden/evals/demo/mock-tutor.mjs [port]
import http from "node:http";

const PORT = Number(process.argv[2] ?? 4100);
const MODEL = "tutor-sim";

const PROBE = {
	question: "Without the formula: if you split a fixed total dose into more, smaller fractions, what happens to cell kill in the tumour?",
	options: [{ label: "Kill falls — sparing grows with fraction number" }, { label: "Kill is unchanged — only total dose matters" }, { label: "Kill rises — more fractions, more hits" }],
	correctAnswer: "Kill falls — sparing grows with fraction number",
	explanation: "Sublethal damage repairs between fractions, so each extra split removes some of the quadratic (two-hit) kill.",
};
const PROBE_DONE = {
	assessment: {
		strands: [
			{ strand: "Cell survival and repair", assessment: "Floor: knows sublethal repair spares cells between fractions. Ceiling: not yet tied to the quadratic term. Build from repair." },
			{ strand: "α/β as a quantity", assessment: "Untested directly; the lesson's centre. Watch for the 'tolerance dose' misconception." },
		],
		summary: "Goal: why fractionation spares late-responding tissue. Enter at the survival curve; go to α/β and BED.",
	},
};
const MAP = `graph TD
  survival["Cell survival: S = exp(−αd − βd²)"] --> repair["Repair between fractions"]
  repair --> bed["BED = nd(1 + d/(α/β))"]
  survival --> ab["α/β: where the two kill terms are equal"]
  ab --> sensitivity["Fraction-size sensitivity"]
  bed --> sensitivity
  sensitivity --> goal["Why fractionation spares late tissue"]`;
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
const POSE = {
	statement: "Schedule A: 60 Gy in 30 fractions. Schedule B: 45 Gy in 15 fractions. Using $\\alpha/\\beta = 3$ Gy for late effects, which schedule is harsher on late-responding tissue, and by how much BED?",
	mode: "recall",
	modelSolution: "$\\text{BED}_A = 60(1 + 2/3) = 100\\ \\text{Gy}_3$; $\\text{BED}_B = 45(1 + 3/3) = 90\\ \\text{Gy}_3$. A is harsher by $10\\ \\text{Gy}_3$.",
};

const TEACH = "You predicted A — right, and here is why it *had* to be A.\n\nPer fraction, $-\\ln S = \\alpha d + \\beta d^2 = \\alpha d\\left(1 + \\frac{d}{\\alpha/\\beta}\\right)$. Over $n$ fractions:\n\n$$\\text{BED} = nd\\left(1 + \\frac{d}{\\alpha/\\beta}\\right)$$\n\n> [!IMPORTANT]\n> The only place fraction size enters is $d/(\\alpha/\\beta)$. A small $\\alpha/\\beta$ makes that term large — so low-α/β (late) tissue is the one punished by big fractions.\n\n**Kind of claim:** LQ is an empirical, mechanistically motivated model, not a law. Units: BED in Gy, written Gy₃ for $\\alpha/\\beta = 3$. Assumes full repair between fractions and no repopulation.";
const RESUME = "> **Resume point**\n> - **Established:** you derived why larger fractions raise late-tissue BED (the $d/(\\alpha/\\beta)$ term) and applied it to a changed schedule.\n> - **Open question:** whether LQ still holds above ~8–10 Gy per fraction.\n> - **Next step:** work out the dose per fraction where the linear and quadratic terms are equal for $\\alpha/\\beta = 3$ Gy.";

/** Decide the tutor's next move from the conversation the app sent. */
function reply(body) {
	const tools = new Set((body.tools ?? []).map((t) => t.function?.name));
	const msgs = body.messages ?? [];
	const calls = msgs.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((c) => c.function?.name) : []));
	const last = msgs[msgs.length - 1] ?? {};
	const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
	const lastToolName = last.role === "tool" ? [...msgs].reverse().find((m) => m.role === "assistant" && (m.tool_calls ?? []).some((c) => c.id === last.tool_call_id))?.tool_calls.find((c) => c.id === last.tool_call_id)?.function?.name : undefined;
	const n = (name) => calls.filter((c) => c === name).length;
	const stopping = last.role === "user" && /stopping here|need to go/i.test(lastText);

	if (stopping) return { text: RESUME };
	if (tools.has("problem")) {
		if (lastToolName === "conclude") return { text: "Solved after one redirect. The load-bearing move was computing the dose per fraction first. Ready for the next one when you are." };
		if (lastToolName === "problem") return { text: "" };
		if (/\[NEXT PROBLEM\]/.test(lastText) || n("problem") === 0) return { text: "", call: ["problem", POSE] };
		if (/final answer/i.test(lastText)) return { call: ["conclude", { outcome: "solved", verdict: "Both BEDs right after one redirect: the dose per fraction was the move.", rung: "R0", missClass: "cue", retest: false }] };
		if (/your thinking/i.test(lastText)) return { text: "Not yet. Before comparing totals, look at what changes per fraction in each schedule. Which quantity in BED does that feed?" };
		return { text: "Go ahead when you're ready." };
	}
	if (tools.has("probe_done")) {
		if (n("probe") === 0) return { text: "Measuring where you stand first — one question.", call: ["probe", PROBE] };
		if (n("probe_done") === 0) return { call: ["probe_done", PROBE_DONE] };
		return { text: "Probe done — handing over to planning." };
	}
	if (tools.has("plan_init")) {
		if (n("plan_init") === 0) return { call: ["plan_init", { mermaid: MAP }] };
		if (lastToolName === "plan_init") return { text: "**Approach.** You already hold repair between fractions, so we start from the survival curve and derive α/β and BED from it, one step at a time, ending at why late tissue is spared. The map is the whole route. Good to go?" };
		if (n("quiz") === 0) return { call: ["quiz", PREDICT] };
		if (n("quiz") === 1 && lastToolName === "quiz") return { text: TEACH, call: ["quiz", CHECK] };
		if (n("quiz") === 2 && lastToolName === "quiz") return { text: "Correct — and the load-bearing move was computing $d/(\\alpha/\\beta)$ first. Next on the map: whether LQ still holds at large doses per fraction. What would you expect to break first?" };
		return { text: "Noted. Say when you want to continue." };
	}
	return { text: "Ready." };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

async function stream(res, { text = "", call }) {
	res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
	const id = `chatcmpl-${++seq}`;
	const send = (delta, finish = null, extra = {}) =>
		res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
	send({ role: "assistant", content: "" });
	// Word-by-word, so the recording shows the reply arriving live.
	for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
		send({ content: piece });
		await sleep(18);
	}
	if (call) {
		await sleep(150);
		send({ tool_calls: [{ index: 0, id: `call_${seq}`, type: "function", function: { name: call[0], arguments: JSON.stringify(call[1]) } }] });
	}
	send({}, call ? "tool_calls" : "stop");
	res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: MODEL, choices: [], usage: { prompt_tokens: 1000, completion_tokens: Math.max(1, Math.round(text.length / 4)), total_tokens: 1000 } })}\n\n`);
	res.write("data: [DONE]\n\n");
	res.end();
}

http
	.createServer(async (req, res) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const raw = Buffer.concat(chunks).toString("utf-8");
		if (req.method === "GET" && req.url?.endsWith("/models")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
		}
		if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
			const body = JSON.parse(raw || "{}");
			const out = reply(body);
			console.log(`[mock] ${[...new Set((body.tools ?? []).map((t) => t.function?.name))].includes("problem") ? "practice" : (body.tools ?? []).some((t) => t.function?.name === "probe_done") ? "prober" : "teacher"} → ${out.call?.[0] ?? "text"}`);
			return stream(res, out);
		}
		res.writeHead(404);
		res.end();
	})
	.listen(PORT, "127.0.0.1", () => console.log(`mock tutor on http://127.0.0.1:${PORT}/v1`));
