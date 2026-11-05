#!/usr/bin/env node
/**
 * Deja listo el kit para creadores (clips verticales, logo animado, placas, subtítulos) para que el Worker
 * lo entregue en https://m.tinkazo.app/kit/<archivo>. Dos caminos, como la música (ver README.md):
 *
 *   node subir-kit.mjs --desde <carpeta> --copiar [--seco]
 *     Copia los archivos a camas/kit/ (junto a este guion, fuera del repositorio) y arma lista.json.
 *     Después se despliega con `npx wrangler@4 deploy`. Cada archivo pesa hasta 25 MiB.
 *   node subir-kit.mjs --desde <carpeta> [--seco] [--bucket tinkazo-kit]
 *     Los sube a R2 (cuando R2 esté habilitado en la cuenta), con la sesión de `wrangler login`.
 *   KIT_DIR=<carpeta> node subir-kit.mjs ...
 *
 * La carpeta no está en el repositorio: los videos no se versionan. Se toman los archivos de la carpeta
 * (sin entrar en subcarpetas); todos tienen que tener nombre simple (minúsculas, números, guiones y puntos)
 * y una extensión del kit. Si uno no cumple, el guion falla antes de copiar o subir ninguno.
 * `--seco` no toca nada: revisa, muestra qué haría y cuánto pesa.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Los mismos nombres y tipos que src/kit.ts: si uno cambia, cambia el otro (lo vigila kit.test.ts).
const NOMBRE = /^[a-z0-9][a-z0-9._-]{0,79}\.(?:mp4|webm|mov|png|jpg|webp|svg|srt|txt|zip|json)$/;
const TIPOS = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  srt: "application/x-subrip",
  txt: "text/plain",
  zip: "application/zip",
  json: "application/json",
};
const TOPE_ASSETS = 25 * 1024 * 1024; // lo que admite un archivo propio de un Worker

const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const seco = args.includes("--seco");
const copiar = args.includes("--copiar");
const aqui = dirname(fileURLToPath(import.meta.url));
const destinoCamas = join(aqui, "camas", "kit");
const bucket = valor("--bucket") ?? "tinkazo-kit";
const carpeta = valor("--desde") ?? process.env.KIT_DIR;

const falla = (mensaje) => {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
};
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

if (!carpeta) falla("falta la carpeta con el kit: --desde <carpeta> o la variable KIT_DIR.");
const raiz = resolve(carpeta);
if (!existsSync(raiz)) falla(`la carpeta no existe: ${raiz}`);

const entradas = readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isFile() && e.name !== "lista.json");
if (!entradas.length) falla(`no hay archivos en ${raiz}.`);
const malos = entradas.filter((e) => !NOMBRE.test(e.name)).map((e) => e.name);
if (malos.length) falla(`nombres que el kit no admite (minúsculas, números, guiones y puntos; extensión ${Object.keys(TIPOS).join(", ")}): ${malos.join(", ")}. No se subió nada.`);

const archivos = entradas.map((e) => {
  const ruta = join(raiz, e.name);
  return { nombre: e.name, ruta, bytes: statSync(ruta).size, tipo: TIPOS[extname(e.name).slice(1)] };
}).sort((a, b) => a.nombre.localeCompare(b.nombre));
const vacios = archivos.filter((a) => a.bytes === 0).map((a) => a.nombre);
if (vacios.length) falla(`archivos vacíos: ${vacios.join(", ")}. No se subió nada.`);
if (copiar) {
  const grandes = archivos.filter((a) => a.bytes > TOPE_ASSETS).map((a) => `${a.nombre} (${mb(a.bytes)})`);
  if (grandes.length) falla(`pasan los 25 MiB que admite un archivo propio del Worker: ${grandes.join(", ")}. Achicalos o usá R2 (sin --copiar).`);
}

// lista.json: lo que hay, para que la página y los creadores lo vean sin listar nada en el servidor.
const lista = { archivos: archivos.map(({ nombre, bytes, tipo }) => ({ nombre, bytes, tipo })) };
const listaRuta = join(raiz, "lista.json");
const listaBytes = Buffer.byteLength(JSON.stringify(lista, null, 2));

let total = 0;
const hacer = (a) => {
  const destino = copiar ? join(destinoCamas, a.nombre) : `${bucket}/${a.nombre}`;
  if (seco) {
    console.log(`SECO  ${destino}  ${mb(a.bytes)}  ${a.tipo}`);
  } else if (copiar) {
    mkdirSync(destinoCamas, { recursive: true });
    copyFileSync(a.ruta, destino);
    console.log(`COPIÓ ${a.nombre}  ${mb(a.bytes)}  (a camas/kit/)`);
  } else {
    const r = spawnSync("npx", ["wrangler@4", "r2", "object", "put", destino, "--file", a.ruta, "--content-type", a.tipo, "--remote"], {
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    if (r.status !== 0) falla(`wrangler falló al subir ${destino} (código ${r.status ?? "ninguno"}).`);
    console.log(`SUBIÓ ${destino}  ${mb(a.bytes)}`);
  }
  total += a.bytes;
};

for (const a of archivos) hacer(a);
if (!seco) writeFileSync(listaRuta, `${JSON.stringify(lista, null, 2)}\n`);
hacer({ nombre: "lista.json", ruta: listaRuta, bytes: listaBytes, tipo: TIPOS.json });
console.log(`${seco ? (copiar ? "Copiaría" : "Subiría") : copiar ? "Copió" : "Subió"} ${archivos.length} archivos y lista.json, ${mb(total)} en total${seco ? " (en seco: no se copió ni se subió nada)." : "."}`);
