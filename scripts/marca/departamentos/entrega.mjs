/**
 * La entrega para la imprenta de la serie de los departamentos: una carpeta con las hojas (PDF y PNG), los PNG sueltos,
 * un ZIP con todo y un LEEME corto. Sale de lo que ya escribió el corredor en public/marca/departamentos/ (con --hojas).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zip } from "../base.mjs";

const RAIZ = "TINKAZO-STICKERS-DEPARTAMENTOS";
const COMA = (n) => String(n).replace(".", ",");

/** Qué lleva cada hoja, con palabras, para el LEEME. */
const QUE_LLEVA = {
  "hoja-a4-occidente": "La Paz, Oruro y Potosí (los cuatro de cada uno)",
  "hoja-a4-valles": "Cochabamba, Chuquisaca y Tarija (los cuatro de cada uno)",
  "hoja-a4-oriente": "Santa Cruz, Beni y Pando (los cuatro de cada uno)",
  "hoja-a4-postales-tinku": "las nueve postales, el Tinku (dos) y el charango",
  "hoja-a4-tiernos": "los cuatro tiernos y ocho para pegar en la laptop",
  "hoja-a3-todos": "los 42, uno de cada uno, con título arriba y dirección abajo",
};

/** El LEEME de la carpeta. `hojas` es el contenido de hojas/hojas.json y `cantidad` cuántos stickers hay en total. */
export function textoLeeme({ hojas, cantidad, repuestos }) {
  const filas = hojas.map((h) => {
    const papel = h.ancho === 210 ? "A4" : "A3";
    return `  ${h.nombre}.pdf`.padEnd(34) + `${papel}, ${h.ids.length} stickers de ${COMA(h.cm)} cm: ${QUE_LLEVA[h.nombre] ?? ""}`;
  });
  const a4 = hojas.filter((h) => h.ancho === 210).length, a3 = hojas.length - a4;
  const aire = Math.min(...hojas.map((h) => h.aire)), margen = Math.min(...hojas.map((h) => h.margen));
  return [
    "STICKERS DE TINKAZO: LOS NUEVE DEPARTAMENTOS",
    "Instagram @tinkazo.app, sitio tinkazo.app",
    "",
    `Son ${cantidad} stickers distintos: los nueve departamentos de Bolivia (cuatro de cada uno), el Tinku y cuatro tiernos, todos con tinkazo.app abajo.${repuestos.length ? ` Hay además ${repuestos.length} de repuesto, que no está en las hojas y se puede imprimir suelto: ${repuestos.join(", ")}.` : ""}`,
    "",
    `HOJAS PARA IMPRIMIR (${hojas.length} archivos: ${a4} en A4 y ${a3} en A3, en la carpeta hojas-para-imprimir)`,
    ...filas,
    "La cantidad de copias de cada hoja la define quien encarga.",
    "",
    "COMO VIENEN LOS PDF",
    "- Tamaño real. Imprimir al 100 %, sin ajustar a la página.",
    "- La línea de corte va en su propia capa, llamada corte (magenta, 0,25 mm), aparte del dibujo y apagable. Sigue la silueta de cada sticker.",
    `- Sangrado de 2 mm: el fondo blanco de cada sticker sale 2 mm más allá de la línea de corte.`,
    `- Entre un sticker y otro hay ${COMA(Math.floor(aire + 1e-6))} mm de aire como mínimo, y ${COMA(Math.floor(margen + 1e-6))} mm como mínimo hasta el borde del papel.`,
    "- La A3 lleva impresos el título (arriba) y la dirección (abajo), fuera de los stickers.",
    "",
    "STICKERS SUELTOS",
    `- uno-por-uno-png: ${cantidad + repuestos.length} PNG de 5 cm a 300 ppp, con fondo transparente, para pantalla, redes o un cartel.`,
    "- En el ZIP, carpeta archivos-de-imprenta: cada sticker en SVG y en PDF, de 5 y de 7 cm, con 3 mm de sangrado y la línea de corte en la capa corte.",
    "- frases.txt: lo que dice cada sticker y lo que quiere decir.",
    "- hojas-vista-previa: cada hoja en PNG, solo para mirar.",
    "",
    "TINKAZO-STICKERS-DEPARTAMENTOS.zip trae todo junto, para mandarlo por WhatsApp o correo.",
    "Material sugerido: vinilo adhesivo con laminado.",
    "",
  ].join("\r\n");
}

/** Arma la carpeta de entrega y su ZIP. Devuelve lo que escribió. */
export function armarEntrega({ origen, destino, serie, repuestos = [] }) {
  const lee = (r) => readFileSync(resolve(origen, r));
  const info = JSON.parse(lee("hojas/hojas.json").toString("utf8"));
  const hojas = info.hojas;
  for (const h of hojas) for (const ext of ["pdf", "png"]) if (!existsSync(resolve(origen, `hojas/${h.nombre}.${ext}`))) throw new Error(`falta hojas/${h.nombre}.${ext}: corré el corredor con --hojas`);
  const enHojas = new Set(hojas.flatMap((h) => h.ids));
  const ids = serie.map((st) => st.id);
  const sueltos = ids.filter((id) => !repuestos.includes(id));
  const sinHoja = sueltos.filter((id) => !enHojas.has(id));
  if (sinHoja.length) throw new Error(`estos no están en ninguna hoja y no son de repuesto: ${sinHoja.join(", ")}`);
  const leeme = Buffer.from(textoLeeme({ hojas, cantidad: sueltos.length, repuestos }), "utf8");
  const frases = lee("frases.txt");

  const archivos = new Map(); // ruta dentro de la carpeta -> datos
  archivos.set("LEEME.txt", leeme);
  archivos.set("frases.txt", frases);
  for (const h of hojas) {
    archivos.set(`hojas-para-imprimir/${h.nombre}.pdf`, lee(`hojas/${h.nombre}.pdf`));
    archivos.set(`hojas-vista-previa/${h.nombre}.png`, lee(`hojas/${h.nombre}.png`));
  }
  for (const id of ids) archivos.set(`uno-por-uno-png/${id}.png`, lee(`${id}.png`));
  const imprenta = new Map();
  for (const id of ids) for (const cm of [5, 7]) for (const ext of ["svg", "pdf"]) imprenta.set(`archivos-de-imprenta/tinkazo-${id}-${cm}cm.${ext}`, lee(`imprenta/tinkazo-${id}-${cm}cm.${ext}`));

  mkdirSync(destino, { recursive: true });
  for (const [ruta, datos] of archivos) {
    const r = resolve(destino, ruta);
    mkdirSync(resolve(r, ".."), { recursive: true });
    writeFileSync(r, datos);
  }
  const todo = [...archivos, ...imprenta].map(([ruta, datos]) => [`${RAIZ}/${ruta}`, datos]);
  const z = zip(todo);
  writeFileSync(resolve(destino, `${RAIZ}.zip`), z);
  return { archivos: archivos.size, zip: { entradas: todo.length, bytes: z.length }, hojas: hojas.length, sueltos: ids.length, carpeta: readdirSync(destino) };
}
