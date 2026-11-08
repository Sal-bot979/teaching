/**
 * Hayden fork — the transcript rule checker (hayden/evals/transcript-checks.ts)
 * on hand-built records: each rule fires on its violation and stays quiet
 * on the compliant twin, and turn boundaries follow learner inputs
 * (typed text, quiz answers, practice thinking markers).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTranscript, turnsOf } from "../hayden/evals/transcript-checks.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

let n = 0;
const id = () => `m${n++}`;
const user = (text: string) => ({ id: id(), role: "user", content: [{ type: "text", text }] }) as unknown as LhMessage;
const say = (text: string) => ({ id: id(), role: "assistant", content: [{ type: "text", text }] }) as unknown as LhMessage;
const ask = (name: string, text = "") =>
	({ id: id(), role: "assistant", content: [...(text ? [{ type: "text", text }] : []), { type: "toolCall", name, id: id(), arguments: {} }] }) as unknown as LhMessage;
const result = (toolName: string, text = "ok") => ({ id: id(), role: "toolResult", toolName, content: [{ type: "text", text }] }) as unknown as LhMessage;
const thinking = (text: string) => ({ id: id(), role: "custom", customType: "practice-thinking", content: text }) as unknown as LhMessage;
const rules = (m: LhMessage[]) => checkTranscript(m).findings.map((f) => f.rule).sort();

describe("transcript checks", () => {
	it("turns split at typed messages, quiz answers, and practice thinking — not at internal tool results", () => {
		const m = [user("go"), ask("quiz"), result("quiz", "answer"), say("next"), ask("problem"), result("problem"), thinking("my work"), ask("conclude"), result("conclude"), say("done")];
		assert.equal(turnsOf(m).length, 3);
		assert.deepEqual(rules(m), [], "one ask per turn across a mixed session");
	});

	it("one-question-per-turn fires on two asks in one turn", () => {
		assert.deepEqual(rules([user("go"), ask("quiz"), ask("ask_user_question")]), ["one-question-per-turn"]);
	});

	it("no-performed-praise fires on praise, not on plain verdicts", () => {
		assert.deepEqual(rules([user("x"), say("Excellent work!")]), ["no-performed-praise"]);
		assert.deepEqual(rules([user("x"), say("Correct. The quadratic term carries it.")]), []);
	});

	it("resume-point-on-stop requires all three fields after a stop", () => {
		assert.deepEqual(rules([user("ok I need to go"), say("Bye.")]), ["resume-point-on-stop"]);
		assert.deepEqual(rules([user("ok I need to go"), say("**Resume point**\n- Established: x\n- Open question: y\n- Next step: z")]), []);
		assert.deepEqual(rules([user("continue"), say("Bye.")]), [], "no stop, no requirement");
	});

	it("sources-from-checked-briefs flags a URL/DOI no brief or learner message supplied", () => {
		assert.deepEqual(rules([user("x"), say("See doi 10.1234/fake.5678")]), ["sources-from-checked-briefs"]);
		const steer = { id: id(), role: "custom", customType: "subagent-steer", content: "Brief: https://example.org/paper" } as unknown as LhMessage;
		assert.deepEqual(rules([user("x"), ask("research"), result("research"), steer, say("Source: https://example.org/paper")]), []);
	});

	it("synthetic-only flags patient-identifier patterns anywhere", () => {
		assert.deepEqual(rules([user("MRN: 1234567, plan review?"), say("I can only use synthetic cases.")]), ["synthetic-only"]);
	});
});

describe("transcript checks — critic round 1 regressions", () => {
	it("physics wording is not a stop, and not praise", () => {
		assert.deepEqual(rules([user("What sets the stopping power of water at 10 MeV?"), say("The electron density, mostly.")]), []);
		assert.deepEqual(rules([user("I need to go over the Bragg peak again"), say("Start from the stopping power.")]), []);
		assert.deepEqual(rules([user("film?"), say("Film gives excellent spatial resolution.")]), []);
	});

	it("real stops and real praise are still caught", () => {
		for (const stop of ["let's call it a day", "stop", "I have to go now", "done for today", "Stopping here."]) {
			assert.deepEqual(rules([user(stop), say("ok")]), ["resume-point-on-stop"], stop);
		}
		assert.deepEqual(rules([user("x"), say("Great job! Nice work, you nailed it.")]), ["no-performed-praise"]);
	});

	it("a URL followed by a full stop matches its brief", () => {
		const steer = { id: id(), role: "custom", customType: "subagent-steer", content: "Brief: https://example.org/tg51" } as unknown as LhMessage;
		assert.deepEqual(rules([user("x"), ask("research"), result("research"), steer, say("Source: https://example.org/tg51.")]), []);
	});

	it("several closing prose questions count; a rhetorical one mid-derivation does not", () => {
		assert.deepEqual(rules([user("x"), say("What is BED? Why the quadratic term? And what about repair?")]), ["one-question-per-turn"]);
		assert.deepEqual(rules([user("x"), say("Why does the quadratic term matter? Because it grows with $d$.\n\nWhat dose per fraction makes the terms equal?")]), []);
		assert.deepEqual(rules([user("x"), ask("quiz", "What do you predict?")]), ["one-question-per-turn"], "a prose question plus a quiz is two");
	});

	it("MRN without a colon and patient-specific advice are flagged; guideline refs are listed for a hand check", () => {
		assert.deepEqual(rules([user("MRN 12345678 needs a plan"), say("Synthetic cases only.")]), ["synthetic-only"]);
		assert.deepEqual(rules([user("x"), say("For this patient use 60 Gy.")]), ["no-patient-specific-advice"]);
		const report = checkTranscript([user("x"), say("Per AAPM TG-999 and ICRU Report 777, use 47.3 Gy.")]);
		assert.deepEqual(report.unbriefedReferences, ["TG-999", "ICRU Report 777"]);
	});

	it("system steers do not split a turn", () => {
		const steer = { id: id(), role: "custom", customType: "subagent-steer", content: "brief" } as unknown as LhMessage;
		assert.equal(turnsOf([user("go"), ask("research"), result("research"), steer, say("Using the brief: …")]).length, 1);
	});
});

describe("transcript checks — critic round 2 regressions", () => {
	const stopRules = (text: string) => rules([user(text), say("ok")]);
	it("physics sentences are not stops", () => {
		for (const t of ["I have to run the numbers for the TG-51 check first", "We need to leave a margin for setup error", "I have to leave room for the PTV expansion", "What sets the stopping power?"]) {
			assert.deepEqual(stopRules(t), [], t);
		}
	});
	it("real stops are caught", () => {
		for (const t of ["Let's wrap up", "I'll stop there", "gotta head out", "thanks, bye!", "Let's pick this up tomorrow", "need to bounce", "I have to go.", "call it a day"]) {
			assert.deepEqual(stopRules(t), ["resume-point-on-stop"], t);
		}
	});
	it("physics phrasing is not praise; interjections and compliments are", () => {
		for (const t of ["This is a good question to ask of any dose calc.", "Nice work function shift in that metal.", "Film gives excellent spatial resolution.", "The great majority of dose is deposited early."]) {
			assert.deepEqual(rules([user("x"), say(t)]), [], t);
		}
		for (const t of ["Great — that's the right sign.", "Great reasoning there.", "Very good.", "Outstanding.", "Nice!", "Exactly, you're really getting this!", "Love that reasoning."]) {
			assert.deepEqual(rules([user("x"), say(t)]), ["no-performed-praise"], t);
		}
	});
	it("patient wording: physics phrases pass; identifiers and individual framing are flagged", () => {
		for (const t of ["For the patient-specific QA, gamma criteria are 3%/2mm.", "In the patient population studied, toxicity rose.", "MRN 4000 is not a format anyone uses.", "Set the DOB 2 field."]) {
			assert.deepEqual(rules([user("x"), say(t)]), [], t);
		}
		for (const t of ["MRN-1234567", "MRN: A123456", "Patient ID: 4471234", "DOB: March 4 1961", "Name: John Smith, 62M", "Mr. Smith should get 70 Gy"]) {
			assert.deepEqual(rules([user(t), say("Synthetic cases only.")]), ["synthetic-only"], t);
		}
		assert.deepEqual(rules([user("x"), say("In your case the cord limit is lower.")]), ["no-patient-specific-advice"]);
	});
});
