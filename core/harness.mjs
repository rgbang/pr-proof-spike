// Recorded browser test run for any web app.
// Drives headless Edge/Chrome over the DevTools protocol, runs the app's tests (tests.mjs) with real checks,
// shows a live scoreboard, narration banner, cursor and check toasts on screen, and records the screen.
//
//   node harness.mjs <out-dir>        (reads <out-dir>/plan.json, written by run.py)
//
// Writes <out-dir>/.work/frames/*.jpg + frames.json, and <out-dir>/e2e.json (results + voice cues).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = resolve(process.argv[2]);
const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8"));
const cfg = plan.config;
const APP = plan.app_url;
const [VW, VH] = cfg.viewport ?? [1600, 900];
const SCALE = 1920 / VW;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORK = join(OUT, ".work");
const FRAMES = join(WORK, "frames");
const DOWNLOADS = join(OUT, "downloads");
rmSync(FRAMES, { recursive: true, force: true });
rmSync(DOWNLOADS, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(DOWNLOADS, { recursive: true });

const TESTS = [];

function voice(lines) {
  const spec = join(WORK, "voice-lines.json");
  writeFileSync(spec, JSON.stringify({ voice: cfg.voice ?? "en-US-AndrewNeural", rate: cfg.rate ?? "+4%", lines }));
  const r = spawnSync(plan.python, [join(plan.scripts_dir, "voice.py"), join(WORK, "voice"), spec], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("voice.py failed: " + (r.stderr || r.stdout).slice(-800));
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

// ---- browser --------------------------------------------------------------------------------
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
];
const browserPath = cfg.browser ?? BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Edge or Chrome found; set \"browser\" in testrun.json");
const PORT = 9800 + Math.floor(Math.random() * 150);
// Remove browser profiles left behind by earlier runs that crashed or were stopped (each is hundreds of MB).
for (const old of (existsSync(WORK) ? readdirSync(WORK) : []).filter((n) => n.startsWith("browser-profile-"))) {
  try { rmSync(join(WORK, old), { recursive: true, force: true }); } catch {} // one still in use is skipped
}
const profile = join(WORK, `browser-profile-${process.pid}`);
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${VW},${VH}`, "--hide-scrollbars", "--no-first-run", "--mute-audio", "about:blank",
], { stdio: "ignore" });

let targets;
for (let i = 0; i < 80 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
let lastDialog = null;
const rec = { on: false, start: 0, paused: 0, pausedAt: 0, frames: [], cues: [] };
const vt = () => (rec.on ? Date.now() - rec.start - rec.paused : rec.pausedAt - rec.start - rec.paused);

ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
    return;
  }
  if (msg.method === "Page.screencastFrame") {
    const { data, sessionId } = msg.params;
    send("Page.screencastFrameAck", { sessionId });
    if (!rec.on) return;
    const f = `f${String(rec.frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(join(FRAMES, f), Buffer.from(data, "base64"));
    rec.frames.push({ f, t: vt() });
  } else if (msg.method === "Page.javascriptDialogOpening") {
    lastDialog = msg.params.message;
    send("Page.handleJavaScriptDialog", { accept: true });
  }
};
function send(method, params = {}) { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return id; }
const cdp = (method, params = {}) =>
  new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
// Run code in the page and wait for its real result. A Promise is always awaited: an unawaited Promise is
// truthy and would fake a passing check.
const rawJs = async (expr) => {
  const wrapped = `(async () => { const __v = eval(${JSON.stringify(expr)}); return await __v; })()`;
  const r = await cdp("Runtime.evaluate", { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
  return r.result.value;
};
// Multi-page apps: a link or form submit loads a new page, which drops the HUD (window.__tr). Any call
// that needs the HUD re-injects it first, once the new page has loaded, so tests never have to.
let injecting = false;
const js = async (expr) => {
  if (!injecting && expr.includes("__tr") && !(await rawJs("typeof window.__tr !== 'undefined'").catch(() => false))) {
    injecting = true;
    try {
      const end = Date.now() + 30000;
      while (Date.now() < end && !(await rawJs("document.readyState === 'complete'").catch(() => false))) await sleep(150);
      await hud();
    } finally { injecting = false; }
  }
  return rawJs(expr);
};

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("DOM.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: SCALE, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: cfg.color_scheme ?? "light" }] });
await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS }).catch(() => {});

async function startRec() {
  rec.on = true; rec.start = Date.now(); rec.paused = 0;
  await cdp("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1920, maxHeight: Math.round(VH * SCALE), everyNthFrame: 1 });
}
function pauseRec() { if (rec.on) { rec.on = false; rec.pausedAt = Date.now(); } }
async function resumeRec(label) {
  if (rec.on) return;
  const skipped = Date.now() - rec.pausedAt;
  rec.paused += skipped;
  rec.on = true;
  await nudge();
  if (label && skipped > 1500) await toast(`⏩ ${label}: ${(skipped / 1000).toFixed(0)} s skipped in the video`, "info");
}
// The screencast only sends frames when something changes; an invisible change forces a fresh one.
let nudgeFlip = false;
const nudge = () => js(`document.body.style.outline = '1px solid rgba(0,0,0,${(nudgeFlip = !nudgeFlip) ? ".011" : ".012"})'`).catch(() => {});
const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await nudge(); await sleep(Math.min(400, end - Date.now())); } };

// ---- on-screen HUD ---------------------------------------------------------------------------
const HUD = readFileSync(join(plan.scripts_dir, "hud.js"), "utf8");
const state = { tests: [] };
let cursor = { x: VW / 2, y: VH / 2 };
let current = null;
let checks = 0;

async function hud() {
  injecting = true;
  try { await rawJs(HUD); } finally { injecting = false; }
  // Extra selectors (e.g. ".card, .mode") that count as clickable when finding things by their text.
  if (cfg.clickable) await js(`window.__trExtra = ${JSON.stringify(cfg.clickable)}`);
  await js(`__tr.panel(${JSON.stringify(state)})`);
  await js(`__tr.move(${cursor.x}, ${cursor.y})`);
  if (current) await js(`__tr.banner(${JSON.stringify(current.label)}, ${JSON.stringify(current.say)}, '')`);
}
async function waitFor(expr, ms = 30000, what = String(expr)) {
  const end = Date.now() + ms;
  let lastErr;
  while (Date.now() < end) {
    try { if (typeof expr === "function" ? await expr() : await js(expr)) return; } catch (e) { lastErr = e; }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}${lastErr ? " (" + lastErr.message + ")" : ""}`);
}
async function load(url = APP) {
  await cdp("Page.navigate", { url });
  await waitFor(`document.readyState === 'complete'`, 30000, "the page to load");
  await sleep(300);
  if (cfg.ready && url.startsWith(APP)) await waitFor(cfg.ready, 60000, "the app to be ready");
  await hud();
}
const status = (text) => js(`__tr.status(${JSON.stringify(text)})`);
const toast = (text, kind = "") => js(`__tr.toast(${JSON.stringify(text)}, ${JSON.stringify(kind)})`);

// A check: a JS expression run in the page that must return true or false. Anything else fails it.
async function check(label, expr) {
  let ok = false, err = "";
  try {
    const v = typeof expr === "boolean" ? expr : await js(expr);
    if (typeof v !== "boolean") throw new Error(`check returned ${typeof v}, not true/false`);
    ok = v;
  } catch (e) { err = e.message; }
  checks++;
  current.checks.push({ label, ok });
  await toast(`${ok ? "✓" : "✗"} ${label}`, ok ? "" : "bad");
  await sleep(450);
  if (!ok) throw new Error(`Check failed: ${label}${err ? " (" + err + ")" : ""}`);
}
// A target is visible text (button, link, field, label) or a CSS selector / JS expression.
const el = (t) => (/^[#.\[]|[(]/.test(t) ? (/[(]/.test(t) ? t : `document.querySelector(${JSON.stringify(t)})`) : `__tr.find(${JSON.stringify(t)})`);
async function moveTo(target) {
  const p = await js(`(() => { const e = ${el(target)}; if (!e) return null; e.scrollIntoView({block: 'center'}); return __tr.center(e); })()`);
  if (!p) throw new Error("Not found on the page: " + target);
  await sleep(150);
  const q = await js(`__tr.center(${el(target)})`);
  await js(`__tr.move(${q.x}, ${q.y})`);
  cursor = q;
  await sleep(520);
  return q;
}
async function click(target, after = 450) {
  const p = await moveTo(target);
  await js(`__tr.pulse(${p.x}, ${p.y})`);
  await js(`(() => { const e = ${el(target)}; e.focus(); e.click(); })()`);
  await sleep(after);
}
async function select(target, value) {
  const p = await moveTo(target);
  await js(`__tr.pulse(${p.x}, ${p.y})`);
  await js(`(() => { const s = ${el(target)}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(500);
}
async function type(target, text, cps = 28) {
  await click(target, 200);
  for (const ch of text) { await cdp("Input.insertText", { text: ch }); await sleep(1000 / cps); }
}
const filePath = (f) => (isAbsolute(f) ? f : join(plan.files_dir, f));
// Put real files from disk into a file input (the same as choosing them in the file dialog).
// `pointAt` is what the cursor moves to first, e.g. the drop zone.
async function upload(inputSelector, files, pointAt = null) {
  if (pointAt) { const p = await moveTo(pointAt); await js(`__tr.pulse(${p.x}, ${p.y})`); }
  const { root } = await cdp("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: inputSelector });
  if (!nodeId) throw new Error("File input not found: " + inputSelector);
  await cdp("DOM.setFileInputFiles", { nodeId, files: [].concat(files).map(filePath) });
  await sleep(300);
}
// Wait while something slow happens (an AI answer, an encode), with the wait cut out of the video.
async function waitWhile(busyExpr, ms = 120000, label = "Working") {
  await sleep(250);
  if (!(await js(busyExpr).catch(() => false))) return;
  await status(`${label}…`);
  pauseRec();
  try { await waitFor(`!(${busyExpr})`, ms, label.toLowerCase()); }
  finally { await resumeRec(label); }
}

// ---- the app's tests -------------------------------------------------------------------------
const t = {
  test: (name, say, fn) => TESTS.push({ name, say, fn }),
  check, click, select, type, upload, moveTo, waitFor, waitWhile, load, js, cdp, sleep, status, toast,
  waitText: (text, ms) => waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, ms, `"${text}"`),
  waitGone: (text, ms) => waitFor(`!document.body.innerText.includes(${JSON.stringify(text)})`, ms, `"${text}" to go`),
  peek: (title, text) => js(`__tr.peek(${JSON.stringify(title)}, ${JSON.stringify(String(text).slice(0, 1200))})`),
  unpeek: () => js(`__tr.unpeek()`),
  sha256InPage: (expr) => js(`(async () => __tr.sha256(await (${expr})))()`),
  lastDialog: () => lastDialog,
  clearDialog: () => { lastDialog = null; },
  downloads: () => readdirSync(DOWNLOADS),
  downloadsDir: DOWNLOADS, out: OUT, files: plan.files_dir, config: cfg, app: APP, vars: plan.vars ?? {},
  url: (path = "/") => new URL(path, APP).href,   // t.app is the app's address (a string); t.url("/settings") builds a page address
  saveText: (name, text) => writeFileSync(join(OUT, name), text),
};
const mod = await import(pathToFileURL(plan.tests_file).href);
await mod.default(t);
if (plan.quick) {
  const keep = cfg.quick ?? [];
  const missing = keep.filter((n) => !TESTS.some((x) => x.name === n));
  if (missing.length) console.error("quick list names tests that don't exist: " + missing.join(", "));
  const picked = keep.map((n) => TESTS.find((x) => x.name === n)).filter(Boolean); // in the quick list's order
  TESTS.length = 0;
  TESTS.push(...picked);
}
if (plan.only?.length) {
  const picked = TESTS.filter((x) => plan.only.some((o) => x.name.toLowerCase().includes(o.toLowerCase())));
  TESTS.length = 0;
  TESTS.push(...picked);
}
TESTS.forEach((x, i) => (x.id = `t${String(i + 1).padStart(2, "0")}`));
if (!TESTS.length) throw new Error("No tests to run");

// ---- run ------------------------------------------------------------------------------------
const unit = plan.unit;
const u = { total: unit.tests.length, passed: unit.tests.filter((x) => x.outcome === "passed").length,
            failed: unit.tests.filter((x) => x.outcome === "failed" || x.outcome === "xpassed").length };
const INTRO = cfg.intro ?? `This is an automated test run of ${cfg.title}. A browser uses the real app the way a person would, and every result is checked on screen.`;
const UNIT = `The automated test suite ran ${u.total} tests. ${u.passed} passed` + (u.failed ? ` and ${u.failed} failed.` : ".");
const showUnit = u.total > 0;

for (const x of TESTS) state.tests.push({ name: x.name, s: "todo" });
const lines = [{ id: "intro", text: INTRO }, ...(showUnit ? [{ id: "unit", text: UNIT }] : []),
  ...TESTS.map((x) => ({ id: x.id, text: x.say }))];
console.log(`voice: ${lines.length} lines`);
const durs = voice(lines);

const results = [];
const cue = (id) => rec.cues.push({ id, t: vt() });
const cards = pathToFileURL(join(plan.scripts_dir, "cards.html")).href;

await cdp("Page.navigate", { url: cards });
await waitFor(`typeof render === 'function'`, 15000);
await js(`render('title', ${JSON.stringify(plan.title)})`);
await sleep(300);
await startRec();
cue("intro");
await hold(durs.intro * 1000 + 900);

if (showUnit) {
  await js(`render('unit', ${JSON.stringify({ ...unit, labels: cfg.suite?.labels ?? {} })})`);
  cue("unit");
  const unitMs = Math.max(durs.unit * 1000 + 1200, Math.min(40000, 4000 + unit.tests.length * 90));
  await js(`autoScroll(${unitMs})`);
  await hold(unitMs);
}

await load();
for (const [i, x] of TESTS.entries()) {
  current = { label: `Test ${i + 1} of ${TESTS.length} · ${x.name}`, say: x.say, checks: [] };
  state.tests[i].s = "run";
  await js(`__tr.panel(${JSON.stringify(state)}); __tr.clearToasts(); __tr.banner(${JSON.stringify(current.label)}, ${JSON.stringify(x.say)}, '')`);
  const v0 = vt(), w0 = Date.now();
  cue(x.id);
  let st = "pass", error = "";
  try {
    await Promise.race([x.fn(), sleep(900000).then(() => { throw new Error("Test took longer than 15 minutes"); })]);
    if (!current.checks.length) throw new Error("Test made no checks");
  } catch (e) {
    st = "fail"; error = e.message;
    if (!rec.on) await resumeRec();
    await toast("✗ " + error.slice(0, 140), "bad").catch(() => {});
    try { writeFileSync(join(OUT, `fail-${x.id}.jpg`), Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 85 })).data, "base64")); } catch {}
  }
  const need = durs[x.id] * 1000 + 700 - (vt() - v0); // let the narration finish
  if (need > 0) await hold(need);
  state.tests[i].s = st;
  await js(`__tr.panel(${JSON.stringify(state)}); __tr.status(${JSON.stringify(st === "pass" ? "✓ Passed" : "✗ Failed: " + error.slice(0, 120))})`).catch(() => {});
  await hold(900);
  results.push({ id: x.id, name: x.name, status: st, error, ms: Date.now() - w0, checks: current.checks });
  console.log(`${st === "pass" ? "PASS" : "FAIL"}  ${x.name}${error ? "  -- " + error : ""}`);
}
current = null;

const ePass = results.filter((r) => r.status === "pass").length;
const eFail = results.length - ePass;
const bad = eFail + u.failed;
const SUMMARY = (bad === 0
  ? `All checks passed. ${ePass} of ${results.length} browser tests` + (showUnit ? ` and ${u.passed} of ${u.total} suite tests` : "") +
    ` passed, with ${checks} checks made on screen.`
  : `${bad} ${bad === 1 ? "test needs" : "tests need"} attention. ${ePass} of ${results.length} browser tests passed` +
    (showUnit ? `, and ${u.passed} of ${u.total} suite tests.` : ".")) + ` A full report is saved next to this video.`;
pauseRec();
const sdur = voice([{ id: "summary", text: SUMMARY }]).summary;
await cdp("Page.navigate", { url: cards });
await waitFor(`typeof render === 'function'`, 15000);
await js(`render('summary', ${JSON.stringify({ e2e: results, unit: unit.tests, checks })})`);
await sleep(300);
await resumeRec();
cue("summary");
await hold(sdur * 1000 + 2500);
const length = vt();
rec.on = false;
await cdp("Page.stopScreencast").catch(() => {});

writeFileSync(join(FRAMES, "frames.json"), JSON.stringify({ frames: rec.frames, length }));
writeFileSync(join(OUT, "e2e.json"), JSON.stringify({ results, checks, cues: rec.cues, durations: { ...durs, summary: sdur }, summary_text: SUMMARY }, null, 1));
console.log(`\nbrowser tests: ${ePass}/${results.length} passed, ${checks} checks, ${rec.frames.length} frames, ${(length / 1000).toFixed(1)} s of video`);

ws.close();
if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
else browser.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
// Exit explicitly: an open socket or timer must never keep the run waiting after the results are saved.
process.exit(eFail ? 1 : 0);
