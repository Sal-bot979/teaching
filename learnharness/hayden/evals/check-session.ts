/**
 * Score saved sessions with the transcript rule checks —
 *   npx tsx hayden/evals/check-session.ts            (every session)
 *   npx tsx hayden/evals/check-session.ts <chatId>   (one session)
 * Reads the app's own chat store (honors LH_DATA_DIR). Read-only.
 */

import { chatStore } from "../../src/store/chats.ts";
import { checkTranscript } from "./transcript-checks.ts";

const ids = process.argv[2] ? [process.argv[2]] : chatStore.listChats().map((c) => c.id);
let violations = 0;
for (const id of ids) {
	const chat = chatStore.getChat(id);
	if (!chat) {
		console.error(`no session ${id}`);
		process.exitCode = 1;
		continue;
	}
	const report = checkTranscript(chat.messages);
	violations += report.findings.length;
	console.log(`\n${chat.title} (${id}) — ${report.turns} turns, median ${report.medianWords} words/turn`);
	if (report.resumePointRequired) console.log(`  resume point on stop: ${report.resumePointPresent ? "present" : "MISSING"}`);
	for (const f of report.findings) console.log(`  ✗ [${f.rule}] turn ${f.turn}: ${f.detail}`);
	if (!report.findings.length) console.log("  ✓ no rule violations");
}
console.log(`\n${ids.length} session(s), ${violations} violation(s).`);
