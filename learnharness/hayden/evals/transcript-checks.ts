/**
 * Rule checks for a learning-session transcript — the Hayden profile's
 * observable promises, scored from the saved record, not from opinion.
 *
 * Pure functions over the persisted message list (LhMessage[]), so the
 * same checks score scripted fixtures (tests/hayden-scenarios.test.ts) and
 * real sessions (check-session.ts). They detect VIOLATIONS of rules a
 * transcript can show; passing them is necessary, not sufficient, for
 * good teaching — learning itself is measured by the retention protocol.
 */

import type { LhMessage } from "../../src/core/native-messages.ts";

/** Every tool whose call asks the learner something and ends the turn. */
const ASKING_TOOLS = new Set(["quiz", "probe", "ask_user_question", "explain", "recall", "problem"]);
const PRAISE = /\b(great question|excellent|awesome|amazing|fantastic|well done|good job|brilliant|perfect!)/i;
const STOP_INTENT = /\b(stop(ping)?|pause|done for (now|today)|need to go|gotta go|have to go|that'?s all for (now|today))\b/i;
/** Identifier shapes that must never appear in a synthetic-only session. */
const PATIENT_ID = /\b(MRN|medical record (number|no\.?)|DOB|date of birth|patient name)\s*[:#]/i;
const SOURCE_REF = /(https?:\/\/[^\s)\]>"']+|\b10\.\d{4,9}\/[^\s)\]>"']+)/g;

type Block = { type: string; text?: string; name?: string };

function blocks(m: LhMessage): Block[] {
	const content = (m as { content?: unknown }).content;
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? (content as Block[]) : [];
}

const textOf = (m: LhMessage) => blocks(m).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");

/** A learner input opens a turn: a typed message, a marker (practice
 *  thinking, a steer), or the answer to an asking tool. */
function opensTurn(m: LhMessage): boolean {
	if (m.role === "user" || m.role === "custom") return true;
	return m.role === "toolResult" && ASKING_TOOLS.has((m as { toolName?: string }).toolName ?? "");
}

/** Turns: everything from one learner input up to the next. */
export function turnsOf(messages: readonly LhMessage[]): LhMessage[][] {
	const turns: LhMessage[][] = [];
	let current: LhMessage[] = [];
	for (const m of messages) {
		if (opensTurn(m) && current.some((x) => x.role === "assistant")) {
			turns.push(current);
			current = [];
		}
		current.push(m);
	}
	if (current.length) turns.push(current);
	return turns;
}

export interface Finding {
	rule: string;
	turn: number;
	detail: string;
}

export interface Report {
	turns: number;
	findings: Finding[];
	/** Words of assistant prose per turn — brevity is reported, not judged. */
	wordsPerTurn: number[];
	medianWords: number;
	resumePointRequired: boolean;
	resumePointPresent: boolean;
}

export function checkTranscript(messages: readonly LhMessage[]): Report {
	const findings: Finding[] = [];
	const turns = turnsOf(messages);
	const nonAssistantText = messages.filter((m) => m.role !== "assistant").map(textOf).join("\n")
		+ "\n" + messages.map((m) => JSON.stringify((m as { details?: unknown }).details ?? "")).join("\n");
	const wordsPerTurn: number[] = [];

	turns.forEach((turn, i) => {
		const assistant = turn.filter((m) => m.role === "assistant");
		const asks = assistant.flatMap(blocks).filter((b) => b.type === "toolCall" && ASKING_TOOLS.has(b.name ?? ""));
		if (asks.length > 1) findings.push({ rule: "one-question-per-turn", turn: i, detail: `${asks.length} question calls: ${asks.map((b) => b.name).join(", ")}` });
		const prose = assistant.map(textOf).join("\n");
		wordsPerTurn.push(prose.split(/\s+/).filter(Boolean).length);
		const praise = PRAISE.exec(prose);
		if (praise) findings.push({ rule: "no-performed-praise", turn: i, detail: `"${praise[0]}"` });
		for (const ref of prose.match(SOURCE_REF) ?? []) {
			if (!nonAssistantText.includes(ref)) findings.push({ rule: "sources-from-checked-briefs", turn: i, detail: `${ref} appears in no research brief or learner message` });
		}
	});
	for (const [i, turn] of turns.entries()) {
		const all = turn.map(textOf).join("\n");
		const hit = PATIENT_ID.exec(all);
		if (hit) findings.push({ rule: "synthetic-only", turn: i, detail: `patient-identifier pattern "${hit[0]}"` });
	}

	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const resumePointRequired = lastUser !== undefined && STOP_INTENT.test(textOf(lastUser));
	const lastTurnProse = turns.length ? turns[turns.length - 1]!.filter((m) => m.role === "assistant").map(textOf).join("\n") : "";
	const resumePointPresent = /Resume point/i.test(lastTurnProse) && /Established/i.test(lastTurnProse) && /Open question/i.test(lastTurnProse) && /Next step/i.test(lastTurnProse);
	if (resumePointRequired && !resumePointPresent) findings.push({ rule: "resume-point-on-stop", turn: turns.length - 1, detail: "learner stopped; no complete resume point (Established / Open question / Next step)" });

	const sorted = [...wordsPerTurn].sort((a, b) => a - b);
	const medianWords = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
	return { turns: turns.length, findings, wordsPerTurn, medianWords, resumePointRequired, resumePointPresent };
}
