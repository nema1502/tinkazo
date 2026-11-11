import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La marca del modo en la cabecera. Sin modo Oficial es un `span.netbadge` y se esconde donde no entra
 * (celular y la fila de una línea entre 1101 y 1439 px). Con modo Oficial, `src/ui/wallet-ui.ts` la crea como
 * `button.netbadge` y tiene que verse en todos los anchos: confundir Prueba con Oficial es lo peor que puede pasar.
 */

interface Regla {
  medias: string[];
  selector: string;
  cuerpo: string;
}

/** Las reglas del archivo con las `@media` que las envuelven, sin comentarios. */
function reglas(css: string): Regla[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const salida: Regla[] = [];
  const pila: string[] = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === "{") {
      // Lo que viene antes de un `;` suelto (un `@import`, por ejemplo) no es parte de la cabeza.
      const cabeza = (limpio.slice(desde, i).split(";").pop() ?? "").trim();
      if (cabeza.startsWith("@")) {
        pila.push(cabeza);
        desde = i + 1;
      } else {
        const fin = limpio.indexOf("}", i);
        salida.push({ medias: pila.filter((p) => p.startsWith("@media")), selector: cabeza, cuerpo: limpio.slice(i + 1, fin) });
        i = fin;
        desde = fin + 1;
      }
    } else if (c === "}") {
      pila.pop();
      desde = i + 1;
    }
  }
  return salida;
}

const normal = (s: string) => s.replace(/\s+/g, " ").trim();
const esconde = (cuerpo: string) => /display\s*:\s*none/.test(cuerpo);
const MEDIA_ESCONDE = "@media (max-width: 760px), (min-width: 1101px) and (max-width: 1439px)";

describe("la marca del modo en la cabecera", () => {
  const todas = reglas(readFileSync(new URL("./styles.css", import.meta.url), "utf8"));

  it("en celular y de 1101 a 1439 px se esconde solo la marca de siempre, que es un span", () => {
    const enLaMedia = todas.filter((r) => r.medias.some((m) => normal(m) === MEDIA_ESCONDE));
    expect(enLaMedia.length).toBeGreaterThan(0);
    const escondidas = enLaMedia.filter((r) => esconde(r.cuerpo)).flatMap((r) => r.selector.split(",").map(normal));
    expect(escondidas).toContain(".auth span.netbadge:not(.bad)");
    expect(escondidas).not.toContain(".auth .netbadge:not(.bad)");
  });

  it("ninguna regla esconde un button.netbadge que no sea el de la otra red", () => {
    const culpables = todas
      .filter((r) => esconde(r.cuerpo))
      .flatMap((r) => r.selector.split(",").map(normal))
      .filter((sel) => {
        const ultimo = sel.split(/[\s>+~]+/).pop() ?? "";
        if (!/\.netbadge(?![\w-])/.test(ultimo)) return false;
        if (/(?:^|[^:])\.bad(?![\w-])/.test(ultimo.replace(/:not\([^)]*\)/g, ""))) return false;
        // Alcanza a un botón si no exige otro elemento (span, a, div…) que no sea button.
        const elemento = /^([a-z][a-z0-9-]*)/i.exec(ultimo)?.[1];
        return elemento === undefined || elemento === "button";
      });
    expect(culpables).toEqual([]);
  });

  const enMedia = (media: string, selector: string) =>
    todas.filter((r) => r.medias.some((m) => normal(m) === media) && r.selector.split(",").map(normal).includes(selector));

  it("en 460 px o menos el botón de la marca tiene su versión compacta, sin bajar del piso de 14 px de letra", () => {
    const compacta = enMedia("@media (max-width: 460px)", "header .auth button.netbadge")[0];
    expect(compacta).toBeDefined();
    const cuerpo = normal(compacta!.cuerpo);
    const letra = /font-size:\s*([\d.]+)px/.exec(cuerpo);
    expect(letra).not.toBeNull();
    // docs/ux.md: 14 px en todo texto, también a 320 px, y las mayúsculas no cuentan doble.
    expect(Number(letra![1])).toBeGreaterThanOrEqual(14);
    expect(cuerpo).toMatch(/padding:\s*0 4px/);
    expect(esconde(cuerpo)).toBe(false);
    // Con el botón, la cuenta se arrima: la fila del logo es la que no se puede partir.
    expect(enMedia("@media (max-width: 460px)", "header .auth:has(> button.netbadge)").map((r) => normal(r.cuerpo))).toContain("gap: 4px;");
  });

  // Medido con scripts/medir-cabecera-oficial.mjs sobre el build del ensayo: sin estas reglas, con el botón la cuenta caía a
  // una segunda fila entre 320 y 374 px y entre 461 y 560 px. La medida de verdad es la del navegador; esto cuida que no se borren.
  it("con el botón, la fila del logo se angosta: un idioma, la cuenta en su cara, sin borde repetido y la llama sola debajo de 350 px", () => {
    const cuerpos = (media: string, selector: string) => enMedia(media, selector).map((r) => normal(r.cuerpo)).join(" ");
    expect(esconde(cuerpos("@media (max-width: 700px)", "header .bar:has(button.netbadge) .langs button.on"))).toBe(true);
    expect(esconde(cuerpos("@media (min-width: 461px) and (max-width: 700px)", "header .auth:has(> button.netbadge) .cuenta-chip.dentro .cc-txt"))).toBe(true);
    expect(cuerpos("@media (min-width: 461px) and (max-width: 700px)", "header .auth:has(> button.netbadge) .cuenta-chip.fuera .cc-t")).toMatch(/clip: rect\(0 0 0 0\)/);
    expect(cuerpos(MEDIA_ESCONDE, "header .auth:has(> button.netbadge:not(.bad)) .netbadge + .hello")).toMatch(/border-left: 2px solid/);
    expect(esconde(cuerpos("@media (max-width: 349px)", "header .bar:has(button.netbadge) .wm-text"))).toBe(true);
    // El logo sin la palabra se sigue llamando Tinkazo para el lector de pantalla.
    expect(readFileSync(new URL("../index.html", import.meta.url), "utf8")).toMatch(/<a class="wordmark" href="\/" aria-label="Tinkazo">/);
  });

  it("el lector de pantalla oye la palabra que se ve: el botón no pisa su nombre con la pista", () => {
    const ui = readFileSync(new URL("./ui/wallet-ui.ts", import.meta.url), "utf8");
    const desde = ui.indexOf('const net = document.createElement("button")');
    expect(desde).toBeGreaterThan(0);
    const bloque = ui.slice(desde, ui.indexOf("box.appendChild(net)", desde));
    expect(bloque).toContain("net.textContent = t(modeNameKey(network.name))");
    expect(bloque).not.toMatch(/setAttribute\(\s*["']aria-label["']/);
  });

  it("el botón de la marca es un blanco de toque de 44 px, y de 48 en las pantallas táctiles", () => {
    const fuera = todas.filter((r) => r.medias.length === 0 && r.selector.split(",").map(normal).includes("button.netbadge"));
    expect(fuera.some((r) => /min-height:\s*44px/.test(r.cuerpo))).toBe(true);
    const tactil = enMedia("@media (pointer: coarse), (max-width: 760px)", "button.netbadge");
    expect(tactil.some((r) => /min-height:\s*48px/.test(r.cuerpo))).toBe(true);
    // Ninguna regla que alcance al botón le baja el alto, salvo la que lo saca de la vista con la otra red.
    const bajan = todas
      .filter((r) => /min-height:\s*(?:0|[1-3]?\d)px|min-height:\s*0\b|(?:^|[;\s])height:/.test(r.cuerpo))
      .flatMap((r) => r.selector.split(",").map(normal))
      .filter((sel) => /\.netbadge(?![\w-])/.test(sel.split(/[\s>+~]+/).pop() ?? "") && !/\.bad\b/.test(sel));
    expect(bajan).toEqual([]);
  });
});
