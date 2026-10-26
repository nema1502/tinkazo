/**
 * La batería de auditores, como datos: qué corre `pnpm audit:todo`, en qué
 * orden, cómo se arma el resumen y cuántas líneas ocupa.
 *
 * Todo lo que no toca procesos está acá, para probarlo sin red ni Chrome
 * (`bateria.test.mjs`). Lanzar los procesos es de `bateria-proceso.mjs`, y
 * juntarlo todo es de `scripts/audit-todo.mjs`.
 *
 * Los tres niveles de la decisión D6 del plan: en cada cambio, a mano, lo que
 * toca al cambio; antes de subir, el mínimo de arriba; de noche, esto entero.
 */
import { FUERA_DEL_SELECTOR, SELECTOR } from "./juegos.mjs";

/** Qué tan seguido cabe en la batería: `siempre` es el default; el resto se pide. */
export const NIVELES = {
  siempre: "entra en la batería",
  noche: "solo con --noche (es inestable con la máquina cargada)",
  fisica: "solo con --fisica (mira juegos que ya no están en el selector)",
  aparte: "ya corre dentro de otro auditor (pantalla, dentro de audit-rigor): solo con --solo",
};

const conBase = ({ base }) => ["--base", base];
/** Los que salieron del selector y todavía tienen auditor propio: se piden con --todos-los-juegos. */
const TRES_FUERA = ["tombola", "pasanaku", "stellar"];

/**
 * Cada auditor. `juegos`: `null` si no mira un juego; `"uno"` si hay que correrlo
 * una vez por juego; `"todos"` si entiende `todos` y lo corre en una sola
 * corrida. `estimado` son segundos por juego si mira juegos, y en total si no
 * (tiempos del 22 de octubre de 2026). `exclusivo`: no corre al lado de otro
 * (miden el sonido real y se desafinan con la máquina cargada).
 */
export const AUDITORES = [
  { id: "check-glosario", script: "check-glosario.mjs", chrome: false, nivel: "siempre", juegos: null, estimado: 2 },
  { id: "check-lore", script: "check-lore.mjs", chrome: false, red: true, nivel: "siempre", juegos: null, estimado: 20 },
  { id: "check-renta", script: "check-renta.mjs", chrome: false, red: true, nivel: "siempre", juegos: null, estimado: 10 },
  {
    id: "smoke",
    script: "smoke.mjs",
    chrome: true,
    red: true,
    nivel: "siempre",
    juegos: null,
    estimado: 13,
    args: ({ base }) => [`${base}/?demo=wheel&instant=1&lead=3`],
  },
  { id: "check-paginas", script: "check-paginas.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 76, args: conBase },
  { id: "check-qr", script: "check-qr.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 30, args: conBase },
  { id: "check-verificacion", script: "check-verificacion.mjs", chrome: true, red: true, nivel: "siempre", juegos: null, estimado: 60, args: conBase },
  { id: "audit-game", script: "audit-game.mjs", chrome: true, red: true, nivel: "siempre", juegos: "uno", estimado: 110, args: conBase },
  { id: "audit-rigor", script: "audit-rigor.mjs", chrome: true, nivel: "siempre", juegos: "todos", estimado: 248, args: conBase, fuera: TRES_FUERA },
  { id: "audit-identidad", script: "audit-identidad.mjs", chrome: true, nivel: "siempre", juegos: "todos", estimado: 120, args: conBase, fuera: TRES_FUERA },
  { id: "audit-pantalla", script: "audit-pantalla.mjs", chrome: true, nivel: "aparte", juegos: "todos", estimado: 73, args: conBase, fuera: TRES_FUERA },
  { id: "audit-delatores", script: "audit-delatores.mjs", chrome: true, nivel: "siempre", juegos: "todos", estimado: 102, args: conBase, fuera: TRES_FUERA },
  { id: "audit-emocion", script: "audit-emocion.mjs", chrome: true, nivel: "siempre", juegos: "todos", estimado: 20, args: conBase, fuera: TRES_FUERA },
  { id: "audit-legible", script: "audit-legible.mjs", chrome: true, red: true, nivel: "siempre", juegos: "todos", estimado: 45, args: conBase, fuera: TRES_FUERA },
  { id: "audit-choques", script: "audit-choques.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 41, args: conBase },
  { id: "audit-encuadre", script: "audit-encuadre.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 164, args: conBase },
  { id: "audit-sound", script: "audit-sound.mjs", chrome: true, nivel: "siempre", juegos: "todos", estimado: 50, exclusivo: true, args: conBase, fuera: TRES_FUERA },
  { id: "audit-mezcla", script: "audit-mezcla.mjs", chrome: true, nivel: "noche", juegos: "todos", estimado: 41, exclusivo: true, args: conBase, fuera: TRES_FUERA },
  { id: "audit-ui", script: "audit-ui.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 210, args: conBase },
  { id: "audit-espera", script: "audit-espera.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 78, args: conBase },
  { id: "audit-detalles", script: "audit-detalles.mjs", chrome: true, nivel: "siempre", juegos: null, estimado: 167, args: conBase },
  {
    id: "audit-flujo",
    script: "audit-flujo.mjs",
    chrome: true,
    red: true,
    nivel: "siempre",
    juegos: null,
    estimado: 900,
    args: ({ base, noche }) => ["--base", base, "--temas", noche ? "dark,light" : "dark"],
  },
  { id: "audit-fisica", script: "audit-fisica.mjs", chrome: true, nivel: "fisica", juegos: "todos", estimado: 40, args: conBase, fuera: [] },
];

/** El auditor de un nombre: `audit-ui`, `ui` o `paginas`. */
export function buscarAuditor(token, catalogo = AUDITORES) {
  const t = String(token).trim();
  return catalogo.find((a) => a.id === t) ?? catalogo.find((a) => a.id === `audit-${t}` || a.id === `check-${t}`) ?? null;
}

/**
 * Qué se corre: una tarea por (auditor, objetivo). Sin `solo` entran los de
 * nivel `siempre`, más `noche` con `--noche` y `fisica` con `--fisica`; con
 * `solo`, esos, pidan lo que pidan. Sin `juegos`, los que miran juegos corren
 * los diez del selector; `todosLosJuegos` suma los que salieron de él.
 */
export function planDe(
  { solo = [], juegos = null, noche = false, fisica = false, todosLosJuegos = false, base = "http://localhost:4180" } = {},
  catalogo = AUDITORES,
) {
  const desconocidos = solo.filter((s) => !buscarAuditor(s, catalogo));
  if (desconocidos.length) throw new Error(`no conozco el auditor ${desconocidos.join(", ")}; son: ${catalogo.map((a) => a.id).join(", ")}`);
  const elegidos = solo.length
    ? solo.map((s) => buscarAuditor(s, catalogo))
    : catalogo.filter((a) => a.nivel === "siempre" || (a.nivel === "noche" && noche) || (a.nivel === "fisica" && fisica));
  const tareas = [];
  const tarea = (a, objetivo) => {
    const propios = a.args ? a.args({ base, objetivo, noche }) : [];
    const posicional = a.juegos ? [objetivo] : [];
    // El de `smoke` es una URL, que va primero; el de los juegos, también.
    const args = [...posicional, ...propios, "--json"];
    tareas.push({
      id: a.juegos ? `${a.id}:${objetivo}` : a.id,
      auditor: a.id,
      objetivo: a.juegos ? objetivo : (a.objetivo ?? "sitio"),
      script: a.script,
      args,
      chrome: !!a.chrome,
      exclusivo: !!a.exclusivo,
      necesitaBase: !!a.args,
      estimado: a.estimado,
    });
  };
  for (const a of elegidos) {
    if (!a.juegos) {
      tarea(a, "sitio");
    } else if (a.juegos === "uno") {
      for (const j of juegos ?? [...SELECTOR, ...(todosLosJuegos ? FUERA_DEL_SELECTOR : [])]) tarea(a, j);
    } else if (juegos) {
      for (const j of juegos) tarea(a, j);
    } else {
      tarea({ ...a, estimado: a.estimado * SELECTOR.length }, "todos");
      if (todosLosJuegos) for (const j of a.fuera ?? FUERA_DEL_SELECTOR) tarea(a, j);
    }
  }
  return ordenar(tareas);
}

/** Primero lo que no abre Chrome, después lo más largo, y al final lo que pide la máquina libre. */
export function ordenar(tareas) {
  const rango = (t) => (t.exclusivo ? 2 : t.chrome ? 1 : 0);
  return tareas
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rango(a.t) - rango(b.t) || (rango(a.t) === 1 ? b.t.estimado - a.t.estimado : 0) || a.i - b.i)
    .map(({ t }) => t);
}

/** Cuántas veces se arranca cada cosa: corridas y Chromes (uno por corrida que lo usa). */
export function contar(plan) {
  return { corridas: plan.length, chromes: plan.filter((t) => t.chrome).length, segundos: plan.reduce((s, t) => s + t.estimado, 0) };
}

/** Cuánto tardaría en el mejor de los casos con `paralelo` corridas a la vez, simulando el pool. */
export function estimarSegundos(plan, paralelo = 2) {
  const libres = Array.from({ length: Math.max(1, paralelo) }, () => 0);
  let finExclusivo = 0;
  const cola = [...plan];
  while (cola.length) {
    const t = cola.shift();
    libres.sort((a, b) => a - b);
    if (t.exclusivo) {
      const ini = Math.max(finExclusivo, ...libres);
      finExclusivo = ini + t.estimado;
      libres.fill(finExclusivo);
    } else {
      libres[0] = Math.max(libres[0], finExclusivo) + t.estimado;
    }
  }
  return Math.max(finExclusivo, ...libres);
}

/**
 * Corre las tareas con a lo sumo `paralelo` a la vez. `hacer(tarea, ranura)`
 * devuelve una promesa; la ranura (0, 1) sirve para darle a cada una su puerto.
 * Una tarea `exclusiva` espera a que no haya otra corriendo y no deja arrancar
 * a nadie mientras corre. Devuelve los resultados en el orden en que terminan.
 */
export async function correrEnPool(tareas, paralelo, hacer) {
  const cola = [...tareas];
  const resultados = [];
  const ranuras = Array.from({ length: Math.max(1, paralelo) }, (_, i) => i);
  let corriendo = 0;
  let exclusiva = false;
  await new Promise((fin) => {
    const siguiente = () => {
      while (cola.length && ranuras.length && !exclusiva) {
        const t = cola[0];
        if (t.exclusivo && corriendo > 0) break;
        cola.shift();
        const ranura = ranuras.shift();
        corriendo++;
        if (t.exclusivo) exclusiva = true;
        Promise.resolve()
          .then(() => hacer(t, ranura))
          .then(
            (r) => resultados.push(r),
            (e) => resultados.push({ tarea: t, codigo: -1, segundos: 0, resumen: null, error: String(e?.message ?? e), cola: [] }),
          )
          .finally(() => {
            corriendo--;
            if (t.exclusivo) exclusiva = false;
            ranuras.unshift(ranura);
            ranuras.sort((a, b) => a - b);
            siguiente();
          });
      }
      if (!cola.length && corriendo === 0) fin();
    };
    siguiente();
  });
  return resultados;
}

/**
 * Los resultados de las corridas, agrupados por auditor. Cada resultado:
 * `{ tarea, codigo, segundos, resumen | null, error?, cola? }`. Un auditor
 * que no dejó resumen cuenta como una comprobación fallada: la batería no se
 * puede dar por buena si alguien se cayó sin decir nada.
 */
export function agrupar(resultados) {
  const porAuditor = new Map();
  for (const r of resultados) {
    const { tarea, codigo, segundos, resumen } = r;
    const g = porAuditor.get(tarea.auditor) ?? { id: tarea.auditor, estado: "ok", aprobadas: 0, total: 0, segundos: 0, corridas: [] };
    let fallas = [];
    let aprobadas = 0;
    let total = 0;
    if (resumen) {
      aprobadas = resumen.aprobadas;
      total = resumen.total;
      fallas = resumen.fallas.map((f) => ({ ...f }));
      // Salió con error pero todas sus comprobaciones pasaron: algo se cayó afuera de ellas.
      if (codigo !== 0 && fallas.length === 0 && aprobadas === total) {
        fallas.push({ nombre: `terminó con código ${codigo} sin ninguna comprobación fallada`, detalle: (r.cola ?? []).slice(-2).join(" | ") });
        total += 1;
      }
    } else {
      total = 1;
      fallas.push({
        nombre: "no dejó resumen",
        detalle: r.error ?? `código ${codigo}${r.cola?.length ? ` · ${r.cola.slice(-3).join(" | ")}` : ""}`,
      });
      g.estado = "error";
    }
    if (fallas.length && g.estado === "ok") g.estado = "falla";
    g.aprobadas += aprobadas;
    g.total += total;
    g.segundos += segundos;
    g.corridas.push({
      objetivo: tarea.objetivo,
      codigo,
      segundos,
      aprobadas,
      total,
      fallas,
      ...(resumen ? {} : { cola: r.cola ?? [] }),
    });
    porAuditor.set(tarea.auditor, g);
  }
  return [...porAuditor.values()];
}

/** El informe entero que va al archivo, a partir de los grupos. */
export function informeDe({ auditores, segundos, inicio, base, paralelo, opciones }) {
  const fallas = [];
  for (const a of auditores) for (const c of a.corridas) for (const f of c.fallas) fallas.push({ auditor: a.id, objetivo: c.objetivo, nombre: f.nombre, detalle: f.detalle });
  return {
    inicio,
    segundos: Math.round(segundos),
    base,
    paralelo,
    opciones,
    aprobadas: auditores.reduce((s, a) => s + a.aprobadas, 0),
    total: auditores.reduce((s, a) => s + a.total, 0),
    auditores,
    fallas,
  };
}

/** El resumen de una línea de la propia batería, con la forma de los auditores. */
export function resumenDeBateria(informe) {
  return {
    auditor: "audit-todo",
    objetivo: "bateria",
    aprobadas: informe.aprobadas,
    total: informe.total,
    fallas: informe.fallas.slice(0, 100).map((f) => ({ nombre: `${f.auditor}${f.objetivo && f.objetivo !== "sitio" ? ` ${f.objetivo}` : ""}: ${f.nombre}`.slice(0, 160), detalle: String(f.detalle ?? "").slice(0, 240) })),
    segundos: informe.segundos,
  };
}

const dos = (n) => String(n).padStart(2, "0");
export function duracion(s) {
  s = Math.round(s);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${dos(Math.floor((s % 3600) / 60))} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${dos(s % 60)} s`;
  return `${s} s`;
}
const corta = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * El resumen para leer: a lo sumo `maxLineas` líneas (20 por defecto). Los que
 * fallaron van primero, cada uno con sus fallas (se acortan si no caben); los
 * que pasaron, uno por línea o empaquetados si son muchos.
 */
export function formatearResumen(informe, { maxLineas = 20, ancho = 118, archivo = "" } = {}) {
  const { auditores } = informe;
  const malos = auditores.filter((a) => a.estado !== "ok");
  const buenos = auditores.filter((a) => a.estado === "ok");
  const marca = (a) => (a.estado === "ok" ? "✓" : a.estado === "error" ? "!" : "✗");
  const nombre = (a) => `${marca(a)} ${a.id.padEnd(18)} ${`${a.aprobadas}/${a.total}`.padStart(9)}  ${duracion(a.segundos)}`;
  const detalle = (a) =>
    a.corridas.flatMap((c) => c.fallas.map((f) => `    · ${c.objetivo && !["sitio", "todos"].includes(c.objetivo) ? `${c.objetivo}: ` : ""}${f.nombre}${f.detalle ? ` — ${f.detalle}` : ""}`));

  const cab = `audit:todo · ${auditores.length} auditores · ${duracion(informe.segundos)} · ${buenos.length} sin fallas, ${malos.length} con fallas`;
  const pie = `${informe.aprobadas}/${informe.total} comprobaciones${archivo ? ` · detalle en ${archivo}` : ""}`;
  const presupuesto = maxLineas - 2;
  const lineasDe = (k) => malos.reduce((s, a) => s + 1 + Math.min(k, detalle(a).length) + (detalle(a).length > k && k > 0 ? 1 : 0), 0);

  let k = 3;
  while (k > 0 && lineasDe(k) + (buenos.length ? 1 : 0) > presupuesto) k--;
  let mostrados = malos;
  let omitidos = 0;
  if (lineasDe(k) + (buenos.length ? 1 : 0) > presupuesto) {
    // Ni una línea por auditor alcanza: los primeros, y cuántos faltan.
    const caben = Math.max(0, presupuesto - 1 - (buenos.length ? 1 : 0));
    mostrados = malos.slice(0, caben);
    omitidos = malos.length - mostrados.length;
  }

  const lineas = [corta(cab, ancho)];
  for (const a of mostrados) {
    const d = detalle(a);
    lineas.push(corta(k === 0 && d.length ? `${nombre(a)} · ${d.length} falla${d.length === 1 ? "" : "s"}` : nombre(a), ancho));
    for (const l of d.slice(0, k)) lineas.push(corta(l, ancho));
    if (k > 0 && d.length > k) lineas.push(`    … y ${d.length - k} más`);
  }
  if (omitidos) lineas.push(`… y ${omitidos} auditor${omitidos === 1 ? "" : "es"} más con fallas (ver el archivo)`);
  const sitio = maxLineas - 1 - lineas.length;
  if (buenos.length && sitio > 0) {
    if (buenos.length <= sitio) {
      for (const a of buenos) lineas.push(corta(nombre(a), ancho));
    } else {
      const porFila = Math.ceil(buenos.length / sitio);
      for (let i = 0; i < buenos.length; i += porFila) {
        lineas.push(corta(buenos.slice(i, i + porFila).map((a) => `✓ ${a.id} ${a.aprobadas}/${a.total}`).join("   "), ancho));
      }
    }
  }
  lineas.push(pie);
  return lineas.slice(0, maxLineas);
}
