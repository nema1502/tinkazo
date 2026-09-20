/**
 * Chrome headless por DevTools Protocol, sin dependencias.
 * Node 22+ trae WebSocket y fetch, así que no hace falta Puppeteer.
 *
 * Lo usan `scripts/smoke.mjs` y `scripts/audit-game.mjs`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const chrome = CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error("no encontré Chrome ni Edge; definí CHROME=<ruta>");
  return chrome;
}

/** Cliente mínimo del DevTools Protocol sobre un WebSocket. */
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
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
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** Evalúa una expresión en la página y devuelve su valor. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  /** Espera a que la expresión sea verdadera. Devuelve si lo logró y cuánto tardó. */
  async waitFor(expression, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await this.eval(`!!(${expression})`)) return { ok: true, elapsed: Date.now() - t0 };
      } catch {
        /* la página puede estar navegando */
      }
      await sleep(400);
    }
    return { ok: false, elapsed: Date.now() - t0 };
  }

  async screenshot(path) {
    const { writeFile } = await import("node:fs/promises");
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
  }
}

/**
 * Abre Chrome, devuelve `{ open(url), close() }`.
 * `open` entrega una CDP nueva por pestaña, ya navegada.
 */
export async function launch({ port = Number(process.env.CDP_PORT || 9222), width = 1280, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "tinkazo-chrome-"));
  const proc = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* todavía no levantó */
    }
    if (i > 60) throw new Error("Chrome no expuso DevTools");
    await sleep(200);
  }

  const sockets = [];
  return {
    async open(url) {
      const target = await (
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
      ).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.addEventListener("open", res);
        ws.addEventListener("error", rej);
      });
      sockets.push(ws);
      const cdp = new CDP(ws);
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url });
      return cdp;
    },
    close() {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* ya cerrado */
        }
      }
      try {
        proc.kill();
      } catch {
        /* ya cerrado */
      }
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* perfil en uso */
      }
    },
  };
}
