import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El modo stand y la cantidad de personas que salen. El stand sí muestra el contador, con sus propias palabras (Cuántos
 * salen, `ganadores.ts`): ninguna regla del stand lo esconde. Lo que el stand no tiene es el orden de turnos y las
 * participaciones por persona: una ronda de ejemplo no se reparte ni se ordena.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");

/** Los cuerpos de las reglas cuyo selector, o uno de su lista, es exactamente el pedido. */
function cuerpos(selector: string): string[] {
  const salida: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const lista = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (lista.includes(selector)) salida.push(m[2] ?? "");
  }
  return salida;
}

/** Todos los selectores de las reglas que dicen body[data-stand="1"], uno por uno. */
function selectoresDelStand(): string[] {
  const salida: string[] = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    for (const s of (m[1] ?? "").split(",")) {
      const limpio = s.replace(/\s+/g, " ").trim();
      if (limpio.startsWith('body[data-stand="1"]')) salida.push(limpio);
    }
  }
  return salida;
}

describe("el modo stand muestra Cuántos salen", () => {
  it("el control existe en la página con ese identificador", () => {
    expect(pagina).toContain('id="ganadores-control"');
  });

  it("ninguna regla del stand esconde el control, el contador, los atajos ni el rótulo", () => {
    const partes = ["#ganadores-control", ".sellar-ganadores", ".nw-grupo", ".nw-contador", "#nw-atajos", "#nw-menos", "#nw-mas", "#nw-valor", "#nw-etiqueta", "#nw"];
    for (const s of selectoresDelStand()) {
      for (const parte of partes) {
        expect(s.endsWith(parte) || s.includes(`${parte} `) || s.includes(`${parte}:`), `${s} esconde ${parte}`).toBe(false);
      }
    }
  });

  it("el stand sigue sin el orden de turnos, que no tiene", () => {
    const reglas = cuerpos('body[data-stand="1"] #turnos-opcion');
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
  });

  it("el stand tampoco muestra las participaciones por persona: en una ronda de ejemplo cada línea es una persona", () => {
    for (const id of ["#btn-varias", "#varias-panel", "#participaciones-aviso"]) {
      const reglas = cuerpos(`body[data-stand="1"] ${id}`);
      expect(reglas, id).toHaveLength(1);
      expect(reglas[0], id).toMatch(/display:\s*none\s*!important/);
      expect(pagina, id).toContain(`id="${id.slice(1)}"`);
    }
  });

  it("fuera del stand nada lo esconde: sigue a la vista junto a Sellar la lista", () => {
    const sueltas = cuerpos("#ganadores-control").concat(cuerpos(".sellar-ganadores"));
    for (const cuerpo of sueltas) expect(cuerpo).not.toMatch(/display:\s*none/);
  });
});

describe("el final de una ronda del stand", () => {
  const inicio = pagina.indexOf('<div class="stand-fin" id="stand-fin">');
  const fin = pagina.indexOf('<div class="row grande-row">', inicio);
  const standFin = pagina.slice(inicio, fin);

  it("Otra ronda y Cambiar la lista van primero, después la línea chica y la salida es un enlace", () => {
    const otra = standFin.indexOf('id="stand-otra"');
    const cambiar = standFin.indexOf('id="stand-editar"');
    const nota = standFin.indexOf('class="stand-fin-nota"');
    const salir = standFin.indexOf('id="stand-salir"');
    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(fin).toBeGreaterThan(inicio);
    expect(otra).toBeGreaterThanOrEqual(0);
    expect(cambiar).toBeGreaterThan(otra);
    expect(nota).toBeGreaterThan(cambiar);
    expect(salir).toBeGreaterThan(nota);
    expect(standFin).toContain('<button class="ghost" id="stand-editar"');
    expect(standFin).toContain('<button class="enlace" id="stand-salir"');
    expect(standFin).not.toMatch(/<h3\b/);
    expect(standFin).toContain('data-i="standBanda"');
  });

  it("el final no lleva caja de color", () => {
    const reglas = cuerpos('body[data-stand="1"] .stand-fin');
    expect(reglas.length).toBeGreaterThan(0);
    for (const cuerpo of reglas) expect(cuerpo).not.toMatch(/\b(?:background|border|box-shadow)\s*:/);
  });

  it("la banda usa standBandaModo y el rótulo del estadio sigue siendo standBanda", () => {
    const desde = pagina.indexOf('<div class="stand-banda app-only tab-nuevo" id="stand-banda">');
    const banda = pagina.slice(desde, pagina.indexOf("</div>", desde));
    expect(desde).toBeGreaterThanOrEqual(0);
    expect(banda).toContain('data-i="standBandaModo"');
    const fuente = readFileSync(join(process.cwd(), "src/ui/stand.ts"), "utf8");
    expect(fuente).toMatch(/function rotular\(\): void \{\s*\$\("st-round"\)\.dataset\.ens = t\("standBanda"\);\s*\}/);
  });
});

describe("la pantalla grande del QR", () => {
  it("ya no esconde los nombres", () => {
    const reglas = cuerpos(".stand-sala.grande .ss-nombres");
    expect(reglas.length).toBeGreaterThan(0);
    for (const cuerpo of reglas) expect(cuerpo).not.toMatch(/display:\s*none/);
  });

  it("no proyecta la línea de la conexión", () => {
    const reglas = cuerpos(".stand-sala.grande .ss-estado");
    expect(reglas.length).toBeGreaterThan(0);
    expect(reglas.some((cuerpo) => /display:\s*none/.test(cuerpo))).toBe(true);
  });

  it("los cuatro tramos fijan columnas y una letra que nunca baja de 20 px, y la etiqueta de repetido escala", () => {
    const tramos = [
      ["hasta-6", 1, "clamp(22px, 6vh, 72px)"],
      ["7-12", 2, "clamp(20px, 4.2vh, 50px)"],
      ["13-24", 3, "clamp(20px, 3.2vh, 38px)"],
      ["25-mas", 3, "clamp(20px, 2.6vh, 30px)"],
    ] as const;
    for (const [tramo, columnas, letra] of tramos) {
      const reglas = cuerpos(`.stand-sala.grande[data-tramo="${tramo}"] .ss-nombres`);
      expect(reglas, tramo).toHaveLength(1);
      expect(reglas[0]).toContain(`--ss-cols: ${columnas}`);
      expect(reglas[0]).toContain(`font-size: ${letra}`);
    }
    const repetidos = cuerpos(".stand-sala.grande .ss-nombres .ss-rep");
    expect(repetidos.length).toBeGreaterThan(0);
    expect(repetidos.some((cuerpo) => /font-size:\s*max\(14px,\s*0\.45em\)/.test(cuerpo))).toBe(true);
  });

  it("lleva el aviso primero, visible y sin superponerse al QR", () => {
    expect(pagina).toMatch(/<p class="ss-banda-grande" data-i="standBanda">/);
    const abierta = pagina.indexOf('id="sala-abierta"');
    expect(pagina.indexOf('class="ss-banda-grande"')).toBeGreaterThan(abierta);
    expect(pagina.indexOf('class="ss-banda-grande"')).toBeLessThan(pagina.indexOf('id="sala-qr-img"'));
    const reglas = cuerpos(".stand-sala.grande .ss-banda-grande");
    expect(reglas.length).toBeGreaterThan(0);
    expect(reglas.some((cuerpo) => /display:\s*block/.test(cuerpo))).toBe(true);
    for (const cuerpo of reglas) expect(cuerpo).not.toMatch(/position:\s*sticky/);
    expect(reglas.some((cuerpo) => /position:\s*static/.test(cuerpo))).toBe(true);
    expect(reglas.some((cuerpo) => /font-size:\s*max\(18px,\s*2\.6vh\)/.test(cuerpo))).toBe(true);
  });

  it("el QR en grande no se deforma y usa el menor entre el alto y el ancho disponibles", () => {
    const reglas = cuerpos(".stand-sala.grande .ss-qr img");
    expect(reglas.length).toBeGreaterThan(0);
    const conservaLaForma = reglas.some(
      (cuerpo) => /height:\s*auto\s*!important/.test(cuerpo) && /aspect-ratio:\s*1\s*;/.test(cuerpo),
    );
    expect(conservaLaForma).toBe(true);
    expect(css).toMatch(/width:\s*min\(calc\(100dvh - 190px\), calc\(50vw - 40px\)\)\s*!important/);
  });

  it("ocupa todo el alto, arranca de arriba al desbordar y centra el contenido cuando entra", () => {
    const panel = cuerpos('body[data-stand="1"] .stand-sala.grande');
    expect(panel.length).toBeGreaterThan(0);
    expect(panel.some((cuerpo) => /height:\s*100dvh/.test(cuerpo) && /justify-content:\s*flex-start/.test(cuerpo))).toBe(true);
    expect(panel.some((cuerpo) => /background:\s*var\(--paper\)/.test(cuerpo))).toBe(true);
    expect(panel.some((cuerpo) => /border:\s*0\s*;/.test(cuerpo) && /box-shadow:\s*none/.test(cuerpo))).toBe(true);
    const contenido = cuerpos(".stand-sala.grande #sala-abierta");
    expect(contenido.some((cuerpo) => /margin:\s*auto 0/.test(cuerpo))).toBe(true);
  });

  it("en pantalla angosta la lista tiene un alto máximo y su propio recorrido", () => {
    const reglas = cuerpos(".stand-sala.grande .ss-nombres");
    expect(reglas.some((cuerpo) => /max-height:\s*30vh/.test(cuerpo) && /overflow:\s*auto/.test(cuerpo))).toBe(true);
  });

  it("en laptop el panel no tiene recorrido propio y los nombres llenan la grilla", () => {
    expect(css).toMatch(/body\[data-stand="1"\] \.stand-sala\.grande \{ padding: 16px 24px; overflow: hidden; \}/);
    const reglas = cuerpos(".stand-sala.grande .ss-nombres");
    expect(reglas.some((cuerpo) => /max-height:\s*none/.test(cuerpo) && /overflow:\s*hidden/.test(cuerpo))).toBe(true);
    expect(css).toContain("grid-template-columns: repeat(var(--ss-cols, 2), minmax(0, 1fr))");
  });

  it("en laptop cada nombre ocupa un renglón y nunca se parte letra por letra", () => {
    const fichas = cuerpos(".stand-sala.grande .ss-nombres li");
    expect(fichas.some((cuerpo) => /white-space:\s*nowrap/.test(cuerpo) && /text-overflow:\s*ellipsis/.test(cuerpo))).toBe(true);
    const nombres = cuerpos(".stand-sala.grande .ss-nombres .ss-nombre");
    expect(nombres.some((cuerpo) => /overflow-wrap:\s*normal/.test(cuerpo))).toBe(true);
    expect(css).not.toContain("14ch");
  });

  it("en celular los nombres de la pantalla grande son fichas chicas", () => {
    const reglas = cuerpos(".stand-sala.grande .ss-nombres");
    expect(reglas.some((cuerpo) => /display:\s*flex/.test(cuerpo) && /font-size:\s*18px/.test(cuerpo))).toBe(true);
  });

  it("el número de personas tiene su propio tramo grande", () => {
    expect(css).toMatch(/\.ss-cuenta strong \{ font-size:\s*clamp\(48px, 12vh, 140px\); \}/);
  });
});

describe("lo que el stand esconde y lo que deja", () => {
  it("esconde los orígenes, el logo, la lista en grande, los equipos y la cuenta de junto al cuadro", () => {
    const ids = [
      "origenes",
      "pegar-ayuda",
      "luma-ayuda",
      "logo-fila",
      "btn-sala",
      "btn-equipos",
      "equipos-panel",
      "lista-cuenta",
    ];
    for (const id of ids) {
      const reglas = cuerpos(`body[data-stand="1"] #${id}`);
      expect(reglas, id).toHaveLength(1);
      expect(reglas[0], id).toMatch(/display:\s*none\s*!important/);
    }
  });

  it("deja la sala, el cuadro, Empezar la ronda y el resumen", () => {
    for (const id of ["stand-sala", "ta", "btn-freeze", "sellar-resumen"]) {
      const escondido = selectoresDelStand().some((selector) => selector.endsWith(`#${id}`));
      expect(escondido, id).toBe(false);
    }
  });

  it("la tarjeta vacía no repite la explicación de la sala", () => {
    expect(pagina).not.toContain('data-i="standSalaB"');
  });

  it("esconde el pliegue, la opinión, el título repetido y la nota del 3D", () => {
    for (const selector of [
      'body[data-stand="1"] #mas-opciones',
      'body[data-stand="1"] #feedback-fin',
      'body[data-stand="1"] #sec-draw > .head',
      'body[data-stand="1"] #ver3d-row > .note',
    ]) {
      const reglas = cuerpos(selector);
      expect(reglas, selector).toHaveLength(1);
      expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
    }
  });

  it("la herramienta ofrece el stand antes del cuadro y la portada tiene su botón", () => {
    expect(pagina.indexOf('id="btn-stand"')).toBeGreaterThan(0);
    expect(pagina.indexOf('id="btn-stand"')).toBeLessThan(pagina.indexOf('id="ta"'));
    const hero = pagina.indexOf('class="hero hero-portada');
    const entrada = pagina.indexOf("data-entrar-stand");
    const cierre = pagina.indexOf("</section>", hero);
    expect(hero).toBeGreaterThan(0);
    expect(entrada).toBeGreaterThan(hero);
    expect(entrada).toBeLessThan(cierre);
  });
});

describe("la espera y los avisos del stand", () => {
  it("Deshacer queda fijo abajo, con fondo amarillo, borde y un botón táctil", () => {
    const reglas = cuerpos(".ss-deshacer:not([hidden])");
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatch(/position:\s*fixed/);
    expect(reglas[0]).toMatch(/left:\s*12px/);
    expect(reglas[0]).toMatch(/right:\s*12px/);
    expect(reglas[0]).toMatch(/bottom:\s*12px/);
    expect(reglas[0]).toMatch(/z-index:\s*70/);
    expect(reglas[0]).toMatch(/background:\s*var\(--yellow\)/);
    expect(reglas[0]).toMatch(/color:\s*#191919/);
    expect(reglas[0]).toMatch(/border:\s*3px solid #191919/);
    const boton = cuerpos(".ss-deshacer:not([hidden]) #sala-deshacer-b");
    expect(boton).toHaveLength(1);
    expect(boton[0]).toMatch(/min-height:\s*44px/);
  });

  it("mientras arranca otra ronda esconde participantes, el selector y sus notas", () => {
    const partes = ["#sec-participants", "#gamepick", "#pick-label", "#rec-head", "#rec-sel-nota", "#juego-nota", "#ver3d-row"];
    for (const parte of partes) {
      const reglas = cuerpos(`body[data-stand-arrancando="1"] ${parte}`);
      expect(reglas, parte).toHaveLength(1);
      expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
    }
  });

  it("con el QR abierto no repite las fichas de nombres debajo del cuadro", () => {
    const reglas = cuerpos('body[data-stand="1"]:has(#sala-abierta:not([hidden])) #names');
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
  });

  it("en laptop el contenido del stand llega hasta 1200 px", () => {
    expect(css).toMatch(/body\[data-stand="1"\] main \{ max-width:\s*1240px; \}/);
  });
});

describe("el rótulo del estadio en el stand", () => {
  it("en celular los botones ceden una fila y el rótulo puede usar el ancho", () => {
    expect(css).toMatch(/body\[data-stand="1"\] \.st-top \{ flex-wrap:\s*wrap; row-gap:\s*6px; \}/);
    expect(css).toMatch(/body\[data-stand="1"\] #st-round \{ flex:\s*1 1 0; min-width:\s*0; \}/);
    expect(css).toMatch(/body\[data-stand="1"\] \.st-actions \{ order:\s*3; flex:\s*1 0 100%; justify-content:\s*flex-end; \}/);
  });

  it("en proyector usa una letra que se lee desde el fondo", () => {
    expect(css).toMatch(/body\[data-stand="1"\] #st-round::after \{ font-size:\s*clamp\(14px, 2\.6vh, 28px\); \}/);
  });
});

/** Los cuerpos de las reglas cuyo selector es exactamente el pedido, sobre un texto de CSS dado. */
function cuerposEn(texto: string, selector: string): string[] {
  const salida: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const lista = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (lista.includes(selector)) salida.push(m[2] ?? "");
  }
  return salida;
}

describe("arreglos de la sala y de la banda", () => {
  const equipos = readFileSync(join(process.cwd(), "src/equipos/equipos.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("la línea de la conexión no se pinta de rojo", () => {
    expect(cuerposEn(css, '.ss-estado[data-estado="sondeo"]')).toHaveLength(0);
    expect(cuerposEn(equipos, '.equipos-panel .ss-estado[data-estado="sondeo"]')).toHaveLength(0);
  });

  it("el QR de la tarjeta no se deforma", () => {
    for (const [texto, selector] of [[css, ".ss-qr img"], [equipos, ".equipos-panel .ss-qr img"]] as const) {
      const reglas = cuerposEn(texto, selector);
      expect(reglas.length).toBeGreaterThan(0);
      expect(reglas.some((c) => /height:\s*auto\s*!important/.test(c) && /aspect-ratio:\s*1\s*;/.test(c))).toBe(true);
    }
  });

  it("el botón de la banda del stand puede partirse", () => {
    const reglas = cuerpos('body[data-stand="1"] .stand-banda button.ghost');
    expect(reglas.length).toBeGreaterThan(0);
    for (const c of reglas) expect(c).not.toMatch(/nowrap/);
  });

  it("Cerrar el QR va fuera de la fila de botones", () => {
    expect(pagina.indexOf('id="sala-cerrar"')).toBeGreaterThan(pagina.indexOf('id="sala-revisar"'));
    expect(pagina).toMatch(/<button class="enlace ss-cerrar" type="button" id="sala-cerrar"/);
  });
});

describe("la guía y la comprobación de la sala siguen lo que existe", () => {
  const ux = readFileSync(join(process.cwd(), "docs/ux.md"), "utf8");

  it("la guía ubica Tengo un stand en la portada y arriba del cuadro", () => {
    expect(ux).toContain('con "Probar con un ejemplo" y "Tengo un stand" como alternativas');
    expect(ux).toContain('deja a la vista "Tengo un stand" arriba del cuadro');
    expect(ux).toContain("No pide cuenta ni graba nada");
  });

  it("la guía llama Llevar los nombres al botón de salida", () => {
    expect(ux).toContain('también con "Llevar los nombres"');
    expect(ux).not.toContain('también con "Llevar esta lista"');
  });

  it("la comprobación del celular cerrado exige el texto real del servicio", () => {
    const script = readFileSync(join(process.cwd(), "scripts/probar-sala.mjs"), "utf8");
    const servicio = readFileSync(join(process.cwd(), "workers/sala/src/pagina.ts"), "utf8");
    const cerrada = servicio.match(/cerrada:\s*"([^"]+)"/)?.[1] ?? "";
    expect(cerrada).toMatch(/ya se cerró/);
    expect(script).toContain("/ya se cerró/.test(document.getElementById('msg').textContent)");
    expect(script).not.toContain("/ya terminó|ya se cerró/");
  });
});
