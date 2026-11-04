#!/usr/bin/env node
/**
 * Baja los sonidos crudos del servicio de generación de efectos de sonido.
 *
 * Uso (desde la raíz del repositorio):
 *   node scripts/sonidos/generar.mjs <manifiesto.json> --salida <carpeta de crudos> [--solo id1,id2]
 *
 * El manifiesto es una lista de `{ juego, id, prompt, dur, variantes, loop?, influencia? }` (los textos que se
 * pidieron están en `public/sonidos/PROMPTS.md`). Cada variante queda en `<salida>/<juego>/<id>-v<N>.mp3`; la que ya
 * existe no se vuelve a pedir. Después: `python -I scripts/sonidos/procesar.py <salida>`.
 *
 * La llave se lee de la variable `ELEVENLABS_API_KEY` o de `.env.local` y no se imprime nunca. Cuesta unos 11 créditos
 * por segundo de sonido; el servicio no acepta menos de 0,5 s. El gasto de cada pedido se anota en `<salida>/gasto.log`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const manifiesto = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--salida" && args[args.indexOf(a) - 1] !== "--solo");
const salida = resolve(opt("--salida", "sonidos-crudos"));
const solo = opt("--solo", "")?.split(",").filter(Boolean);
if (!manifiesto) {
  console.error("Falta el manifiesto. Uso: node scripts/sonidos/generar.mjs <manifiesto.json> --salida <carpeta>");
  process.exit(1);
}

function llave() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const f of [resolve(raiz, ".env.local"), resolve(raiz, "..", "..", "..", ".env.local")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^ELEVENLABS_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error("No encontré ELEVENLABS_API_KEY ni en el entorno ni en .env.local.");
  process.exit(1);
}
const KEY = llave();
const items = JSON.parse(readFileSync(resolve(manifiesto), "utf8")).filter((i) => !solo?.length || solo.includes(i.id));
let gastado = 0;

for (const it of items) {
  const dir = `${salida}/${it.juego}`;
  mkdirSync(dir, { recursive: true });
  for (let v = 1; v <= (it.variantes ?? 1); v++) {
    const f = `${dir}/${it.id}-v${v}.mp3`;
    if (existsSync(f)) continue;
    const body = { text: it.prompt, duration_seconds: Math.max(0.5, it.dur), prompt_influence: it.influencia ?? 0.5, model_id: "eleven_text_to_sound_v3" };
    if (it.loop) body.loop = true;
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.log(`ERROR ${it.juego}/${it.id}-v${v}: ${res.status} ${(await res.text()).slice(0, 160).split(KEY).join("***")}`);
      continue;
    }
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    const costo = Number(res.headers.get("character-cost") || 0);
    gastado += costo;
    appendFileSync(`${salida}/gasto.log`, `${new Date().toISOString()} ${it.juego}/${it.id}-v${v} ${it.dur}s costo=${costo}\n`);
    console.log(`ok ${it.juego}/${it.id}-v${v} ${costo}`);
  }
}
console.log("créditos gastados en esta corrida:", gastado);
