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
/** Learner-originated markers (system steers and graph context are not turns). */
const LEARNER_MARKERS = new Set(["practice-thinking", "problem-dismissed"]);
/** Praise aimed at the learner — "excellent spatial resolution" is not praise. */
const PRAISE = /\b(great|excellent|good|nice|fantastic|superb|amazing|awesome|brilliant|perfect) (question|job|work|answer|thinking|catch)\b|\b(well done|you nailed it|nailed it|spot on|great stuff|bravo|kudos)\b|^\s*(great|excellent|perfect|awesome|superb|brilliant|amazing)[!.]/im;
/** A stop is a statement about the session, not a word: "stopping power"
 *  and "need to go over the Bragg peak" are physics. */
const STOP_INTENT = /^\s*(stop|pause|done|bye|later)\W*$|\b(stop(ping)? (here|now|for (now|today|tonight))|let'?s stop|pause (here|now|for now)|done for (now|today|tonight)|(need|have|got) to (go|leave|run)\b(?!\s+(over|through|back|into|to|with))|gotta (go|run)|call it a (day|night)|that'?s (all|it) for (now|today|tonight)|out of time|signing off)\b/i;
/** Identifiers that must never appear in a synthetic-only session. */
const PATIENT_ID = /\b(MRN|medical record (number|no\.?))\s*[:#]?\s*\d{4,}|\b(DOB|date of birth)\s*[:#]?\s*\d|\bpatient name\s*[:#]/i;
/** Patient-specific framing in the TUTOR's prose (advice, not principles). */
const PATIENT_ADVICE = /\b(for|in|treat) (this|your|my|the) patient\b|\byour patient('s)?\b/i;
const SOURCE_REF = /(https?:\/\/[^\s)\]>"']+|\b10\.\d{4,9}\/[^\s)\]>"']+)/g;
/** Named guideline/report identifiers — listed for a human check when no
 *  brief or learner message carries them (too common to call violations). */
const GUIDELINE_REF = /\b(TG[- ]?\d{1,3}[a-z]?|ICRU (Report )?\d{1,3}|IAEA TRS[- ]?\d{1,4}|NCRP (Report )?\d{1,3}|QUANTEC|AAPM Report \d{1,3})\b/gi;

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
	if (m.role === "user") return true;
	if (m.role === "custom") return LEARNER_MARKERS.has((m as { customType?: string }).customType ?? "");
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
	/** Guideline/report identifiers no brief or learner message carries —
	 *  check by hand; not counted as violations. */
	unbriefedReferences: string[];
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
	const unbriefedReferences: string[] = [];

	turns.forEach((turn, i) => {
		const assistant = turn.filter((m) => m.role === "assistant");
		const asks = assistant.flatMap(blocks).filter((b) => b.type === "toolCall" && ASKING_TOOLS.has(b.name ?? ""));
		const prose = assistant.map(textOf).join("\n");
		// Prose questions count only in the closing paragraph — the one the
		// learner is asked to answer; rhetorical "why?" mid-derivation is method.
		const closing = prose.trim().split(/\n\s*\n/).pop() ?? "";
		const proseAsks = (closing.replace(/\$[^$]*\$/g, "").match(/\?(\s|$)/g) ?? []).length;
		if (asks.length + proseAsks > 1) findings.push({ rule: "one-question-per-turn", turn: i, detail: `${asks.length} question call(s) + ${proseAsks} closing prose question(s)` });
		wordsPerTurn.push(prose.split(/\s+/).filter(Boolean).length);
		const praise = PRAISE.exec(prose);
		if (praise) findings.push({ rule: "no-performed-praise", turn: i, detail: `"${praise[0]}"` });
		for (const raw of prose.match(SOURCE_REF) ?? []) {
			const ref = raw.replace(/[.,;:!?]+$/, "");
			if (!nonAssistantText.includes(ref)) findings.push({ rule: "sources-from-checked-briefs", turn: i, detail: `${ref} appears in no research brief or learner message` });
		}
		for (const ref of prose.match(GUIDELINE_REF) ?? []) {
			if (!nonAssistantText.toLowerCase().includes(ref.toLowerCase()) && !unbriefedReferences.includes(ref)) unbriefedReferences.push(ref);
		}
		const advice = PATIENT_ADVICE.exec(prose);
		if (advice) findings.push({ rule: "no-patient-specific-advice", turn: i, detail: `"${advice[0]}"` });
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
	return { turns: turns.length, findings, unbriefedReferences, wordsPerTurn, medianWords, resumePointRequired, resumePointPresent };
}
