// Drives the real LearnHarness UI like a learner would, against the mock
// tutor (mock-tutor.mjs connected as the custom endpoint), and records it.
//   node hayden/evals/demo/record-walkthrough.cjs <appUrl> <outDir> [--video]
// Without --video it saves a screenshot per step (a debugging rehearsal).
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const [, , APP = "http://127.0.0.1:3200", OUT = "./walkthrough-out", ...flags] = process.argv;
const VIDEO = flags.includes("--video");

(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		...(VIDEO ? { recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } } : {}),
	});
	const p = await context.newPage();
	let step = 0;
	const mark = async (name) => {
		step++;
		if (!VIDEO) await p.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`) });
		console.log(`step ${step}: ${name}`);
	};
	const pause = (ms) => p.waitForTimeout(ms);
	const composer = () => p.locator('[contenteditable=true][aria-label]').filter({ hasNot: p.locator("[data-testid]") }).last();
	const typeIn = async (loc, text) => { await loc.click(); await loc.pressSequentially(text, { delay: 28 }); };
	const say = async (text) => { await typeIn(composer(), text); await pause(400); await p.keyboard.press("Enter"); };
	const thinking = () => p.locator("[contenteditable=true][role=textbox]").last();
	const answerDock = async (option, confidenceSteps, thought) => {
		await p.getByRole("radio", { name: option }).first().click();
		await pause(500);
		const slider = p.getByTestId("confidence-slider");
		await slider.focus();
		for (let i = 0; i < Math.abs(confidenceSteps); i++) { await p.keyboard.press(confidenceSteps > 0 ? "ArrowRight" : "ArrowLeft"); await pause(180); }
		await pause(300);
		await typeIn(thinking(), thought);
		await pause(600);
		await p.getByRole("button", { name: "Submit answer" }).click();
	};

	// ── 1. Home → start a session with a length cue and a goal ──
	await p.goto(APP, { waitUntil: "networkidle" });
	await pause(1500);
	await mark("home");
	await typeIn(p.locator('[contenteditable=true][aria-label="What do you want to learn?"]'), "Normal session (~25 min). Goal: why fractionation spares late-responding tissue under the LQ model.");
	await pause(600);
	await p.keyboard.press("Enter");

	// ── 2. The probe measures first ──
	await p.getByRole("radio", { name: /Kill falls/ }).waitFor({ timeout: 60_000 });
	await pause(1800);
	await mark("probe-question");
	await answerDock(/Kill falls/, 2, "Cells repair sublethal damage between fractions, so splitting the dose gives them time.");

	// ── 3. Probe done → plan map → approach ──
	await p.getByText(/Good to go\?/).waitFor({ timeout: 90_000 });
	await pause(2500);
	await mark("assessment-and-plan");
	await p.mouse.wheel(0, 600);
	await pause(1500);
	await say("Looks good, go.");

	// ── 4. Predict before the step is taught ──
	await p.getByRole("radio", { name: /A \(low/ }).waitFor({ timeout: 60_000 });
	await pause(1800);
	await mark("predict");
	await answerDock(/A \(low/, 1, "Low α/β means the quadratic term matters sooner, so bigger fractions should hit A harder.");

	// ── 5. Teaching resolves the prediction; the check waits behind a button ──
	await p.getByText(/had\* to be A|had to be A/).first().waitFor({ timeout: 60_000 });
	await pause(2500);
	await mark("teaching");
	await p.mouse.wheel(0, 900);
	await pause(2500);
	const reveal = p.getByRole("button", { name: /check your understanding/i });
	if (await reveal.count()) { await reveal.first().click(); await pause(1200); }
	await p.getByRole("radio", { name: /Rises from 100 to 120/ }).waitFor({ timeout: 60_000 });
	await mark("check");
	await answerDock(/Rises from 100 to 120/, 2, "d/(α/β) goes from 2/3 to 1, so BED goes 60·5/3 = 100 → 60·2 = 120.");
	await p.getByText(/what would you expect to break first/i).waitFor({ timeout: 60_000 });
	await pause(2500);
	await mark("next-step");

	// ── 6. The live plan window ──
	await p.getByRole("button", { name: /^plan/i }).first().click();
	await pause(3500);
	await mark("plan-window");
	await p.keyboard.press("Escape");
	await pause(1200);

	// ── 7. Stopping → resume point ──
	await say("Need to go — stopping here.");
	await p.getByText(/Resume point/).first().waitFor({ timeout: 60_000 });
	await pause(3500);
	await mark("resume-point");

	// ── 8. Practice: a transfer problem, a wrong attempt, a hint, the answer ──
	await p.getByTestId("new-session-practice").click();
	await pause(1500);
	await say("Practice: LQ fractionation and BED, new numbers please.");
	await p.getByText(/Schedule A: 60 Gy in 30 fractions/).first().waitFor({ timeout: 60_000 });
	await pause(2500);
	await mark("practice-problem");
	await typeIn(thinking(), "Just compare totals: 60 > 45, so A is harsher by 15.");
	await pause(500);
	await p.keyboard.press("Enter");
	await p.getByText(/Not yet\. Before comparing totals/).waitFor({ timeout: 60_000 });
	await pause(3000);
	await mark("practice-hint");
	await typeIn(thinking(), "Final answer: A has d = 2 so BED = 60(1 + 2/3) = 100; B has d = 3 so BED = 45·2 = 90. A is harsher by 10 Gy₃.");
	await pause(500);
	await p.keyboard.press("Enter");
	await p.getByText(/Solved after one redirect/).waitFor({ timeout: 60_000 });
	await pause(3500);
	await mark("practice-solved");

	// ── 9. The profile switch ──
	await p.getByTestId("settings-entry").click();
	await pause(1000);
	await p.getByRole("dialog").getByText("Agent", { exact: true }).first().click();
	await pause(800);
	await p.getByText("90-learner-profile", { exact: false }).first().scrollIntoViewIfNeeded();
	await pause(3000);
	await mark("profile-switch");

	const video = p.video();
	await context.close();
	if (video) console.log(`video: ${await video.path()}`);
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
