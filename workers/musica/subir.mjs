#!/usr/bin/env node
/**
 * Deja listas las camas musicales de los juegos, una por juego, con nombres fijos.
 * Dos caminos (ver README.md):
 *
 *   node subir.mjs --desde <carpeta con los mp3> --copiar [--seco]
 *     Copia los diez mp3 a camas/ (junto a este guion, fuera del repositorio), que el
 *     Worker entrega como archivos propios: después se despliega con `wrangler deploy`.
 *   node subir.mjs --desde <carpeta con los mp3> [--seco] [--bucket tinkazo-musica]
 *     Los sube a R2 (cuando R2 esté habilitado en la cuenta).
 *   MUSICA_DIR=<carpeta> node subir.mjs ...
 *
 * La carpeta no está en el repositorio (la música no se versiona, ver README.md): se
 * pasa con `--desde` o con la variable `MUSICA_DIR`. Cada archivo se llama `<juego>.mp3`.
 *
 * `--seco` no toca la nube: revisa que estén los diez archivos, que parezcan mp3 y
 * muestra qué subiría y cuánto pesa. Sin `--seco`, usa `wrangler r2 object put --remote`
 * con la sesión de `wrangler login` de la cuenta de Tinkazo. Si falta un archivo, sale
 * con error antes de subir ninguno.
 */
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const JUEGOS = ["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi"];

const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const seco = args.includes("--seco");
const copiar = args.includes("--copiar");
const destinoCamas = join(dirname(fileURLToPath(import.meta.url)), "camas");
const bucket = valor("--bucket") ?? "tinkazo-musica";
const carpeta = valor("--desde") ?? process.env.MUSICA_DIR;

const falla = (mensaje) => {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
};
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (!carpeta) falla("falta la carpeta con los mp3: --desde <carpeta> o la variable MUSICA_DIR.");
const raiz = resolve(carpeta);
if (!existsSync(raiz)) falla(`la carpeta no existe: ${raiz}`);

/** Un mp3 empieza con una etiqueta ID3 o con un cuadro de audio (11 bits en 1). */
function pareceMp3(ruta) {
  const fd = openSync(ruta, "r");
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b.toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  } finally {
    closeSync(fd);
  }
}

// Primero se revisa todo: ninguna subida a medias por un archivo que faltaba.
const faltan = [];
const malos = [];
const archivos = JUEGOS.map((juego) => {
  const ruta = join(raiz, `${juego}.mp3`);
  if (!existsSync(ruta)) {
    faltan.push(`${juego}.mp3`);
    return { juego, ruta, bytes: 0 };
  }
  const bytes = statSync(ruta).size;
  if (bytes === 0 || !pareceMp3(ruta)) malos.push(`${juego}.mp3`);
  return { juego, ruta, bytes };
});
if (faltan.length) falla(`faltan en ${raiz}: ${faltan.join(", ")}. No se subió nada.`);
if (malos.length) falla(`no parecen mp3 (vacíos o de otro formato): ${malos.join(", ")}. No se subió nada.`);

let total = 0;
for (const { juego, ruta, bytes } of archivos) {
  const destino = copiar ? join(destinoCamas, `${juego}.mp3`) : `${bucket}/${juego}.mp3`;
  if (copiar && !seco) {
    mkdirSync(destinoCamas, { recursive: true });
    copyFileSync(ruta, destino);
    console.log(`COPIÓ ${juego}.mp3  ${kb(bytes)}  (a camas/)`);
  } else if (seco) {
    console.log(`SECO  ${destino}  ${kb(bytes)}  (desde ${ruta})`);
  } else {
    const r = spawnSync("npx", ["wrangler@4", "r2", "object", "put", destino, "--file", ruta, "--content-type", "audio/mpeg", "--remote"], {
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    if (r.status !== 0) falla(`wrangler falló al subir ${destino} (código ${r.status ?? "ninguno"}). Ya subidos: ${archivos.slice(0, archivos.findIndex((a) => a.juego === juego)).map((a) => a.juego).join(", ") || "ninguno"}.`);
    console.log(`SUBIÓ ${destino}  ${kb(bytes)}`);
  }
  total += bytes;
}
console.log(`${seco ? (copiar ? "Copiaría" : "Subiría") : copiar ? "Copió" : "Subió"} ${archivos.length} archivos, ${(total / 1048576).toFixed(2)} MB en total${seco ? " (en seco: no se copió ni se subió nada)." : "."}`);
