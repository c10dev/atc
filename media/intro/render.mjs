#!/usr/bin/env node
// Renders media/intro/index.html to an MP4: headless Chromium over CDP (Node's built-in WebSocket) -> PNG frames -> ffmpeg.
// No npm dependency. Needs: node 24, ffmpeg, a Chromium (see README.md). Usage: node media/intro/render.mjs [--square] [--fps 30] [--out <dir>] [--frame <seconds>]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);

const square = flag("--square");
const fps = Number(opt("--fps", "30"));
const outDir = resolve(opt("--out", join(homedir(), "atc-media", "intro")));
const W = square ? 1080 : 1920, H = 1080;
const outFile = join(outDir, square ? "atc-intro-1x1.mp4" : "atc-intro-16x9.mp4");
const url = `${pathToFileURL(join(here, "index.html"))}${square ? "?aspect=1x1" : ""}`;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const pw = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(pw)) {
    const shells = readdirSync(pw).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of shells) {
      const p = join(pw, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium"]) if (existsSync(p)) return p;
  throw new Error("No Chromium found. Set CHROME_BIN to a chrome or chrome-headless-shell binary.");
}
if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg not found on PATH");

const profile = mkdtempSync(join(tmpdir(), "atc-intro-"));
const chrome = spawn(findChrome(), ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
const cleanup = () => { chrome.kill(); rmSync(profile, { recursive: true, force: true }); };
process.on("exit", cleanup);

async function waitPort() {
  const f = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(f)) return readFileSync(f, "utf8").split("\n")[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chromium did not open a DevTools port");
}
const port = await waitPort();
let page;
for (let i = 0; i < 50 && !page; i++) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  page = list.find((t) => t.type === "page");
  if (!page) await new Promise((r) => setTimeout(r, 100));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });

await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp("Page.enable");
await cdp("Page.navigate", { url });
for (let i = 0; i < 100; i++) {
  const r = await cdp("Runtime.evaluate", { expression: "typeof window.seek === 'function' && document.readyState === 'complete'", returnByValue: true });
  if (r.result.value) break;
  await new Promise((r) => setTimeout(r, 100));
}
const duration = (await cdp("Runtime.evaluate", { expression: "window.DURATION", returnByValue: true })).result.value;
const frame = async (t) => {
  await cdp("Runtime.evaluate", { expression: `seek(${t})` });
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  return Buffer.from(data, "base64");
};

mkdirSync(outDir, { recursive: true });
if (opt("--frame", null) !== null) {
  // one still for a quick look: node render.mjs --frame 12.5  (written next to the video, never committed)
  const f = join(outDir, `frame-${String(opt("--frame")).replace(".", "_")}${square ? "-1x1" : ""}.png`);
  writeFileSync(f, await frame(Number(opt("--frame"))));
  console.log(f);
  cleanup();
  process.exit(0);
}

const total = Math.round(duration * fps);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-tag:v", "avc1", outFile], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res) => ff.on("close", res));
for (let n = 0; n < total; n++) {
  const buf = await frame(n / fps);
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (n % 60 === 0) process.stdout.write(`\rframe ${n}/${total}`);
}
ff.stdin.end();
const code = await done;
cleanup();
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
console.log(`\n${outFile} · ${(statSync(outFile).size / 1e6).toFixed(1)} MB · ${duration}s @ ${fps} fps`);
