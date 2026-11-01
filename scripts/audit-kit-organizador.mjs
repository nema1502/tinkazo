#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import jsQR from "jsqr";

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (args.includes("--help")) {
  console.log(`Usage: node scripts/audit-kit-organizador.mjs --base http://localhost:5187 [--playwright /absolute/path/to/playwright/index.mjs] [--engine webkit] [--out .evidence/kit-organizador/browser]
Uses an already installed Playwright, an already running parent-owned server, and normal browser sandboxing. Never starts a server, installs dependencies or creates a PDF. Checks desktop/mobile-emulated ES/EN, real language buttons, print mode selection/reset, card geometry under print CSS, and decodes the static QR with its quiet zone. Screenshots are NOT PDF/physical-phone evidence. Preview authentication must already be authorized by the parent.`);
  process.exit(0);
}
const base = new URL(value("--base", "http://localhost:5187"));
if (base.username || base.password || base.search || base.hash) throw new Error("Supply a clean base URL without credentials, query or fragment");
const out = resolve(value("--out", ".evidence/kit-organizador/browser"));
if (!relative(resolve(".evidence/kit-organizador"), out).startsWith("..") && out.startsWith(resolve(".evidence/kit-organizador"))) mkdirSync(out, { recursive: true });
else throw new Error("Evidence output must stay inside .evidence/kit-organizador");
const modulePath = value("--playwright", null);
const { webkit, firefox, chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const engine = value("--engine", "webkit");
if (!["webkit", "firefox", "chromium"].includes(engine)) throw new Error("Supported engines: webkit, firefox, chromium");
const browser = await ({ webkit, firefox, chromium })[engine].launch({ headless: true });
const records = [];
let activeContext;
let activePage;
const check = (ok, name, detail = "") => {
  records.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) throw new Error(name);
};
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    activeContext = context;
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    const scripts = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname); });
    const response = await page.goto(new URL("/sorteo-para-meetup.html?lang=es&theme=light", base).href);
    check(response?.ok(), `${width}: page response`);
    await page.locator('[data-kit-print="guide"]').waitFor();
    check(await page.locator(".kit-guide").count() === 1, `${width}: genuine guide, not login/protection page`);
    await page.waitForFunction(() => document.documentElement.lang === "es");
    for (const lang of ["es", "en", "es"]) {
      await page.locator(`#l-${lang}`).click();
      await page.waitForFunction((l) => document.documentElement.lang === l, lang);
      check(await page.locator(`.kit-language[lang="${lang}"]`).isVisible(), `${width} ${lang}: selected guide visible`);
      check(!await page.locator(`.kit-language[lang="${lang === "es" ? "en" : "es"}"]`).isVisible(), `${width} ${lang}: other guide hidden`);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        cards: [...document.querySelectorAll(".kit-card")].every((card) => [...card.querySelectorAll("[lang]")].every((el) => getComputedStyle(el).display !== "none")),
        dot: document.body.innerText.includes("·"),
        broken: [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute("src")),
      }));
      check(state.overflow <= 1, `${width} ${lang}: no horizontal overflow`, String(state.overflow));
      check(state.cards, `${width} ${lang}: both card languages remain visible`);
      check(!state.dot, `${width} ${lang}: no visible middle dot`);
      check(state.broken.length === 0, `${width} ${lang}: local images loaded`, JSON.stringify(state.broken));
      await page.locator(`a[href="#kit-${lang}-4"]`).click();
      check(new URL(page.url()).hash === `#kit-${lang}-4`, `${width} ${lang}: section navigation`);
      await page.screenshot({ path: resolve(out, `${engine}-${width}-${lang}.png`), fullPage: true });
    }
    const pixels = await page.locator(".kit-card-qr img").first().evaluate((img) => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 360;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 360, 360);
      return Array.from(ctx.getImageData(0, 0, 360, 360).data);
    });
    const decoded = jsQR(new Uint8ClampedArray(pixels), 360, 360);
    check(decoded?.data === "https://tinkazo.app/sorteo-para-meetup.html#comprobacion", `${width}: printed static QR destination`);
    const quiet = pixels.every((v, i) => {
      const pixel = Math.floor(i / 4), x = pixel % 360, y = Math.floor(pixel / 360);
      return i % 4 === 3 || (x >= 32 && x < 328 && y >= 32 && y < 328) || v === 255;
    });
    check(quiet, `${width}: four-module white quiet zone`);
    await page.evaluate(() => { window.print = () => { window.__kitPrintCalled = document.documentElement.dataset.kitPrint; }; });
    for (const mode of ["guide", "cards"]) {
      await page.locator(`[data-kit-print="${mode}"]`).click();
      check(await page.evaluate((m) => window.__kitPrintCalled === m && document.documentElement.dataset.kitPrint === m, mode), `${width}: ${mode} print control`);
      await page.emulateMedia({ media: "print" });
      const geometry = await page.evaluate((mode) => {
        const card = document.querySelector(".kit-card");
        const box = card.getBoundingClientRect();
        const sheet = document.querySelector(".kit-card-sheet").getBoundingClientRect();
        const textFits = [...card.querySelectorAll("h3, p, li, img, a")].every((el) => {
          const r = el.getBoundingClientRect(); return r.bottom <= box.bottom + .5 && r.right <= box.right + .5 && r.left >= box.left - .5;
        });
        return { mode, textFits, cardHeight: box.height, sheetHeight: sheet.height,
          guideVisible: getComputedStyle(document.querySelector(".kit-guide")).display !== "none",
          cardsVisible: getComputedStyle(document.querySelector(".kit-cards-section")).display !== "none",
          font: getComputedStyle(document.querySelector(".kit-card-language li")).fontSize,
          qr: document.querySelector(".kit-card-qr img").getBoundingClientRect().width };
      }, mode);
      check(geometry.guideVisible === (mode === "guide") && geometry.cardsVisible === (mode === "cards"), `${width}: ${mode} print-only content`, JSON.stringify(geometry));
      if (mode === "cards") {
        check(geometry.textFits && geometry.sheetHeight <= 277 * 96 / 25.4 + 1, `${width}: two-card A4 CSS geometry (not PDF proof)`);
        check(parseFloat(geometry.font) >= 14 * 96 / 72 - .1 && geometry.qr >= 32 * 96 / 25.4, `${width}: print type and QR sizes`);
        await page.screenshot({ path: resolve(out, `${engine}-${width}-print-cards-CSS-only.png`), fullPage: true });
      }
      await page.emulateMedia({ media: "screen" });
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      check(await page.evaluate(() => !document.documentElement.dataset.kitPrint), `${width}: afterprint reset`);
    }
    await page.locator('a[href="#comprobacion"]').click();
    check(await page.locator("#comprobacion").isVisible(), `${width}: public fragment target exists`);
    check(errors.length === 0, `${width}: no runtime exceptions`, JSON.stringify(errors));
    records.push({ name: `${width}: initial scripts for bundle inspection`, scripts });
    await context.tracing.stop({ path: resolve(out, `${engine}-${width}-trace.zip`) });
    await context.close();
    activeContext = undefined;
    activePage = undefined;
  }
} catch (error) {
  records.push({ ok: false, name: "audit stopped", detail: error.message });
  if (activePage) await activePage.screenshot({ path: resolve(out, `${engine}-first-failure.png`), fullPage: true }).catch(() => {});
  if (activeContext) await activeContext.tracing.stop({ path: resolve(out, `${engine}-first-failure-trace.zip`) }).catch(() => {});
  throw error;
} finally {
  writeFileSync(resolve(out, "results.json"), JSON.stringify({ engine, records, limitations: ["Print CSS geometry is not a PDF pagination proof", "Mobile viewport is not a physical phone", "No projection hardware was tested", "Parent owns native A4 PDF and preview checks"] }, null, 2));
  await browser.close();
}
