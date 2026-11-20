#!/usr/bin/env node
/**
 * La serie de stickers de los nueve departamentos, el Tinku y los tiernos de toda Bolivia.
 *
 * Los dibujos viven en scripts/marca/departamentos/, uno por zona (occidente, valles, oriente y bolivia), y cada uno
 * exporta STICKERS: una lista de { id, nombre, frase, nota, dibujar(D, frase) }. Este corredor los junta, los troquela
 * y escribe en public/marca/departamentos/:
 *   <id>.png                         el sticker de 5 cm a 300 ppp, con fondo transparente (el borde blanco incluido)
 *   imprenta/tinkazo-<id>-5cm.svg     y -7cm.svg, -5cm.pdf, -7cm.pdf: a tamaño real, con 3 mm de sangrado y la línea
 *                                    de troquel en la capa "corte"
 *   frases.txt                       las frases, con lo que quieren decir
 *   hojas/<hoja>.pdf y .png          con --hojas, las hojas que ya tengan todos sus stickers dibujados
 *
 * Uso:
 *   node scripts/marca/departamentos.mjs                       todos
 *   node scripts/marca/departamentos.mjs --solo occidente      una zona (occidente, valles, oriente, bolivia)
 *   node scripts/marca/departamentos.mjs --solo lapaz,tinku    los de un departamento (el comienzo del id)
 *   node scripts/marca/departamentos.mjs --solo lapaz-illimani un sticker
 *   node scripts/marca/departamentos.mjs --hojas               además, las hojas completas
 *   node scripts/marca/departamentos.mjs --vista <carpeta>     no toca public/: deja en la carpeta, de lo elegido, el PNG
 *                                                              de 300 ppp, el de tamaño real en pantalla de 5 cm y el de
 *                                                              4,2 cm (el de la A3), a 96 ppp, y una hoja A4 de prueba de
 *                                                              6 cm, para mirarlos
 *   node scripts/marca/departamentos.mjs --lista               qué hay y qué falta
 *
 * Revisa cada sticker antes de escribirlo: el troquel de una sola pieza, ninguna letra de la frase por debajo de 2,8 mm
 * a 5 cm, la etiqueta tinkazo.app de 2,2 mm o más, y las frases sin las palabras ni los signos que no van.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { rect, pdf, svgMm } from "./base.mjs";
import { aMedida, mueve, pngMm, hoja } from "./pincel.mjs";
import { ordenar, armarHoja, medirHoja, marcosA3, tonos } from "./departamentos/hojas.mjs";
import { armarEntrega } from "./departamentos/entrega.mjs";
import { STICKERS as OCCIDENTE } from "./departamentos/occidente.mjs";
import { STICKERS as VALLES } from "./departamentos/valles.mjs";
import { STICKERS as ORIENTE } from "./departamentos/oriente.mjs";
import { STICKERS as BOLIVIA } from "./departamentos/bolivia.mjs";
import { STICKERS as LITORAL, HOJA as HOJA_LITORAL } from "./departamentos/litoral.mjs";

export const ZONAS = { occidente: OCCIDENTE, valles: VALLES, oriente: ORIENTE, bolivia: BOLIVIA, litoral: LITORAL };
/** El comienzo del id dice de dónde es cada sticker. */
export const LUGARES = {
  lapaz: "La Paz", oruro: "Oruro", potosi: "Potosí", cochabamba: "Cochabamba", chuquisaca: "Chuquisaca", tarija: "Tarija",
  santacruz: "Santa Cruz", beni: "Beni", pando: "Pando", litoral: "El Litoral", tinku: "El Tinku", tierno: "Tiernos de toda Bolivia",
};
export const SERIE = Object.entries(ZONAS).flatMap(([zona, lista]) => lista.map((st) => ({ ...st, zona })));
export const lugarDe = (st) => LUGARES[st.id.split("-")[0]];

/**
 * Las hojas, con el plan de la serie: cinco A4 de doce stickers y una A3 con los 42. `cm` es lo mínimo que se acepta
 * (6 en las A4 y 4,2 en la A3, según el plan): el tamaño real es el mayor que entra en la hoja, ver hojas.mjs. `bloques`
 * dice qué stickers se quedan juntos al alternar los colores (los cuatro de un departamento, una fila) y `fijo` que se
 * dejan en el orden dado. Una hoja sale
 * recién cuando todos sus stickers están dibujados.
 *
 * Cochabamba entra con el silpancho (Full stack) y no con Todo con llajua: esa quedó dibujada y se puede sumar si se
 * quiere, pero la A3 de 42 no tiene lugar para ella.
 */
export const HOJAS = {
  "hoja-a4-occidente": { ancho: 210, alto: 297, cols: 3, cm: 6, bloques: [4, 4, 4], ids: ["lapaz-illimani", "lapaz-api", "lapaz-cebra", "lapaz-totora", "oruro-carnaval", "oruro-sajama", "oruro-quirquincho", "oruro-quinua", "potosi-uyuni", "potosi-flamencos", "potosi-vales", "potosi-arbol"] },
  "hoja-a4-valles": { ancho: 210, alto: 297, cols: 3, cm: 6, bloques: [4, 4, 4], ids: ["cochabamba-tunari", "cochabamba-charango", "cochabamba-silpancho", "cochabamba-llajta", "chuquisaca-sucre", "chuquisaca-dino", "chuquisaca-chocolate", "chuquisaca-tarabuco", "tarija-sanjacinto", "tarija-violin", "tarija-churo", "tarija-blanqueada"] },
  "hoja-a4-oriente": { ancho: 210, alto: 297, cols: 3, cm: 6, bloques: [4, 4, 4], ids: ["santacruz-tajibo", "santacruz-cunape", "santacruz-elay", "santacruz-achachairu", "beni-mamore", "beni-paraba", "beni-victoria", "beni-capiguara", "pando-selva", "pando-castana", "pando-asai", "pando-tucan"] },
  // Una fila por zona: occidente, valles, oriente y, abajo, el Tinku y la música.
  "hoja-a4-postales-tinku": { ancho: 210, alto: 297, cols: 3, cm: 6, bloques: [3, 3, 3, 3], fijo: true, ids: ["lapaz-illimani", "oruro-carnaval", "potosi-uyuni", "cochabamba-tunari", "chuquisaca-sucre", "tarija-sanjacinto", "santacruz-tajibo", "beni-mamore", "pando-selva", "tinku-montera", "tinku-pareja", "cochabamba-charango"] },
  "hoja-a4-tiernos": { ancho: 210, alto: 297, cols: 3, cm: 6, ids: ["tierno-kantuta", "tierno-patuju", "tierno-jucumari", "tierno-perezoso", "lapaz-api", "santacruz-cunape", "potosi-vales", "potosi-flamencos", "chuquisaca-dino", "beni-capiguara", "beni-paraba", "tarija-churo"] },
};
/**
 * La A3 con los 42, en el orden de las A4: dos filas de seis por cada zona (occidente, valles, oriente) y abajo el Tinku
 * y los tiernos. Deja lugar arriba para el título y abajo para la dirección.
 */
HOJAS["hoja-a3-todos"] = { ancho: 297, alto: 420, cols: 6, cm: 4.2, arriba: 48, abajo: 26, bloques: [12, 12, 12, 6], ids: [...new Set(Object.values(HOJAS).flatMap((h) => h.ids))] };
/** El Litoral va en su propia hoja, después de la A3, que sigue siendo la de los 42. */
HOJAS["hoja-a4-litoral"] = HOJA_LITORAL;

/** Dibujados pero fuera de las hojas del plan: se entregan sueltos, de repuesto. */
export const REPUESTOS = ["cochabamba-llajua"];

/** Lo que no va en ninguna frase ni nota: apuestas, alcohol y los signos que la marca no usa. */
const PROHIBIDO = /suerte|apuest|apost|casino|singani|chicha|cerveza|borrach|[«»;·—–]/i;
/** Palabras que también tienen un sentido inocente (vino de venir, al azar, un trago de agua): avisan, no frenan. */
const DUDOSO = /\bazar\b|\bvinos?\b|\btragos?\b|\bcopas?\b/i;
const textosDe = (st) => [...(st.frase ?? []), st.nombre ?? "", st.nota ?? ""];

/** Revisa la lista: ids únicos y con lugar conocido, frases sin lo prohibido. Devuelve los problemas. */
export function revisarSerie(serie = SERIE) {
  const problemas = [], vistos = new Set();
  for (const st of serie) {
    if (vistos.has(st.id)) problemas.push(`${st.id}: el id está repetido`);
    vistos.add(st.id);
    if (!lugarDe(st)) problemas.push(`${st.id}: el id tiene que empezar con un lugar (${Object.keys(LUGARES).join(", ")})`);
    if (!Array.isArray(st.frase) || !st.frase.length) problemas.push(`${st.id}: falta la frase (una lista de líneas)`);
    for (const t of textosDe(st)) if (PROHIBIDO.test(t)) problemas.push(`${st.id}: "${t}" tiene algo que no va`);
    if (typeof st.dibujar !== "function") problemas.push(`${st.id}: falta dibujar(D, frase)`);
  }
  return problemas;
}
/** Lo que hay que mirar con ojos: palabras que pueden leerse como alcohol o apuestas según la frase. */
export const avisosSerie = (serie = SERIE) => serie.flatMap((st) => textosDe(st).filter((t) => DUDOSO.test(t)).map((t) => `${st.id}: "${t}" puede leerse mal, revisalo`));

/** Mide un sticker a 5 cm y dice si se lee: letra de la frase de 2,8 mm o más y tinkazo.app de 2,2 mm o más. */
export function medidas(st) {
  const s = aMedida(st, 5, 0);
  const fallas = [];
  if (s.capMin < 2.8) fallas.push(`la letra más chica de la frase mide ${s.capMin.toFixed(2)} mm a 5 cm (tiene que medir 2,8 o más)`);
  if (s.capSello < 2.2) fallas.push(`tinkazo.app mide ${s.capSello.toFixed(2)} mm (tiene que medir 2,2 o más)`);
  return { w: s.w, h: s.h, capMin: s.capMin, capSello: s.capSello, fallas };
}

const SANGRE = 3;
/** Los archivos de un sticker: el PNG de 300 ppp y, para la imprenta, SVG y PDF de 5 y 7 cm con sangrado y troquel. */
export function archivosDe(st) {
  const salida = new Map();
  const v = aMedida(st, 5, 0);
  salida.set(`${st.id}.png`, pngMm(v.formas, v.w, v.h, 300));
  for (const cm of [5, 7]) {
    const s = aMedida(st, cm, SANGRE);
    const w = s.w + 2 * SANGRE, h = s.h + 2 * SANGRE, formas = mueve(s.formas, SANGRE, SANGRE);
    const titulo = `Tinkazo, ${st.nombre}: sticker de ${cm} cm con ${SANGRE} mm de sangrado`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    salida.set(`imprenta/tinkazo-${st.id}-${cm}cm.svg`, Buffer.from(svgMm(w, h, formas, titulo)));
    salida.set(`imprenta/tinkazo-${st.id}-${cm}cm.pdf`, pdf(w, h, SANGRE, formas));
  }
  return salida;
}

/** El alto en píxeles de la vista en PNG de una hoja: se lee entera en una pantalla y se acerca bien. */
const ALTO_VISTA = 1600;
/**
 * El PDF (con la línea de corte en su capa) y la vista en PNG de una hoja armada con la grilla de hojas.mjs. `cm` es el
 * tamaño de los stickers; sin él, el mayor que entra. La A3 lleva su título y su pie.
 */
export function archivosHoja(nombre, lista, h, { cm } = {}) {
  const hj = armarHoja(lista, { ancho: h.ancho, alto: h.alto, cols: h.cols, cm, arriba: h.arriba ?? 0, abajo: h.abajo ?? 0 });
  const marcos = h.arriba ? marcosA3(h.ancho, h.alto, h.arriba, h.abajo) : [];
  // Primero el título y el pie, que van debajo; la línea de corte sigue siendo lo último.
  const formas = [...marcos, ...hj.formas];
  const fondo = { cmds: rect(0, 0, hj.ancho, hj.alto), fill: "#e9e2d4" };
  const archivos = new Map([[`hojas/${nombre}.pdf`, pdf(hj.ancho, hj.alto, 0, formas)], [`hojas/${nombre}.png`, pngMm([fondo, ...formas], hj.ancho, hj.alto, ALTO_VISTA / hj.alto * 25.4)]]);
  return { archivos, hoja: hj, medidas: medirHoja(hj) };
}

/** Las frases de la serie, para copiar en un pie de foto, con lo que quieren decir. */
export function textoFrases(serie = SERIE) {
  const salida = ["TINKAZO, STICKERS DE LOS NUEVE DEPARTAMENTOS", "============================================", "Para copiar en un pie de foto, una placa de video o un cartel. Siempre se escribe Tinkazo, con K. Instagram: @tinkazo.app"];
  for (const [clave, lugar] of Object.entries(LUGARES)) {
    const de = serie.filter((st) => st.id.startsWith(`${clave}-`));
    if (!de.length) continue;
    salida.push("", lugar.toUpperCase());
    for (const st of de) {
      salida.push(`  ${st.frase.join(" ").replace(/\s+/g, " ")}`);
      if (st.nota) salida.push(`      ${st.nota}`);
    }
  }
  salida.push("");
  return salida.join("\r\n");
}

/** Los stickers que pide `--solo`: zonas, comienzos de id o ids, separados por comas. */
export function elegir(solo, serie = SERIE) {
  if (!solo) return serie;
  const pedidos = solo.split(",").map((s) => s.trim()).filter(Boolean);
  const elegidos = serie.filter((st) => pedidos.some((p) => st.zona === p || st.id === p || st.id.startsWith(`${p}-`)));
  const sobran = pedidos.filter((p) => !serie.some((st) => st.zona === p || st.id === p || st.id.startsWith(`${p}-`)));
  if (sobran.length) throw new Error(`--solo: no hay nada que se llame ${sobran.join(", ")}`);
  return elegidos;
}

function principal(args) {
  const conocidas = ["--solo", "--vista", "--hojas", "--solo-hojas", "--entrega", "--lista"];
  const raras = args.filter((a) => a.startsWith("--") && !conocidas.includes(a));
  if (raras.length) { console.error(`no conozco ${raras.join(", ")} (valen ${conocidas.join(", ")})`); process.exit(1); }
  // --solo y --vista piden un valor: sin él, --vista escribiría en public/ y --solo haría todo.
  const opt = (n) => {
    const i = args.indexOf(n);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith("--")) { console.error(`${n} necesita un valor`); process.exit(1); }
    return v;
  };
  const problemas = revisarSerie();
  if (problemas.length) { console.error(problemas.join("\n")); process.exit(1); }
  for (const a of avisosSerie()) console.log(`AVISO ${a}`);
  if (args.includes("--lista")) {
    const hechos = new Set(SERIE.map((st) => st.id));
    for (const [z, lista] of Object.entries(ZONAS)) console.log(`${z}: ${lista.map((st) => st.id).join(", ") || "(ninguno todavía)"}`);
    const planeados = [...new Set(Object.values(HOJAS).flatMap((h) => h.ids ?? []))];
    const faltan = planeados.filter((id) => !hechos.has(id));
    console.log(`\n${hechos.size} dibujados. Faltan ${faltan.length} del plan: ${faltan.join(", ")}`);
    return;
  }
  const soloHojas = args.includes("--solo-hojas"); // arma las hojas con lo que ya está escrito, sin volver a dibujar cada sticker
  const elegidos = soloHojas ? [] : elegir(opt("--solo"));
  const vista = opt("--vista");
  const destino = vista ? resolve(vista) : fileURLToPath(new URL("../../public/marca/departamentos/", import.meta.url));
  mkdirSync(destino, { recursive: true });
  const escribir = (nombre, datos) => { const ruta = resolve(destino, nombre); mkdirSync(resolve(ruta, ".."), { recursive: true }); writeFileSync(ruta, datos); };
  let mal = 0;
  for (const st of elegidos) {
    const t0 = Date.now();
    const m = medidas(st);
    const linea = `${st.id}: ${m.w.toFixed(1)} x ${m.h.toFixed(1)} mm, frase ${m.capMin.toFixed(2)} mm, sello ${m.capSello.toFixed(2)} mm`;
    if (m.fallas.length) { console.error(`MAL ${linea}\n  ${m.fallas.join("\n  ")}`); mal++; continue; }
    if (vista) {
      const v = aMedida(st, 5, 0), a3 = aMedida(st, 4.2, 0);
      escribir(`${st.id}.png`, pngMm(v.formas, v.w, v.h, 300));
      escribir(`${st.id}-pantalla.png`, pngMm(v.formas, v.w, v.h, 96));
      escribir(`${st.id}-a3.png`, pngMm(a3.formas, a3.w, a3.h, 96));
    } else for (const [n, d] of archivosDe(st)) escribir(n, d);
    console.log(`bien ${linea} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  if (vista && elegidos.length) {
    const lista = Array.from({ length: Math.max(elegidos.length, 6) }, (_, i) => elegidos[i % elegidos.length]);
    for (const [n, d] of archivosHoja("vista-a4", lista.slice(0, 12), HOJAS["hoja-a4-occidente"]).archivos) escribir(n.replace("hojas/", ""), d);
  }
  if (!vista && !soloHojas) escribir("frases.txt", Buffer.from(textoFrases(), "utf8"));
  if ((args.includes("--hojas") || soloHojas) && !vista) {
    const porId = new Map(SERIE.map((st) => [st.id, st]));
    const completas = Object.entries(HOJAS).filter(([nombre, h]) => {
      const faltan = h.ids.filter((id) => !porId.has(id));
      if (faltan.length) console.log(`${nombre}: falta dibujar ${faltan.length} (${faltan.join(", ")})`);
      return !faltan.length;
    });
    // El orden alterna los colores. Cada hoja usa el tamaño mayor que le entra (aprovecha el papel).
    const info = [];
    for (const [nombre, h] of completas) {
      const base = h.ids.map((id) => porId.get(id));
      const lista = h.fijo ? base : ordenar(base, { cols: h.cols, bloques: h.bloques });
      const { archivos, hoja: hj, medidas: m } = archivosHoja(nombre, lista, h);
      info.push({ nombre, ancho: h.ancho, alto: h.alto, cols: h.cols, cm: hj.cm, aire: m.aire, margen: m.margen, ids: lista.map((st) => st.id) });
      if (hj.cm < h.cm) throw new Error(`${nombre}: los stickers entran a ${hj.cm} cm y el plan pide al menos ${h.cm}`);
      for (const [n, d] of archivos) escribir(n, d);
      console.log(`${nombre}: lista, ${lista.length} de ${hj.cm} cm, aire ${hj.gapX.toFixed(1)} x ${hj.gapY.toFixed(1)} mm (mínimo ${m.aire.toFixed(1)}), margen mínimo ${m.margen.toFixed(1)} mm, ocupa el ${(m.ocupa * 100).toFixed(0)} % del papel`);
      const f = Math.ceil(lista.length / h.cols);
      for (let i = 0; i < f; i++) console.log(`  fila ${i + 1}: ${lista.slice(i * h.cols, (i + 1) * h.cols).map((st) => `${st.id} (${tonos(st, 1).join("")})`).join(", ")}`);
    }
    // Lo que midió cada hoja, para el LEEME de la entrega y para la prueba.
    escribir("hojas/hojas.json", Buffer.from(JSON.stringify({ hojas: info }, null, 2) + "\n", "utf8"));
  }
  // La carpeta para la imprenta: hojas, PNG sueltos, frases, LEEME y un ZIP con todo, de lo que ya está escrito en public/.
  const entrega = opt("--entrega");
  if (entrega && !vista) {
    const r = armarEntrega({ origen: destino, destino: resolve(entrega), serie: SERIE, repuestos: REPUESTOS });
    console.log(`entrega en ${resolve(entrega)}: ${r.hojas} hojas, ${r.sueltos} stickers sueltos, ZIP con ${r.zip.entradas} archivos (${(r.zip.bytes / 1e6).toFixed(1)} MB)`);
  }
  if (mal) process.exit(1);
}

// Se corre solo cuando se lo llama directo (la prueba lo importa). En Windows la letra del disco puede venir en minúscula.
const mismo = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && mismo(resolve(process.argv[1]), fileURLToPath(import.meta.url))) principal(process.argv.slice(2));
