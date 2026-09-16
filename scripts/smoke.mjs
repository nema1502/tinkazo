#!/usr/bin/env node
/**
 * Smoke test del sitio con Chrome headless vía DevTools Protocol, sin
 * dependencias (Node 22+ trae WebSocket y fetch).
 *
 * Uso:  node scripts/smoke.mjs <url> [--wait "<expresión JS>"] [--timeout 40000]
 *
 * Abre la URL, espera hasta que la expresión sea verdadera (por defecto: hay
 * una tarjeta de ganador) y luego imprime un resumen del DOM y los errores de
 * consola. Sale con código 1 si la condición no se cumple a tiempo o si hubo
 * excepciones no capturadas.
 *
 * Variables: CHROME (ruta del binario), CDP_PORT (9222).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("uso: node scripts/smoke.mjs <url> [--wait <js>] [--timeout <ms>]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const waitExpr = opt("--wait", "document.querySelectorAll('.winner-name').length > 0");
const timeoutMs = Number(opt("--timeout", "40000"));
const port = Number(process.env.CDP_PORT || 9222);

const candidates = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("no encontré Chrome/Edge; define CHROME=<ruta>");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "tinkazo-smoke-"));
const proc = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => {
  try { proc.kill(); } catch { /* ya cerrado */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* perfil en uso */ }
};
process.on("exit", cleanup);

async function waitForDevtools() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch { /* todavía no */ }
    await sleep(200);
  }
  throw new Error("Chrome no expuso DevTools");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.console = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.exceptions.push(d.exception?.description || d.text);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.console.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }
}

async function main() {
  await waitForDevtools();
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new CDP(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url });

  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await cdp.eval(`!!(${waitExpr})`)) { ok = true; break; }
    } catch { /* la página puede estar navegando */ }
    await sleep(500);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const summary = await cdp.eval(`JSON.stringify({
    title: document.title,
    lang: document.documentElement.lang,
    entities: document.getElementById('entities')?.textContent || '',
    proof: document.getElementById('proof')?.textContent || '',
    drawBtn: document.getElementById('btn-draw')?.textContent || '',
    winners: [...document.querySelectorAll('.winner-name')].map(e => e.textContent),
    drandLink: document.getElementById('drand-link')?.getAttribute('href') || '',
    footer: document.querySelector('[data-i="footL"]')?.textContent || '',
  })`);
  const s = JSON.parse(summary);
  console.log(`${ok ? "OK" : "TIMEOUT"} tras ${elapsed} s · ${url}`);
  for (const [k, v] of Object.entries(s)) console.log(`  ${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v).slice(0, 160)}`);
  if (cdp.exceptions.length) console.log("  excepciones:", cdp.exceptions.slice(0, 3));
  if (cdp.console.length) console.log("  console.error:", cdp.console.slice(0, 3));
  ws.close();
  process.exitCode = ok && cdp.exceptions.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error("smoke falló:", e.message); process.exitCode = 1; }).finally(cleanup);
