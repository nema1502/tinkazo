/**
 * Las piezas de la segunda vuelta del kit: logos con la dirección, más stickers, hojas A4, imágenes para redes,
 * afiches, cartel de mesa y la portada del kit. Cada una se dibuja una sola vez (formas planas, letras en trazos)
 * y sale en SVG, PDF o PNG según haga falta. Devuelve la lista [ruta dentro del ZIP, nombre en public/marca].
 */
import { afin, rasterizar, pngNivel, pdf, svgMm, rutaSvg, num } from "./base.mjs";
import { Lienzo } from "./dibujo.mjs";
import { logoArchivo } from "./logos.mjs";
import { listaStickers, construir, hoja, SANGRE } from "./stickers.mjs";
import { FORMATOS, escenaRed } from "./redes.mjs";
import { afiche, cartel, ampliar } from "./afiches.mjs";
import { portada } from "./portada.mjs";

export const TEMAS_ARCHIVO = ["claro", "oscuro"];
export const LANGS = ["es", "en"];

/** Un SVG en píxeles (para los logos): las formas tal cual. */
const svgPx = (w, h, formas, titulo) => `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}" role="img" aria-labelledby="titulo">
<title id="titulo">${titulo}</title>
${formas.map(rutaSvg).join("\n")}
</svg>
`;
/** El PNG de un lienzo a un ancho dado (alto proporcional). */
function pngDe(l, ancho) {
  const e = ancho / l.w, alto = Math.round(l.h * e);
  const formas = l.formas.map((f) => ({ ...f, cmds: afin(f.cmds, e, 0, 0, e, 0, 0) }));
  return pngNivel(ancho, alto, rasterizar(formas, ancho, alto));
}
const mueve = (formas, dx, dy) => formas.map((f) => ({ ...f, cmds: afin(f.cmds, 1, 0, 0, 1, dx, dy) }));
const sufTema = (t) => (t === "oscuro" ? "-oscuro" : "");

export function generarPiezas(escribir) {
  const zip = [];
  const nota = (ruta, nombre) => zip.push([ruta, nombre]);

  // 1. Logos con la dirección: svg y png de 2048 de ancho, en claro y oscuro.
  for (const disp of ["horizontal", "apilado"]) for (const tema of TEMAS_ARCHIVO) {
    const l = logoArchivo(Lienzo, disp, tema, true);
    const nombre = `logo-web-${disp}${sufTema(tema)}`;
    escribir(`${nombre}.svg`, svgPx(l.w, l.h, l.formas, "Tinkazo, tinkazo.app"));
    escribir(`${nombre}.png`, pngDe(l, 2048));
    for (const ext of ["svg", "png"]) nota(`logos/tinkazo-${nombre}.${ext}`, `${nombre}.${ext}`);
  }

  // 2. Stickers: 5 y 7 cm, svg y pdf, con sangrado y capa de corte.
  for (const [base, spec] of listaStickers()) for (const cm of [5, 7]) {
    const s = construir(spec, cm, SANGRE);
    const w = s.w + 2 * SANGRE, h = s.h + 2 * SANGRE;
    const formas = mueve(s.formas, SANGRE, SANGRE);
    const nombre = `${base}-${cm}cm`;
    escribir(`${nombre}.svg`, svgMm(w, h, formas, `Tinkazo, sticker de ${cm} cm con ${SANGRE} mm de sangrado`));
    escribir(`${nombre}.pdf`, pdf(w, h, SANGRE, formas));
    for (const ext of ["svg", "pdf"]) nota(`stickers/tinkazo-${nombre}.${ext}`, `${nombre}.${ext}`);
  }

  // 3. Hojas A4 con 5 mm entre stickers y la capa de corte, para mandar a cortar en vinilo.
  for (const lang of LANGS) {
    const E = (nombre, tema = "claro") => ({ nombre, tema, lang });
    const fila5 = [
      [E("redondo"), E("redondo", "oscuro"), E("cuadrado")],
      [E("verificable"), E("gratis"), E("escanea")],
      [E("evento"), E("cuadrado"), E("verificable")],
      [E("gratis"), E("escanea"), E("evento")],
      [E("web"), E("web"), E("web")],
      [E("web", "oscuro"), E("web", "oscuro"), E("web", "oscuro")],
    ];
    const fila7 = [
      [E("verificable"), E("gratis")],
      [E("escanea"), E("evento")],
      [E("redondo"), E("redondo", "oscuro")],
      [E("web"), E("web", "oscuro")],
    ];
    for (const [nombre, filas, cm] of [[`stickers-hoja-a4-${lang}`, fila5, 5], [`stickers-hoja-a4-7cm-${lang}`, fila7, 7]]) {
      const h = hoja(filas, cm);
      escribir(`${nombre}.svg`, svgMm(h.ancho, h.alto, h.formas, `Tinkazo, hoja A4 de stickers de ${cm} cm`));
      escribir(`${nombre}.pdf`, pdf(h.ancho, h.alto, 0, h.formas));
      for (const ext of ["svg", "pdf"]) nota(`stickers/hojas/tinkazo-${nombre}.${ext}`, `${nombre}.${ext}`);
    }
  }

  // 4. Imágenes para redes: PNG en claro y oscuro, en español y en inglés.
  for (const f of FORMATOS) for (const tema of TEMAS_ARCHIVO) for (const lang of LANGS) {
    const nombre = `redes-${f.id}-${tema}-${lang}`;
    escribir(`${nombre}.png`, pngDe(escenaRed(f.id, tema, lang), f.w));
    nota(`redes/tinkazo-${nombre}.png`, `${nombre}.png`);
  }

  // 5. Afiche (A4 y A3) y cartel de mesa (A5): svg y pdf, claro y oscuro, es y en.
  for (const tema of TEMAS_ARCHIVO) for (const lang of LANGS) {
    const a4 = afiche(tema, lang), a3 = ampliar(a4, 297, 420), a5 = cartel(tema, lang);
    for (const [nombre, l, titulo] of [
      [`afiche-evento-a4-${tema}-${lang}`, a4, "Tinkazo, afiche del evento A4"],
      [`afiche-evento-a3-${tema}-${lang}`, a3, "Tinkazo, afiche del evento A3"],
      [`cartel-mesa-a5-${tema}-${lang}`, a5, "Tinkazo, cartel de mesa A5"],
    ]) {
      escribir(`${nombre}.svg`, svgMm(l.w, l.h, l.formas, titulo));
      escribir(`${nombre}.pdf`, pdf(l.w, l.h, 0, l.formas));
      for (const ext of ["svg", "pdf"]) nota(`afiches/tinkazo-${nombre}.${ext}`, `${nombre}.${ext}`);
    }
  }

  // 6. La portada del kit, para mandar junto al enlace.
  for (const lang of LANGS) {
    const nombre = lang === "es" ? "kit-portada.png" : "kit-portada-en.png";
    escribir(nombre, pngDe(portada(lang), 1600));
    nota(nombre.replace("kit-", "tinkazo-kit-"), nombre);
  }
  return zip;
}
