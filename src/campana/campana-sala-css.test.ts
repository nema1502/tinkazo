import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lo que la hoja de la pantalla grande y del panel de quien organiza tiene que cumplir: sin espacio muerto, el QR tan
 * grande como entre y todo legible desde el fondo. Lee el CSS tal cual: lo que se mide en un navegador lo mide el auditor.
 */

const css = readFileSync("src/campana/campana-sala.css", "utf8");
const DOS_COLUMNAS = "@media (min-width: 900px), (orientation: landscape) and (min-width: 640px)";

/** El contenido de las llaves de la regla que empieza con ese selector, sin mirar lo que haya adentro de otros bloques. */
function regla(selector: string, hoja = css): string {
  const inicio = hoja.indexOf(`${selector} {`);
  if (inicio < 0) return "";
  const fin = hoja.indexOf("}", inicio);
  return hoja.slice(inicio, fin);
}

/** Lo que hay dentro de un @media, con sus llaves anidadas. */
function bloque(consulta: string): string {
  const inicio = css.indexOf(consulta);
  if (inicio < 0) return "";
  let nivel = 0;
  for (let i = css.indexOf("{", inicio); i < css.length; i++) {
    if (css[i] === "{") nivel++;
    if (css[i] === "}") nivel--;
    if (nivel === 0) return css.slice(inicio, i + 1);
  }
  return "";
}

describe("la pantalla grande de la campaña", () => {
  it("ocupa el alto completo y reparte dos columnas desde 900 px o apaisada", () => {
    const dos = bloque(DOS_COLUMNAS);
    expect(dos).toContain(".campana-grande.sala");
    expect(dos).toMatch(/height:\s*100dvh/u);
    expect(dos).toMatch(/grid-template-columns:\s*var\(--cg-lado\)\s+minmax\(0,\s*1fr\)/u);
  });

  it("el QR usa el menor entre el alto y el ancho disponibles", () => {
    expect(css).toContain("--cg-lado: min(calc(100dvh - 110px), calc(50vw - 40px));");
    expect(regla(".campana-grande .cg-img")).toMatch(/aspect-ratio:\s*1/u);
    expect(bloque(DOS_COLUMNAS)).toMatch(/\.campana-grande \.cg-img\s*\{\s*width:\s*var\(--cg-lado\)\s*!important/u);
  });

  it("con una columna el QR se mide por el ancho y por el alto", () => {
    expect(regla(".campana-grande .cg-img")).toContain("width: min(100%, calc(100dvh - 32px)) !important");
  });

  it("el número es enorme y el botón de la capa mide 64 px o más", () => {
    expect(regla(".cg-numero")).toContain("clamp(48px, 12vh, 140px)");
    expect(regla(".campana-grande .cg-volver")).toMatch(/min-height:\s*(?:6[4-9]|[7-9]\d)px/u);
  });

  it("el aviso de sin QR nunca baja de 48 px y el renglón de debajo del QR se lee en un proyector", () => {
    expect(regla(".cg-sinqr")).toContain("max(48px");
    expect(regla(".cg-apps")).toContain("max(22px, 3vh)");
  });

  it("el premio es lo más grande después del número y el cartel de la instrucción es más chico", () => {
    expect(regla(".cg-premio")).toContain("clamp(32px, min(8vh, 10vw), 96px)");
    expect(regla(".cg-cartel")).toContain("clamp(26px, min(5vh, 7vw), 60px)");
  });

  it("con dos columnas el número y el aviso de lista cerrada crecen con el alto y el botón no se come el espacio libre", () => {
    const dos = bloque(DOS_COLUMNAS);
    expect(dos).toContain(".cg-numero { font-size: clamp(64px, 28vh, 320px); }");
    expect(dos).toContain(".cg-cerro { font-size: clamp(56px, 16vh, 200px); line-height: 1; }");
    expect(dos).toContain(".campana-grande .cg-volver { margin-top: 0; }");
  });

  it("lo que cierra la lista no ensancha la columna del QR ni parte el título", () => {
    expect(regla(".cg-cerro")).toContain("clamp(40px, 6vh, 72px)");
    expect(regla(".cg-cerro")).toContain("overflow-wrap: anywhere");
    expect(regla(".cg-arriba h2")).toContain("overflow-wrap: anywhere");
    expect(regla(".cg-premio")).toContain("overflow-wrap: anywhere");
  });

  it("el atributo hidden gana a cualquier display de la capa", () => {
    expect(css).toMatch(/\.campana-grande \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/u);
  });

  it("con movimiento reducido no hay salto", () => {
    const reducido = bloque("@media (prefers-reduced-motion: reduce)");
    expect(reducido).toMatch(/\.cg-numero\.sube\s*\{\s*animation:\s*none/u);
  });

  it("sin alto de sobra o con la ventana angosta la capa deja hacer scroll y no corta el botón", () => {
    expect(regla(".campana-grande.sala")).toContain("overflow-y: auto");
    expect(bloque("@media (min-width: 900px) and (min-height: 560px)")).toContain("overflow: hidden");
  });
});

describe("el panel de quien organiza", () => {
  it("usa el ancho disponible hasta 1200 px", () => {
    const panel = regla(".cpo-panel");
    expect(panel).toContain("width: 100%");
    expect(panel).toContain("max-width: 1200px");
  });

  it("en el celular no es una caja dentro de otra", () => {
    const celular = bloque("@media (max-width: 699px)");
    expect(celular).toMatch(/\.cpo-panel\s*\{[^}]*padding:\s*0[^}]*border:\s*0[^}]*box-shadow:\s*none/u);
  });

  it("la acción principal ocupa el ancho completo y mide 56 px o más", () => {
    const principal = regla(".cpo-panel button.primary");
    expect(principal).toContain("width: 100%");
    expect(principal).toMatch(/min-height:\s*(?:5[6-9]|[6-9]\d)px/u);
  });

  it("las filas y los motivos miden 44 px", () => {
    expect(regla(".cpo-fila")).toContain("min-height: 44px");
    expect(regla(".cpo-fila button, .cpo-motivos button")).toContain("min-height: 44px");
  });

  it("el QR del panel no se desborda en un celular angosto", () => {
    const qr = regla(".cpo-qr img");
    expect(qr).toContain("max-width: 100%");
    expect(qr).toContain("height: auto !important");
  });

  it("el lugar del QR queda reservado y la imagen no se reescala", () => {
    const lugar = regla(".cpo-panel > .cpo-qr");
    expect(lugar).toContain("width: min(300px, 100%)");
    expect(lugar).toContain("aspect-ratio: 1 / 1");
    const qr = regla(".cpo-qr img");
    // El borde va afuera del tamaño que pone qr.ts: si no, la imagen se achica y pierde módulos.
    expect(qr).toContain("box-sizing: content-box");
    expect(qr).toContain("image-rendering: pixelated");
    expect(css).toContain(".cpo-qr img:not([src]) { visibility: hidden; }");
  });

  it("reparte todos los bloques de la grilla y deja la principal arriba del QR en el celular", () => {
    expect(css).toContain('grid-template-areas: "cab" "num" "acc" "qr" "lista";');
    expect(css).toContain('grid-template-areas: "qr cab" "qr num" "qr acc" "qr lista";');
    for (const area of ["cab", "num", "acc", "qr", "lista"]) {
      expect(css, area).toContain(`grid-area: ${area}`);
    }
  });

  it("el atributo hidden gana a cualquier display del panel", () => {
    expect(css).toMatch(/\.cpo-panel \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/u);
  });

  it("esconde el cuadro de la lista de siempre para que quede una sola acción principal", () => {
    expect(css).toContain("body:has(#cpo-panel) :is(#origenes, #pegar-ayuda, #ta, #lista-cuenta, #lista-cuenta-nota) { display: none !important; }");
  });

  it("la barra de lo que sigue vuelve con la lista cerrada o sellada y sin botón principal en el panel", () => {
    expect(css).toContain(
      'body:has(#cpo-panel:not([data-vista="cerrada"]):not([data-vista="sellada"]), ' +
        "#cpo-panel button.primary) #siguiente { display: none !important; }",
    );
  });

  it("con el panel de una campaña la barra no ofrece Pegar lista: la lista es la del panel", () => {
    // Mientras se lee la lista cerrada el cuadro del editor está vacío y la barra decía Paso 1 de 4 contra la fila viva del panel.
    expect(css).toContain('body:has(#cpo-panel) #siguiente[data-paso="1"] { display: none !important; }');
  });

  it("con la lista sellada o sorteada no queda el botón de sellar del editor ni las notas de su modo y de los términos", () => {
    const abre = 'body:has(#cpo-panel:is([data-vista="sellada"], [data-vista="sorteada"])) :is(';
    const inicio = css.indexOf(abre);
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    for (const id of ["#btn-freeze", "#sellar-modo", "#free-rule"]) expect(regla, id).toContain(id);
    expect(regla).toContain("display: none !important");
    // Con la lista cerrada el botón de sellar es la acción que sigue: ahí se queda.
    expect(regla).not.toContain("cerrada");
    // La barra de abajo tampoco ofrece sellar (el paso 2) con la lista ya sellada o sorteada.
    expect(css).toContain(
      'body:has(#cpo-panel:is([data-vista="sellada"], [data-vista="sorteada"])) #siguiente[data-paso="2"] { display: none !important; }',
    );
  });

  it("con la lista sellada o sorteada el botón de Siguiente premio no se ve", () => {
    expect(css).toContain(
      'body:has(#cpo-panel:is([data-vista="sellada"], [data-vista="sorteada"])) #btn-again-sin { display: none !important; }',
    );
  });

  it("la caja de la lista termina dentro de la pantalla y solo ella se mueve", () => {
    expect(bloque("@media (min-width: 900px) {")).toContain("max-height: max(220px, calc(100dvh - 480px))");
  });

  it("sin QR a la vista el panel abierto pasa a una columna y no deja un hueco", () => {
    expect(css).toContain(".cpo-panel > .cpo-qr:has(> img[hidden]) { display: none; }");
    expect(css).toContain('.cpo-panel[data-vista="abierta"]:has(.cpo-qr img[hidden]) {');
  });

  it("en el celular elegir, la vista previa y confirmar dejan el botón principal abajo", () => {
    const celular = bloque("@media (max-width: 699px)");
    // Sin alto contado desde otro lugar (empujaba el botón fuera de la pantalla): el botón queda pegado abajo.
    expect(celular).not.toContain("100dvh - 160px");
    expect(celular).toContain("position: sticky");
    expect(celular).toContain("bottom: 0");
  });

  it("con el cobro pendiente se esconde el premio grande y con el cobro pagado aparece la marca", () => {
    expect(css).toContain('.cpo-panel[data-comision]:not([data-comision="pagada"]) > .cpo-previa { display: none; }');
    expect(css).toContain(".cpo-cab .cpo-marca {");
  });

  it("en elegir, la vista previa, la inscripción abierta y confirmar se esconde el editor de la lista de debajo del panel", () => {
    expect(css).toContain("#btn-stand, #mas-opciones, #logo-fila, #ganadores-control, .sellar-acciones");
    expect(css).toContain("#sec-participants > .head");
    expect(css).toContain(
      'body:has(#cpo-panel:is([data-vista="elegir"], [data-vista="previa"], [data-vista="abierta"], [data-vista="confirmar"],',
    );
  });

  it("mientras el panel carga, no tiene red, pregunta si se olvida o la tiene otra pestaña tampoco se ve el editor de la lista", () => {
    const vistas = ["cargando", "sin-red", "olvidar", "otra-pestana"];
    for (const abre of [
      'body:has(#cpo-panel:is([data-vista="elegir"], [data-vista="previa"], [data-vista="abierta"], [data-vista="confirmar"],',
      'body:has(#cpo-panel:is([data-vista="abierta"], [data-vista="confirmar"],',
    ]) {
      const inicio = css.indexOf(abre);
      expect(inicio, abre).toBeGreaterThan(-1);
      const selector = css.slice(inicio, css.indexOf(") :is(", inicio));
      for (const v of vistas) expect(selector, v).toContain('[data-vista="' + v + '"]');
    }
  });

  it("con la inscripción abierta o por confirmar tampoco se ven el ejemplo, los juegos interactivos ni la puerta de la cuenta", () => {
    const inicio = css.indexOf('body:has(#cpo-panel:is([data-vista="abierta"], [data-vista="confirmar"],');
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    for (const id of ["#btn-ensayo", "#btn-interactivos", "#cupo-linea", "#primera-vez", "#gate", "#turnos-opcion", "#como-panel"]) {
      expect(regla, id).toContain(id);
    }
    expect(regla).toContain("display: none !important");
  });

  it("al elegir el archivo y en la vista previa no se ven el ejemplo, los juegos interactivos, el selector de modo ni la primera vez", () => {
    const inicio = css.indexOf('body:has(#cpo-panel:is([data-vista="elegir"], [data-vista="previa"])) :is(');
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    for (const id of ["#btn-ensayo", "#btn-interactivos", "#primera-vez", "#turnos-opcion", "#como-panel"]) expect(regla, id).toContain(id);
    // La puerta de la cuenta es lo que deja entrar para abrir la inscripción: se queda.
    expect(regla).not.toContain("#gate");
    expect(regla).toContain("display: none !important");
  });

  it("con una campaña recordada el editor no se pinta antes de que exista el panel", () => {
    const inicio = css.indexOf("html[data-campana] body:not(:has(#cpo-panel)) :is(");
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    for (const id of [
      "#origenes", "#ta", "#lista-cuenta-nota", "#btn-stand", "#mas-opciones", "#ganadores-control", ".sellar-acciones", "#sellar-modo",
      "#sec-participants > .head", "#btn-ensayo", "#btn-interactivos", "#primera-vez", "#gate", "#turnos-opcion", "#como-panel", "#siguiente",
    ]) {
      expect(regla, id).toContain(id);
    }
    expect(regla).toContain("display: none !important");
  });

  it("con la lista cerrada, sellada o sorteada queda el botón de sellar y lo que lleva los errores, sin el resto del cuadro", () => {
    const inicio = css.indexOf('body:has(#cpo-panel:is([data-vista="cerrada"], [data-vista="sellada"], [data-vista="sorteada"])) :is(');
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    for (const id of [
      "#btn-stand", "#mas-opciones", "#logo-fila", "#ganadores-control", "#btn-sala", "#btn-ensayo", "#btn-interactivos",
      "#freeze-hint", "#sellar-sin-cuenta", "#names", "#rules-pre-row", "#turnos-opcion", "#primera-vez", "#btn-varias", "#como-panel",
      "#sec-participants > .head",
    ]) {
      expect(regla, id).toContain(id);
    }
    // El botón de sellar, la aceptación de los términos y lo que muestra los errores del sello y del cobro se quedan a la vista.
    for (const id of [
      "#btn-freeze", ".sellar-acciones", "#free-rule", "#red-estado", "#cupo-linea", "#sellar-resumen", "#seal-status", "#fund-box", "#sellar-modo",
    ]) {
      expect(regla, id).not.toContain(id);
    }
    expect(regla).toContain("display: none !important");
  });

  it("las piezas nuevas del panel siguen una sola convención de movimiento: se mueven salvo que se pida reducido", () => {
    // El tilde de Servicio pagado salta con la animación de siempre y con movimiento reducido no hay ninguna.
    expect(css).toContain(".cpo-cab .cpo-marca-viva.recien::before { animation: fv-pop");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cpo-cab \.cpo-marca-viva\.recien::before \{ animation: none; \}/);
    // Ninguna animación nueva se prende solo con prefers-reduced-motion: no-preference.
    expect(css).not.toContain("no-preference");
  });

  it("el panel anuncia lo que cambia desde un solo lugar: la fila viva y la marca de servicio pagado", () => {
    const armado = readFileSync("src/ui/campana-sala.ts", "utf8");
    expect(armado).toContain('<div id="cpo-fila" class="cpo-viva"></div>');
    expect(armado).toContain('marcaEl.setAttribute("role", "status")');
  });

  it("la fila viva no comparte clase con las filas de la lista: no hereda su borde ni su flex-wrap", () => {
    const armado = readFileSync("src/ui/campana-sala.ts", "utf8");
    expect(armado).not.toMatch(/id="cpo-fila" class="[^"]*\bcpo-fila\b/u);
    expect(css).not.toMatch(/\.cpo-acciones > \.cpo-fila/u);
    expect(css).toMatch(/\.cpo-acciones > \.cpo-viva \{ flex: 1 1 100%; min-height: 56px; \}/u);
  });

  it("cada bloque del panel tiene una clase igual a su id", () => {
    const armado = readFileSync("src/ui/campana-sala.ts", "utf8");
    for (const id of ["cpo-cab", "cpo-previa", "cpo-qr", "cpo-numero", "cpo-acciones", "cpo-lista"]) {
      expect(armado, id).toContain(`id="${id}" class="${id}"`);
    }
  });

  it("la pregunta de dejar la campaña sin línea deja aire entre el título y el botón", () => {
    const armado = readFileSync("src/ui/campana-sala.ts", "utf8");
    // La regla se apoya en que la línea es el hermano que sigue al título.
    expect(armado).toMatch(/<h2 id="cpo-h"><\/h2>' \+\s*'<p id="cpo-linea" class="cpo-linea"><\/p>/u);
    expect(css).toMatch(/\.cpo-panel\[data-vista="olvidar"\] h2:has\(\+ \.cpo-linea:empty\) \{ margin-bottom: 12px; \}/u);
  });
});
