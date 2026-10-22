import { esc } from "../dom";
import { getLang, textos, type Lang } from "../idioma";
import { acortar } from "../enlace-corto";
import { decodeProof } from "../protocol/proof";
import { eventoUrl, partirEvento, type SorteoDelEvento } from "../protocol/evento";
import { fotoPng, type Foto } from "./foto";
import { type ConOrden, enOrdenDeSalida } from "./agrupar";

/**
 * Compartir un sorteo o un evento: la foto con quién ganó y el QR para
 * comprobarlo, y el mensaje para el grupo. Una acción principal, "Compartir por
 * WhatsApp"; a mano siempre, "Descargar la foto" y "Copiar el mensaje".
 *
 * Al abrirse, el diálogo intenta el enlace corto (`enlace-corto.ts`): el
 * mensaje y el QR de la foto lo usan si sale, y el enlace largo si no. Nunca
 * frena compartir: si el servicio no contesta en unos segundos, sigue con el
 * largo. Un evento va primero entero en un solo enlace corto, con una sola
 * foto; si no sale, en las partes de siempre, cada una con su enlace largo.
 *
 * Lo usan el resultado del sorteo (`draw.ts`), Mis sorteos (con la lista del
 * historial) y la página de verificación (con lo que ella misma rehizo). Por
 * eso no importa `i18n.ts`: los textos salen de `textos(lang)`, el diccionario
 * de la página, y las claves que se usan acá aparecen entre comillas en este
 * archivo, para que `vite.config.ts` las incluya en las páginas de lectura.
 *
 * El mensaje repite la forma de `T.es.summary` y `summaryEvento` (los del
 * resultado y los de evento), y una prueba compara las dos cosas.
 */

/** El texto de una clave en el idioma pedido. Si falta, la clave misma. */
function cad(lang: Lang, clave: string): string {
  const v = textos(lang)[clave];
  return typeof v === "string" ? v : clave;
}

/** Reemplaza las marcas {así} en una sola pasada: lo que se pone no se vuelve a mirar. */
function rellenar(plantilla: string, datos: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (marca, clave: string) => (clave in datos ? String(datos[clave]) : marca));
}

/** "Ana, Beto y Carla" / "Ana, Beto and Carla". */
function lista(lang: Lang, nombres: string[]): string {
  return new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);
}

/**
 * La misma lista cada vez con un nombre menos y "N más" al final ("Ana, Beto
 * y 2 más"), de la más larga a la más corta: la foto de un evento la usa si
 * no entran todos, para no cortar un nombre por la mitad.
 */
function listasCortas(lang: Lang, nombres: string[]): string[] {
  const out: string[] = [];
  for (let k = nombres.length - 1; k >= 1; k--) {
    out.push(lista(lang, [...nombres.slice(0, k), rellenar(cad(lang, "fotoMasNombres"), { n: nombres.length - k })]));
  }
  return out;
}

/* ------------------------------------------------------------------ mensajes */

export interface DatosSorteo {
  /** El enlace de verificación del sorteo: el comprobante, tal como quedó. */
  enlace: string;
  ganadores: string[];
  /** Cuántas personas había en la lista. */
  total: number;
  /** El premio, o "" si no hubo. */
  premio: string;
  /** Cuándo se selló, en segundos. */
  fecha?: number;
  /** El número del sorteo en Stellar, si se ancló. */
  numero?: string;
  /** La red donde se ancló: "testnet" o "mainnet". */
  red?: string;
}

/** El mensaje de un sorteo: quién ganó, entre cuántos, el enlace y el pie. */
export function mensajeDeSorteo(lang: Lang, d: DatosSorteo): string {
  const varios = d.ganadores.length > 1;
  const w = lista(lang, d.ganadores);
  const cabeza = d.premio
    ? rellenar(cad(lang, varios ? "cmpCabPremioVarios" : "cmpCabPremioUno"), { premio: d.premio, w, n: d.total })
    : rellenar(cad(lang, varios ? "cmpCabVarios" : "cmpCabUno"), { w, n: d.total });
  return [
    cabeza,
    cad(lang, varios ? "cmpNadieVarios" : "cmpNadieUno"),
    rellenar(cad(lang, "cmpVerificarUno"), { enlace: d.enlace }),
    "",
    cad(lang, "cmpPie"),
  ].join("\n");
}

/**
 * Un renglón por sorteo del evento: el premio (o "Sorteo") y quién ganó.
 * "Polera: Gabriela Flores". En el orden en que salieron (`enOrdenDeSalida`).
 */
export function lineasDeEvento(lang: Lang, sorteos: Array<{ prize?: string; ganadores: string[] } & ConOrden>): string[] {
  return enOrdenDeSalida(sorteos).map((s) => `${s.prize?.trim() || cad(lang, "histDraw")}: ${lista(lang, s.ganadores)}`);
}

/**
 * El mensaje de un evento: cuántos sorteos hay, quién ganó qué, el o los
 * enlaces y el pie. `titulo` es el nombre, o la fecha por defecto.
 */
export function mensajeDeEvento(lang: Lang, d: { titulo: string; sorteos: number; enlaces: string; lineas?: string[] }): string {
  const uno = d.sorteos === 1;
  return [
    rellenar(cad(lang, uno ? "cmpEvUno" : "cmpEvVarios"), { t: d.titulo, n: d.sorteos }),
    ...(d.lineas ?? []),
    rellenar(cad(lang, uno ? "cmpVerificarEvUno" : "cmpVerificarEv"), { enlace: d.enlaces }),
    "",
    cad(lang, "cmpPie"),
  ].join("\n");
}

/* --------------------------------------------------------------------- la foto */

/** "21 de octubre de 2026" / "October 21, 2026". */
function fechaLarga(lang: Lang, segundos?: number): string {
  if (!segundos) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es-BO" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(segundos * 1000),
  );
}

/** El rótulo de arriba: "Sorteo #278 · red de prueba · 21 de octubre de 2026", o "Resultado del sorteo" si no se ancló. */
function rotuloDeSorteo(lang: Lang, d: DatosSorteo): string {
  return [
    d.numero ? rellenar(cad(lang, "fotoNumero"), { n: d.numero }) : cad(lang, "imgKicker"),
    d.numero && d.red === "testnet" ? cad(lang, "fotoPrueba") : "",
    fechaLarga(lang, d.fecha),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Lo que va en la foto de un sorteo, con el enlace que toca (el corto si salió). */
export function fotoDeSorteo(lang: Lang, d: DatosSorteo, enlace: string): Foto {
  const varios = d.ganadores.length > 1;
  return {
    rotulo: rotuloDeSorteo(lang, d),
    titulo: cad(lang, varios ? "imgGanaron" : "imgGano"),
    personas: d.ganadores,
    lineas: [
      d.premio ? `${cad(lang, varios ? "imgPremio" : "winsPrize")} ${d.premio}` : "",
      rellenar(cad(lang, varios ? "fotoEntreVarios" : "fotoEntreUno"), { n: d.total }),
    ].filter(Boolean),
    mas: cad(lang, "fotoMas"),
    enlace,
    escanear: cad(lang, "fotoEscanear"),
    sinQr: cad(lang, "fotoSinQr"),
  };
}

/** Lo que va en la foto de un evento: su nombre, un renglón por sorteo (en el orden en que salieron) y el QR. */
export function fotoDeEvento(lang: Lang, titulo: string, sorteos: SorteoDelEvento[], enlace: string): Foto {
  const n = sorteos.length;
  const enOrden = enOrdenDeSalida(sorteos);
  const fecha = enOrden.map((s) => s.sealedAt ?? 0).find((x) => x > 0);
  return {
    rotulo: [cad(lang, "fotoEvento"), fechaLarga(lang, fecha)].filter(Boolean).join(" · "),
    titulo,
    sub: rellenar(cad(lang, n === 1 ? "evUnSorteo" : "evNSorteos"), { n }),
    filas: enOrden.map((s) => ({ premio: s.prize?.trim() || cad(lang, "histDraw"), ganadores: lista(lang, s.ganadores), cortos: listasCortas(lang, s.ganadores) })),
    lineas: [],
    mas: cad(lang, "fotoMas"),
    enlace,
    escanear: cad(lang, "fotoEscanear"),
    sinQr: cad(lang, "fotoSinQr"),
  };
}

/* -------------------------------------------------------------------- diálogo */

/** Lo que se comparte, ya con el enlace que toca. */
export interface Listo {
  mensaje: string;
  /** Una foto por enlace: una sola, o una por parte del evento. */
  fotos: Foto[];
  /** Una nota arriba, por ejemplo que el evento va en varios enlaces. */
  nota?: string;
  /** El nombre de los archivos, sin la extensión. */
  archivo: string;
  /** Si salió el enlace corto: el diálogo lo cuenta en su nota de privacidad. */
  corto: boolean;
}

export interface Paquete {
  titulo: string;
  /** Arma lo que se comparte: intenta el enlace corto y, si no sale, usa el largo. No falla. */
  preparar: () => Promise<Listo>;
}

let abierto: HTMLDialogElement | null = null;

/** Baja un archivo, como enlace temporal. */
function descargar(f: File): void {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(f);
  enlace.download = f.name;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30_000);
}

/** Lo que se le dice a quien comparte, abajo del botón. */
type Aviso = (texto: string) => void;

/**
 * "Compartir por WhatsApp". Si el navegador puede compartir archivos (el
 * celular, y también Windows, macOS y ChromeOS), la hoja del sistema con la
 * foto y el mensaje: WhatsApp recibe las dos cosas. Si no, la foto va al
 * portapapeles (o se baja, si no se puede) y se abre WhatsApp con el mensaje
 * escrito, avisando que hay que pegar la foto.
 */
async function compartirPorWhatsapp(archivos: File[], mensaje: string, avisar: Aviso, lang: Lang): Promise<void> {
  const datos: ShareData = archivos.length ? { files: archivos, text: mensaje } : { text: mensaje };
  if (typeof navigator.canShare === "function" && navigator.canShare(datos)) {
    try {
      await navigator.share(datos);
      avisar("");
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // En la computadora, la hoja del sistema puede no tener WhatsApp: se dice qué hacer, sin insistir.
        if (!matchMedia("(pointer: coarse)").matches) avisar(cad(lang, "cmpNoAparece"));
        return;
      }
      // Si el navegador no deja (por ejemplo, porque se venció el toque), sigue como en la computadora.
    }
  }
  const celular = matchMedia("(pointer: coarse)").matches;
  let copiada = false;
  const primera = archivos[0];
  if (archivos.length === 1 && primera && !celular && typeof ClipboardItem === "function" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": primera })]);
      copiada = true;
    } catch {
      /* sin permiso para la imagen: se baja */
    }
  }
  if (!copiada) archivos.forEach(descargar);
  const texto = encodeURIComponent(mensaje);
  window.open(celular ? `https://wa.me/?text=${texto}` : `https://web.whatsapp.com/send?text=${texto}`, "_blank", "noopener");
  if (copiada) avisar(cad(lang, "cmpPegaLaFoto"));
  else if (archivos.length) avisar(cad(lang, archivos.length > 1 ? "cmpAdjuntaLasFotos" : "cmpAdjuntaLaFoto"));
  else avisar("");
}

/** Abre el diálogo de compartir y prepara la foto y el mensaje. Reemplaza al que estuviera abierto. */
export function abrirCompartir(p: Paquete, lang: Lang = getLang()): void {
  abierto?.close();
  const dlg = document.createElement("dialog");
  dlg.className = "cmp-dlg";
  dlg.setAttribute("aria-labelledby", "cmp-t");
  dlg.innerHTML =
    `<div class="cmp-cuerpo">` +
    `<div class="cmp-top"><h2 id="cmp-t">${esc(p.titulo)}</h2>` +
    `<button class="ghost" type="button" data-cerrar>${esc(cad(lang, "salaCerrar"))}</button></div>` +
    `<div class="cmp-main">` +
    `<div class="cmp-fotos" aria-busy="true"><div class="cmp-espera"><div class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></div>` +
    `<p>${esc(cad(lang, "cmpPreparando"))}</p></div></div>` +
    `<div class="cmp-lado">` +
    `<p class="note cmp-nota" style="display:none"></p>` +
    `<button class="primary cmp-wa" type="button" data-whatsapp disabled>${esc(cad(lang, "cmpPreparando"))}</button>` +
    `<p class="cmp-aviso" role="status" aria-live="polite"></p>` +
    `<div class="cmp-acc">` +
    `<button class="ghost" type="button" data-bajar disabled>${esc(cad(lang, "cmpBajarFoto"))}</button>` +
    `<button class="ghost" type="button" data-copiar disabled>${esc(cad(lang, "copySummary"))}</button>` +
    `</div>` +
    `<label class="kicker" for="cmp-txt">${esc(cad(lang, "cmpMensaje"))}</label>` +
    `<textarea id="cmp-txt" class="cmp-txt" readonly></textarea>` +
    `<p class="note cmp-priv"></p>` +
    `</div></div></div>`;

  const q = <T extends HTMLElement>(sel: string): T => dlg.querySelector(sel) as T;
  const fotos = q<HTMLElement>(".cmp-fotos");
  const wa = q<HTMLButtonElement>("[data-whatsapp]");
  const bajar = q<HTMLButtonElement>("[data-bajar]");
  const copiar = q<HTMLButtonElement>("[data-copiar]");
  const txt = q<HTMLTextAreaElement>("#cmp-txt");
  const aviso = q<HTMLElement>(".cmp-aviso");
  const priv = q<HTMLElement>(".cmp-priv");
  const nota = q<HTMLElement>(".cmp-nota");
  const urls: string[] = [];
  let archivos: File[] = [];
  let mensaje = "";

  const avisar: Aviso = (texto) => {
    aviso.textContent = texto;
  };

  void (async () => {
    let listo: Listo;
    try {
      listo = await p.preparar();
    } catch {
      // `preparar` no falla; si igual pasa, no hay nada que compartir y se dice.
      if (dlg.isConnected) fotos.innerHTML = `<p class="note">${esc(cad(lang, "cmpSinFoto"))}</p>`;
      return;
    }
    const pngs = await Promise.all(listo.fotos.map((f) => fotoPng(f)));
    // Si se cerró mientras tanto, no hay nada que pintar.
    if (!dlg.isConnected) return;
    mensaje = listo.mensaje;
    txt.value = mensaje;
    const ext = listo.fotos.length > 1;
    archivos = pngs.flatMap((png, i) =>
      png ? [new File([png], `${listo.archivo}${ext ? `-${i + 1}` : ""}.png`, { type: "image/png" })] : [],
    );
    fotos.innerHTML = "";
    fotos.removeAttribute("aria-busy");
    fotos.classList.toggle("varias", archivos.length > 1);
    for (const f of archivos) {
      const url = URL.createObjectURL(f);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = cad(lang, "cmpFotoAlt");
      img.className = "cmp-png";
      fotos.appendChild(img);
    }
    if (!archivos.length) fotos.innerHTML = `<p class="note">${esc(cad(lang, "cmpSinFoto"))}</p>`;
    if (listo.nota) {
      nota.textContent = listo.nota;
      nota.style.display = "";
    }
    // Lo que se comparte, dicho: la foto y el enlace abren la lista entera; el
    // corto deja guardada una copia que no vence, y si hace falta borrarla se
    // pide a Tinkazo (la interfaz no la borra: cortaría la verificación de todos).
    priv.textContent = [
      cad(lang, "cmpPrivLista"),
      listo.corto ? cad(lang, "cmpPrivCorto") : "",
      listo.corto ? cad(lang, "cmpPrivBorrar") : "",
    ]
      .filter(Boolean)
      .join(" ");
    wa.textContent = cad(lang, "cmpWa");
    wa.disabled = false;
    bajar.disabled = !archivos.length;
    bajar.textContent = cad(lang, archivos.length > 1 ? "cmpBajarFotos" : "cmpBajarFoto");
    copiar.disabled = false;
    // Si nadie movió el foco, va a la acción principal.
    const a = document.activeElement;
    if (a === dlg || a === q("[data-cerrar]") || a === document.body) wa.focus({ preventScroll: true });
  })();

  // Un segundo toque mientras la hoja del sistema está abierta haría fallar al
  // primero y abriría WhatsApp Web encima: se espera a que termine.
  let compartiendo = false;
  wa.addEventListener("click", () => {
    if (compartiendo) return;
    compartiendo = true;
    void compartirPorWhatsapp(archivos, mensaje, avisar, lang).finally(() => {
      compartiendo = false;
    });
  });
  bajar.addEventListener("click", () => {
    archivos.forEach(descargar);
    avisar("");
  });
  copiar.addEventListener("click", async () => {
    const orig = copiar.textContent;
    try {
      await navigator.clipboard.writeText(mensaje);
      copiar.textContent = cad(lang, "copied");
    } catch {
      // Sin portapapeles: el mensaje queda seleccionado para copiarlo a mano.
      txt.select();
    }
    setTimeout(() => (copiar.textContent = orig), 1600);
  });
  q<HTMLButtonElement>("[data-cerrar]").addEventListener("click", () => dlg.close());
  // Un clic en el fondo, fuera del cuerpo, cierra.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    dlg.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    if (abierto === dlg) abierto = null;
  });
  document.body.appendChild(dlg);
  abierto = dlg;
  dlg.showModal();
}

/* --------------------------------------------------------------------- sorteo */

/** El nombre de los archivos de la foto: "tinkazo-sorteo-278" o "tinkazo-2026-10-21". */
function archivoDe(numero?: string, fecha?: number): string {
  if (numero) return `tinkazo-sorteo-${numero}`;
  return `tinkazo-${new Date((fecha ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10)}`;
}

/**
 * Compartir un sorteo con lo que ya se sabe de él. `corto: false` comparte el
 * enlace largo sin intentar el corto (la demo no guarda nada en ningún lado).
 */
export function abrirSorteo(d: DatosSorteo, lang: Lang = getLang(), op: { corto?: boolean } = {}): void {
  abrirCompartir(
    {
      titulo: cad(lang, "cmpSorteo"),
      preparar: async () => {
        const c = op.corto === false ? null : await acortar(d.enlace);
        const enlace = c?.corto ?? d.enlace;
        return {
          mensaje: mensajeDeSorteo(lang, { ...d, enlace }),
          fotos: [fotoDeSorteo(lang, d, enlace)],
          archivo: archivoDe(d.numero, d.fecha),
          corto: !!c,
        };
      },
    },
    lang,
  );
}

/** Desde Mis sorteos: el comprobante trae el número de personas, el premio, la fecha y el número del sorteo. */
export async function compartirSorteo(enlace: string, ganadores: string[], lang: Lang = getLang()): Promise<void> {
  const comprobante = await decodeProof(enlace.slice(enlace.indexOf("#")));
  abrirSorteo(
    {
      enlace,
      ganadores,
      total: comprobante.names.length,
      premio: comprobante.prize ?? "",
      ...(comprobante.sealedAt ? { fecha: comprobante.sealedAt } : {}),
      ...(comprobante.id ? { numero: comprobante.id } : {}),
      ...(comprobante.net ? { red: comprobante.net } : {}),
    },
    lang,
  );
}

/* -------------------------------------------------------------------- evento */

/**
 * El evento en sus partes de siempre, para cuando no sale el enlace corto: sus
 * enlaces largos, uno por parte (con los sorteos de cada una), y el mensaje que
 * los trae. Con más de una parte, cada enlace dice cuál es. Null si no hay
 * sorteos. `base` se pasa en las pruebas; en la página es el origen.
 */
export async function paqueteDeEvento(
  titulo: string,
  sorteos: SorteoDelEvento[],
  lang: Lang = getLang(),
  base?: string,
): Promise<{ partes: Array<{ titulo: string; enlace: string; sorteos: SorteoDelEvento[] }>; mensaje: string } | null> {
  if (!sorteos.length) return null;
  // En el orden en que salieron: el enlace, sus partes y la página de evento cuentan lo mismo que el mensaje.
  sorteos = enOrdenDeSalida(sorteos);
  const grupos = await partirEvento(titulo, sorteos);
  const n = grupos.length;
  const parte = (i: number): string => rellenar(cad(lang, "evParte"), { i, n });
  const partes = await Promise.all(
    grupos.map(async (g, i) => {
      const tt = n > 1 ? `${titulo} · ${parte(i + 1)}` : titulo;
      return { titulo: tt, enlace: await eventoUrl(tt, g, base), sorteos: g };
    }),
  );
  const enlaces = n > 1 ? partes.map((p, i) => `${parte(i + 1)}: ${p.enlace}`).join("\n") : (partes[0]?.enlace ?? "");
  return { partes, mensaje: mensajeDeEvento(lang, { titulo, sorteos: sorteos.length, enlaces, lineas: lineasDeEvento(lang, sorteos) }) };
}

/**
 * Lo que se comparte de un evento: primero entero, en un solo enlace corto y
 * una sola foto; si el corto no sale, en las partes de siempre. `base` se pasa
 * en las pruebas.
 */
export async function prepararEvento(
  titulo: string,
  sorteos: SorteoDelEvento[],
  lang: Lang = getLang(),
  op: { corto?: boolean; base?: string } = {},
): Promise<Listo> {
  sorteos = enOrdenDeSalida(sorteos);
  const lineas = lineasDeEvento(lang, sorteos);
  const fecha = sorteos.map((s) => s.sealedAt ?? 0).find((x) => x > 0);
  const archivo = archivoDe(undefined, fecha);
  if (op.corto !== false) {
    const c = await acortar(await eventoUrl(titulo, sorteos, op.base));
    if (c) {
      return {
        mensaje: mensajeDeEvento(lang, { titulo, sorteos: sorteos.length, enlaces: c.corto, lineas }),
        fotos: [fotoDeEvento(lang, titulo, sorteos, c.corto)],
        archivo,
        corto: true,
      };
    }
  }
  const r = await paqueteDeEvento(titulo, sorteos, lang, op.base);
  const partes = r?.partes ?? [];
  return {
    mensaje: r?.mensaje ?? "",
    fotos: partes.map((p) => fotoDeEvento(lang, p.titulo, p.sorteos, p.enlace)),
    ...(partes.length > 1 ? { nota: rellenar(cad(lang, "evAvisoPartes"), { n: partes.length }) } : {}),
    archivo,
    corto: false,
  };
}

/** Compartir un evento: la foto (o una por parte) y el mensaje con quién ganó qué. */
export async function compartirEvento(titulo: string, sorteos: SorteoDelEvento[], lang: Lang = getLang()): Promise<void> {
  if (!sorteos.length) return;
  abrirCompartir({ titulo: cad(lang, "histGrupoCompartir"), preparar: () => prepararEvento(titulo, sorteos, lang) }, lang);
}
