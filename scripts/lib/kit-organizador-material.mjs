#!/usr/bin/env node
/** Rebuild only the supplied organizer material and the fixed, local QR. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import qrcode from "qrcode-generator";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/lib/kit-organizador-material.mjs --write\nRebuild the marked guide/cards in sorteo-para-meetup.html and public/kit-organizador/comprobacion.svg from L1 and the four L4-approved corrections. No network or dependencies are installed.");
  process.exit(0);
}
if (!process.argv.includes("--write")) throw new Error("Use --help or --write");
const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("odd/tasks/kit-organizador.md", root), "utf8").split("L1 — User request (verbatim):")[1].split("L2 — Main refreshed")[0];
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const text = (s) => esc(s).replaceAll("hola@tinkazo.app", '<a href="mailto:hola@tinkazo.app">hola@tinkazo.app</a>');
const url = "https://tinkazo.app/sorteo-para-meetup.html#comprobacion";
const guide = source.split("# ES\n")[1].split("# La tarjeta para las mesas")[0];
const es = guide.split("\n# EN\n")[0].replace(/\n---\s*$/, "").trim();
const en = guide.split("\n# EN\n")[1].replace(/\n---\s*$/, "").trim();
const approved = (s, lang) => lang === "es" ? s
  .replace("«Entrar con Google»", "«Entrar con Google y sortear»")
  .replace("«Siguiente premio»", "«Siguiente premio (quedan […])»")
  .replace("Chromecast. En Chrome: los tres puntos, «Transmitir», y elegí tu pantalla. También en el mismo wifi.", "Chromecast desde una computadora. En Chrome: los tres puntos, «Transmitir, guardar y compartir», «Transmitir…», y elegí tu pantalla. También en el mismo wifi.")
  .replace("Agregale esto arriba:", "En la web, tocá «Advanced» para pegar el mensaje completo. Agregale esto arriba:") : s
  .replace('"Sign in with Google"', '"Sign in with Google and draw"')
  .replace('"Next prize"', '"Next prize ([…] left)"')
  .replace('Chromecast. In Chrome: the three dots, "Cast", and pick your screen. Same wifi here too.', 'Chromecast from a computer. In Chrome: the three dots, "Cast, save and share", "Cast…", and pick your screen. Same wifi here too.')
  .replace("Add this on top:", 'On the web, click "Advanced" to paste the full message. Add this on top:');

// The source uses only paragraphs, headings, ordered/unordered lists, quotes and a table.
// Preserve the words and punctuation; convert only the source's Markdown structure.
function render(markdown, lang) {
  const lines = markdown.split("\n");
  const out = [];
  const lists = [];
  let quote = false;
  let table = false;
  const closeLists = () => { while (lists.length) out.push(`</li></${lists.pop()}>`); };
  const closeQuote = () => { if (quote) { out.push("</blockquote>"); quote = false; } };
  const closeTable = () => { if (table) { out.push("</tbody></table></div>"); table = false; } };
  for (const line of lines) {
    const s = line.trim();
    if (!s) { closeLists(); closeQuote(); closeTable(); continue; }
    if (s.startsWith(">")) {
      closeLists(); closeTable();
      if (!quote) { out.push('<blockquote class="kit-template">'); quote = true; }
      out.push(`<p>${text(s.replace(/^> ?/, ""))}</p>`);
    } else if (s.startsWith("|")) {
      closeLists(); closeQuote();
      const cells = s.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!table) {
        out.push(`<div class="kit-table"><table><thead><tr>${cells.map((c) => `<th scope="col">${text(c)}</th>`).join("")}</tr></thead><tbody>`);
        table = true;
      } else out.push(`<tr>${cells.map((c) => `<td>${text(c)}</td>`).join("")}</tr>`);
    } else if (/^###? /.test(s)) {
      closeLists(); closeQuote(); closeTable();
      if (s.startsWith("### ")) {
        const n = s.match(/^### (\d)/)[1];
        out.push(`<h3 id="kit-${lang}-${n}">${text(s.slice(4))}</h3>`);
      } else out.push(`<h2>${text(s.slice(3))}</h2>`);
    } else if (/^(\d+\. |[-] )/.test(s)) {
      closeQuote(); closeTable();
      const kind = /^\d/.test(s) ? "ol" : "ul";
      // Only the three feedback questions are a nested list in Guido's source.
      const nested = /^   - /.test(line);
      const depth = nested ? 2 : 1;
      while (lists.length > depth) out.push(`</li></${lists.pop()}>`);
      if (lists.length === depth && lists.at(-1) !== kind) out.push(`</li></${lists.pop()}>`);
      if (lists.length < depth) { out.push(`<${kind}>`); lists.push(kind); }
      else out.push("</li>");
      out.push(`<li>${text(s.replace(/^(\d+\. |[-] )/, ""))}`);
    } else {
      closeLists(); closeQuote(); closeTable();
      out.push(`<p>${text(s)}</p>`);
    }
  }
  closeLists(); closeQuote(); closeTable();
  return out.join("\n");
}
const nav = (s, lang) => `<nav class="kit-index" data-i-aria="kitNav" aria-label="Pasos de la guía"><ol>${[...s.matchAll(/^### (.+)$/gm)].map((m, i) => `<li><a href="#kit-${lang}-${i + 1}">${esc(m[1])}</a></li>`).join("")}</ol></nav>`;
const cardSource = source.split("# La tarjeta para las mesas")[1].split("# Notas para vos")[0];
const cardParts = cardSource.split("## ES\n")[1].split("## EN\n");
function cardLang(part, lang) {
  const rows = part.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).filter(Boolean);
  const [title, prize, ...rest] = rows;
  const rules = rest.filter((l) => /^\d\./.test(l));
  const free = rest.find((l) => /^(Participar|Entry)/.test(l));
  return `<div class="kit-card-language" lang="${lang}"><h3>${esc(title)}</h3><p>${esc(prize)}</p><ol>${rules.map((l) => `<li>${esc(l.slice(3))}</li>`).join("")}</ol><p>${esc(free)}</p></div>`;
}
const card = `<article class="kit-card"><div class="kit-card-brand"><span class="wm-text">Tinka<b>zo</b></span></div><div class="kit-card-columns">${cardLang(cardParts[0], "es")}${cardLang(cardParts[1], "en")}</div><div class="kit-card-qr"><a href="${url}"><img src="/kit-organizador/comprobacion.svg" width="132" height="132" alt="Cómo funciona / How it works" data-i-aria="kitQrAlt" aria-label="Cómo funciona: abrir la explicación" /></a><div><p><span lang="es">Cómo funciona</span> / <span lang="en">How it works</span></p><a href="${url}" class="kit-paper-url">tinkazo.app/sorteo-para-meetup.html#comprobacion</a><p>tinkazo.app</p></div></div></article>`;
const block = `<!-- kit:material:start -->
<section class="kit-guide" aria-label="Guía / Guide">
  <div class="kit-controls"><button type="button" data-kit-print="guide" data-i="kitPrintGuide">Imprimir guía A4</button><a href="#kit-tarjetas" data-i="kitCardsLink">Tarjetas para las mesas</a><a href="#comprobacion" data-i="meetTrustT">Por qué se puede comprobar</a></div>
  <div class="kit-language" lang="es">${nav(es, "es")}${render(approved(es, "es"), "es")}</div>
  <div class="kit-language" lang="en">${nav(en, "en")}${render(approved(en, "en"), "en")}</div>
</section>
<section id="kit-tarjetas" class="kit-cards-section">
  <div class="kit-controls"><h2 data-i="kitCardsTitle">Tarjetas bilingües para las mesas</h2><p data-i="kitCardsHelp">Dos tarjetas planas por hoja A4. Imprimí al 100 %, sin encabezados ni pies del navegador.</p><button type="button" data-kit-print="cards" data-i="kitPrintCards">Imprimir dos tarjetas A4</button><a href="#kit-es-1" class="kit-back-es" lang="es">Volver a la guía</a><a href="#kit-en-1" class="kit-back-en" lang="en">Back to the guide</a></div>
  <div class="kit-card-sheet">${card}\n${card}</div>
</section>
<!-- kit:material:end -->`;
const file = new URL("sorteo-para-meetup.html", root);
let html = readFileSync(file, "utf8");
if (html.includes("<!-- kit:material:start -->")) html = html.replace(/<!-- kit:material:start -->[\s\S]*?<!-- kit:material:end -->/, block);
else html = html.replace(/  <section style="padding: 14px 0 0">\n    <h2 class="kicker" data-i="meetStepsT">[\s\S]*?<\/section>/, block);
html = html.replace(/<section style="padding: 14px 0 0">\n    <h2 class="kicker" data-i="meetTrustT">/, '<section id="comprobacion" style="padding: 14px 0 0">\n    <h2 class="kicker" data-i="meetTrustT">');
html = html.replace('src="/src/pagina.ts"', 'src="/src/kit-organizador.ts"');
writeFileSync(file, html);
const qr = qrcode(0, "Q");
qr.addData(url);
qr.make();
mkdirSync(new URL("public/kit-organizador/", root), { recursive: true });
writeFileSync(new URL("public/kit-organizador/comprobacion.svg", root), qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }));
console.log(`Generated bilingual guide and two cards; fixed QR ${url}; ${qr.getModuleCount()} modules + 4 white modules each side.`);
