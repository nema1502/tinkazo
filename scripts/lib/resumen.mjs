/**
 * El resumen de una línea de los auditores (`--json`) y su lectura.
 *
 * Un auditor corre durante minutos y escribe miles de líneas. Quien lo
 * lanza no necesita ninguna: necesita saber cuántas comprobaciones pasaron y
 * cuáles fallaron. Con `--json`, el auditor agrega al final UNA línea:
 *
 *   {"auditor":"audit-ui","objetivo":"sitio","aprobadas":460,"total":461,
 *    "fallas":[{"nombre":"…","detalle":"…"}],"segundos":210}
 *
 * La salida de texto de siempre no cambia: la línea es lo último que sale.
 * `scripts/audit-todo.mjs` corre los auditores y junta estas líneas.
 */

/** Hasta cuántas fallas lleva la línea: el resto se cuenta pero no se detalla. */
export const MAX_FALLAS = 100;
const MAX_NOMBRE = 160;
const MAX_DETALLE = 240;

export const quiereJson = (args = process.argv.slice(2)) => args.includes("--json");

const recorta = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Una comprobación, con los nombres de campo de cualquier auditor
 * (`{name, ok, detail}` o `{nombre, ok, detalle}`). Si trae `grupo`, va
 * delante del nombre.
 */
export function normalizar(c) {
  const nombre = String(c.nombre ?? c.name ?? "");
  return {
    nombre: recorta(c.grupo ? `${c.grupo}: ${nombre}` : nombre, MAX_NOMBRE),
    ok: !!c.ok,
    detalle: recorta(c.detalle ?? c.detail ?? "", MAX_DETALLE),
  };
}

/** El resumen de una corrida, a partir de sus comprobaciones. */
export function resumenDe({ auditor, objetivo, checks, segundos }) {
  const lista = checks.map(normalizar);
  const malas = lista.filter((c) => !c.ok);
  const fallas = malas.slice(0, MAX_FALLAS).map(({ nombre, detalle }) => ({ nombre, detalle }));
  if (malas.length > MAX_FALLAS) fallas.push({ nombre: `… y ${malas.length - MAX_FALLAS} fallas más`, detalle: "" });
  return {
    auditor,
    objetivo: String(objetivo),
    aprobadas: lista.length - malas.length,
    total: lista.length,
    fallas,
    segundos: Math.round(segundos),
  };
}

/**
 * Imprime la línea de resumen si se pidió `--json`. Los segundos son los del
 * proceso entero (arranque de Chrome incluido), que es lo que cuesta correrlo.
 */
export function emitirJson({ auditor, objetivo, checks, args = process.argv.slice(2), segundos = process.uptime() }) {
  if (!quiereJson(args)) return null;
  const r = resumenDe({ auditor, objetivo, checks, segundos });
  console.log(JSON.stringify(r));
  return r;
}

/** ¿Es un resumen con la forma de arriba? */
export function esResumen(r) {
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.auditor === "string" &&
    Number.isInteger(r.aprobadas) &&
    Number.isInteger(r.total) &&
    Array.isArray(r.fallas)
  );
}

/** El último resumen válido de una salida de texto, o null si el auditor no dejó ninguno. */
export function leerResumen(salida) {
  const lineas = String(salida).split(/\r?\n/);
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i].trim();
    if (!l.startsWith("{") || !l.endsWith("}")) continue;
    try {
      const r = JSON.parse(l);
      if (esResumen(r)) return r;
    } catch {
      /* una línea con llaves que no es JSON */
    }
  }
  return null;
}
