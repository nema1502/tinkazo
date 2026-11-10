#!/usr/bin/env node
/**
 * Corre `audit-sound` y `audit-mezcla` sobre la carrera de verdad, una candidata por vez.
 *
 * Para cada candidata pide la dirección `?auditar=...&sonido=<pieza>:<candidata>` (ver `src/sonidos/carrera-eleccion.ts`) y
 * guarda la salida completa en `<salida>/<pieza>-<candidata>.mezcla.txt` y `.sonido.txt`, más un resumen en `resumen.json`.
 * Hace falta el sitio construido y servido (`pnpm build` y `pnpm preview --port <puerto>`). Un solo Chrome a la vez, con su
 * propio `CDP_PORT`. Imprime cada línea que sale de los auditores, así nunca pasa mucho tiempo sin decir algo.
 *
 * Uso: CDP_PORT=9770 node scripts/sonidos/carrera-auditar.mjs --base http://localhost:4770 --salida <carpeta> [--solo pieza[:candidata]] [--sin-sonido] [--sin-mezcla]
 *
 * `hoy` (sin ninguna candidata) se corre primero, para comparar, salvo con `--sin-hoy`; `--combo` corre solo una combinación.
 * El `resumen.json` se completa: lo que ya estaba de otras corridas se conserva. `audit-sound` se corre solo con las piezas de
 * efecto: la música de la banda se cuenta aparte y no cambia lo que ese auditor mide.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = opt("--base", "http://localhost:4770");
const salida = resolve(opt("--salida", join(RAIZ, "..", "carrera-sonido-auditorias")));
const [soloPieza, soloCand] = opt("--solo", "").split(":");
const conSonido = !args.includes("--sin-sonido");
const conMezcla = !args.includes("--sin-mezcla");
const sinHoy = args.includes("--sin-hoy");
// `--combo musica:c,final:a`: corre solo esa combinación (varias piezas a la vez) en vez de una candidata por vez.
const combo = opt("--combo", "");

const PIEZAS = ["musica", "pasos", "echarse", "obstaculos", "final", "festejo"];
const CANDIDATAS = (p) => [...(p === "musica" || p === "final" ? ["base"] : []), "a", "b", "c"];

/** Corre un auditor, repite su salida línea por línea y devuelve el texto y el código de salida. */
function correr(script, extra, etiqueta) {
  return new Promise((ok) => {
    const hijo = spawn(process.execPath, [join(RAIZ, "scripts", script), "race", "--base", base, ...extra], { cwd: RAIZ, env: process.env });
    let texto = "";
    let pendiente = "";
    const alLeer = (d) => {
      const s = d.toString();
      texto += s;
      pendiente += s;
      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";
      for (const l of lineas) if (l.trim()) console.log(`[${etiqueta}] ${l}`);
    };
    hijo.stdout.on("data", alLeer);
    hijo.stderr.on("data", alLeer);
    hijo.on("close", (codigo) => ok({ texto, codigo }));
  });
}

/** Lo que importa de la salida de `audit-mezcla` de una sola corrida. */
export function resumenDeMezcla(texto) {
  const m = /race\s+(-?[\d.]+) LUFS · pico real (-?[\d.]+) dBTP · corto máx (-?[\d.]+) · sin graves de 150 Hz (-?[\d.]+) LU, de 300 Hz (-?[\d.]+) LU · golpe (-?[\d.]+|—) LU · ([\d.]+) s/.exec(texto);
  const fallas = [...texto.matchAll(/^\s*✗ (.+)$/gm)].map((x) => x[1]);
  return m ? { lufs: Number(m[1]), picoRealDb: Number(m[2]), cortoMax: Number(m[3]), pierde150: Number(m[4]), pierde300: Number(m[5]), golpe: m[6] === "—" ? null : Number(m[6]), seg: Number(m[7]), fallas } : { fallas: fallas.length ? fallas : ["no se pudo leer la salida"] };
}

/** Lo que importa de la salida de `audit-sound`. */
export function resumenDeSonido(texto) {
  const lineas = texto.split("\n").map((l) => l.trim());
  const delJuego = lineas.find((l) => /^[✓✗]\s+race\b/.test(l) || /^race\s+✗/.test(l)) ?? "";
  const fallas = lineas.filter((l) => /^✗\s+race\b/.test(l) || /^race\s+✗/.test(l)).map((l) => l.replace(/^✗\s+race\s*/, "").replace(/^race\s+✗\s*/, ""));
  return { ok: /APROBADO/.test(texto) && !/RECHAZADO/.test(texto), linea: delJuego, fallas };
}

async function main() {
  mkdirSync(salida, { recursive: true });
  const pedidos = combo ? [] : sinHoy ? [] : [{ clave: "hoy", sonido: "" }];
  if (combo) pedidos.push({ clave: `combo-${combo.replace(/[:,]/g, "-")}`, sonido: combo, pieza: combo.split(",").map((x) => x.split(":")[0]).find((p) => p !== "musica") ?? "musica" });
  else
    for (const p of PIEZAS) {
      if (soloPieza && p !== soloPieza) continue;
      for (const c of CANDIDATAS(p)) if (!soloCand || c === soloCand) pedidos.push({ clave: `${p}-${c}`, sonido: `${p}:${c}`, pieza: p });
    }
  const rutaResumen = join(salida, "resumen.json");
  let resumen = [];
  try {
    if (existsSync(rutaResumen)) resumen = JSON.parse(readFileSync(rutaResumen, "utf8"));
  } catch {
    resumen = [];
  }
  for (const pedido of pedidos) {
    const extra = pedido.sonido ? ["--sonido", pedido.sonido] : [];
    const r = { clave: pedido.clave };
    if (conMezcla) {
      const out = await correr("audit-mezcla.mjs", extra, `${pedido.clave} mezcla`);
      writeFileSync(join(salida, `${pedido.clave}.mezcla.txt`), out.texto);
      r.mezcla = { codigo: out.codigo, ...resumenDeMezcla(out.texto) };
    }
    if (conSonido && (pedido.clave === "hoy" || !["musica"].includes(pedido.pieza))) {
      const out = await correr("audit-sound.mjs", extra, `${pedido.clave} sonido`);
      writeFileSync(join(salida, `${pedido.clave}.sonido.txt`), out.texto);
      r.sonido = { codigo: out.codigo, ...resumenDeSonido(out.texto) };
    }
    resumen = [...resumen.filter((x) => x.clave !== r.clave), r];
    writeFileSync(rutaResumen, JSON.stringify(resumen, null, 2));
    console.log(`== ${pedido.clave}: mezcla ${r.mezcla ? (r.mezcla.fallas.length ? `${r.mezcla.fallas.length} fallas` : "ok") : "—"}, sonido ${r.sonido ? (r.sonido.codigo === 0 ? "ok" : "falla") : "—"}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
