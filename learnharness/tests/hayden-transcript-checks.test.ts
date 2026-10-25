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
