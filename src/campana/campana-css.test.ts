import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FESTEJO_GRANDE } from "./festejo";

const css = readFileSync("src/campana/campana.css", "utf8");
const general = readFileSync("src/styles.css", "utf8");
const acentos = ["rojo", "naranja", "amarillo", "verde", "azul", "morado"];

function variablesDe(bloque: string | undefined): string[] {
  return [...(bloque ?? "").matchAll(/--cmp-([a-z]+):/gu)].map((coincidencia) => coincidencia[1] ?? "");
}

describe("los acentos de campaña en tema oscuro", () => {
  it("aplican los seis acentos cuando la página fuerza el tema oscuro", () => {
    const bloque = /:root\[data-theme="dark"\]\s*\{([^}]+)\}/u.exec(css)?.[1];
    expect(variablesDe(bloque).sort()).toEqual(acentos.sort());
  });

  it("aplican los seis acentos cuando el sistema pide oscuro y la página no fuerza claro", () => {
    const bloque = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]+)\}/u;
    expect(variablesDe(bloque.exec(css)?.[1]).sort()).toEqual(acentos.sort());
  });

  it("no depende de una clase que el sitio no usa", () => {
    expect(css).not.toContain("html.dark");
  });
});

/** Todas las clases que empiezan con cmp- en una hoja, sin las variables ni los números con punto. */
function clasesCmp(hoja: string): Set<string> {
  return new Set([...hoja.matchAll(/(?<![\w-])\.(cmp-[a-z0-9-]+)/gu)].map((coincidencia) => coincidencia[1] ?? ""));
}

describe("los nombres de clases de la campaña", () => {
  it("ninguna clase cmp- de la campaña está también en la hoja general del sitio", () => {
    const repetidas = [...clasesCmp(css)].filter((clase) => clasesCmp(general).has(clase));
    expect(repetidas).toEqual([]);
  });

  it("la regla de hidden queda arriba de todo y gana a cualquier otro display", () => {
    const regla = /\.cmp \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/u;
    expect(regla.test(css)).toBe(true);
    expect(css.indexOf(".cmp [hidden]")).toBeLessThan(css.indexOf(":root"));
  });
});

describe("la pantalla completa de la campaña", () => {
  it("el botón principal de la acción ocupa todo el ancho, mide 56 px o más y usa la letra principal", () => {
    const principal = /\.cmp \.primary\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(principal).toMatch(/min-height:\s*(?:5[6-9]|[6-9]\d)px\s*;/u);
    expect(principal).toMatch(/width:\s*100%\s*;/u);
    expect(principal).toMatch(/font-size:\s*var\(--letra-prin\)\s*;/u);
  });

  it("los textos de apoyo usan la letra secundaria de la casa, de 16 px", () => {
    for (const selector of [".cmp-apoyo,", ".cmp-error", ".cmp-celda", ".cmp-suave", ".cmp-paso-cuenta", ".cmp-listo"]) {
      const inicio = css.indexOf(selector);
      expect(inicio, selector).toBeGreaterThan(0);
      const bloque = css.slice(inicio, css.indexOf("}", inicio));
      expect(bloque, selector).toMatch(/font-size:\s*var\(--letra-sec\)\s*;/u);
    }
  });

  it("el alto de pantalla completa tiene un respaldo en vh para los navegadores que no entienden dvh", () => {
    const bloque = /\.cmp-estado,\s*\.cmp-saber,\s*\.cmp-hola,\s*\.cmp-adentro\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    const vh = bloque.indexOf("min-height: calc(100vh");
    expect(vh).toBeGreaterThanOrEqual(0);
    expect(vh).toBeLessThan(bloque.indexOf("min-height: calc(100dvh"));
  });

  it("la demostración no suma alto: su etiqueta va en la cabecera y no queda ninguna franja", () => {
    expect(css).not.toContain("--cmp-extra");
    expect(css).not.toContain(":has(");
    expect(css).toMatch(/\.pg-campana \.cmp-ejemplo\s*\{/u);
  });

  it("participar es gratis no es una caja con borde: el estilo de caja ya no existe", () => {
    expect(css).not.toContain(".cmp-gratis");
    expect(css).not.toContain(".cmp-ganan");
  });

  it("el celular acostado también usa dos columnas y la barra de una fila", () => {
    expect(css).toContain("@media (min-width: 900px), (orientation: landscape) and (min-width: 640px)");
    expect(css).toContain("@media (orientation: landscape) and (max-height: 600px)");
  });

  it("en laptop el botón va arriba de las reglas y el bloque de la izquierda no se estira con ellas", () => {
    const laptop = css.slice(css.indexOf("@media (min-width: 900px)"));
    expect(/\.cmp-dos > \.cmp-accion\s*\{[^}]*grid-row:\s*3\s*;/u.test(laptop)).toBe(true);
    expect(/\.cmp-dos > details\s*\{[^}]*grid-row:\s*4\s*;/u.test(laptop)).toBe(true);
    const izquierda = /\.cmp-dos > \.cmp-izq\s*\{([^}]+)\}/u.exec(laptop)?.[1] ?? "";
    expect(izquierda).toMatch(/align-self:\s*start\s*;/u);
    expect(izquierda).toMatch(/position:\s*sticky\s*;/u);
  });

  it("en celular acostado el botón y el aviso de la barra fija entran en una sola fila desde unos 410 px", () => {
    const acostado = css.slice(css.indexOf("@media (orientation: landscape) and (max-height: 600px)"));
    const boton = /\.cmp-accion \.primary\s*\{([^}]+)\}/u.exec(acostado)?.[1] ?? "";
    const aviso = /\.cmp-accion > \.cmp-apoyo,[^{]*\{([^}]+)\}/u.exec(acostado)?.[1] ?? "";
    const base = (bloque: string): number => Number(/flex:\s*\d+ \d+ (\d+)px/u.exec(bloque)?.[1] ?? "9999");
    // Las dos bases más el hueco de 20 px tienen que caber en 410 px menos los 48 px de relleno de la barra.
    expect(base(boton) + 20 + base(aviso)).toBeLessThanOrEqual(410 - 48);
    expect(boton).toMatch(/flex:\s*1 1 \d+px/u);
    expect(aviso).toMatch(/min-width:\s*0\s*;/u);
  });

  it("el enlace de cambiar de cuenta no usa el estilo de botón de 56 px", () => {
    expect(css).not.toContain(".ghost");
    const enlace = /\.cmp-otra-cuenta\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(enlace).toMatch(/min-height:\s*44px\s*;/u);
    expect(enlace).not.toMatch(/width:\s*100%/u);
  });

  it("Acepto y me anoto igual tiene el alto de un botón de toque pero no el de la principal", () => {
    const bloque = /\.cmp-anotarme-igual,\s*\.cmp-de-texto,\s*\.cmp-otra-cuenta\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/min-height:\s*44px\s*;/u);
    expect(bloque).not.toMatch(/width:\s*100%/u);
    expect(css).not.toMatch(/\.cmp-anotarme-igual[^{]*\{[^}]*min-height:\s*5\d/u);
    // En la barra de abajo el fondo es el de la tarjeta, que cambia con el tema: la tinta también.
    expect(/\.cmp-anotarme-igual,\s*\.cmp-de-texto\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "").toMatch(/color:\s*var\(--ink\)\s*;/u);
  });

  it("el aviso de la cuenta usada en otro navegador usa la letra secundaria y el papel de la casa", () => {
    const bloque = /\.cmp-otro-lado\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/font-size:\s*var\(--letra-sec\)\s*;/u);
    expect(bloque).toMatch(/background:\s*var\(--paper\)\s*;/u);
    expect(bloque).toMatch(/color:\s*var\(--ink\)\s*;/u);
  });

  it("la acción queda fija abajo, de borde a borde", () => {
    const bloque = /\.cmp-accion\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/position:\s*sticky\s*;/u);
    expect(bloque).toMatch(/bottom:\s*0\s*;/u);
    expect(bloque).toMatch(/margin:\s*auto -16px/u);
  });

  it("el bloque principal tiene alto mínimo con 100dvh y reparte su contenido", () => {
    const bloque = /\.cmp-estado,\s*\.cmp-saber,\s*\.cmp-hola,\s*\.cmp-adentro\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/min-height:\s*calc\(100dvh/u);
    expect(bloque).toMatch(/display:\s*flex\s*;/u);
    expect(bloque).toMatch(/flex-direction:\s*column\s*;/u);
  });

  it("desde 900 px el bloque usa hasta 1100 px y se parte en dos columnas", () => {
    expect(/\.cmp\s*\{[^}]*max-width:\s*1100px/u.test(css)).toBe(true);
    const desde = css.indexOf("@media (min-width: 900px)");
    expect(desde).toBeGreaterThan(0);
    const laptop = css.slice(desde);
    expect(laptop).toMatch(/\.cmp-dos\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.1fr\) minmax\(0, 1fr\)/u);
  });

  it("el premio ocupa el medio con el monto entre 40 y 84 px, según el ancho y el alto", () => {
    const bloque = /\.cmp-premio-texto\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/font-size:\s*clamp\(40px, 14vw, 72px\)\s*;/u);
    expect(bloque).toMatch(/font-size:\s*clamp\(40px, min\(14vw, 10dvh\), 84px\)\s*;/u);
  });

  it("el festejo vive dentro de su bloque y el papel picado no se queda más de dos segundos y medio", () => {
    const festejo = /\.cmp-festejo\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(festejo).toMatch(/position:\s*absolute\s*;/u);
    expect(festejo).toMatch(/overflow:\s*hidden\s*;/u);
    expect(FESTEJO_GRANDE.retrasoMaxMs + FESTEJO_GRANDE.duracionMaxMs).toBeLessThanOrEqual(2600);
  });
});

describe("el premio y la cabecera de la campaña", () => {
  it("pone el acento de fondo y una tinta fija encima, para que todos los colores se lean", () => {
    const bloque = /\.cmp-hero\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/background:\s*var\(--cmp-acento, var\(--magenta\)\)\s*;/u);
    expect(bloque).toMatch(/(?:^|\s)color:\s*var\(--cmp-tinta\)\s*;/u);
    expect(css).toMatch(/--cmp-tinta:\s*#191919\s*;/u);
  });

  it("esconde el menú y la cuenta en la página de la campaña", () => {
    const regla = /\.pg-campana \.topnav,\s*\.pg-campana \.pg-auth\s*\{([^}]+)\}/u;
    const bloque = regla.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/display:\s*none\s*;/u);
  });
});

describe("la espera viva", () => {
  const sinMovimiento = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("la ruedita de un botón apagado gira en la hoja de la campaña y no depende de la hoja del sitio", () => {
    expect(css).toMatch(/@keyframes cmp-gira\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}\s*\}/u);
    const regla = /\.cmp button\[aria-busy="true"\]::before\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(regla).toMatch(/animation:\s*cmp-gira\s/u);
    expect(regla).toMatch(/border-top-color:\s*currentColor/u);
  });

  it("con movimiento reducido no hay ruedita girando, ni latido, ni salto", () => {
    expect(sinMovimiento).toMatch(/\.cmp button\[aria-busy="true"\]::before/u);
    expect(sinMovimiento).toMatch(/\.cmp-al-dia\.cmp-late \.cmp-punto/u);
    expect(sinMovimiento).toMatch(/\.cmp-celda\.cmp-salta/u);
    const bloque = /\.cmp button\[aria-busy="true"\]::before,[^{]+\{([^}]+)\}/u.exec(sinMovimiento)?.[1] ?? "";
    expect(bloque).toMatch(/animation:\s*none/u);
  });

  it("el punto de Al día late una vez y la señal no se anima si busca la conexión con movimiento reducido", () => {
    expect(css).toMatch(/\.cmp-al-dia\.cmp-late \.cmp-punto\s*\{\s*animation:\s*cmp-late 1200ms/u);
    expect(sinMovimiento).toMatch(/\.cmp-al-dia\[data-estado="buscando"\] \.cmp-punto/u);
  });
});

describe("la tarjeta de confirmar el correo", () => {
  it("con la tarjeta la espera deja de ocupar todo el alto, para que la tarjeta entre a la vista", () => {
    expect(css).toMatch(/\.cmp-con-tarjeta > \.cmp-adentro\s*\{[^}]*min-height:\s*0\s*;/u);
  });

  it("achica la espera con la tarjeta y esconde todo menos lo de escribir con el teclado abierto", () => {
    expect(css).toMatch(/\.cmp-con-tarjeta \.cmp-adentro \.cmp-rotulos,\s*\.cmp-con-tarjeta \.cmp-adentro \.cmp-marca\s*\{\s*display:\s*none/u);
    expect(css).toMatch(/\.cmp\.cmp-teclado > \.cmp-adentro,[^{]*\{\s*display:\s*none/u);
  });

  it("con el teclado abierto el campo y el botón van en una sola fila, para que la barra no tape la línea del correo", () => {
    expect(css).toMatch(/\.cmp\.cmp-teclado \.cmp-cuenta > \.cmp-accion\s*\{[^}]*flex-flow:\s*row nowrap/u);
    const boton = /\.cmp\.cmp-teclado \.cmp-accion \.primary\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    // El botón no se achica: solo deja de ocupar todo el ancho.
    expect(boton).not.toMatch(/min-height/u);
    expect(boton).toMatch(/width:\s*auto/u);
    const campo = /\.cmp\.cmp-teclado \.cmp-accion \.cmp-cuenta-campo\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(campo).toMatch(/min-width:\s*0/u);
  });

  it("el campo del código es grande, para que no haga zoom en el celular, y el botón de texto mide lo de un toque", () => {
    const campo = /\.cmp-accion \.cmp-cuenta-campo\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(campo).toMatch(/font-size:\s*(?:1[6-9]|[2-9]\d)px/u);
    const otra = /\.cmp-cuenta-otra\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
    expect(otra).toMatch(/min-height:\s*(?:4[4-9]|[5-9]\d)px/u);
  });

  it("el aviso del servicio usa la letra secundaria de la casa", () => {
    const inicio = css.indexOf(".cmp-error {");
    expect(inicio).toBeGreaterThan(0);
    expect(css.slice(inicio, css.indexOf("}", inicio))).toMatch(/font-size:\s*var\(--letra-sec\)\s*;/u);
  });
});
