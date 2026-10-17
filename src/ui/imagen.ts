import { getLang, t, T, type Lang } from "../i18n";
import { app, drawAvatar } from "../state";

/**
 * La imagen del resultado para redes: quién salió, qué se lleva y entre
 * cuántos, con la marca. Quien organiza casi siempre publica a quién ganó, y
 * así cada publicación dice dónde se hizo el sorteo.
 *
 * Lleva solo los nombres de quienes ganaron. Nada del QR ni del enlace del
 * comprobante: el comprobante lleva la lista entera, y publicar la imagen no
 * puede publicar a todos los que participaron.
 *
 * Se dibuja en el navegador, a 1080 × 1350 (el 4:5 que Instagram, X y WhatsApp
 * muestran entero), con la letra del sistema y la paleta oscura de la casa,
 * como la imagen para compartir del sitio (public/og.jpg).
 */

const W = 1080;
const H = 1350;
const M = 84;
const ANCHO = W - 2 * M;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const C = {
  fondo: "#171126",
  crema: "#f6efe2",
  crema2: "#cfc6b4",
  apagado: "#97909f",
  tinta: "#000000",
  magenta: "#ff5cb3",
  amarillo: "#ffd24d",
};
const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"];

/** La llama del logo, en sus rectángulos (viewBox -1 -3 24 28). */
const LLAMA: readonly (readonly [number, number, number, number])[] = [
  [2, 11, 16, 7], [15, 3, 4, 10], [14, 0, 8, 4], [20, -2, 2, 3], [3, 18, 2.5, 6],
  [8, 18, 2.5, 6], [12.5, 18, 2.5, 6], [16, 18, 2.5, 6], [0, 9, 3, 4],
];

interface Datos {
  nombres: string[];
  premio: string;
  total: number;
  fecha: Date;
  lang: Lang;
}

function datos(): Datos | null {
  const { frozen, drawn } = app;
  if (!frozen || !drawn) return null;
  return {
    nombres: drawn.winners.map((i) => frozen.names[i] ?? "").filter(Boolean),
    premio: frozen.prize,
    total: frozen.names.length,
    fecha: new Date(frozen.ts * 1000),
    lang: getLang(),
  };
}

type Ctx = CanvasRenderingContext2D;

/** Parte el texto en renglones del ancho dado; una palabra más ancha que el renglón se corta por letras. */
function partir(c: Ctx, texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (!linea || c.measureText(prueba).width <= ancho) linea = prueba;
    else {
      lineas.push(linea);
      linea = palabra;
    }
  }
  if (linea) lineas.push(linea);
  return lineas.flatMap((l) => (c.measureText(l).width <= ancho ? [l] : cortar(c, l, ancho)));
}

function cortar(c: Ctx, texto: string, ancho: number): string[] {
  const tramos: string[] = [];
  let tramo = "";
  for (const letra of Array.from(texto)) {
    if (tramo && c.measureText(tramo + letra).width > ancho) {
      tramos.push(tramo);
      tramo = letra;
    } else tramo += letra;
  }
  if (tramo) tramos.push(tramo);
  return tramos;
}

function recortar(c: Ctx, texto: string, ancho: number): string {
  if (c.measureText(texto).width <= ancho) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && c.measureText(`${letras.join("")}…`).width > ancho) letras.pop();
  return `${letras.join("")}…`;
}

/** El tamaño más grande entre `max` y `min` en el que el texto entra en `renglones`; si no entra ni en `min`, se recorta. */
function encajar(c: Ctx, texto: string, ancho: number, renglones: number, max: number, min: number, peso: number): { tam: number; lineas: string[] } {
  for (let tam = max; tam >= min; tam -= 2) {
    c.font = `${peso} ${tam}px ${SANS}`;
    const lineas = partir(c, texto, ancho);
    if (lineas.length <= renglones) return { tam, lineas };
  }
  c.font = `${peso} ${min}px ${SANS}`;
  const lineas = partir(c, texto, ancho);
  return { tam: min, lineas: [...lineas.slice(0, renglones - 1), recortar(c, lineas.slice(renglones - 1).join(" "), ancho)] };
}

/** Texto con aire entre letras, para los rótulos en versalitas. */
function espaciado(c: Ctx, texto: string, x: number, y: number, aire: number): void {
  for (const letra of Array.from(texto)) {
    c.fillText(letra, x, y);
    x += c.measureText(letra).width + aire;
  }
}

/** Una calcomanía de la casa: color plano, borde de tinta y sombra dura, apenas girada. */
function calcomania(c: Ctx, x: number, y: number, w: number, h: number, color: string, giro: number, dentro?: () => void, sombra = 12): void {
  const borde = Math.max(3, Math.round(Math.min(w, h) / 30));
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate((giro * Math.PI) / 180);
  c.translate(-w / 2, -h / 2);
  c.fillStyle = C.tinta;
  c.fillRect(sombra, sombra, w, h);
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  dentro?.();
  c.lineWidth = borde;
  c.strokeStyle = C.tinta;
  c.strokeRect(borde / 2, borde / 2, w - borde, h - borde);
  c.restore();
}

/**
 * El avatar en su propio lienzo, derecho: girado celda por celda, el suavizado
 * dejaba rayas finas entre las celdas. Se pega entero dentro de la calcomanía.
 */
function cara(nombre: string, lado: number): HTMLCanvasElement {
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = Math.round(lado);
  const c = lienzo.getContext("2d");
  if (c) drawAvatar(c, nombre, 0, 0, lienzo.width);
  return lienzo;
}

function franja(c: Ctx, y: number): void {
  for (let i = 0; i * 60 < W; i++) {
    c.fillStyle = FRANJA[i % FRANJA.length] ?? C.magenta;
    c.fillRect(i * 60, y, 60, 16);
  }
}

/** La llama en magenta con sombra de tinta, girada tres grados, y "Tinkazo" con "zo" en magenta. */
function marca(c: Ctx, x: number, base: number): void {
  const e = 3;
  c.save();
  c.translate(x, base - 78);
  c.rotate((-3 * Math.PI) / 180);
  for (const [color, d] of [[C.tinta, 5], [C.magenta, 0]] as const) {
    c.fillStyle = color;
    for (const [rx, ry, rw, rh] of LLAMA) c.fillRect((rx + 1) * e + d, (ry + 3) * e + d, rw * e, rh * e);
  }
  c.restore();
  c.font = `900 64px ${SANS}`;
  c.fillStyle = C.crema;
  c.fillText("Tinka", x + 96, base);
  c.fillStyle = C.magenta;
  c.fillText("zo", x + 96 + c.measureText("Tinka").width, base);
}

function dibujar(d: Datos): HTMLCanvasElement {
  const lienzo = document.createElement("canvas");
  lienzo.width = W;
  lienzo.height = H;
  const c = lienzo.getContext("2d");
  if (!c) throw new Error("sin lienzo 2d");
  const L = T[d.lang];
  // Los textos fijos, en el idioma de la imagen.
  const s = (clave: string): string => {
    const v = L[clave];
    return typeof v === "string" ? v : "";
  };
  const varios = d.nombres.length > 1;
  c.textBaseline = "alphabetic";
  c.fillStyle = C.fondo;
  c.fillRect(0, 0, W, H);
  franja(c, 0);
  franja(c, H - 16);
  marca(c, M, 148);

  // El rótulo: qué es y cuándo fue.
  const fecha = new Intl.DateTimeFormat(d.lang === "es" ? "es-BO" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(d.fecha);
  c.font = `700 25px ${MONO}`;
  c.fillStyle = C.apagado;
  espaciado(c, `${s("imgKicker")} · ${fecha}`.toUpperCase(), M, 226, 2.5);

  // El pie, de abajo hacia arriba: la calcomanía con la dirección y, arriba, la frase.
  const pie = encajar(c, s(varios ? "imgPieVarios" : "pantallaPie"), ANCHO, 3, 32, 26, 600);
  const renglon = Math.round(pie.tam * 1.35);
  const pieY = H - 190 - pie.lineas.length * renglon;
  c.fillStyle = C.crema2;
  pie.lineas.forEach((l, i) => c.fillText(l, M, pieY + pie.tam + i * renglon));
  c.font = `900 46px ${SANS}`;
  const dir = "tinkazo.app";
  const dirW = Math.ceil(c.measureText(dir).width) + 48;
  calcomania(c, M, H - 140, dirW, 76, C.magenta, -2, () => {
    c.fillStyle = C.fondo;
    c.font = `900 46px ${SANS}`;
    c.fillText(dir, 24, 54);
  }, 9);
  c.font = `700 24px ${MONO}`;
  c.fillStyle = C.apagado;
  espaciado(c, s("imgSello").toUpperCase(), M + dirW + 40, H - 92, 2.5);

  // El medio: el título, quién o quiénes, el premio y entre cuántos. Se mide
  // primero y se centra entre el rótulo y el pie.
  const arriba = 268;
  const abajo = pieY - 40;
  const premio = d.premio ? `${s(varios ? "imgPremio" : "winsPrize")} ${d.premio}` : "";
  c.font = `700 46px ${SANS}`;
  // El premio, en dos renglones como mucho: más largo, se recorta el segundo.
  const lineas = premio ? partir(c, premio, ANCHO) : [];
  const premioL = lineas.length > 2 ? [lineas[0] ?? "", recortar(c, lineas.slice(1).join(" "), ANCHO)] : lineas;
  const entre = L.imgEntre(d.total, varios);
  const colaAlto = premioL.length * 60 + 58;

  if (!varios) {
    // El nombre, lo más grande que entre a lo ancho en tres renglones y a lo
    // alto sin pisar el pie. Con 56 px y tres renglones entra siempre.
    const quien = d.nombres[0] ?? "";
    let nombre = encajar(c, quien, ANCHO - 28, 3, 56, 56, 900);
    for (let tam = 132; tam > 56; tam -= 4) {
      c.font = `900 ${tam}px ${SANS}`;
      const lineas = partir(c, quien, ANCHO - 28);
      if (lineas.length <= 3 && 176 + lineas.length * (Math.round(tam * 1.12) + 12) + 30 + colaAlto <= abajo - arriba) {
        nombre = { tam, lineas };
        break;
      }
    }
    const paso = Math.round(nombre.tam * 1.12) + 12;
    const alto = 128 + 48 + nombre.lineas.length * paso + 30 + colaAlto;
    let y = arriba + Math.max(0, (abajo - arriba - alto) / 2);
    c.font = `900 128px ${SANS}`;
    c.fillStyle = C.crema;
    const titulo = s("imgGano");
    c.fillText(titulo, M, y + 110);
    const lado = 150;
    const foto = cara(d.nombres[0] ?? "", lado);
    calcomania(c, M + c.measureText(titulo).width + 44, y - 10, lado, lado, "#fff", 3, () => c.drawImage(foto, 0, 0, lado, lado), 10);
    y += 128 + 48;
    // El nombre sobre una franja amarilla, renglón por renglón, como el
    // "comprobar." de la imagen del sitio.
    c.font = `900 ${nombre.tam}px ${SANS}`;
    for (const [i, l] of nombre.lineas.entries()) {
      const base = y + nombre.tam * 0.86 + i * paso;
      c.fillStyle = C.amarillo;
      c.fillRect(M - 14, base - nombre.tam * 0.86, c.measureText(l).width + 28, Math.round(nombre.tam * 1.12));
      c.fillStyle = C.fondo;
      c.fillText(l, M, base);
    }
    y += nombre.lineas.length * paso + 30;
    cola(c, premioL, entre, y);
    return lienzo;
  }

  // Varios: una fila por ganador, con su cara y su número. Hasta seis en una
  // columna; de siete a doce, en dos; con más, los primeros once y "y N más".
  const enDos = d.nombres.length > 6;
  const tope = enDos ? 12 : 6;
  const vistos = d.nombres.length > tope ? tope - 1 : d.nombres.length;
  const resto = d.nombres.length - vistos;
  const porColumna = enDos ? Math.ceil(vistos / 2) : vistos;
  const colW = enDos ? (ANCHO - 40) / 2 : ANCHO;
  const tituloAlto = 104 + 34;
  const espacio = abajo - arriba - tituloAlto - colaAlto - 24 - (resto ? 56 : 0);
  const fila = Math.max(64, Math.min(176, Math.floor(espacio / porColumna)));
  const alto = tituloAlto + fila * porColumna + (resto ? 56 : 0) + 24 + colaAlto;
  let y = arriba + Math.max(0, (abajo - arriba - alto) / 2);
  c.font = `900 104px ${SANS}`;
  c.fillStyle = C.crema;
  c.fillText(s("imgGanaron"), M, y + 90);
  y += tituloAlto;
  const lado = fila - 20;
  const numTam = Math.round(Math.min(40, fila * 0.32));
  c.font = `800 ${numTam}px ${MONO}`;
  const numW = c.measureText(`#${vistos}`).width;
  // La letra de los nombres baja hasta que entren todos, con un piso; lo que
  // no entre ni así se recorta con puntos suspensivos.
  const libre = colW - lado - 26 - numW - 18;
  let nomTam = Math.round(Math.min(72, fila * 0.46));
  const piso = enDos ? 24 : 32;
  for (; nomTam > piso; nomTam -= 2) {
    c.font = `900 ${nomTam}px ${SANS}`;
    if (d.nombres.slice(0, vistos).every((n) => c.measureText(n).width <= libre)) break;
  }
  for (let k = 0; k < vistos; k++) {
    const nombre = d.nombres[k] ?? "";
    const x0 = M + (enDos ? Math.floor(k / porColumna) : 0) * (colW + 40);
    const y0 = y + (k % porColumna) * fila;
    const foto = cara(nombre, lado);
    calcomania(c, x0, y0 + 4, lado, lado, "#fff", k % 2 ? 2 : -2, () => c.drawImage(foto, 0, 0, lado, lado), Math.max(5, Math.round(lado / 14)));
    c.font = `900 ${nomTam}px ${SANS}`;
    c.fillStyle = C.crema;
    c.fillText(recortar(c, nombre, libre), x0 + lado + 26, y0 + 4 + lado / 2 + nomTam * 0.36);
    c.font = `800 ${numTam}px ${MONO}`;
    c.fillStyle = C.magenta;
    c.textAlign = "right";
    c.fillText(`#${k + 1}`, x0 + colW, y0 + 4 + lado / 2 + numTam * 0.36);
    c.textAlign = "left";
  }
  y += porColumna * fila;
  if (resto) {
    c.font = `800 40px ${SANS}`;
    c.fillStyle = C.crema2;
    c.fillText(L.imgMas(resto), M, y + 40);
    y += 56;
  }
  cola(c, premioL, entre, y + 24);
  return lienzo;
}

/** El premio y entre cuántos, debajo de los nombres. */
function cola(c: Ctx, premio: string[], entre: string, y: number): void {
  c.font = `700 46px ${SANS}`;
  c.fillStyle = C.crema;
  premio.forEach((l, i) => c.fillText(l, M, y + 46 + i * 60));
  c.font = `600 34px ${SANS}`;
  c.fillStyle = C.apagado;
  c.fillText(entre, M, y + premio.length * 60 + 44);
}

/** La imagen se arma una vez por resultado e idioma, y queda lista. */
let lista: { clave: string; archivo: Promise<File> } | null = null;

function archivo(): { d: Datos; archivo: Promise<File> } | null {
  const d = datos();
  if (!d) return null;
  const clave = JSON.stringify(d);
  if (lista?.clave !== clave) lista = { clave, archivo: armar(d) };
  return { d, archivo: lista.archivo };
}

async function armar(d: Datos): Promise<File> {
  const blob = await new Promise<Blob | null>((r) => dibujar(d).toBlob(r, "image/png"));
  if (!blob) throw new Error("toBlob");
  return new File([blob], `tinkazo-${d.fecha.toISOString().slice(0, 10)}.png`, { type: "image/png" });
}

/**
 * La arma de antemano, apenas termina el festejo: en el celular, compartir
 * tiene que salir del mismo toque, y si hay que esperar a dibujarla el
 * navegador puede negar el menú de compartir.
 */
export function prepararImagen(): void {
  archivo()?.archivo.catch(() => {
    lista = null;
  });
}

/** En el celular, el menú de compartir del sistema; en la computadora, la descarga. */
export async function compartirImagen(btn: HTMLButtonElement): Promise<void> {
  const a = archivo();
  if (!a) return;
  const L = T[getLang()];
  let f: File;
  try {
    f = await a.archivo;
  } catch {
    lista = null;
    avisar(btn, t("imgFalla"));
    return;
  }
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], text: L.imgTexto(a.d.nombres, a.d.premio) });
      avisar(btn, t("imgLista"));
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Si el navegador no deja compartir, se descarga.
    }
  }
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(f);
  enlace.download = f.name;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30_000);
  avisar(btn, t("imgDescargada"));
}

function avisar(btn: HTMLButtonElement, texto: string): void {
  btn.textContent = texto;
  setTimeout(() => (btn.textContent = t("imgBtn")), 2200);
}
