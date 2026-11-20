import "./pagina";
import "./version-nueva";
import { onLangChange, texto as t, textos } from "./idioma";
import { decodeAmigo, type AmigoLink } from "./protocol/proof";

/**
 * La página del enlace de cada persona en un Amigo secreto: `confirmar.html#<su parte>`.
 *
 * Lo común de las páginas (el tema, el menú, la cuenta y el idioma) lo pone `pagina.ts`. Acá se lee la parte que trae el
 * fragmento, que nunca pasa por un servidor, y se dice solo eso: el nombre del sorteo, quién abre y a quién le regala.
 * Las dos secciones nacen escondidas. Con un enlace bueno se muestra la del regalo y con uno roto, el aviso. Así no
 * queda nunca un encabezado a medias encima del error.
 *
 * Los nombres van siempre con `textContent`: los escribió quien organiza y no se leen como HTML.
 */

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** ¿Es el nombre por defecto del modo, en castellano o en inglés? */
const esElDeSiempre = (nombre: string): boolean => (["es", "en"] as const).some((l) => textos(l).amigoPrize === nombre);

/** Escribe la parte de esta persona en el idioma de la página. El nombre de quien abre va dentro de la línea `confirmarT`. */
function pintar(parte: AmigoLink): void {
  const premio = $("c-premio");
  const para = $("c-para");
  const hacia = $("c-hacia");
  // Sin nombre propio, el sticker dice qué es: Amigo secreto, en el idioma de la página. El nombre por defecto,
  // sellado en cualquiera de los dos idiomas, también: en inglés, Amigo secreto se lee Secret Santa.
  const nombre = parte.prize?.trim() ?? "";
  if (premio) premio.textContent = !nombre || esElDeSiempre(nombre) ? t("amigoPrize") : nombre;
  // El nombre va como función: como texto, un $$ o un $& del nombre se leerían como patrones del reemplazo.
  if (para) para.textContent = t("confirmarT").replace("{nombre}", () => parte.from);
  if (hacia) hacia.textContent = parte.to;
}

async function abrir(): Promise<void> {
  let parte: AmigoLink;
  try {
    parte = await decodeAmigo(location.hash);
  } catch {
    // Un enlace cortado, viejo o de otra cosa: se dice y no se inventa nada.
    const error = $("c-error");
    if (error) error.hidden = false;
    return;
  }
  pintar(parte);
  onLangChange(() => pintar(parte));
  const ok = $("c-ok");
  if (ok) ok.hidden = false;
}

void abrir();
