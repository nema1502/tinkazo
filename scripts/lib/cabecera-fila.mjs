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

/**
 * Los anchos de escritorio que mira el auditor, en el modo Oficial (la dirección lleva ?red=oficial). Son los cuatro saltos de la
 * cabecera: 1101 px es el más angosto de la fila de una línea (el chip de la cuenta es solo la cara), 1200 px suma el nombre de
 * pila de a ocho letras, 1280 px lo deja de a trece y 1440 px, donde el enlace vuelve a decir Para empresas y el chip trae la
 * frase entera de la vía. Cada uno es el caso más ancho de su tramo.
 */
export const ANCHOS_CABECERA = [1101, 1200, 1280, 1440];

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

/**
 * La cuenta abierta, que es la de quien organiza y la más ancha. Sin una sesión de verdad (en modo Oficial no hay forma de abrirla
 * sin Google) se reemplaza el chip de Entrar por el de adentro, con el mismo marcado que dibuja src/ui/cuenta-chip.ts (la cara con
 * su letra y su visto, el nombre de pila y la frase de la vía) y un nombre de pila largo. Las frases son las de cuentaViaGoogle y
 * cuentaViaGoogleC de src/i18n.ts. Devuelve verdadero si encontró el chip para cambiarlo. Es una estimación del ancho, no una
 * sesión: la medida con una cuenta de verdad la hace scripts/audit-flujo.mjs.
 */
const VIA_GOOGLE = { es: ["Entraste con Google", "Google"], en: ["Signed in with Google", "Google"] };
export function cuentaAbiertaJs(idioma) {
  const [larga, corta] = VIA_GOOGLE[idioma] ?? VIA_GOOGLE.es;
  const marcado =
    '<span class="cc-cara"><span class="hello-face cc-letra" aria-hidden="true">M</span>' +
    '<i class="cc-ok" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 6.4l2.3 2.3 4.9-5"/></svg></i></span>' +
    '<span class="cc-txt"><b class="cc-nombre">Maximiliano</b><small class="cc-via"><span class="cc-via-l">' + larga + '</span><span class="cc-via-c">' + corta + '</span></small></span>';
  return `(() => {
  const viejo = document.querySelector('#wallet-box .cuenta-chip');
  if (!viejo) return false;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'cuenta-chip dentro hello mini';
  chip.dataset.estado = 'dentro';
  chip.innerHTML = ${JSON.stringify(marcado)};
  viejo.replaceWith(chip);
  return true;
})()`;
}

/** Cuántos píxeles de la pantalla tiene que dejar libres la flecha de Más en el celular. La fila deja 16 px de margen a cada lado. */
export const AIRE_BORDE_CELULAR_PX = 8;

/**
 * Los anchos del celular que mira el auditor: 412 px es el corte donde entra Empresas en la fila, 414 px el del iPhone grande
 * y 461 y 521 px los dos primeros anchos donde el relleno de las entradas cambia (de 7 a 11 px, y de 5 a 11 px): son los más
 * apretados de cada tramo.
 */
export const ANCHOS_CELULAR = [412, 414, 461, 521];

/** La letra del sistema agrandada: Android deja elegir el 110 %, el 120 % y más, y es común en quien lee de cerca. */
export const ESCALA_LETRA_SISTEMA = 1.2;

/**
 * Se evalúa en la página: agranda la letra de la fila de enlaces al 120 % (16 px a 19,2 px) con prioridad, sin cambiar de
 * familia. Es la letra del sistema agrandada y no la letra ancha: son dos peores casos distintos, y el auditor mira los dos.
 */
export const AGRANDAR_LETRA = `(() => {
  const s = document.createElement('style');
  s.textContent = 'header .topnav a, header .topnav .mas-btn { font-size: 19.2px !important; }';
  document.head.appendChild(s);
  return true;
})()`;

/**
 * Lo que se mide de la fila del celular, con las campañas forzadas abiertas (la fila lleva cuatro entradas): el ancho de la
 * pantalla y lo que se recorre, las cajas de la fila, del botón de Más y de Empresas, y si Empresas está achicada con puntos
 * suspensivos (su contenido es más ancho que ella).
 */
export const SONDA_FILA_CELULAR = `JSON.stringify((() => {
  document.documentElement.setAttribute('data-campanas', '1');
  const caja = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const r = el.getBoundingClientRect();
    return { arriba: r.top, abajo: r.bottom, izquierda: r.left, derecha: r.right };
  };
  const empresas = document.querySelector('header .topnav a.nav-empresas-cel');
  const visibles = [...document.querySelectorAll('header .topnav > a, header .topnav .mas-btn')].filter((a) => a.getClientRects().length > 0);
  return {
    ancho: document.documentElement.clientWidth,
    scrollAncho: document.documentElement.scrollWidth,
    nav: caja(document.querySelector('header .topnav')),
    mas: caja(document.querySelector('header .topnav .mas-btn')),
    empresas: caja(empresas),
    empresasCortada: empresas ? empresas.scrollWidth > empresas.clientWidth : null,
    entradas: visibles.length,
  };
})())`;

/**
 * Evalúa la fila del celular. Falla, con el motivo en claro, si falta la medida o el botón de Más, si Empresas no está en la fila
 * (no se midió el caso de las cuatro entradas), si la página se recorre de costado o si la flecha de Más queda a menos de
 * "aire" píxeles del borde de la pantalla. Empresas puede estar achicada con puntos suspensivos: es lo que la fila hace
 * cuando no hay lugar, y se dice en el detalle.
 * @returns {{ ok: boolean, detalle: string }}
 */
export function evaluarFilaCelular(m, aire = AIRE_BORDE_CELULAR_PX) {
  if (!m || !m.mas) return { ok: false, detalle: "no se encontró el botón de Más en la fila del celular" };
  if (!m.empresas) {
    return { ok: false, detalle: `Empresas no está en la fila con ${m.ancho} px de ancho (${m.entradas} entradas a la vista): no se midió el caso de las cuatro entradas` };
  }
  if (m.scrollAncho > m.ancho + 1) {
    return { ok: false, detalle: `la página se recorre de costado: mide ${m.scrollAncho} px de ancho con una pantalla de ${m.ancho} px` };
  }
  const aSobra = Math.round(m.ancho - m.mas.derecha);
  if (aSobra < aire) {
    return {
      ok: false,
      detalle: `Más termina a ${aSobra} px del borde con ${m.ancho} px de ancho (el mínimo es de ${aire} px): la flecha queda pegada o fuera de la pantalla`,
    };
  }
  const estado = m.empresasCortada ? "Empresas achicada con puntos suspensivos" : "Empresas entera";
  return { ok: true, detalle: `Más termina a ${aSobra} px del borde con ${m.ancho} px de ancho, ${estado} (${m.entradas} entradas)` };
}

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

/** El relleno a cada lado de los renglones de la lista que abre Más en el celular (styles.css, .topnav .mas-lista a). */
export const RELLENO_LISTA_MAS_PX = 16;

/**
 * Se evalúa en la página: abre Más con un toque, como lo haría la persona, y mide el relleno de cada renglón que se ve. Con las
 * campañas forzadas abiertas, que es cuando la fila del celular aprieta su relleno y una regla mal acotada alcanzó a la lista.
 * Devuelve el texto JSON del ancho de la pantalla, si la lista quedó abierta y el relleno izquierdo y derecho de cada renglón.
 */
export const SONDA_LISTA_MAS = `JSON.stringify((() => {
  document.documentElement.setAttribute('data-campanas', '1');
  const mas = document.querySelector('header .topnav .mas');
  const boton = document.querySelector('header .topnav .mas-btn');
  if (boton && boton.getAttribute('aria-expanded') !== 'true') boton.click();
  const items = [...document.querySelectorAll('header .topnav .mas-lista a')]
    .filter((a) => a.getClientRects().length > 0)
    .map((a) => {
      const e = getComputedStyle(a);
      return { texto: (a.textContent || '').trim(), izquierda: parseFloat(e.paddingLeft), derecha: parseFloat(e.paddingRight) };
    });
  return { ancho: document.documentElement.clientWidth, abierta: !!(mas && mas.classList.contains('abierto')), items };
})())`;

/**
 * Evalúa la lista de Más. Falla, con el motivo en claro, si no hay medida, si la lista no se abrió, si no hay renglones a la
 * vista o si alguno tiene menos de "minimo" píxeles de relleno a cualquiera de los dos lados: el texto queda pegado al borde de
 * la caja y el resalte del toque, sin aire.
 * @returns {{ ok: boolean, detalle: string }}
 */
export function evaluarListaMas(m, minimo = RELLENO_LISTA_MAS_PX) {
  if (!m) return { ok: false, detalle: "no hay medida de la lista de Más" };
  if (!m.abierta) return { ok: false, detalle: `la lista de Más no se abrió con un toque al botón con ${m.ancho} px de ancho: no se midió` };
  if (!m.items || m.items.length === 0) return { ok: false, detalle: `la lista de Más no tiene renglones a la vista con ${m.ancho} px de ancho` };
  const flojos = m.items.filter((i) => Math.min(i.izquierda, i.derecha) < minimo);
  if (flojos.length > 0) {
    const lista = flojos.map((i) => `"${i.texto}" (${Math.min(i.izquierda, i.derecha)} px)`).join(", ");
    return {
      ok: false,
      detalle: `en la lista de Más, ${lista} con menos de ${minimo} px de relleno con ${m.ancho} px de ancho: el texto queda pegado al borde de la caja`,
    };
  }
  return { ok: true, detalle: `la lista de Más conserva ${minimo} px de relleno en sus ${m.items.length} renglones con ${m.ancho} px de ancho` };
}
