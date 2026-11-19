// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { app } from "../state";
import { abrirHojaDeModo, marcarSellandoAhora } from "./modo-ui";

/**
 * El botón para pasar de modo en la hoja del modo. Salía como una barra gris plana, sin borde ni sombra, de 23 px de
 * alto: llevaba la clase `solid`, que en `src/styles.css` solo existe como `button.mini.solid`, y sin `mini` ninguna
 * regla lo alcanzaba. Acá se abre la hoja de verdad y se mira qué reglas del archivo alcanzan al botón.
 */

const h = vi.hoisted(() => ({ red: "testnet" as "mainnet" | "testnet" }));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    network: {
      ...o.network,
      get name() {
        return h.red;
      },
    },
    changeMode: () => true,
  };
});

interface Regla {
  medias: string[];
  selector: string;
  cuerpo: string;
}

/** Las reglas del archivo con las `@media` que las envuelven, sin comentarios (misma forma que `marca-del-modo.test.ts`). */
function reglas(css: string): Regla[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const salida: Regla[] = [];
  const pila: string[] = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === "{") {
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
const todas = reglas(readFileSync("src/styles.css", "utf8"));

/** Las reglas de la hoja de estilos que alcanzan a ese elemento, con el selector que lo alcanzó. */
function alcanzan(el: Element): Regla[] {
  return todas.filter((r) =>
    r.selector.split(",").some((sel) => {
      try {
        return el.matches(normal(sel));
      } catch {
        return false; // un selector que jsdom no entiende no cuenta como alcance
      }
    }),
  );
}

/** El valor de una propiedad en el cuerpo de una regla, o null. */
const valor = (cuerpo: string, propiedad: string): string | null => {
  const m = new RegExp(`(?:^|[;\\s])${propiedad}\\s*:\\s*([^;]+)`).exec(cuerpo);
  return m ? normal(m[1]!) : null;
};

function abrir(red: "mainnet" | "testnet"): { boton: HTMLButtonElement; cerrar: HTMLButtonElement } {
  h.red = red;
  document.body.innerHTML = "";
  abrirHojaDeModo();
  const boton = document.querySelector<HTMLButtonElement>(".modo-card .modo-cambiar");
  const cerrar = document.querySelector<HTMLButtonElement>(".modo-card button.mini.ghost");
  if (!boton || !cerrar) throw new Error("la hoja del modo no armó sus botones");
  return { boton, cerrar };
}

beforeEach(() => {
  h.red = "testnet";
  app.frozen = null;
  app.drawn = null;
  marcarSellandoAhora(false);
  document.body.innerHTML = "";
});

describe("el botón para pasar de modo se ve como un botón del sitio", () => {
  for (const [red, texto] of [
    ["testnet", T.es.modeSwitchToOfficial],
    ["mainnet", T.es.modeSwitchToTest],
  ] as const) {
    describe(`desde ${red}, «${texto}»`, () => {
      it("nace con la clase del botón principal y con la suya, no con `solid` a secas", () => {
        const { boton } = abrir(red);
        expect(boton.textContent).toBe(texto);
        expect(boton.classList.contains("primary")).toBe(true);
        expect(boton.classList.contains("modo-cambiar")).toBe(true);
        expect(boton.classList.contains("solid")).toBe(false);
      });

      it("lo alcanza una regla de styles.css con fondo, borde y sombra de la casa", () => {
        const { boton } = abrir(red);
        const cuerpos = alcanzan(boton).filter((r) => r.medias.length === 0).map((r) => r.cuerpo);
        const todo = cuerpos.join(";");
        expect(cuerpos.length).toBeGreaterThan(0);
        expect(valor(todo, "background")).toBe("var(--magenta)");
        expect(valor(todo, "color")).toBe("var(--on-accent)");
        expect(valor(todo, "border")).toMatch(/^var\(--bw\) solid var\(--ink\)$/);
        expect(valor(todo, "box-shadow")).toBe("var(--sh-sm)");
      });

      it("y su regla propia le da 48 px de alto mínimo en todos los anchos, sin que ninguna otra lo baje de 44", () => {
        const { boton } = abrir(red);
        const alcanzadas = alcanzan(boton);
        const alturas = alcanzadas.flatMap((r) => {
          const v = valor(r.cuerpo, "min-height");
          return v === null ? [] : [{ selector: normal(r.selector), media: r.medias.length > 0, px: Number(/^([\d.]+)px$/.exec(v)?.[1]) }];
        });
        // Ninguna regla que lo alcance le deja menos de 44 px (el piso de pantallas grandes, docs/ux.md).
        expect(alturas.length).toBeGreaterThan(0);
        expect(alturas.filter((a) => !(a.px >= 44))).toEqual([]);
        // La suya, sin `@media`, da 48 px: vale en celular (hasta 760 px) y también en pantallas grandes.
        const propias = alturas.filter((a) => !a.media && /\.modo-cambiar(?![\w-])/.test(a.selector));
        expect(propias.length).toBeGreaterThan(0);
        expect(propias.filter((a) => !(a.px >= 48))).toEqual([]);
        // Y que ninguna regla lo achique con un alto fijo.
        expect(alcanzadas.filter((r) => valor(r.cuerpo, "height") !== null).map((r) => r.selector)).toEqual([]);
      });

      it("se distingue de «Cerrar», que es la acción secundaria", () => {
        const { boton, cerrar } = abrir(red);
        const fondo = (el: Element) => alcanzan(el).filter((r) => r.medias.length === 0).map((r) => valor(r.cuerpo, "background")).filter(Boolean).pop();
        expect(fondo(boton)).toBe("var(--magenta)");
        expect(fondo(cerrar)).toBe("var(--card)");
      });
    });
  }

  it("la clase que usa tiene una regla propia en styles.css, sin depender de `mini`", () => {
    const { boton } = abrir("testnet");
    const propias = todas.flatMap((r) => r.selector.split(",").map(normal)).filter((sel) => /\.modo-cambiar(?![\w-])/.test(sel));
    expect(propias.length).toBeGreaterThan(0);
    expect(propias.some((sel) => /\.mini(?![\w-])/.test(sel))).toBe(false);
    expect(boton.classList.contains("mini")).toBe(false);
  });
});
