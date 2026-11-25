// La cabecera de escritorio en una sola fila, para el auditor de interfaz (scripts/audit-ui.mjs).
// Entre 1101 y 1439 px la cabecera va en una línea: el logo, la fila de enlaces y, a la derecha, el grupo del idioma, la marca
// del modo y la cuenta (.header-lado). Con la marca Oficial, que es la más ancha, y cinco entradas en la fila, ese grupo cayó
// a una segunda fila, a la izquierda y debajo del logo, y ninguna comprobación lo avisó. Esta pieza mide las posiciones y
// decide, sin navegador, si el grupo quedó en la fila del logo. Su prueba es scripts/lib/cabecera-fila.test.mjs.

/** Cuántos píxeles de diferencia entre los centros todavía cuentan como la misma fila. */
export const MARGEN_FILA_PX = 6;

/**
 * El aire mínimo, en píxeles, entre el último enlace de la fila y el grupo de la derecha. Cero pasa por un píxel y a la primera
 * letra distinta se parte: pide un colchón para que un cambio chico de texto o de relleno avise antes de romper la fila.
 */
export const AIRE_MINIMO_PX = 16;

/**
 * La letra del peor caso. Las máquinas de GitHub dibujan con una letra más ancha que la de una compu de verdad (DejaVu Sans en
 * Linux) y ahí se vio el defecto, pero este auditor corre con el Chrome de quien lo lanza, que en Windows usa una letra mucho más
 * angosta (Segoe UI) y dejaba pasar la cabecera partida. Se fuerza una letra ancha en todo lo de la cabecera antes de medir:
 * DejaVu Sans donde está y Verdana, que mide casi igual y viene con Windows y con macOS. La monoespaciada de la marca del modo
 * y de los botones del idioma (Consolas en Windows es angosta) pasa a DejaVu Sans Mono o a Courier New.
 */
export const LETRA_ANCHA = '"DejaVu Sans", Verdana, sans-serif';
export const LETRA_MONO_ANCHA = '"DejaVu Sans Mono", "Courier New", monospace';

/** Los anchos de escritorio que mira el auditor, en el modo Oficial (la dirección lleva ?red=oficial). */
export const ANCHOS_CABECERA = [1101, 1280];

/**
 * Lo que se mide en la página. Las campañas se fuerzan abiertas (el atributo data-campanas del elemento html, que decide la
 * hoja de estilos): con ellas cerradas la fila lleva una entrada menos y la medida no sería la del peor caso. Devuelve el
 * texto JSON de las cajas del logo, de la fila de enlaces (hasta el último que se ve) y del grupo de la derecha.
 */
export const SONDA_FILA_CABECERA = `JSON.stringify((() => {
  document.documentElement.setAttribute('data-campanas', '1');
  const caja = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { arriba: r.top, abajo: r.bottom, izquierda: r.left, derecha: r.right };
  };
  const visibles = [...document.querySelectorAll('header .topnav a')].filter((a) => a.getClientRects().length > 0);
  const ultimo = visibles[visibles.length - 1] || null;
  const lado = document.querySelector('header .header-lado');
  return {
    logo: caja(document.querySelector('header .wordmark')),
    ultimoEnlace: caja(ultimo),
    ultimoTexto: ultimo ? (ultimo.textContent || '').trim() : '',
    entradas: visibles.length,
    lado: caja(lado),
    marca: !!document.querySelector('header .auth .netbadge'),
    ladoTexto: lado ? (lado.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    ancho: document.documentElement.clientWidth,
  };
})())`;

/**
 * Se evalúa en la página antes de medir: pone la letra ancha, con prioridad, en la cabecera y en todo lo que lleva. Una letra es
 * monoespaciada si la que tiene puesta nombra una monoespaciada (ui-monospace, Consolas, monospace). Devuelve cuántos elementos
 * cambió, para que quien llama compruebe que no fue cero.
 */
export const FORZAR_LETRA_ANCHA = `(() => {
  const ancha = ${JSON.stringify(LETRA_ANCHA)};
  const mono = ${JSON.stringify(LETRA_MONO_ANCHA)};
  const todos = [...document.querySelectorAll('header, header *')];
  for (const el of todos) {
    const f = getComputedStyle(el).fontFamily || '';
    el.style.setProperty('font-family', /mono|consolas/i.test(f) ? mono : ancha, 'important');
  }
  return todos.length;
})()`;

const centro = (c) => (c.arriba + c.abajo) / 2;

/**
 * Evalúa lo medido. Falla, con el motivo en claro, si falta una pieza, si el grupo de la derecha no está en la misma fila que el
 * logo (el centro a más de `margen` píxeles) si la fila de enlaces llega hasta pisarlo o si deja menos de `aireMinimo` píxeles de aire.
 * @returns {{ ok: boolean, detalle: string }}
 */
export function evaluarFilaCabecera(m, margen = MARGEN_FILA_PX, aireMinimo = AIRE_MINIMO_PX) {
  if (!m || !m.logo || !m.lado) {
    return { ok: false, detalle: "no se encontró el logo o el grupo de la derecha (.header-lado) en la cabecera" };
  }
  if (m.marca === false) {
    return { ok: false, detalle: "la marca del modo no aparece en la cabecera: la medida no es la del modo Oficial, que es el caso más ancho" };
  }
  const caida = Math.round(centro(m.lado) - centro(m.logo));
  if (Math.abs(caida) > margen) {
    return {
      ok: false,
      detalle:
        `el grupo de la derecha (idioma, marca y cuenta) cayó a otra fila: su centro está ${caida} px ${caida > 0 ? "debajo" : "arriba"} del logo ` +
        `(el margen es de ${margen} px) con ${m.ancho} px de ancho. La fila de enlaces no entra`,
    };
  }
  if (m.ultimoEnlace && m.ultimoEnlace.derecha > m.lado.izquierda + 1) {
    const pisa = Math.round(m.ultimoEnlace.derecha - m.lado.izquierda);
    return {
      ok: false,
      detalle: `la fila de enlaces llega hasta "${m.ultimoTexto}" y pisa ${pisa} px al grupo de la derecha con ${m.ancho} px de ancho`,
    };
  }
  const aire = m.ultimoEnlace ? Math.round(m.lado.izquierda - m.ultimoEnlace.derecha) : 0;
  if (m.ultimoEnlace && aire < aireMinimo) {
    return {
      ok: false,
      detalle:
        `la fila de enlaces llega hasta "${m.ultimoTexto}" y deja ${aire} px de aire al grupo de la derecha con ${m.ancho} px de ancho ` +
        `(el mínimo es de ${aireMinimo} px, medido con la letra ancha). Sigue en una fila, pero a la menor diferencia se parte`,
    };
  }
  return { ok: true, detalle: `el grupo de la derecha está en la fila del logo, con ${aire} px de aire (${m.entradas} entradas, hasta "${m.ultimoTexto}")` };
}
