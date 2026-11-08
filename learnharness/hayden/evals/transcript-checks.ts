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
/** Praise aimed at the learner, shaped as an interjection or a direct
 *  compliment — "excellent spatial resolution", "a good question to ask of
 *  any dose calc" and "nice work function shift" are physics, not praise. */
const PRAISE = /(^|[.!?]\s+|\n)\s*(great|excellent|nice|perfect|awesome|amazing|brilliant|outstanding|superb|fantastic|wonderful|lovely|very good|good job|well done)( (job|work|question|answer|thinking|catch|reasoning|point))?\s*([!.,;:]|\s[—–-]|$)|\b(you nailed it|nailed it|spot on|bravo|kudos|you'?re (really )?getting (this|it)|love (that|this|your) (reasoning|thinking|answer)|great (reasoning|thinking|work) there)\b/im;
/** A stop is a statement about the session, not a word: "stopping power",
 *  "need to go over the Bragg peak", "have to run the numbers" and "leave
 *  a margin" are physics. Heuristic: a screen, not a verdict. */
const STOP_INTENT = /^\s*(stop|pause|done|bye|later|thanks,? bye)\W*$|\b(stop(ping)? (here|there|now|for (now|today|tonight))|i'?ll stop (here|there)|let'?s (stop|wrap up|pause)|wrap(ping)? (it )?up|pause (here|now|for now)|done for (now|today|tonight)|call it a (day|night)|that'?s (all|it) for (now|today|tonight)|out of time|signing off|pick (this|it) up (tomorrow|later|next time|another time)|(need|have|got|gotta) to (go|leave|run|head out|bounce)(\s+(now|soon|in a (sec|minute)))?\s*([.!,;]|$)|gotta (go|run|head out|bounce)\b|need to bounce|head(ing)? out\s*([.!,;]|$)|\bbye\b[!.]?\s*$)/i;
/** Identifier shapes that must never appear in a synthetic-only session
 *  (6+ digit record numbers, dated DOBs, named people). */
const PATIENT_ID = /\b(MRN|medical record (number|no\.?)|patient id)\s*[-:#]?\s*[A-Z]{0,2}\d{6,}|\b(DOB|date of birth)\s*[:#]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\.? \d{1,2},? \d{4})/i;
/** Named individuals (case-sensitive: "Name: John Smith", "Mr. Smith"). */
const NAMED_PERSON = /\b(Patient )?[Nn]ame\s*:\s*[A-Z][a-z]+ [A-Z][a-z]+|\b(Mr|Mrs|Ms|Miss)\.? [A-Z][a-z]+/;
/** Patient-specific framing in the TUTOR's prose. "Patient-specific QA"
 *  and "the patient population studied" are physics and are not flagged;
 *  general guidance ("for a patient with a pacemaker…") is not either. */
const PATIENT_ADVICE = /\b(for|in|treat) (this|your|my) patient\b|\byour patient('s)?\b|\bin your (case|patient)\b/i;
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
		const hit = PATIENT_ID.exec(all) ?? NAMED_PERSON.exec(all);
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
