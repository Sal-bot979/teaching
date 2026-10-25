/**
 * Hayden fork — the opt-in learner profile (hayden/learner-profile.md),
 * pinned against the UPSTREAM composed prompts captured at b277ee3
 * (hayden/evals/golden/upstream-*.txt, written by composeInstructions in
 * the unmodified upstream checkout).
 *
 *   off → every agent's prompt is byte-identical to upstream, except the
 *         two documented study-folder sentences (UPSTREAM_EDITS).
 *   on  → every agent's prompt is exactly (off) + separator + profile —
 *         upstream doctrine intact, profile appended once, last. Practice
 *         included (its shared allowlist is the trap a new file alone
 *         would fall into).
 *
 * Runs under an isolated LH_DATA_DIR (set before any config import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-hayden-profile-"));
process.env.LH_DATA_DIR = TMP_DATA;
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { listSourceSegments } = await import("../src/agent/prompt-segments.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const profile = await import("../hayden/profile.ts");
const configModule = await import("../config.ts");

const AGENTS = ["prober", "teacher", "practice"] as const;
const GOLDEN = path.join(import.meta.dirname, "..", "hayden", "evals", "golden");
const SEP = "\n\n---\n\n";

/** The only intended differences from upstream with the profile off: the
 *  learner-file doctrine now names the study folder (security exception). */
const UPSTREAM_EDITS: Array<[string, string]> = [
	[
		"Paths resolve against his home directory.",
		"Paths resolve against his study folder; nothing outside it is reachable — if a file isn't there, ask him to put it there.",
	],
	["find/ls/grep/read, home-anchored", "find/ls/grep/read, anchored to his study folder"],
];

function upstreamExpected(kind: (typeof AGENTS)[number]): string {
	let text = fs.readFileSync(path.join(GOLDEN, `upstream-${kind}.txt`), "utf-8");
	for (const [from, to] of UPSTREAM_EDITS) text = text.replace(from, to);
	return text;
}

function reset(): void {
	promptOverrides.deleteOverride(profile.PROFILE_SEGMENT);
	writeSettings({ version: 1 });
}

describe("Hayden profile — OFF restores upstream", () => {
	it("no switches: every agent composes upstream (+ only the documented study-folder edits)", () => {
		reset();
		for (const kind of AGENTS) {
			assert.equal(composeInstructions(kind), upstreamExpected(kind), `${kind} drifted from upstream`);
		}
	});

	it("the documented edits actually apply (they are not silently no-ops)", () => {
		const teacher = fs.readFileSync(path.join(GOLDEN, "upstream-teacher.txt"), "utf-8");
		for (const [from] of UPSTREAM_EDITS) assert.ok(teacher.includes(from), `golden lacks: ${from}`);
	});

	it("file on disk but switch off → upstream; switch on but no file → upstream", () => {
		reset();
		promptOverrides.writeOverride(profile.PROFILE_SEGMENT, profile.PROFILE_TEXT);
		for (const kind of AGENTS) {
			assert.equal(composeInstructions(kind, { [profile.PROFILE_SEGMENT]: false }), upstreamExpected(kind));
		}
		promptOverrides.deleteOverride(profile.PROFILE_SEGMENT);
		for (const kind of AGENTS) {
			assert.equal(composeInstructions(kind, { [profile.PROFILE_SEGMENT]: true }), upstreamExpected(kind));
		}
	});

	it("disableProfile() after enableProfile() returns every agent to upstream", () => {
		reset();
		profile.enableProfile();
		profile.disableProfile();
		const switches = readSettings()?.agent?.prompts ?? {};
		for (const kind of AGENTS) assert.equal(composeInstructions(kind, switches), upstreamExpected(kind));
		assert.deepEqual(profile.profileStatus().composesInto, []);
	});
});

describe("Hayden profile — ON reaches all three agents", () => {
	it("enableProfile(): each prompt is exactly upstream + separator + profile", () => {
		reset();
		const { wroteFile } = profile.enableProfile();
		assert.equal(wroteFile, true);
		const switches = readSettings()?.agent?.prompts ?? {};
		for (const kind of AGENTS) {
			const composed = composeInstructions(kind, switches);
			assert.equal(composed, upstreamExpected(kind) + SEP + profile.PROFILE_TEXT.trim(), `${kind}: profile not appended cleanly`);
			assert.equal(composed.split("## Learner profile").length - 1, 1, `${kind}: profile composed more than once`);
		}
		assert.deepEqual(profile.profileStatus(), { switchOn: true, file: "shipped profile", composesInto: ["prober", "teacher", "practice"] });
	});

	it("practice keeps its own doctrine verbatim and still lacks the teaching-only shared fragments", () => {
		const practicePaths = listSourceSegments("practice").map((s) => s.path);
		assert.ok(practicePaths.includes("shared/90-learner-profile.md"));
		for (const excluded of ["system-prompt.md", "shared/20-question-tools.md", "shared/25-confidence.md", "shared/30-learner-files.md"]) {
			assert.ok(!practicePaths.includes(excluded), `practice must not compose ${excluded}`);
		}
		const switches = readSettings()?.agent?.prompts ?? {};
		const practice = composeInstructions("practice", switches);
		for (const file of ["00-base.md", "10-doctrine.md"]) {
			const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "agent", "prompts", "practice", file), "utf-8").trim();
			assert.ok(practice.includes(source), `practice/${file} altered`);
		}
	});

	it("a customized override is kept unless forced", () => {
		reset();
		promptOverrides.writeOverride(profile.PROFILE_SEGMENT, "## Learner profile\nMY EDIT");
		assert.equal(profile.enableProfile().wroteFile, false);
		assert.equal(profile.profileStatus().file, "customized");
		assert.equal(profile.enableProfile(true).wroteFile, true);
		assert.equal(profile.profileStatus().file, "shipped profile");
	});

	it("a malformed settings.json is refused, not overwritten (critic round 1)", () => {
		reset();
		const { SETTINGS_FILE } = configModule;
		const broken = '{"version":1,"models":{"strong":{"provider":"x","id":"y"}},}';
		fs.writeFileSync(SETTINGS_FILE, broken);
		assert.throws(() => profile.enableProfile(), /not valid settings JSON/);
		assert.throws(() => profile.disableProfile(), /not valid settings JSON/);
		assert.equal(fs.readFileSync(SETTINGS_FILE, "utf-8"), broken, "file untouched");
		assert.equal(promptOverrides.readOverride(profile.PROFILE_SEGMENT), null, "no override written either");
		reset();
	});

	it("the shipped source segment is empty (so 'off' can never leak profile text)", () => {
		const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "agent", "prompts", "shared", "90-learner-profile.md"), "utf-8");
		assert.equal(src.trim(), "");
	});
});

describe("Hayden profile — the text carries every requested clause", () => {
	const text = fs.readFileSync(path.join(import.meta.dirname, "..", "hayden", "learner-profile.md"), "utf-8");
	const required: Array<[string, RegExp]> = [
		["defers to doctrine", /doctrine of the session you are running wins/],
		["practice guard", /never license teaching beyond a surgical line/],
		["practice keeps its progression", /In practice, progression stays the doctrine's/],
		["practice repair via hint ladder", /In practice, that repair runs through the hint ladder/],
		["practice: no correction while generable", /without stating the correction while the learner can still generate it/],
		["practice: unretested miss on stop", /if a miss is still unretested, name it as the open question/],
		["credentials are not evidence", /Credentials are a prior, not evidence/],
		["advance once demonstrated", /once the learner has demonstrated something, move on/],
		["one question per turn", /One main reasoning step and one substantive question per turn/],
		["brief by default", /Brief by default/],
		["no syllabus", /No syllabus up front/],
		["generative demands", /predict.*own words.*counterexample.*changed version/s],
		["confident misconception repair", /Confidently wrong.*repair the prerequisite/s],
		["units/assumptions/limits", /units, assumptions, approximations/],
		["law vs model vs convention", /physical law.*empirical model.*clinical convention/s],
		["synthetic only, no patient advice", /Synthetic, non-patient examples only.*Nothing here is patient-specific clinical advice/s],
		["no invented sources", /never invent a citation/],
		["session lengths", /~10 min.*~25 min.*~45 min/s],
		["no fake mastery", /never call something mastered because time ran out/],
		["resume point", /Resume point.*Established.*Open question.*Next step/s],
		["covered ≠ demonstrated", /only what they demonstrated/],
	];
	for (const [name, re] of required) it(name, () => assert.match(text, re));
	it("stays tight (always in context)", () => assert.ok(text.split(/\s+/).length < 650, "profile over 650 words"));
});
