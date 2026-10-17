/**
 * El QR del comprobante, generado acá.
 *
 * Antes se pedía a un servicio ajeno, y eso tenía dos problemas de fondo.
 *
 * El primero es de privacidad, y es el que importa. El comprobante viaja en el
 * fragmento de la URL justamente para que los nombres de los participantes no
 * lleguen ni a los registros del hosting. Mandar esa misma URL como parámetro
 * de consulta a otro servidor tiraba toda esa disciplina a la basura: los
 * nombres salían del navegador igual, solo que a otro lado.
 *
 * El segundo es práctico. El QR aparece en el momento del ganador, con la sala
 * mirando, y dependía del wifi del evento. Ahora se dibuja en el navegador y
 * funciona con la red caída.
 *
 * Se usa `qrcode-generator`, que es una implementación conocida y chica, en vez
 * de escribir una a mano: un QR mal armado falla en silencio y recién se
 * descubre cuando alguien no puede escanearlo.
 */

/** Cuánto mide el QR chico en píxeles de CSS, como mínimo. */
const SIZE = 200;
/** Margen obligatorio alrededor, en módulos. Sin esto muchos lectores fallan. */
const QUIET = 4;

/**
 * Dibuja el QR del enlace y devuelve una imagen lista para `src`.
 *
 * Devuelve `null` si el enlace no entra en un QR, que pasa con listas muy
 * grandes. En ese caso quien llama debería esconder el recuadro en vez de
 * mostrar uno roto: el enlace de todos modos se puede copiar y compartir.
 */
export async function qrDataUrl(text: string): Promise<string | null> {
  return (await dibujar(text, SIZE))?.url ?? null;
}

/**
 * Pone el QR en la imagen al tamaño en que se dibujó, para que el navegador
 * no lo reescale. Reescalado, un comprobante largo perdía módulos: de 339 a
 * 140 px quedaba en 1,2 px por módulo y no lo leía ningún celular (revisión
 * del 16 de octubre de 2026). `ancho` es lo que se quiere ocupar, en px de CSS.
 */
export async function pintarQr(img: HTMLImageElement, text: string, ancho = SIZE): Promise<boolean> {
  const qr = await dibujar(text, ancho);
  if (!qr) return false;
  img.src = qr.url;
  img.style.width = img.style.height = `${qr.lado}px`;
  return true;
}

/** Baja la librería del QR de antemano: con el wifi caído al final del show, igual se dibuja. */
export function precargarQr(): Promise<unknown> {
  return import("qrcode-generator").catch(() => undefined);
}

async function dibujar(text: string, ancho: number): Promise<{ url: string; lado: number } | null> {
  const { default: qrcode } = await import("qrcode-generator");
  let qr: ReturnType<typeof qrcode>;
  try {
    // Versión 0 es automática: elige la más chica que entre. Corrección "L"
    // porque el enlace es largo y la pantalla está limpia, sin sol ni manchas.
    qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
  } catch {
    return null;
  }

  const count = qr.getModuleCount();
  const total = count + QUIET * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Cada módulo es un número entero de píxeles del equipo, y nunca menos de
  // dos: si no, el redondeo deja costuras y los lectores se confunden. Se
  // muestra a ese mismo tamaño (`lado`), sin que el navegador lo estire.
  const cell = Math.max(2, Math.floor((ancho * dpr) / total));
  const side = cell * total;

  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const c = canvas.getContext("2d");
  if (!c) return null;

  // Oscuro sobre claro, siempre, sin importar el tema de la página. Usar la
  // tinta de la paleta parecía elegante y rompía el QR en tema oscuro, donde
  // la tinta es casi blanca: quedaba claro sobre blanco y ningún lector lo
  // encontraba. Un QR no tiene tema.
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, side, side);
  c.fillStyle = "#191919";
  for (let r = 0; r < count; r++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(r, col)) continue;
      c.fillRect((col + QUIET) * cell, (r + QUIET) * cell, cell, cell);
    }
  }
  return { url: canvas.toDataURL("image/png"), lado: side / dpr };
}
