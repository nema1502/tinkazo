/**
 * Las piezas de la segunda vuelta del kit: logos con la dirección, más stickers, hojas A4, imágenes para redes,
 * afiches, cartel de mesa y la portada del kit. Cada una se dibuja una sola vez (formas planas, letras en trazos)
 * y sale en SVG, PDF o PNG según haga falta. Devuelve { zip, sponsor }: las listas [ruta dentro del ZIP, nombre en
 * public/marca] del kit completo y del kit liviano para sponsors.
 */
import { afin, rasterizar, pngNivel, pdf, svgMm, rutaSvg, num } from "./base.mjs";
import { Lienzo } from "./dibujo.mjs";
import { logoArchivo } from "./logos.mjs";
import { listaStickers, construir, hoja, SANGRE } from "./stickers.mjs";
import { FORMATOS, escenaRed } from "./redes.mjs";
import { afiche, cartel, ampliar } from "./afiches.mjs";
import { portada } from "./portada.mjs";
import { rollUp, bannerMesa, cargarFotos, cargarFotosRed, JUEGOS_FOTO, SANGRE_IMPRESO, logoPared, VARIANTES_PARED, SPONSOR_FORMATOS, SPONSOR_CON_JUEGOS, escenaSponsor } from "./impresos.mjs";
import { textosSponsorTxt, preguntasTxt } from "./textos-sponsor.mjs";

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
  const formas = l.formas.map((f) => (f.imagen ? { ...f, x: f.x * e, y: f.y * e, ancho: f.ancho * e, alto: f.alto * e } : { ...f, cmds: afin(f.cmds, e, 0, 0, e, 0, 0) }));
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

  // 7. Para presentarnos: el roll-up (85 y 100 por 200 cm) y el banner de mesa (120 por 40 cm), con fotos de los juegos.
  //    PDF para la imprenta (las fotos adentro), SVG para editar (enlaza los JPEG que van al lado) y una vista chica
  //    para la página, con las fotos de 640 px adentro del archivo.
  const fotos = cargarFotos(), medias = cargarFotos("media"), chicas = cargarFotos("chica");
  for (const j of JUEGOS_FOTO) {
    escribir(`juego-${j}.jpg`, fotos[j].datos);
    nota(`impresos/juego-${j}.jpg`, `juego-${j}.jpg`);
  }
  for (const lang of LANGS) {
    for (const [nombre, hacer, titulo] of [
      [`rollup-85x200-${lang}`, (f) => rollUp(85, lang, f), "Tinkazo, roll-up de 85 por 200 cm"],
      [`rollup-100x200-${lang}`, (f) => rollUp(100, lang, f), "Tinkazo, roll-up de 100 por 200 cm"],
      [`banner-mesa-120x40-${lang}`, (f) => bannerMesa(lang, f === fotos ? medias : f),"Tinkazo, banner de mesa de 120 por 40 cm"],
    ]) {
      const l = hacer(fotos);
      const sangre = `${titulo}, con ${SANGRE_IMPRESO} mm de sangrado`;
      escribir(`${nombre}.svg`, svgMm(l.w, l.h, l.formas, sangre));
      escribir(`${nombre}.pdf`, pdf(l.w, l.h, SANGRE_IMPRESO, l.formas));
      nota(`impresos/tinkazo-${nombre}.svg`, `${nombre}.svg`); // el PDF para la imprenta se baja suelto desde la página: con él el ZIP pasaba de los 4 MB
      if (!nombre.startsWith("rollup-100")) {
        const v = hacer(chicas);
        escribir(`vista-${nombre}.svg`, svgMm(v.w, v.h, v.formas, `${titulo}, vista previa`));
      }
    }
  }

  // 8. Para quien nos pone de sponsor: logos en caja fija para la pared de sponsors, imágenes para anunciarlo y los textos.
  const sponsor = [];
  for (const disp of ["horizontal", "cuadrado"]) for (const v of VARIANTES_PARED) {
    const l = logoPared(disp, v);
    const nombre = `logo-pared-${disp}${v === "claro" ? "" : `-${v}`}`;
    escribir(`${nombre}.svg`, svgPx(l.w, l.h, l.formas, "Tinkazo"));
    escribir(`${nombre}.png`, pngDe(l, l.w));
    // Para imprimir: PNG de 2400 px de ancho y PDF vectorial (30 cm de ancho el horizontal, 20 cm el cuadrado).
    escribir(`${nombre}-2400.png`, pngDe(l, 2400));
    const mmAncho = disp === "horizontal" ? 300 : 200, e = mmAncho / l.w;
    escribir(`${nombre}.pdf`, pdf(mmAncho, l.h * e, 0, l.formas.map((f) => ({ ...f, cmds: afin(f.cmds, e, 0, 0, e, 0, 0) }))));
    for (const ext of ["svg", "png", "pdf"]) sponsor.push([`logos/tinkazo-${nombre}.${ext}`, `${nombre}.${ext}`]);
    sponsor.push([`logos/tinkazo-${nombre}-2400.png`, `${nombre}-2400.png`]);
  }
  for (const f of SPONSOR_FORMATOS) for (const tema of TEMAS_ARCHIVO) for (const lang of LANGS) {
    const nombre = `redes-${f.id}-${tema}-${lang}`;
    escribir(`${nombre}.png`, pngDe(escenaSponsor(f.id, tema, lang), f.w));
    sponsor.push([`redes/tinkazo-${nombre}.png`, `${nombre}.png`]);
  }
  // El segundo estilo, con capturas de los juegos: solo en la página (con fotos pesan más y el ZIP queda liviano).
  const fotosRed = cargarFotosRed();
  for (const id of SPONSOR_CON_JUEGOS) for (const tema of TEMAS_ARCHIVO) for (const lang of LANGS) {
    const f = SPONSOR_FORMATOS.find((q) => q.id === id);
    escribir(`redes-${id}-juegos-${tema}-${lang}.png`, pngDe(escenaSponsor(id, tema, lang, "juegos", fotosRed), f.w));
  }
  escribir("textos-sponsor.txt", textosSponsorTxt());
  sponsor.push(["tinkazo-textos-sponsor.txt", "textos-sponsor.txt"]);
  escribir("preguntas-organizadores.txt", preguntasTxt());
  sponsor.push(["tinkazo-preguntas-para-coordinar.txt", "preguntas-organizadores.txt"]);
  for (const [ruta, nombre] of sponsor) nota(`sponsor/${ruta}`, nombre);
  return { zip, sponsor };
}
