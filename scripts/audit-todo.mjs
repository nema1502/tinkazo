#!/usr/bin/env node
/**
 * La batería entera con un solo comando.
 *
 * Corre los auditores de a dos Chrome como máximo, junta lo que cada uno dejó
 * con `--json` en un archivo y escribe un resumen de a lo sumo 20 líneas:
 * aprobadas sobre total por auditor, y las fallas. Se lee de un vistazo, en vez de
 * miles de líneas de salida. Los tres niveles de la decisión D6: en cada
 * cambio, lo que toca al cambio (`--solo`); antes de subir, el mínimo de
 * `docs/juegos.md`; de noche, esto sin opciones.
 *
 * Uso:
 *   pnpm build
 *   pnpm audit:todo [--json] [--solo audit-ui,smoke] [--juegos trompo,oruro]
 *                   [--noche] [--fisica] [--todos-los-juegos]
 *                   [--base URL] [--out archivo.json] [--paralelo 1|2]
 *                   [--simular] [--progreso] [--construir]
 *
 * - Sin `--solo` corren los de nivel `siempre`; `--noche` suma la mezcla de
 *   sonido (inestable con carga) y los dos temas de la QA de flujo; `--fisica`
 *   suma el auditor de física (mira juegos que ya no están en el selector).
 * - Los que miran juegos corren los diez del selector. `--juegos` los limita
 *   (`--juegos trompo` es el mínimo para un cambio en ese juego) y
 *   `--todos-los-juegos` suma los que salieron de él.
 * - Levanta `vite preview` en el primer puerto libre desde el 4180, salvo con
 *   `--base`. Cada corrida lleva su `CDP_PORT` (9680, 9690; `--cdp` lo cambia).
 * - Con `--json`, la última línea es el resumen de la batería, con la forma de
 *   cualquier auditor: {"auditor":"audit-todo","aprobadas","total","fallas",…}.
 * - El archivo va a `docs/capturas/auditorias/<fecha-hora>.json` (no se
 *   versiona) y la salida entera de cada corrida, a una carpeta al lado.
 * - Apaga solo lo que lanzó, por PID. Nunca todos los Chrome.
 * - Sale con 1 si algo falló o si algún auditor se cayó sin dejar resumen.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agrupar, contar, correrEnPool, duracion, estimarSegundos, formatearResumen, informeDe, planDe, resumenDeBateria } from "./lib/bateria.mjs";
import { correrTarea, levantarPreview, matarTodos } from "./lib/bateria-proceso.mjs";
import { quiereJson } from "./lib/resumen.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const lista = (v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

const inicio = new Date();
const sello = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-${String(inicio.getDate()).padStart(2, "0")}_${String(inicio.getHours()).padStart(2, "0")}-${String(inicio.getMinutes()).padStart(2, "0")}`;
const salida = resolve(opt("--out", join("docs", "capturas", "auditorias", `${sello}.json`)));
const carpetaLogs = salida.replace(/\.json$/, "") + "-logs";
// Dos Chrome como máximo, siempre.
const paralelo = Math.max(1, Math.min(2, Number(opt("--paralelo", "2")) || 2));
const cdp = Number(opt("--cdp", process.env.CDP_PORT || "9680"));
const json = quiereJson(args);

let plan;
try {
  plan = planDe({
    solo: lista(opt("--solo", "")),
    juegos: lista(opt("--juegos", "")).length ? lista(opt("--juegos", "")) : null,
    noche: flag("--noche"),
    fisica: flag("--fisica"),
    todosLosJuegos: flag("--todos-los-juegos"),
    base: opt("--base", "http://localhost:4180"),
  });
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(2);
}
if (!plan.length) {
  console.error("no hay nada que correr con esas opciones");
  process.exit(2);
}

if (flag("--simular")) {
  const c = contar(plan);
  console.log(`${c.corridas} corridas (${c.chromes} con Chrome) · ~${duracion(estimarSegundos(plan, paralelo))} con ${paralelo} a la vez`);
  for (const t of plan) console.log(`  ${t.chrome ? "C" : " "}${t.exclusivo ? "X" : " "} node scripts/${t.script} ${t.args.join(" ")}  (~${duracion(t.estimado)})`);
  process.exit(0);
}

const necesitaBase = plan.some((t) => t.necesitaBase);
let preview = null;
let base = opt("--base", "");
const apagar = () => {
  matarTodos();
};
process.on("exit", apagar);
for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, () => {
    apagar();
    process.exit(130);
  });
}

try {
  if (necesitaBase && !base) {
    if (!existsSync(join(raiz, "dist", "index.html"))) {
      if (!flag("--construir")) {
        console.error("falta dist/: corré `pnpm build` antes (o agregá --construir)");
        process.exit(2);
      }
      const b = spawnSync("pnpm", ["build"], { cwd: raiz, stdio: "inherit", shell: true });
      if (b.status !== 0) process.exit(2);
    }
    preview = await levantarPreview({ raiz });
    base = preview.base;
  }
  // Ahora que se sabe la base, se arma el plan de verdad.
  const real = planDe({
    solo: lista(opt("--solo", "")),
    juegos: lista(opt("--juegos", "")).length ? lista(opt("--juegos", "")) : null,
    noche: flag("--noche"),
    fisica: flag("--fisica"),
    todosLosJuegos: flag("--todos-los-juegos"),
    base: base || "http://localhost:4180",
  });

  const t0 = Date.now();
  const factor = Number(opt("--limite", "1")) || 1;
  const resultados = await correrEnPool(real, paralelo, async (tarea, ranura) => {
    const r = await correrTarea({
      script: join(raiz, "scripts", tarea.script),
      args: tarea.args,
      env: { CDP_PORT: String(cdp + 10 * ranura) },
      cwd: process.cwd(),
      // El triple de lo medido el 22 de octubre más cinco minutos: lo que se
      // cuelga se corta, lo que solo está lento termina.
      limiteMs: (tarea.estimado * 3 + 300) * 1000 * factor,
      log: join(carpetaLogs, `${tarea.id.replace(/[^\w.-]+/g, "_")}.log`),
    });
    if (flag("--progreso")) {
      const x = r.resumen;
      console.error(`${r.error || !x || x.fallas.length ? "✗" : "✓"} ${tarea.id} ${x ? `${x.aprobadas}/${x.total}` : "sin resumen"} · ${duracion(r.segundos)}`);
    }
    return { tarea, ...r };
  });

  const orden = new Map(real.map((t, i) => [t.id, i]));
  resultados.sort((a, b) => (orden.get(a.tarea.id) ?? 0) - (orden.get(b.tarea.id) ?? 0));
  const informe = informeDe({
    auditores: agrupar(resultados),
    segundos: (Date.now() - t0) / 1000,
    inicio: inicio.toISOString(),
    base: base || null,
    paralelo,
    opciones: { solo: lista(opt("--solo", "")), juegos: lista(opt("--juegos", "")), noche: flag("--noche"), fisica: flag("--fisica"), todosLosJuegos: flag("--todos-los-juegos") },
  });
  mkdirSync(dirname(salida), { recursive: true });
  writeFileSync(salida, JSON.stringify(informe, null, 1));

  const mostrar = salida.startsWith(raiz) ? salida.slice(raiz.length + 1).replace(/\\/g, "/") : salida;
  console.log(formatearResumen(informe, { archivo: mostrar }).join("\n"));
  if (json) console.log(JSON.stringify(resumenDeBateria(informe)));
  process.exitCode = informe.fallas.length ? 1 : 0;
} finally {
  preview?.parar();
  apagar();
}
