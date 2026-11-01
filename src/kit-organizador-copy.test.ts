import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("sorteo-para-meetup.html");
// L1 is supplied editorial source, not a reimplementation of the renderer.
// L3/L4 authorize only these four ES/EN differences from that source.
const source = read("odd/tasks/kit-organizador.md").split("L1 — User request (verbatim):")[1]!.split("L2 — Main refreshed")[0]!;
const material = source.split("# ES\n")[1]!.split("# Notas para vos")[0]!;
const approved = new Map([
  ["«Entrar con Google»", "«Entrar con Google y sortear»"],
  ['"Sign in with Google"', '"Sign in with Google and draw"'],
  ["«Siguiente premio»", "«Siguiente premio (quedan […])»"],
  ['"Next prize"', '"Next prize ([…] left)"'],
  ["Chromecast. En Chrome: los tres puntos, «Transmitir», y elegí tu pantalla. También en el mismo wifi.", "Chromecast desde una computadora. En Chrome: los tres puntos, «Transmitir, guardar y compartir», «Transmitir…», y elegí tu pantalla. También en el mismo wifi."],
  ['Chromecast. In Chrome: the three dots, "Cast", and pick your screen. Same wifi here too.', 'Chromecast from a computer. In Chrome: the three dots, "Cast, save and share", "Cast…", and pick your screen. Same wifi here too.'],
  ["Agregale esto arriba:", "En la web, tocá «Advanced» para pegar el mensaje completo. Agregale esto arriba:"],
  ["Add this on top:", 'On the web, click "Advanced" to paste the full message. Add this on top:'],
]);
const plain = html.replace(/<\/?(?:a|b|span)\b[^>]*>/g, "").replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ");

describe("Guido's supplied copy, with only the four expressly approved guide corrections", () => {
  it("contains every source heading, paragraph, rule and table cell in both languages", () => {
    const lines = material.split("\n").map((s) => s.trim()).filter(Boolean);
    let cardInstructions = false;
    let checked = 0;
    for (let line of lines) {
      if (line === "# La tarjeta para las mesas") { cardInstructions = true; continue; }
      if (cardInstructions && !line.startsWith(">")) continue;
      if (/^# (ES|EN)$|^## (ES|EN)$|^---$|^\|[-| ]+\|$/.test(line)) continue;
      line = line.replace(/^#{1,3} /, "").replace(/^> ?/, "").replace(/^\d+\. /, "").replace(/^- /, "").replace("[QR] ", "");
      if (!line) continue;
      for (const [before, after] of approved) line = line.replace(before, after);
      for (const cell of line.startsWith("|") ? line.slice(1, -1).split("|").map((s) => s.trim()) : [line]) {
        expect(plain, cell).toContain(cell);
        checked++;
      }
    }
    expect(checked).toBe(136);
  });
  it("has seven troubleshooting rows and two source quotations per language, and no visible middle dot", () => {
    expect(html.match(/<tr><td>/g)).toHaveLength(14);
    expect(html.match(/<blockquote class="kit-template">/g)).toHaveLength(4);
    expect(plain).not.toContain("·");
  });
  it("adds bilingual keys without repurposing the existing page keys", () => {
    for (const key of [...html.matchAll(/data-i(?:-aria)?="(kit[^"]+)"/g)].map((m) => m[1]!)) {
      expect(typeof T.es[key], key).toBe("string");
      expect(typeof T.en[key], key).toBe("string");
      expect(T.en[key], key).not.toBe(T.es[key]);
    }
    expect(T.es.meetH1).toBe("Sorteo para tu meetup, en pantalla grande");
    expect(T.en.meetH1).toBe("A draw for your meetup, on the big screen");
    expect(T.es.meetTrustT).toBe("Por qué se puede comprobar");
    expect(T.en.meetTrustT).toBe("Why you can check it");
    expect(T.es.meetNamesT).toBe("Qué pasa con los nombres");
    expect(T.en.meetNamesT).toBe("What happens to the names");
  });
});
