/**
 * La herramienta de cupones de Tinkazo: crea lotes en el portero de mainnet y arma las tarjetas para imprimir, mira
 * cómo va un lote, anula un lote o un código, y admite a mano una cuenta que ya existe. Con los pagos, suma sorteos a
 * mano, marca una orden pagada por fuera y resuelve los pagos sueltos.
 *
 *   node scripts/cupones.mjs crear --lote space-apps-14nov --cantidad 30 --sorteos 3 --dias 60 \
 *     --vence 2026-12-14 --salida C:/cupones-privados [--usos 1]
 *   node scripts/cupones.mjs estado --lote space-apps-14nov [--json]
 *   node scripts/cupones.mjs anular --lote space-apps-14nov-reserva
 *   node scripts/cupones.mjs anular --codigo K7M2-9QXA-4HTR
 *   node scripts/cupones.mjs admitir --cuenta G... --sorteos 20 --dias 60 --ref pruebas-internas
 *   node scripts/cupones.mjs dar --cuenta G... --sorteos 10 --dias 365 --ref venta-qr-0001
 *   node scripts/cupones.mjs pagada --orden ABCD2345 --metodo qr-bs --ref comprobante-0001
 *   node scripts/cupones.mjs sueltos [--json]
 *   node scripts/cupones.mjs asignar --operacion 123456789 --orden ABCD2345
 *   node scripts/cupones.mjs devuelto --operacion 123456789 --ref devolucion-0001
 *
 * Sin secretos en el repositorio: la clave de cupones sale de `TINKAZO_CUPONES_TOKEN` y va solo en la cabecera
 * `Authorization`; nunca se muestra. El portero es `https://pm.tinkazo.app`; `--base http://127.0.0.1:8793` para probar
 * con `wrangler dev`.
 *
 * `crear` genera los códigos con `crypto.getRandomValues`, escribe en `--salida` el CSV (código y enlace) y
 * `<lote>-tarjetas.html` (ocho por hoja A4, frente y dorso, con su QR) y recién entonces los manda al portero. Si el
 * portero no los crea, borra lo que escribió: no quedan tarjetas que no valen. **Se niega a escribir dentro de un
 * repositorio de git**, y en especial dentro de este (también desde una copia de trabajo): los códigos en claro son
 * plata y el repositorio es público.
 *
 * Cómo se lee un código es lo mismo que en el portero (`workers/patrocinio/src/cupon-codigo.ts`) y el sitio: los tres
 * pasan el vector `workers/patrocinio/src/cupon-vectores.json`.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import qrcode from "qrcode-generator";

// ---------- el código: copia de workers/patrocinio/src/cupon-codigo.ts, con el mismo vector ----------

/** El alfabeto de Crockford, sin I, L, O ni U. */
export const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LARGO = 12;
/** Lo más que trae un cupón: el mismo número que `MAX_SORTEOS_POR_CUPON` del portero (una prueba lo compara). */
export const MAX_SORTEOS_POR_CUPON = 50;
const MAX_ENTRADA = 64;
const SEPARADORES = /[\s\-\u2010-\u2015\u2212]/g;
const VALIDO = new RegExp(`^[${ALFABETO}]{${LARGO}}$`);

/** Sin espacios ni guiones, en mayúsculas, la O como 0 y la I o la L como 1. Si no da 12 del alfabeto, null. */
export function normalizar(entrada) {
  if (typeof entrada !== "string" || entrada.length > MAX_ENTRADA) return null;
  const limpio = entrada.replace(SEPARADORES, "");
  if (!/^[0-9A-Za-z]*$/.test(limpio)) return null;
  const codigo = limpio.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return VALIDO.test(codigo) ? codigo : null;
}

/** Tres grupos de cuatro: `K7M2-9QXA-4HTR`. */
export function mostrar(codigo) {
  if (normalizar(codigo) !== codigo) throw new Error("cupon-forma");
  return `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8)}`;
}

/**
 * `cantidad` códigos distintos. Cada carácter sale de un byte al azar de `aleatorio` (por defecto
 * `crypto.getRandomValues`, nunca `Math.random`): 32 divide 256, así que tomar los 5 bits bajos es parejo.
 */
export function generarCodigos(cantidad, aleatorio = (arr) => globalThis.crypto.getRandomValues(arr)) {
  const vistos = new Set();
  let vueltas = 0;
  while (vistos.size < cantidad) {
    if (++vueltas > cantidad * 10 + 10) throw new Error("los bytes al azar se repiten: no se pueden generar códigos distintos");
    const bytes = aleatorio(new Uint8Array(LARGO));
    vistos.add(Array.from(bytes, (b) => ALFABETO[b & 31]).join(""));
  }
  return [...vistos];
}

/**
 * El id de una orden como lo escribe quien opera: con o sin el prefijo de la nota (`tk:o:`), con guiones o espacios, en
 * minúsculas, la O como 0 y la I o la L como 1. Lo mismo que `normalizarOrden` del portero (`workers/patrocinio/src/cobros.ts`).
 */
export function normalizarOrden(entrada) {
  if (typeof entrada !== "string" || entrada.length > MAX_ENTRADA) return null;
  const limpio = entrada.replace(SEPARADORES, "").replace(/^tk:[o0]:/i, "");
  if (!/^[0-9A-Za-z]+$/.test(limpio)) return null;
  const id = limpio.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return new RegExp(`^[${ALFABETO}]{8}$`).test(id) ? id : null;
}

/** Un texto ajeno (la nota de un pago) como se puede imprimir: cada carácter de control pasa a ser un signo visible. */
export const visible = (texto) => String(texto).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");

/** El enlace del cupón: abre Oficial y lleva el código en el fragmento, que el navegador no le manda a nadie. */
export const enlaceDe = (codigo) => `https://tinkazo.app/?red=oficial#cupon=${codigo}`;

// ---------- fechas: el vencimiento es a las 23:59 de Bolivia (UTC-4, sin horario de verano) ----------

const BOLIVIA_MS = 4 * 3_600_000;
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `AAAA-MM-DD` a las 23:59:59.999 de Bolivia, en ms. Una fecha que no existe lanza. */
export function venceDe(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ""));
  if (!m) throw new Error("la fecha va como AAAA-MM-DD");
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dia = new Date(Date.UTC(a, mes - 1, d));
  if (dia.getUTCFullYear() !== a || dia.getUTCMonth() !== mes - 1 || dia.getUTCDate() !== d) throw new Error(`la fecha ${texto} no existe`);
  return Date.UTC(a, mes - 1, d, 23, 59, 59, 999) + BOLIVIA_MS;
}

/** El día de Bolivia de un instante. */
function enBolivia(ms) {
  const f = new Date(ms - BOLIVIA_MS);
  return { a: f.getUTCFullYear(), mes: f.getUTCMonth(), d: f.getUTCDate(), h: f.getUTCHours(), min: f.getUTCMinutes() };
}

// ---------- no escribir dentro de un repositorio ----------

/** La raíz de este repositorio y, si es una copia de trabajo (`.git` es un archivo), también la del principal. */
export function raicesProtegidas(raiz) {
  const raices = [resolve(raiz)];
  const git = join(raiz, ".git");
  try {
    if (existsSync(git) && statSync(git).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, "utf8"));
      if (m) {
        const comun = resolve(resolve(raiz, m[1].trim()), "..", "..");
        if (basename(comun) === ".git") raices.push(dirname(comun));
      }
    }
  } catch {
    // Sin poder leerlo, queda la raíz de la copia; la búsqueda de `.git` hacia arriba sigue valiendo.
  }
  return raices;
}

/** La ruta real de `destino`: la del antepasado más cercano que existe (sin enlaces ni uniones) y lo que falta. */
function rutaReal(destino) {
  let d = resolve(destino);
  const resto = [];
  while (!existsSync(d)) {
    const p = dirname(d);
    if (p === d) break;
    resto.unshift(basename(d));
    d = p;
  }
  let real = d;
  try {
    real = realpathSync.native(d);
  } catch {
    real = d;
  }
  return join(real, ...resto);
}

/** Si `destino` cae dentro de alguna de `raices` o de cualquier carpeta de un repositorio de git. */
export function dentroDeUnRepo(destino, raices) {
  const candidatos = [resolve(destino), rutaReal(destino)];
  for (const abs of candidatos) {
    for (const r of raices) {
      const rel = relative(resolve(r), abs);
      if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return true;
    }
    let d = abs;
    for (;;) {
      if (existsSync(join(d, ".git"))) return true;
      const p = dirname(d);
      if (p === d) break;
      d = p;
    }
  }
  return false;
}

// ---------- las tarjetas ----------

const escapar = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** El QR del enlace como SVG, oscuro sobre blanco y con su margen de cuatro módulos. */
function qrSvg(texto) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margen = 4;
  let d = "";
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) d += `M${c + margen} ${f + margen}h1v1h-1z`;
  const lado = n + 2 * margen;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${lado}" height="${lado}" fill="#ffffff"/><path d="${d}" fill="#191919"/></svg>`;
}

/** Los textos de la tarjeta (sección 3.6 del diseño), en castellano y en inglés. */
function textos({ sorteos, vence, usos }) {
  const f = enBolivia(vence);
  const fechaEs = `${f.d} de ${MESES_ES[f.mes]}`;
  const fechaEn = `${MESES_EN[f.mes]} ${f.d}`;
  return {
    sorteos: [sorteos === 1 ? "1 sorteo oficial gratis, que cualquiera puede comprobar." : `${sorteos} sorteos oficiales gratis, que cualquiera puede comprobar.`, sorteos === 1 ? "1 free Live draw anyone can check." : `${sorteos} free Live draws anyone can check.`],
    escanear: ["Escaneá el código con la cámara del celular.", "Scan the code with your phone's camera."],
    uso: usos === 1 ? [`Un solo uso, uno por equipo. Vale hasta el ${fechaEs}.`, `Single use, one per team. Valid until ${fechaEn}.`] : [`Uno por equipo. Vale hasta el ${fechaEs}.`, `One per team. Valid until ${fechaEn}.`],
    dorso: [
      'Si no se abre: entrá a tinkazo.app/?red=oficial con Google o con tu correo, tocá "Tengo un cupón" y escribí:',
      'If it doesn\'t open: go to tinkazo.app/?red=oficial, sign in with Google or email, tap "I have a coupon" and type:',
    ],
  };
}

const POR_HOJA = 8;
const COLUMNAS = 2;

/**
 * Las tarjetas de un lote, ocho por hoja A4: una hoja de frentes y detrás la de sus dorsos, con las columnas cambiadas
 * para imprimir a doble faz girando por el borde largo (así cada dorso cae detrás de su frente).
 */
export function tarjetasHtml({ lote, codigos, sorteos, vence, usos }) {
  const t = textos({ sorteos, vence, usos });
  const par = ([es, en], clase = "") => `<p class="${clase}">${escapar(es)}<span class="en">${escapar(en)}</span></p>`;
  // El QR es el enlace; en pantalla también se puede tocar, para probar una tarjeta antes de imprimir.
  const frente = (c) => `<div class="tarjeta frente"><div class="marca">Tinkazo</div><a class="qr" href="${escapar(enlaceDe(c))}">${qrSvg(enlaceDe(c))}</a>${par(t.sorteos, "fuerte")}${par(t.escanear)}${par(t.uso, "chico")}</div>`;
  const dorso = (c) => `<div class="tarjeta dorso">${par(t.dorso)}<div class="codigo">${escapar(mostrar(c))}</div></div>`;
  const vacia = '<div class="tarjeta vacia"></div>';
  const hojas = [];
  for (let i = 0; i < codigos.length; i += POR_HOJA) {
    const grupo = codigos.slice(i, i + POR_HOJA);
    const lleno = [...grupo, ...Array(POR_HOJA - grupo.length).fill(null)];
    hojas.push(`<section class="hoja frente">${lleno.map((c) => (c ? frente(c) : vacia)).join("")}</section>`);
    const espejo = [];
    for (let f = 0; f < POR_HOJA / COLUMNAS; f++) for (let k = COLUMNAS - 1; k >= 0; k--) espejo.push(lleno[f * COLUMNAS + k]);
    hojas.push(`<section class="hoja dorso">${espejo.map((c) => (c ? dorso(c) : vacia)).join("")}</section>`);
  }
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarjetas ${escapar(lote)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #191919; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .aviso { padding: 12px 16px; font-size: 14px; background: #f3efe6; }
  .hoja { width: 210mm; height: 297mm; display: grid; grid-template-columns: repeat(2, 105mm); grid-template-rows: repeat(4, 74.25mm); page-break-after: always; break-after: page; }
  .tarjeta { border: 0.2mm dashed #b8b2a6; padding: 4mm 6mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  .tarjeta.vacia { border-color: transparent; }
  .marca { font-weight: 800; font-size: 15pt; letter-spacing: 0.02em; }
  .qr { display: block; width: 36mm; height: 36mm; margin: 1.5mm 0; }
  .qr svg { width: 100%; height: 100%; display: block; }
  p { margin: 0.6mm 0; font-size: 8.5pt; line-height: 1.25; }
  p.fuerte { font-weight: 700; font-size: 9pt; }
  p.chico { font-size: 7.5pt; }
  .en { display: block; color: #4a463f; font-size: 0.92em; }
  .dorso p { font-size: 14px; line-height: 1.35; }
  .codigo { margin-top: 3mm; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 20pt; font-weight: 700; letter-spacing: 0.06em; }
  @media print { .aviso { display: none; } }
</style>
</head>
<body>
<div class="aviso">Lote ${escapar(lote)}, ${codigos.length} tarjetas. Imprimir al 100 %, a doble faz y girando por el borde largo. Van en sobre o boca abajo: una foto del QR o del código lo canjea.</div>
${hojas.join("\n")}
</body>
</html>
`;
}

/** El CSV del lote: código como se muestra y su enlace. */
export const csvDe = (codigos) => `codigo,enlace\n${codigos.map((c) => `${mostrar(c)},${enlaceDe(c)}`).join("\n")}\n`;

// ---------- hablar con el portero ----------

export const BASE_POR_DEFECTO = "https://pm.tinkazo.app";
const CLAVE_MINIMA = 32;
const ESPERA_MS = 20_000;
const FORMA_LOTE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FORMA_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FORMA_CUENTA = /^G[A-Z2-7]{55}$/;
/** El id de una operación de Horizon, como lo muestra `sueltos`. */
const FORMA_OPERACION = /^\d{1,30}$/;
const METODOS_PAGADA = ["a-mano", "qr-bs"];

class ErrorDeUso extends Error {}

/** El portero al que se le habla: https, o uno local para `wrangler dev`. Nunca otra cosa: la clave va en la cabecera. */
function baseDe(texto) {
  const b = String(texto ?? BASE_POR_DEFECTO).replace(/\/+$/, "");
  let u;
  try {
    u = new URL(b);
  } catch {
    throw new ErrorDeUso(`--base no es una dirección: ${b}`);
  }
  const local = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  if ((u.protocol !== "https:" && !local) || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new ErrorDeUso("--base tiene que ser https (o http://127.0.0.1 para wrangler dev), sin ruta");
  return `${u.protocol}//${u.host}`;
}

export function leerArgumentos(argv) {
  const [orden, ...resto] = argv;
  const opciones = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (!a.startsWith("--")) throw new ErrorDeUso(`no entiendo "${a}"`);
    const nombre = a.slice(2);
    if (nombre === "json") opciones.json = true;
    else {
      const v = resto[i + 1];
      if (v === undefined || v.startsWith("--")) throw new ErrorDeUso(`falta el valor de --${nombre}`);
      opciones[nombre] = v;
      i++;
    }
  }
  return { orden, opciones };
}

function entero(opciones, nombre, min, max, porDefecto) {
  const v = opciones[nombre];
  if (v === undefined && porDefecto !== undefined) return porDefecto;
  if (!/^\d{1,6}$/.test(String(v ?? ""))) throw new ErrorDeUso(`--${nombre} va como un número entero`);
  const n = Number(v);
  if (n < min || n > max) throw new ErrorDeUso(`--${nombre} va de ${min} a ${max}`);
  return n;
}

const AYUDA = `Uso:
  node scripts/cupones.mjs crear --lote <lote> --cantidad <1 a 500> --sorteos <1 a 50> --dias <1 a 365> --vence AAAA-MM-DD --salida <carpeta fuera del repositorio> [--usos 1]
  node scripts/cupones.mjs estado --lote <lote> [--json]
  node scripts/cupones.mjs anular --lote <lote>
  node scripts/cupones.mjs anular --codigo <código>
  node scripts/cupones.mjs admitir --cuenta G... --sorteos <1 a 500> --dias <1 a 3650> --ref <ref>
  node scripts/cupones.mjs dar --cuenta G... --sorteos <1 a 500> --dias <1 a 3650> --ref <ref>
  node scripts/cupones.mjs pagada --orden <orden> --metodo qr-bs|a-mano --ref <ref>
  node scripts/cupones.mjs sueltos [--json]
  node scripts/cupones.mjs asignar --operacion <operación> --orden <orden>
  node scripts/cupones.mjs devuelto --operacion <operación> --ref <ref>
La clave va en TINKAZO_CUPONES_TOKEN. --base cambia el portero (por defecto ${BASE_POR_DEFECTO}).`;

/**
 * Corre una orden. Devuelve el código de salida (0 bien, 1 mal). Todo lo de afuera entra como argumento, para probarlo
 * sin red: `fetch`, `env`, el reloj, dónde se escribe lo que se muestra y la raíz del repositorio.
 */
export async function ejecutar(argv, { fetch = globalThis.fetch, env = process.env, ahora = () => Date.now(), log = console.log, raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..") } = {}) {
  let escritos = [];
  try {
    const { orden, opciones } = leerArgumentos(argv);
    if (!["crear", "estado", "anular", "admitir", "dar", "pagada", "sueltos", "asignar", "devuelto"].includes(orden)) throw new ErrorDeUso(orden ? `no conozco la orden "${orden}"` : "falta la orden");
    const base = baseDe(opciones.base);
    const clave = String(env.TINKAZO_CUPONES_TOKEN ?? "");

    /** Un pedido al portero con la clave en la cabecera. Lanza con el estado y el motivo, nunca con la clave. */
    const pedir = async (metodo, ruta, cuerpo) => {
      if (clave.length < CLAVE_MINIMA) throw new ErrorDeUso("falta la clave de cupones: cargala en TINKAZO_CUPONES_TOKEN (no la pegues en el comando)");
      let res;
      try {
        res = await fetch(`${base}${ruta}`, {
          method: metodo,
          headers: { Authorization: `Bearer ${clave}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
          ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
          signal: AbortSignal.timeout(ESPERA_MS),
        });
      } catch {
        throw new Error(`no se pudo hablar con el portero (${base})`);
      }
      let j = null;
      try {
        j = await res.json();
      } catch {
        j = null;
      }
      if (!res.ok) {
        const motivo = j && typeof j.motivo === "string" ? j.motivo : "sin motivo";
        const extra = j && typeof j.detalle === "string" ? ` (${j.detalle})` : j && typeof j.que === "string" ? ` (${j.que})` : "";
        const pista = res.status === 401 ? ": la clave de TINKAZO_CUPONES_TOKEN no es la del portero" : res.status === 404 && motivo === "no-existe" ? ": el portero no tiene cargada la clave de cupones, o no es el de mainnet" : "";
        throw new Error(`el portero respondió ${res.status} ${motivo}${extra}${pista}`);
      }
      return j ?? {};
    };

    if (orden === "crear") {
      if (typeof opciones.lote !== "string" || !FORMA_LOTE.test(opciones.lote)) throw new ErrorDeUso("--lote va en minúsculas, números y guiones (space-apps-14nov)");
      const lote = opciones.lote;
      const cantidad = entero(opciones, "cantidad", 1, 500);
      const sorteos = entero(opciones, "sorteos", 1, MAX_SORTEOS_POR_CUPON);
      const dias = entero(opciones, "dias", 1, 365);
      const usos = entero(opciones, "usos", 1, 500, 1);
      let vence;
      try {
        vence = venceDe(opciones.vence);
      } catch (e) {
        throw new ErrorDeUso(`--vence: ${e.message}`);
      }
      if (vence <= ahora()) throw new ErrorDeUso("--vence ya pasó");
      if (!opciones.salida) throw new ErrorDeUso("falta --salida: una carpeta fuera del repositorio");
      const salida = resolve(opciones.salida);
      if (dentroDeUnRepo(salida, raicesProtegidas(raiz))) throw new ErrorDeUso(`--salida tiene que estar fuera del repositorio (y de cualquier repositorio de git): ${salida}`);
      if (clave.length < CLAVE_MINIMA) throw new ErrorDeUso("falta la clave de cupones: cargala en TINKAZO_CUPONES_TOKEN (no la pegues en el comando)");
      const csv = join(salida, `${lote}.csv`);
      const html = join(salida, `${lote}-tarjetas.html`);
      for (const f of [csv, html]) if (existsSync(f)) throw new ErrorDeUso(`ya existe ${f}: no se pisa un lote (usá otro nombre o movelo)`);

      const codigos = generarCodigos(cantidad);
      mkdirSync(salida, { recursive: true });
      writeFileSync(csv, csvDe(codigos), { flag: "wx" });
      escritos.push(csv);
      writeFileSync(html, tarjetasHtml({ lote, codigos, sorteos, vence, usos }), { flag: "wx" });
      escritos.push(html);
      const r = await pedir("POST", "/v1/admin/cupones", { lote, codigos, sorteos, dias, vence, usos });
      escritos = [];
      log(`Lote ${lote}: ${r.creados} cupones creados${r.repetidos ? `, ${r.repetidos} repetidos` : ""}, con ${sorteos} sorteos para ${dias} días.`);
      log(`Tarjetas: ${html}`);
      log(`Códigos y enlaces: ${csv}`);
      if (r.creados !== cantidad) {
        log("Atención: el portero no creó todos los códigos. No imprimas este lote: anulalo y crealo de nuevo.");
        return 1;
      }
      return 0;
    }

    if (orden === "estado") {
      if (typeof opciones.lote !== "string" || !FORMA_LOTE.test(opciones.lote)) throw new ErrorDeUso("--lote va en minúsculas, números y guiones");
      const e = await pedir("GET", `/v1/admin/cupones?lote=${encodeURIComponent(opciones.lote)}`);
      if (opciones.json) {
        log(JSON.stringify(e, null, 2));
        return 0;
      }
      const f = enBolivia(Number(e.vence));
      log(`Lote ${e.lote}`);
      log(`  creados: ${e.creados}, canjeados: ${e.canjeados}, cuentas: ${e.cuentas}, sorteos usados: ${e.sorteosUsados}`);
      log(`  se canjea hasta el ${f.d} de ${MESES_ES[f.mes]} de ${f.a}, ${String(f.h).padStart(2, "0")}:${String(f.min).padStart(2, "0")} de Bolivia`);
      log(`  anulado: ${e.anulado ? "sí" : "no"} (${e.anulados ?? 0} anulados)`);
      return 0;
    }

    if (orden === "anular") {
      if ((opciones.lote === undefined) === (opciones.codigo === undefined)) throw new ErrorDeUso("anular va con --lote o con --codigo, uno solo");
      let cuerpo;
      if (opciones.lote !== undefined) {
        if (!FORMA_LOTE.test(opciones.lote)) throw new ErrorDeUso("--lote va en minúsculas, números y guiones");
        cuerpo = { lote: opciones.lote };
      } else {
        const c = normalizar(opciones.codigo);
        if (!c) throw new ErrorDeUso("--codigo no es un código de cupón (12 caracteres)");
        cuerpo = { codigo: c };
      }
      const r = await pedir("POST", "/v1/admin/cupones/anular", cuerpo);
      log(`Anulados: ${r.anulados}. Lo ya canjeado sigue valiendo.`);
      return 0;
    }

    /** La ref de lo que se hace a mano: lo que lo explica (un comprobante, una venta). */
    const ref = () => {
      if (typeof opciones.ref !== "string" || !FORMA_REF.test(opciones.ref)) throw new ErrorDeUso("--ref va con letras, números, puntos, guiones o guiones bajos, hasta 64");
      return opciones.ref;
    };
    const operacion = () => {
      if (typeof opciones.operacion !== "string" || !FORMA_OPERACION.test(opciones.operacion)) throw new ErrorDeUso("--operacion va como el número de la operación que muestra sueltos");
      return opciones.operacion;
    };
    const ordenDe = () => {
      const id = normalizarOrden(opciones.orden);
      if (!id) throw new ErrorDeUso("--orden va como el id de la orden, 8 caracteres (ABCD2345 o tk:o:ABCD2345)");
      return id;
    };

    if (orden === "admitir" || orden === "dar") {
      if (typeof opciones.cuenta !== "string" || !FORMA_CUENTA.test(opciones.cuenta)) throw new ErrorDeUso("--cuenta va como una cuenta de Stellar (G...)");
      const sorteos = entero(opciones, "sorteos", 1, 500);
      const dias = entero(opciones, "dias", 1, 3650);
      const cuerpo = { cuenta: opciones.cuenta, sorteos, dias, ref: ref() };
      if (orden === "dar") {
        // Solo a una cuenta que ya está en el libro: si no, el portero contesta 409 fuera-del-libro (usá admitir).
        const r = await pedir("POST", "/v1/admin/derechos", cuerpo);
        log(r.repetido ? `Esa ref ya se había usado: no se sumó nada. Le quedan ${r.sorteos?.quedan} sorteos.` : `Sumados ${sorteos} sorteos para ${dias} días. Le quedan ${r.sorteos?.quedan} sorteos.`);
        return 0;
      }
      const r = await pedir("POST", "/v1/admin/altas", cuerpo);
      log(r.repetido ? `Esa ref ya se había dado a esta cuenta: no se sumó nada. Le quedan ${r.sorteos?.quedan} sorteos.` : `Cuenta admitida${r.altaNueva ? "" : " (ya estaba en el libro)"}: ${sorteos} sorteos para ${dias} días. Le quedan ${r.sorteos?.quedan} sorteos.`);
      return 0;
    }

    if (orden === "pagada") {
      const id = ordenDe();
      if (!METODOS_PAGADA.includes(opciones.metodo)) throw new ErrorDeUso("--metodo va como qr-bs (cobro en bolivianos por QR) o a-mano");
      const r = await pedir("POST", "/v1/admin/ordenes/pagada", { orden: id, metodo: opciones.metodo, ref: ref() });
      log(r.repetido ? `La orden ${id} ya estaba pagada: no se sumó nada.` : `Orden ${id} pagada (${opciones.metodo}): la persona ya tiene sus sorteos.`);
      return 0;
    }

    if (orden === "sueltos") {
      const r = await pedir("GET", "/v1/admin/sueltos");
      const sueltos = Array.isArray(r.sueltos) ? r.sueltos : [];
      const parciales = Array.isArray(r.parciales) ? r.parciales : [];
      if (opciones.json) {
        log(JSON.stringify(r, null, 2));
        return 0;
      }
      if (r.horizon === false) log("Horizon no contestó: esto es lo que ya se sabía, sin los pagos más nuevos.");
      const cuandoDe = (ms) => {
        const f = enBolivia(Number(ms));
        return `${f.d} de ${MESES_ES[f.mes]}, ${String(f.h).padStart(2, "0")}:${String(f.min).padStart(2, "0")}`;
      };
      if (!sueltos.length) log("No hay pagos sueltos sin resolver.");
      else {
        log(`${sueltos.length} pagos sueltos sin resolver (para devolver, a mano desde la cuenta de cobros):`);
        for (const p of sueltos) {
          log(`  operación ${p.operacion}: ${p.cantidad} ${p.activo}, ${p.motivo}${p.nota ? `, nota "${visible(p.nota)}"` : ""}${p.orden ? `, orden ${p.orden}` : ""}, ${cuandoDe(p.ms)}`);
          log(`    de ${visible(p.de)}, transacción ${visible(p.tx)}`);
        }
      }
      if (parciales.length) {
        log(`${parciales.length} órdenes pagadas a medias (se completan con la misma nota, se marcan con pagada o se devuelve lo recibido):`);
        for (const o of parciales) log(`  orden ${o.id} (${o.producto}): llegaron ${o.recibido} de ${o.total} USDC, falta llegar a ${o.minimo}; ${o.vencida ? "venció" : "vence"} el ${cuandoDe(o.vence)}`);
      }
      return 0;
    }

    if (orden === "asignar") {
      const cuerpo = { operacion: operacion(), orden: ordenDe() };
      const r = await pedir("POST", "/v1/admin/sueltos/asignar", cuerpo);
      log(`Operación ${cuerpo.operacion} asignada a la orden ${cuerpo.orden}: ${r.pagada ? "la orden quedó pagada" : "la orden todavía no llega al mínimo"}.${r.sobrante && r.sobrante !== "0" ? ` Sobran ${r.sobrante}: quedan en sueltos para devolver.` : ""}`);
      return 0;
    }

    // devuelto
    const cuerpo = { operacion: operacion(), devuelto: true, ref: ref() };
    const r = await pedir("POST", "/v1/admin/sueltos/asignar", cuerpo);
    log(r.repetido ? `La operación ${cuerpo.operacion} ya estaba marcada como devuelta.` : `Operación ${cuerpo.operacion} marcada como devuelta. La devolución la manda a mano quien tiene la llave de la cuenta de cobros.`);
    return 0;
  } catch (e) {
    // Lo escrito de un lote que el portero no creó se borra: esos códigos no valen.
    for (const f of escritos) {
      try {
        unlinkSync(f);
      } catch {
        // Si no se puede borrar, se avisa abajo.
      }
    }
    if (escritos.length) log(`Se borraron las tarjetas y el CSV: el portero no creó el lote.${escritos.some((f) => existsSync(f)) ? " Quedaron archivos sin borrar: no los imprimas." : ""}`);
    log(`Error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof ErrorDeUso) log(AYUDA);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await ejecutar(process.argv.slice(2));
}
