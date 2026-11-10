#!/usr/bin/env node
/**
 * Mide cada candidata de sonido de la carrera ya renderizada (`carrera-render.mjs`) contra las metas de la dirección.
 *
 * Sin navegador: lee los WAV de `<carpeta>/<pieza>/<eleccion>.wav` y mide sonoridad (LUFS con la ponderación K), pico
 * real, recortes, lo que se pierde en un parlante que corta en 150 y en 300 Hz, cuánta energía hay entre 250 Hz y 4 kHz,
 * el silencio entre el clic y el golpe, el golpe contra la música de la recta y la duración del festejo. Escribe
 * `<carpeta>/medidas.json` y sale con error si una candidata (a, b o c) no cumple. `hoy` y `base` se miden para comparar
 * y no hacen fallar nada.
 *
 * Uso: node scripts/sonidos/carrera-medir.mjs --carpeta <render> [--solo pieza[:eleccion]] [--sugerir]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { energiaEnBanda, leerWav, medirSenal, nivelMaximoDeTramo, ponderarK, sonoridadMaxima, tramoQueSuena } from "../lib/senal.mjs";
import { correccionDeNivel, juzgar } from "./carrera-juicio.mjs";

const PIEZAS = ["musica", "pasos", "echarse", "obstaculos", "final", "festejo"];
const ELECCIONES = ["hoy", "base", "a", "b", "c"];
/** Cuándo cae cada cosa en la demostración del final (`TIEMPOS_FINAL` de `src/sonidos/carrera.ts`). */
const CRUCE = 3;
const GOLPE = 4;

/** Todas las medidas de una candidata renderizada. */
export function medirCandidata(pieza, wav) {
  const { sr, L, R } = wav;
  const medida = medirSenal(L, R, sr);
  const [a, b] = tramoQueSuena(L, R, -50);
  const registro = energiaEnBanda(L.subarray(a, b), R.subarray(a, b), sr, 250, 4000).enBanda;
  const m = { medida, registro };
  if (pieza === "final") {
    // El silencio: desde 0,06 s después del cruce (el clic cabe en los primeros 0,05) hasta 0,03 s antes del golpe.
    m.silencio = nivelMaximoDeTramo(L, R, sr, CRUCE + 0.06, GOLPE - 0.03);
    m.silencioPrimerosMs = nivelMaximoDeTramo(L, R, sr, CRUCE + 0.06, CRUCE + 0.46);
    const i0 = Math.round(GOLPE * sr);
    const ka = ponderarK(L.subarray(i0), sr), kb = ponderarK(R.subarray(i0), sr);
    m.golpe = sonoridadMaxima(ka, kb, sr, 0.4, 0.05);
    const [pa, pb] = [0, i0];
    m.antesDelGolpe = sonoridadMaxima(ponderarK(L.subarray(pa, pb), sr), ponderarK(R.subarray(pa, pb), sr), sr, 0.4, 0.05);
  }
  if (pieza === "festejo") {
    // Cuánto dura mientras no cae 30 dB bajo su pico: no depende de a qué volumen se la renderizó.
    const [c, d] = tramoQueSuena(L, R, medida.picoDb - 30);
    m.duracionFestejo = (d - c) / sr;
  }
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const carpeta = resolve(opt("--carpeta", ""));
  if (!opt("--carpeta", "")) throw new Error("falta --carpeta <carpeta del render>");
  const [soloPieza, soloEleccion] = opt("--solo", "").split(":");
  const sugerir = args.includes("--sugerir");
  const todas = [];
  let fallan = 0;
  for (const pieza of PIEZAS) {
    if (soloPieza && pieza !== soloPieza) continue;
    for (const e of ELECCIONES) {
      if (soloEleccion && e !== soloEleccion) continue;
      const ruta = join(carpeta, pieza, `${e}.wav`);
      if (!existsSync(ruta)) continue;
      const m = medirCandidata(pieza, leerWav(readFileSync(ruta)));
      const j = juzgar(pieza, m);
      const es = e === "a" || e === "b" || e === "c";
      if (es && !j.ok) fallan++;
      todas.push({ pieza, eleccion: e, ...m, ok: j.ok, fallas: j.fallas, correccionDb: correccionDeNivel(pieza, m) });
      const x = m.medida;
      const extra = pieza === "final" ? ` golpe ${m.golpe.toFixed(1)} LUFS, silencio ${m.silencio.toFixed(0)} dBFS` : pieza === "festejo" ? ` dura ${m.duracionFestejo.toFixed(2)} s` : "";
      console.log(
        `${pieza.padEnd(10)} ${e.padEnd(4)} ${j.ok ? "ok   " : es ? "FALLA" : "(ref)"} I ${x.I.toFixed(1).padStart(6)} mom ${x.momentanea.toFixed(1).padStart(6)} pico ${x.picoRealDb.toFixed(1).padStart(6)} dBTP` +
          ` 150: ${(pieza === "musica" ? x.pierde150 : x.pierde150Momentanea).toFixed(1)} 300: ${(pieza === "musica" ? x.pierde300 : x.pierde300Momentanea).toFixed(1)} LU registro ${(m.registro * 100).toFixed(0)} %${extra}` +
          (sugerir ? `  corregir ${correccionDeNivel(pieza, m) >= 0 ? "+" : ""}${correccionDeNivel(pieza, m).toFixed(1)} dB` : ""),
      );
      for (const f of j.fallas) console.log(`           - ${f}`);
    }
  }
  writeFileSync(join(carpeta, "medidas.json"), JSON.stringify(todas, null, 2));
  console.log(fallan ? `\n${fallan} candidatas no cumplen` : "\nlas candidatas medidas cumplen");
  process.exit(fallan ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
