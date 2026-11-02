/**
 * La boleta: un solo veredicto por juego, con las nueve cosas que un juego tiene
 * que demostrar, armado con lo que los auditores ya dejan (`--json`).
 *
 * Todo lo que no toca archivos de la red ni procesos está acá, para probarlo sin
 * red ni Chrome (`boleta.test.mjs`). El comando es `scripts/boleta.mjs`.
 *
 * Cada fila junta partes. Una parte es verde (pasó), roja (falló) o gris (no hay
 * dato: el auditor no corrió, no existe todavía o falta el veto humano). La fila
 * es roja si alguna parte es roja, gris si no hay rojas pero sí grises, y verde
 * solo si todas lo son. La boleta aprueba con las nueve filas en verde: una fila
 * gris no es verde.
 *
 * Un resumen de auditor solo trae las comprobaciones que fallaron (no las que
 * pasaron): "pasó" quiere decir que la corrida existe y ninguna falla le toca.
 */
import { FUERA_DEL_SELECTOR, SELECTOR } from "./juegos.mjs";

export const TOTAL = 9;
export const VERDE = "verde";
export const ROJO = "rojo";
export const GRIS = "gris";

/** Los auditores que alimentan la boleta, para `audit:todo --boleta` (sin la prueba del niño: no corre en la batería). `audit-palabras` corre una vez por juego, sin Chrome. */
export const AUDITORES_DE_LA_BOLETA = [
  "audit-game",
  "audit-rigor",
  "audit-identidad",
  "audit-delatores",
  "audit-emocion",
  "audit-legible",
  "audit-mezcla",
  "audit-palabras",
  "check-lore",
  "smoke",
];

export const NOMBRES = [
  "Justicia",
  "Comprensión",
  "Identificación",
  "Momento",
  "Sala y proyector",
  "Sin olor a apuesta",
  "Verdad y respeto",
  "Robustez",
  "Ganas de volver",
];

const TODOS_LOS_JUEGOS = [...SELECTOR, ...FUERA_DEL_SELECTOR];

const verde = (texto) => ({ estado: VERDE, texto });
const rojo = (texto) => ({ estado: ROJO, texto });
const gris = (texto) => ({ estado: GRIS, texto });

/* ------------------------------------------------------------------ entrada */

/**
 * Las corridas (`{auditor, objetivo, aprobadas, total, fallas, datos?}`) de lo que
 * haya en un archivo ya leído: el informe de `audit:todo` (con `auditores`), una
 * sola línea de resumen, o una lista de líneas.
 */
export function corridasDe(contenido) {
  if (!contenido || typeof contenido !== "object") return [];
  if (Array.isArray(contenido)) return contenido.flatMap(corridasDe);
  if (Array.isArray(contenido.auditores)) {
    return contenido.auditores.flatMap((a) => (a.corridas ?? []).map((c) => ({ auditor: a.id, ...c })));
  }
  if (typeof contenido.auditor === "string" && Number.isInteger(contenido.aprobadas) && Number.isInteger(contenido.total)) {
    return [{ ...contenido, fallas: contenido.fallas ?? [] }];
  }
  return [];
}

/** Lee texto que puede ser un JSON entero o varias líneas JSON (la salida de un auditor). */
export function corridasDeTexto(texto) {
  try {
    return corridasDe(JSON.parse(texto));
  } catch {
    return String(texto)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{") && l.endsWith("}"))
      .flatMap((l) => {
        try {
          return corridasDe(JSON.parse(l));
        } catch {
          return [];
        }
      });
  }
}

/* ------------------------------------------------------------------ selección */

/** La falla de la pregunta del olor a apuesta de la prueba del niño: informa a la fila 6 y no cuenta como falta de comprensión. */
export const esOlor = (f) => /^olor\b/i.test(String(f.nombre ?? ""));

/**
 * ¿Esta falla es de este juego? Las que llevan el prefijo de otro juego no; las sin prefijo, sí.
 * `audit-palabras` nombra las suyas `apuesta: <unidad>` o `vocabulario: <unidad>`: son del juego que dice la unidad.
 */
export function esDelJuego(falla, juego) {
  const n = String(falla.nombre ?? "").toLowerCase();
  const deUnidad = /^(?:apuesta|vocabulario):\s*(\S+)/.exec(n);
  if (deUnidad) return deUnidad[1] === juego;
  const propio = new RegExp(`^${juego}(?:[:\\s]|$)`);
  if (propio.test(n)) return true;
  return !TODOS_LOS_JUEGOS.some((j) => new RegExp(`^${j}(?:[:\\s]|$)`).test(n));
}

/**
 * Lo que un auditor dejó para un juego: sus corridas (las del juego, o las de
 * `todos` y `sitio`, que lo cubren) y las fallas que le tocan. `null` si no hay corrida.
 */
export function deAuditor(corridas, auditor, juego) {
  const propias = corridas.filter((c) => c.auditor === auditor && c.objetivo === juego);
  const generales = corridas.filter((c) => c.auditor === auditor && ["todos", "diez", "todo"].includes(c.objetivo));
  const usadas = [...propias, ...generales];
  if (!usadas.length) return null;
  const fallas = usadas.flatMap((c) => (c.fallas ?? []).filter((f) => esDelJuego(f, juego)));
  const propiasAprobadas = propias.reduce((s, c) => s + c.aprobadas, 0);
  const propiasTotal = propias.reduce((s, c) => s + c.total, 0);
  return { fallas, aprobadas: propiasAprobadas, total: propiasTotal, conCifra: propias.length > 0, datos: propias.find((c) => c.datos)?.datos ?? null };
}

const coincide = (f, re) => re.test(`${f.nombre ?? ""} ${f.detalle ?? ""}`);
const detalleDe = (fallas) => fallas.slice(0, 2).map((f) => `${f.nombre}${f.detalle ? ` (${f.detalle})` : ""}`).join("; ");

/**
 * Una parte a partir de un auditor: gris si no corrió, roja con la primera
 * falla que cumpla `cuales`, verde si no.
 */
function parteDeAuditor(rotulo, aud, cuales = () => true, { cifra = null } = {}) {
  if (!aud) return gris(`${rotulo}: sin correr`);
  const malas = aud.fallas.filter(cuales);
  if (malas.length) return rojo(`${rotulo}: ${malas.length} ${malas.length === 1 ? "falla" : "fallas"} (${detalleDe(malas)})`);
  return verde(`${rotulo}: aprobado${cifra ? ` (${cifra})` : ""}`);
}

const soloMathRandom = (f) => coincide(f, /Math\.random/i);
const deSala = (f) => coincide(f, /destellos|contorno|se lee desde el fondo|tinta del cartel/i);

/* ------------------------------------------------------------------ las nueve filas */

/** El Bayes máximo (en %) de la recta, del `--json <archivo>` de `audit-delatores`; `null` si no está. */
export function bayesMaximo(detalle) {
  const juegos = detalle?.juegos ?? {};
  const valores = [];
  for (const [clave, d] of Object.entries(juegos)) {
    if (!clave.includes("adivinador")) continue;
    for (const v of Object.values(d)) {
      for (const h of v?.hasta ?? []) if (h.q <= 0.88 && Number.isFinite(h.acierto)) valores.push(h.acierto);
    }
  }
  return valores.length ? Math.max(...valores) * 100 : null;
}

const coma = (n, d = 1) => n.toFixed(d).replace(".", ",");

function filaJusticia({ corridas, juego, bayes }) {
  const del = deAuditor(corridas, "audit-delatores", juego);
  const rig = deAuditor(corridas, "audit-rigor", juego);
  const gam = deAuditor(corridas, "audit-game", juego);
  const cifra = bayes != null ? `Bayes máximo ${coma(bayes)} %` : "sin cifra del Bayes";
  return [
    parteDeAuditor("delatores", del, () => true, { cifra }),
    parteDeAuditor("cero Math.random", rig, soloMathRandom),
    parteDeAuditor("el ganador es el del protocolo", gam, (f) => coincide(f, /ganador en pantalla es el que fij/i)),
  ];
}

function filaComprension({ corridas, juego, nino }) {
  const c = deAuditor(corridas, "audit-nino", juego);
  if (c?.conCifra) {
    const d = c.datos;
    const cifra = d && Number.isInteger(d.pasan) && Number.isInteger(d.semillas) ? `${d.pasan} de ${d.semillas} corridas, mínimo ${d.minimo}` : "sin cifra";
    // El olor a apuesta es de la fila 6: aquí no cuenta.
    const sinOlor = c.fallas.filter((f) => !esOlor(f));
    return [sinOlor.length ? rojo(`prueba del niño: no pasa (${cifra}; ${detalleDe(sinOlor)})`) : verde(`prueba del niño: pasa (${cifra})`)];
  }
  if (nino && Number.isInteger(nino.pasan) && Number.isInteger(nino.semillas)) {
    const cifra = `${nino.pasan} de ${nino.semillas} corridas, mínimo ${nino.minimo ?? "?"}`;
    return [nino.pasa ? verde(`prueba del niño: pasa (${cifra})`) : rojo(`prueba del niño: no pasa (${cifra})`)];
  }
  return [gris("prueba del niño: sin correr")];
}

function filaIdentificacion({ corridas, juego }) {
  const a = deAuditor(corridas, "audit-identidad", juego);
  return [parteDeAuditor("identificación", a, () => true, { cifra: "con 8 todos, con 18 nueve de cada diez; sin cifra del porcentaje" })];
}

function filaMomento({ corridas, juego, vetos }) {
  const a = deAuditor(corridas, "audit-emocion", juego);
  const cifra = a?.conCifra ? `${a.aprobadas} de ${a.total}` : null;
  const parte = parteDeAuditor("emoción", a, () => true, { cifra: cifra ?? "sin cifra" });
  if (a && cifra && a.fallas.length) parte.texto = `emoción: ${a.aprobadas} de ${a.total} (${detalleDe(a.fallas)})`;
  return [parte, parteDeVeto(vetos, "momento", "veto del momento")];
}

function filaSala({ corridas, juego }) {
  const leg = deAuditor(corridas, "audit-legible", juego);
  const mez = deAuditor(corridas, "audit-mezcla", juego);
  const rig = deAuditor(corridas, "audit-rigor", juego);
  return [
    parteDeAuditor("legibilidad", leg),
    mez ? parteDeAuditor("mezcla", mez) : gris("mezcla: sin correr (solo con --noche)"),
    parteDeAuditor("destellos y contorno", rig, deSala),
  ];
}

function filaApuesta({ corridas, juego }) {
  const pal = deAuditor(corridas, "audit-palabras", juego);
  const partes = [pal ? parteDeAuditor("palabras (apuesta)", pal, (f) => coincide(f, /^apuesta/i)) : gris("palabras (apuesta): sin auditor")];
  const nino = deAuditor(corridas, "audit-nino", juego);
  const olor = nino?.datos?.olor;
  const malas = nino ? nino.fallas.filter(esOlor) : [];
  if (malas.length || olor?.aprobada === false) {
    partes.push(rojo(`pregunta del olor: ${malas.length ? detalleDe(malas) : `${olor.conOlor} de ${olor.fotos} fotos dicen que sí`}`));
  } else if (olor?.aprobada === true) {
    partes.push(verde(`pregunta del olor: ${olor.fotos} de ${olor.fotos} fotos dicen que no`));
  } else if (olor?.aprobada === null) {
    partes.push(gris("pregunta del olor: sin respuestas"));
  }
  return partes;
}

/** Las tarjetas de un juego, a partir del texto de `src/games/lore.ts`. */
export function tarjetasDe(loreTs, juego) {
  const juegos = [...loreTs.matchAll(/^ {2}(\w+): \[/gm)].map((m) => ({ at: m.index ?? 0, juego: m[1] }));
  const juegoDe = (at) => juegos.filter((j) => j.at < at).at(-1)?.juego ?? "";
  return [...loreTs.matchAll(/q:\s*"([^"]+)",\s*\n\s*a:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",\s*\n\s*src:\s*"([^"]+)"/g)]
    .map((m) => ({ q: m[1], a: m[2], href: m[3], src: m[4], juego: juegoDe(m.index ?? 0) }))
    .filter((t) => t.juego === juego);
}

function filaVerdad({ corridas, juego, tarjetas, vetos }) {
  const lore = corridas.find((c) => c.auditor === "check-lore");
  let parteLore;
  if (!tarjetas || tarjetas.length === 0) parteLore = gris("tarjeta: el juego no tiene tarjeta en lore.ts");
  else if (!lore) parteLore = gris("tarjeta: check-lore sin correr");
  else {
    const claves = tarjetas.flatMap((t) => [t.href, t.q, t.a]);
    const malas = lore.fallas.filter((f) => claves.some((k) => `${f.nombre} ${f.detalle ?? ""}`.includes(k)));
    parteLore = malas.length ? rojo(`tarjeta: ${detalleDe(malas)}`) : verde(`tarjeta: ${tarjetas.length} con fuente viva`);
  }
  const pal = deAuditor(corridas, "audit-palabras", juego);
  const vocab = pal ? parteDeAuditor("palabras (vocabulario)", pal, (f) => coincide(f, /^vocabulario/i)) : gris("palabras (vocabulario): sin auditor");
  return [parteLore, vocab, parteDeVeto(vetos, "cultural", "veto cultural")];
}

function filaRobustez({ corridas, juego }) {
  const rig = deAuditor(corridas, "audit-rigor", juego);
  const gam = deAuditor(corridas, "audit-game", juego);
  const smoke = corridas.find((c) => c.auditor === "smoke");
  return [
    parteDeAuditor("rigor (2, 60 y 200 personas, fugas, saltar)", rig, (f) => !soloMathRandom(f) && !deSala(f)),
    parteDeAuditor("audit-game (celular, temas, inglés)", gam, (f) => !coincide(f, /ganador en pantalla es el que fij/i)),
    smoke ? (smoke.fallas.length ? rojo(`smoke: ${detalleDe(smoke.fallas)}`) : verde("smoke: aprobado")) : gris("smoke: sin correr"),
  ];
}

/** Un veto humano: `docs/boletas-vetos.json`, `{ "<juego>": { "<cual>": { ok, fecha, nota } } }`. */
export function parteDeVeto(vetos, cual, rotulo) {
  const v = vetos?.[cual];
  if (!v || typeof v.ok !== "boolean") return gris(`${rotulo}: pendiente`);
  const cuando = v.fecha ? ` el ${v.fecha}` : "";
  return v.ok ? verde(`${rotulo}: ok${cuando}${v.nota ? ` (${v.nota})` : ""}`) : rojo(`${rotulo}: no${cuando}${v.nota ? ` (${v.nota})` : ""}`);
}

/** El veto «volver»: el puntaje de la rúbrica de ganas de volver sobre 30, verde con 24 o más y sin patrón oscuro. */
export function parteDeVolver(vetos) {
  const v = vetos?.volver;
  if (!v || !Number.isFinite(v.puntaje)) return gris("ganas de volver: pendiente");
  const de = Number.isFinite(v.de) ? v.de : 30;
  const cifra = `${v.puntaje} de ${de}`;
  const nota = v.nota ? ` (${v.nota})` : "";
  if (v.patronOscuro) return rojo(`ganas de volver: ${cifra}, con patrón oscuro${nota}`);
  if (v.puntaje < 24) return rojo(`ganas de volver: ${cifra}, hacen falta 24${nota}`);
  return verde(`ganas de volver: ${cifra}${v.fecha ? ` el ${v.fecha}` : ""}${nota}`);
}

/** El estado de una fila a partir de sus partes. */
export function estadoDe(partes) {
  if (partes.some((p) => p.estado === ROJO)) return ROJO;
  if (partes.some((p) => p.estado === GRIS)) return GRIS;
  return VERDE;
}

/* ------------------------------------------------------------------ la boleta */

/**
 * @param {object} p
 * @param {string} p.juego
 * @param {object[]} p.corridas  lo que dejaron los auditores (ver `corridasDe`)
 * @param {object} [p.vetos]     las entradas de `docs/boletas-vetos.json` para este juego
 * @param {object} [p.nino]      `veredicto.json` de la prueba del niño, si no hay línea de resumen
 * @param {object} [p.tarjetas]  las tarjetas del juego en `lore.ts` (`tarjetasDe`)
 * @param {number|null} [p.bayes] el Bayes máximo en %, si se leyó el detalle de delatores
 */
export function armarBoleta({ juego, corridas, vetos = {}, nino = null, tarjetas = null, bayes = null }) {
  const ctx = { juego, corridas, vetos, nino, tarjetas, bayes };
  const partes = [
    filaJusticia(ctx),
    filaComprension(ctx),
    filaIdentificacion(ctx),
    filaMomento(ctx),
    filaSala(ctx),
    filaApuesta(ctx),
    filaVerdad(ctx),
    filaRobustez(ctx),
    [parteDeVolver(vetos)],
  ];
  const filas = partes.map((ps, i) => ({ n: i + 1, nombre: NOMBRES[i], estado: estadoDe(ps), partes: ps }));
  const aprobadas = filas.filter((f) => f.estado === VERDE).length;
  return {
    juego,
    filas,
    aprobadas,
    total: TOTAL,
    rojas: filas.filter((f) => f.estado === ROJO).length,
    grises: filas.filter((f) => f.estado === GRIS).length,
    aprueba: aprobadas === TOTAL,
  };
}

const ICONO = { [VERDE]: "verde", [ROJO]: "ROJO", [GRIS]: "gris" };

/** La boleta como Markdown, con la tabla de nueve filas. */
export function boletaMd(b, { fecha = "" } = {}) {
  const l = [
    `# Boleta de ${b.juego}${fecha ? ` (${fecha})` : ""}`,
    "",
    `${b.aprueba ? "APRUEBA" : "NO APRUEBA"}: ${b.aprobadas} de ${b.total} en verde${b.rojas ? `, ${b.rojas} en rojo` : ""}${b.grises ? `, ${b.grises} en gris (sin dato)` : ""}.`,
    "",
    "| # | Dimensión | Estado | Detalle |",
    "|---|---|---|---|",
  ];
  for (const f of b.filas) {
    l.push(`| ${f.n} | ${f.nombre} | ${ICONO[f.estado]} | ${f.partes.map((p) => `${p.texto}`.replace(/\|/g, "/")).join("<br>")} |`);
  }
  l.push("", "Una fila gris no es verde: la boleta aprueba con las nueve en verde. Los vetos viven en `docs/boletas-vetos.json`.", "");
  return l.join("\n");
}

/** La línea JSON con la forma de los demás auditores. */
export function resumenDeBoleta(b, segundos = 0) {
  const fallas = b.filas
    .filter((f) => f.estado !== VERDE)
    .map((f) => ({ nombre: `${f.n} ${f.nombre}: ${f.estado === ROJO ? "rojo" : "gris"}`, detalle: f.partes.filter((p) => p.estado !== VERDE).map((p) => p.texto).join("; ").slice(0, 240) }));
  return {
    auditor: "boleta",
    objetivo: b.juego,
    aprobadas: b.aprobadas,
    total: b.total,
    fallas,
    segundos: Math.round(segundos),
    datos: { filas: b.filas.map((f) => ({ n: f.n, nombre: f.nombre, estado: f.estado })), rojas: b.rojas, grises: b.grises },
  };
}
