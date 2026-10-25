/**
 * The Hayden learner profile switch — `npx tsx hayden/profile.ts on|off|status`.
 *
 * No new mechanism: this does exactly what Settings → Agent → Prompts does
 * by hand for one segment — writes the override file for
 * shared/90-learner-profile.md (empty in source) and flips its switch in
 * settings.json's agent.prompts map. Honors LH_DATA_DIR like the app.
 *
 *   on      write the override (unless a customized one exists) + switch on
 *   off     switch off — the override file stays on disk, as upstream intends
 *   status  print the switch, the file state, and whether it composes
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_FILE } from "../config.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { CURRENT_SETTINGS_VERSION } from "../src/core/settings.ts";
import { readSettings } from "../src/store/settings.ts";
import { promptOverrides } from "../src/store/prompt-overrides.ts";

export const PROFILE_SEGMENT = "shared/90-learner-profile.md";
export const PROFILE_TEXT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "learner-profile.md"), "utf-8");

function setSwitch(on: boolean): void {
	// Edit ONLY our key in the raw record: everything else in the file —
	// including fields the app's sanitizer would drop — is left exactly as is.
	let record: Record<string, unknown> = { version: CURRENT_SETTINGS_VERSION };
	if (fs.existsSync(SETTINGS_FILE)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
		} catch {
			parsed = undefined;
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`${SETTINGS_FILE} exists but is not valid settings JSON — fix or move it first; nothing was changed.`);
		}
		record = parsed as Record<string, unknown>;
	}
	const agent = record.agent !== null && typeof record.agent === "object" && !Array.isArray(record.agent) ? (record.agent as Record<string, unknown>) : {};
	const prompts = agent.prompts !== null && typeof agent.prompts === "object" && !Array.isArray(agent.prompts) ? (agent.prompts as Record<string, unknown>) : {};
	const next = { ...record, agent: { ...agent, prompts: { ...prompts, [PROFILE_SEGMENT]: on } } };
	fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, "\t"), "utf-8");
}

/** Switch the profile on. A customized override already on disk is kept
 *  unless `force` — the learner's own edits are never silently replaced. */
export function enableProfile(force = false): { wroteFile: boolean } {
	const existing = promptOverrides.readOverride(PROFILE_SEGMENT);
	const wroteFile = existing === null || force;
	setSwitch(true); // first: a refused settings write must leave the override untouched too
	if (wroteFile) promptOverrides.writeOverride(PROFILE_SEGMENT, PROFILE_TEXT);
	return { wroteFile };
}

export function disableProfile(): void {
	setSwitch(false);
}

export function profileStatus() {
	const switches = readSettings()?.agent?.prompts ?? {};
	const file = promptOverrides.readOverride(PROFILE_SEGMENT);
	return {
		switchOn: switches[PROFILE_SEGMENT] === true,
		file: file === null ? "absent" : file === PROFILE_TEXT ? "shipped profile" : "customized",
		composesInto: (["prober", "teacher", "practice"] as const).filter((kind) =>
			composeInstructions(kind, switches).includes("## Learner profile"),
		),
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [cmd, flag] = process.argv.slice(2);
	if (cmd === "on") {
		const { wroteFile } = enableProfile(flag === "--force");
		if (!wroteFile) console.log("Kept your customized override (use `on --force` to replace it with the shipped profile).");
	} else if (cmd === "off") {
		disableProfile();
	} else if (cmd !== "status") {
		console.error("usage: npx tsx hayden/profile.ts on [--force] | off | status");
		process.exit(2);
	}
	console.log(JSON.stringify(profileStatus(), null, 2));
}
