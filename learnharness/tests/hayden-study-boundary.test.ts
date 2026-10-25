/**
 * Hayden fork — the study-folder boundary (fs-shared studyRoot /
 * resolveSourcePath). Learner-file tools (read, ls, find, grep) and the
 * learner PDF job reach ONLY the study folder: no home-directory scanning,
 * no `..` traversal, no outside absolute paths, no symlink escape.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-hayden-boundary-")));
const STUDY = path.join(SANDBOX, "study");
const OUTSIDE = path.join(SANDBOX, "outside");
fs.mkdirSync(path.join(STUDY, "notes"), { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.writeFileSync(path.join(STUDY, "notes", "lq.md"), "BED = nD(1 + d/(alpha/beta))\n");
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "SECRET-TOKEN\n");
fs.symlinkSync(path.join(OUTSIDE, "secret.txt"), path.join(STUDY, "link-to-secret.txt"));
fs.symlinkSync(OUTSIDE, path.join(STUDY, "link-to-outside-dir"));
process.env.LH_STUDY_DIR = STUDY;
process.env.LH_DATA_DIR = path.join(SANDBOX, "data");
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const { resolveSourcePath, studyRoot } = await import("../src/agent/tools/fs-shared.ts");
const { readTool } = await import("../src/agent/tools/read.ts");
const { lsTool } = await import("../src/agent/tools/ls.ts");
const { findTool } = await import("../src/agent/tools/find.ts");
const { grepTool } = await import("../src/agent/tools/grep.ts");

async function text(tool: AgentTool<any>, params: unknown): Promise<string> {
	const result = await tool.execute!("c", params);
	return (result.content[0] as { text: string }).text;
}

describe("study-folder boundary — resolveSourcePath", () => {
	it("defaults to the study folder; relative paths resolve inside it", () => {
		assert.equal(studyRoot(), STUDY);
		assert.equal(resolveSourcePath(), STUDY);
		assert.equal(resolveSourcePath("notes/lq.md"), path.join(STUDY, "notes", "lq.md"));
		assert.equal(resolveSourcePath(path.join(STUDY, "notes")), path.join(STUDY, "notes"));
	});

	const escapes: Array<[string, string]> = [
		["dot-dot traversal", "../outside/secret.txt"],
		["deep traversal", "notes/../../outside/secret.txt"],
		["outside absolute path", path.join(OUTSIDE, "secret.txt")],
		["home directory", os.homedir()],
		["tilde home", "~/.ssh/id_rsa"],
		["filesystem root", "/etc/passwd"],
		["symlinked file escaping", "link-to-secret.txt"],
		["symlinked dir escaping", "link-to-outside-dir/secret.txt"],
		["sibling prefix trick", `${STUDY}-evil/x.txt`],
	];
	for (const [name, p] of escapes) {
		it(`rejects ${name}`, () => assert.throws(() => resolveSourcePath(p), /Outside the study folder/));
	}

	it("unset LH_STUDY_DIR → <data dir>/study (never the home directory)", () => {
		const saved = process.env.LH_STUDY_DIR;
		delete process.env.LH_STUDY_DIR;
		try {
			assert.equal(studyRoot(), path.join(SANDBOX, "data", "study"));
			assert.notEqual(studyRoot(), os.homedir());
		} finally {
			process.env.LH_STUDY_DIR = saved;
		}
	});
});

describe("study-folder boundary — every learner-file tool", () => {
	it("read: inside works; escape is an error the model sees; secret never returned", async () => {
		assert.match(await text(readTool, { path: "notes/lq.md" }), /BED/);
		for (const p of ["../outside/secret.txt", "link-to-secret.txt", path.join(OUTSIDE, "secret.txt")]) {
			await assert.rejects(() => readTool.execute!("c", { path: p }), /Outside the study folder/);
		}
	});

	it("ls: defaults to the study folder; outside rejected", async () => {
		assert.match(await text(lsTool, {}), /notes\//);
		await assert.rejects(() => lsTool.execute!("c", { path: OUTSIDE }), /Outside the study folder/);
		await assert.rejects(() => lsTool.execute!("c", { path: os.homedir() }), /Outside the study folder/);
	});

	it("find/grep: search the study folder only, never follow symlinks out", async () => {
		assert.match(await text(findTool, { pattern: "*.md" }), /lq\.md/);
		assert.doesNotMatch(await text(findTool, { pattern: "*.txt" }), /secret/);
		assert.doesNotMatch(await text(grepTool, { pattern: "SECRET" }), /SECRET-TOKEN/);
		await assert.rejects(() => grepTool.execute!("c", { pattern: "SECRET", path: OUTSIDE }), /Outside the study folder/);
		await assert.rejects(() => findTool.execute!("c", { pattern: "*", path: "/" }), /Outside the study folder/);
	});
});

describe("study-folder boundary — critic round 1", () => {
	it("resolving paths never creates the study folder", () => {
		const saved = process.env.LH_STUDY_DIR;
		process.env.LH_STUDY_DIR = path.join(SANDBOX, "not-yet");
		try {
			assert.equal(resolveSourcePath("notes.md"), path.join(SANDBOX, "not-yet", "notes.md"));
			assert.throws(() => resolveSourcePath("../outside/secret.txt"), /Outside the study folder/);
			assert.equal(fs.existsSync(path.join(SANDBOX, "not-yet")), false);
		} finally {
			process.env.LH_STUDY_DIR = saved;
		}
	});

	it("SVG figures cannot pull local files: external hrefs are stripped before either renderer", async () => {
		const { stripExternalRefs, getHeadless } = await import("../src/agent/subagents/headless.ts");
		const secretPng = path.join(OUTSIDE, "secret.png");
		// a 1x1 red PNG
		fs.writeFileSync(secretPng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
		const svg = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20"><image ${href} width="20" height="20"/></svg>`;
		for (const attack of [`href="${secretPng}"`, `xlink:href='file://${secretPng}'`, `href=${secretPng}`]) {
			assert.doesNotMatch(stripExternalRefs(svg(attack)), /secret\.png/, attack);
		}
		const keep = `href="data:image/png;base64,AAAA"`;
		assert.match(stripExternalRefs(svg(keep)), /data:image\/png/);
		assert.match(stripExternalRefs('<svg><use href="#a"/></svg>'), /href="#a"/);
		// End to end through resvg: the rendered pixel is the white background, not the secret's red.
		const png = await getHeadless().renderSvg(svg(`href="${secretPng}"`));
		const { Resvg } = await import("@resvg/resvg-js");
		const probe = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20"><image href="data:image/png;base64,${png.toString("base64")}" width="20" height="20"/></svg>`);
		const pixels = probe.render().pixels;
		assert.deepEqual([...pixels.subarray(0, 3)], [255, 255, 255], "no red pixel from the outside file");
	});
});
