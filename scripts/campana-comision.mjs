#!/usr/bin/env node
/**
 * Dice cuánto cobra Tinkazo a una campaña de empresa y si ya se pagó, mirando la red. Es para quien activa campañas: sin llaves,
 * sin escribir nada y sin leer archivos de entorno.
 *
 *   node scripts/campana-comision.mjs <archivo de campaña> [opciones]
 *
 * El archivo es el firmado (`{ texto, firma }`, se toma `texto`) o la campaña suelta. Lo que no viene por opción sale del
 * entorno (`VITE_COMISION_PB`, `VITE_COMISION_MINIMO`, `VITE_COMISION_CUENTA`, `VITE_RETIRO_COSTO`, `VITE_RETIRO_CUENTA`,
 * `VITE_PATROCINIO_URL_MAINNET`): sirve con `node --env-file=...`.
 *
 *   --pb 200            Los puntos básicos del total de los premios (200 es el 2 %).
 *   --minimo 1.50       Lo menos que se cobra, en dólares digitales.
 *   --costo 0.50        El costo del retiro por el que viaja el cobro.
 *   --cuenta G...       La cuenta de Tinkazo que recibe el cobro.
 *   --cobros G...       La cuenta de cobros del retiro.
 *   --portero <url>     El servicio de comisiones, para comprobar que atienda retiros con ese costo.
 *   --sitio <url>       Lee <url>/comision.json (lo que publica el build) y sale con 1 si no coincide con lo que se le pasó.
 *   --sin-red           Solo el cálculo: no pregunta nada a la red.
 *   --json              La salida como JSON.
 *
 * Salida: 0 pagada, 3 sin pagar, 2 no se pudo mirar, 1 uso o archivo malo o que no coincide con el sitio, 4 solo el cálculo
 * (`--sin-red`, que nunca se confunde con pagada).
 *
 * El informe dice cada pago que cuenta (hash, monto, fecha y de quién), la suma y lo que se pagó de más, para poder devolverlo,
 * y avisa si el evento ya tenía pagos de antes de esta campaña (un evento repetido hereda los pagos anteriores). Dice también
 * tres cosas que rompen el día: si la cuenta que recibe existe con la línea del dólar digital, si el servicio de comisiones
 * atiende retiros con ese costo, y si la cuenta de quien organiza tiene los premios más el cobro. Y deja el enlace de pago y su
 * código para el plan B: pagar el cobro desde otra billetera.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SALIDA = { pagada: 0, uso: 1, noSePudo: 2, sinPagar: 3, soloCalculo: 4 };

const HORIZON = "https://horizon.stellar.org";
const ES_CUENTA = /^G[A-Z2-7]{55}$/;

/** Las opciones que lleva cada bandera, y las variables del entorno de donde salen cuando no vienen. */
const DEL_ENTORNO = {
  pb: "VITE_COMISION_PB",
  minimo: "VITE_COMISION_MINIMO",
  cuenta: "VITE_COMISION_CUENTA",
  costo: "VITE_RETIRO_COSTO",
  cobros: "VITE_RETIRO_CUENTA",
  portero: "VITE_PATROCINIO_URL_MAINNET",
};

/** Lee los argumentos. Devuelve las opciones o `{ error }` con lo que está mal, sin escribir ningún valor. */
export function leerOpciones(argv, env = {}) {
  const o = { archivo: null, sinRed: false, json: false, sitio: null };
  const conValor = new Set(["--pb", "--minimo", "--costo", "--cuenta", "--cobros", "--portero", "--sitio"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sin-red") o.sinRed = true;
    else if (a === "--json") o.json = true;
    else if (conValor.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { error: `a ${a} le falta el valor` };
      o[a.slice(2)] = v;
    } else if (a.startsWith("--")) return { error: `no conozco la opción ${a}` };
    else if (o.archivo === null) o.archivo = a;
    else return { error: "se espera un solo archivo" };
  }
  if (o.archivo === null) return { error: "falta el archivo de la campaña" };
  for (const [nombre, variable] of Object.entries(DEL_ENTORNO)) {
    if (o[nombre] === undefined || o[nombre] === "") o[nombre] = env[variable] ?? "";
  }
  return o;
}

/** La campaña del archivo: el firmado (`{ texto, firma }`) o la campaña suelta. `null` si no es un JSON. */
export function leerArchivo(crudo) {
  let x;
  try {
    x = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (x && typeof x === "object" && typeof x.texto === "string" && typeof x.firma === "string") {
    try {
      return JSON.parse(x.texto);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" ? x : null;
}

const dolares = (m) => `${m / 10_000_000n},${(m % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "").padEnd(2, "0")}`;
const fecha = (s) => new Date(s * 1000).toISOString().replace(".000Z", "Z");

/** Pide un JSON a Horizon. `null` si no contesta, `"no-existe"` con un 404. */
async function horizon(fetchF, ruta) {
  try {
    const r = await fetchF(`${HORIZON}${ruta}`, { signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) return "no-existe";
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** La línea del dólar digital de una cuenta (lo que Horizon dice de `balances`), o `null`. */
function lineaDelDolar(cuenta, usdc) {
  const balances = Array.isArray(cuenta?.balances) ? cuenta.balances : [];
  return balances.find((b) => b.asset_type === "credit_alphanum4" && b.asset_code === usdc.code && b.asset_issuer === usdc.issuer) ?? null;
}

const stroopsDe = (texto) => {
  const m = /^(\d{1,13})(?:\.(\d{1,7}))?$/.exec(String(texto));
  return m ? BigInt(m[1]) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0")) : null;
};

/** Los números de la configuración, leídos con los mismos lectores que el sitio. Lanza con la variable que está mal, sin su valor. */
function leerConfiguracion(config, m) {
  const pb = m.config.leerPb(config.pb);
  const minimo = m.config.leerMinimo(config.minimo);
  const costo = m.retiro.leerElCosto(config.costo);
  const cuenta = m.retiro.leerLaCuenta(config.cuenta);
  const cobros = m.retiro.leerLaCuenta(config.cobros);
  if (pb.tipo !== "valido") throw new Error("los puntos básicos no están o están mal escritos (un entero de 1 a 1000)");
  if (minimo.tipo !== "valido") throw new Error("el mínimo no está o está mal escrito (dólares con punto y hasta 2 decimales)");
  if (costo.tipo !== "valido" || costo.stroops === 0n) throw new Error("el costo del retiro no está o está mal escrito");
  if (cuenta.tipo !== "valida") throw new Error("la cuenta que recibe no está o no es una dirección válida");
  if (cobros.tipo !== "valida") throw new Error("la cuenta de cobros no está o no es una dirección válida");
  if (cuenta.cuenta === cobros.cuenta) throw new Error("la cuenta que recibe no puede ser la de cobros");
  if (minimo.valor < m.config.minimoPosible(costo.stroops)) throw new Error("el mínimo no alcanza para el camino del retiro (el costo más 1 dólar)");
  return { pb: pb.valor, minimo: minimo.valor, costo: costo.stroops, cuenta: cuenta.cuenta, cobros: cobros.cuenta };
}

/**
 * Arma el informe de una campaña. `datos` es la campaña (el texto firmado, ya leído); `config` las opciones de `leerOpciones`;
 * `modulos` son los de `src` que comparten el sitio y el guion (`comision`, `red`, `config`, `retiro`, `pagos`, `portero`).
 * `fetch` se pasa aparte para probarlo sin red. Lanza con lo que está mal en el archivo o en la configuración.
 */
export async function informeDeComision(datos, config, { fetch: fetchF = fetch, modulos: m, sinRed = false }) {
  const campana = m.comision.loQueCobra(datos);
  if (campana === null) throw new Error("el archivo no tiene la forma de una campaña (evento, premios y apertura)");
  const c = leerConfiguracion(config, m);
  const total = m.comision.totalDePremios(campana.premios);
  const comision = m.comision.comisionDe(campana.premios, c.pb, c.minimo);
  const umbral = m.comision.umbralPagado(comision, c.costo);
  const nota = m.comision.notaDeLaComision(campana.evento);
  const enlace = m.comision.enlaceDePago(c.cuenta, comision, nota, m.pagos.USDC_MAINNET);
  const informe = {
    evento: campana.evento,
    premios: total,
    porcentaje: m.comision.porcentajeEnTexto(c.pb, "es"),
    minimo: c.minimo,
    comision,
    aCargar: total + comision,
    nota,
    llegaALaCuenta: umbral,
    costoALosCobros: c.costo,
    cuenta: c.cuenta,
    enlace,
    estado: "solo-calculo",
    suma: 0n,
    excedente: 0n,
    pagos: [],
    deAntes: [],
    comprobaciones: { cuentaQueRecibe: { estado: "sin-mirar" }, servicio: { estado: "sin-mirar" }, organizadora: { estado: "sin-mirar" } },
  };
  if (sinRed) return informe;

  // Los pagos que cuentan, de lo que recibió la cuenta de Tinkazo.
  const busqueda = { cuenta: c.cuenta, nota, desde: Math.floor(campana.abreMs / 1000) - 30 * 86_400 };
  const lista = await m.red.listarLosPagosDeLaComision(busqueda, { fetch: fetchF });
  informe.pagos = lista.pagos;
  informe.suma = lista.pagos.reduce((a, p) => a + p.monto, 0n);
  informe.excedente = informe.suma > umbral ? informe.suma - umbral : 0n;
  informe.deAntes = lista.pagos.filter((p) => p.cuando * 1000 < campana.abreMs);
  informe.estado = informe.suma >= umbral ? "pagada" : lista.completa ? "sin-pagar" : "sin-mirar";

  // Lo que rompe el día: tres comprobaciones con su salida propia.
  const usdc = m.pagos.USDC_MAINNET;
  const recibe = await horizon(fetchF, `/accounts/${c.cuenta}`);
  if (recibe === "no-existe") informe.comprobaciones.cuentaQueRecibe = { estado: "no-existe" };
  else if (recibe !== null) {
    const linea = lineaDelDolar(recibe, usdc);
    informe.comprobaciones.cuentaQueRecibe = { estado: linea === null ? "sin-linea" : linea.is_authorized === false ? "sin-autorizar" : "lista" };
  }
  const organizadora = typeof datos.organizadora === "string" && ES_CUENTA.test(datos.organizadora) ? datos.organizadora : null;
  if (config.portero === "" || organizadora === null) {
    informe.comprobaciones.servicio = { estado: organizadora === null ? "sin-cuenta-organizadora" : "sin-direccion" };
  } else {
    const l = await m.portero.mirarPagos(config.portero.replace(/\/+$/, ""), organizadora, { fetch: fetchF });
    informe.comprobaciones.servicio =
      l.tipo === "sin-respuesta"
        ? { estado: "sin-mirar" }
        : l.tipo === "pagos" && l.pagos.retiro && l.pagos.costoRetiro === c.costo
          ? { estado: "atiende" }
          : { estado: "no-atiende" };
  }
  if (organizadora === null) informe.comprobaciones.organizadora = { estado: "sin-cuenta-organizadora" };
  else {
    const cuenta = await horizon(fetchF, `/accounts/${organizadora}`);
    if (cuenta === "no-existe") informe.comprobaciones.organizadora = { estado: "no-existe" };
    else if (cuenta !== null) {
      const saldo = stroopsDe(lineaDelDolar(cuenta, usdc)?.balance ?? "0") ?? 0n;
      const falta = informe.aCargar > saldo ? informe.aCargar - saldo : 0n;
      informe.comprobaciones.organizadora = { estado: falta === 0n ? "alcanza" : "falta", saldo, falta };
    }
  }
  return informe;
}

/** Compara lo que se le pasó al guion con lo que publica el build del sitio (`/comision.json`). Devuelve las diferencias. */
export async function compararConElSitio(config, sitio, m, fetchF = fetch) {
  const url = `${sitio.replace(/\/+$/, "")}/comision.json`;
  let publicado;
  try {
    const r = await fetchF(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [`el sitio no publica comision.json (código ${r.status})`];
    publicado = await r.json();
  } catch {
    return ["no se pudo leer comision.json del sitio"];
  }
  const c = leerConfiguracion(config, m);
  const propio = { pb: String(c.pb), minimo: String(c.minimo), cuenta: c.cuenta, costo: String(c.costo) };
  return Object.entries(propio)
    .filter(([k, v]) => publicado?.[k] !== v)
    .map(([k]) => `${k}: lo que calcula el guion no es lo que publica el sitio`);
}

const ESTADOS = {
  pagada: "PAGADA",
  "sin-pagar": "SIN PAGAR",
  "sin-mirar": "NO SE PUDO MIRAR",
  "solo-calculo": "SOLO EL CÁLCULO, NO SE MIRÓ LA RED",
};
const COMPROBACIONES = {
  cuentaQueRecibe: {
    titulo: "La cuenta que recibe",
    lista: "lista (existe y tiene la línea del dólar digital)",
    "no-existe": "NO EXISTE: no se puede pagar",
    "sin-linea": "SIN LA LÍNEA DEL DÓLAR DIGITAL: no se puede pagar",
    "sin-autorizar": "LA LÍNEA NO ESTÁ AUTORIZADA: no se puede pagar",
  },
  servicio: {
    titulo: "El servicio de comisiones",
    atiende: "atiende retiros con ese costo",
    "no-atiende": "NO ATIENDE retiros con ese costo: solo anda el pago desde otra billetera",
    "sin-direccion": "sin la dirección del servicio (--portero): no se comprobó",
    "sin-cuenta-organizadora": "el archivo no trae la cuenta de quien organiza: no se comprobó",
  },
  organizadora: {
    titulo: "La cuenta de quien organiza",
    alcanza: "tiene los premios más el cobro",
    "no-existe": "NO EXISTE",
    "sin-cuenta-organizadora": "el archivo no trae esa cuenta: no se comprobó",
  },
};

/** El informe en palabras, para leer en la terminal. */
export function textoDelInforme(i, codigoQr = null) {
  const L = [];
  L.push(`Evento: ${i.evento}`);
  L.push(`Premios: ${dolares(i.premios)}`);
  L.push(`Cobro: ${dolares(i.comision)} (${i.porcentaje}, con un mínimo de ${dolares(i.minimo)})`);
  L.push(`La empresa carga en total: ${dolares(i.aCargar)}`);
  L.push(`Nota: ${i.nota}`);
  L.push(`A la cuenta que cobra llegan: ${dolares(i.llegaALaCuenta)}, y ${dolares(i.costoALosCobros)} a la de cobros`);
  L.push(`Estado: ${ESTADOS[i.estado]}`);
  if (i.estado !== "solo-calculo") {
    L.push(`Pagos que cuentan: ${i.pagos.length}, suman ${dolares(i.suma)}`);
    for (const p of i.pagos) L.push(`  ${p.hash}  ${dolares(p.monto)}  ${fecha(p.cuando)}  de ${p.de}`);
    if (i.excedente > 0n) L.push(`Se pagó de más: ${dolares(i.excedente)}. Es lo que se devuelve.`);
    if (i.deAntes.length > 0) {
      L.push(`AVISO: ${i.deAntes.length} pago(s) con esta nota son de antes de abrirse esta campaña. Un evento repetido hereda los pagos anteriores:`);
      L.push("  el ensayo y la campaña del día llevan eventos distintos.");
    }
    for (const [k, def] of Object.entries(COMPROBACIONES)) {
      const c = i.comprobaciones[k];
      let dicho = def[c.estado] ?? "no se pudo mirar";
      if (k === "organizadora" && c.estado === "falta") dicho = `le faltan ${dolares(c.falta)} (tiene ${dolares(c.saldo)})`;
      L.push(`${def.titulo}: ${dicho}`);
    }
  }
  L.push("Plan B, pagar desde otra billetera:");
  L.push(`  ${i.enlace}`);
  if (codigoQr) L.push(codigoQr);
  return L.join("\n");
}

/** El código del enlace, para dibujarlo en la terminal. `null` si la biblioteca no está. */
async function codigoEnTexto(enlace) {
  try {
    const { default: qrcode } = await import("qrcode-generator");
    const qr = qrcode(0, "L");
    qr.addData(enlace);
    qr.make();
    return qr.createASCII(1, 2);
  } catch {
    return null;
  }
}

/** El código con que sale el guion según el informe. */
export function codigoDeSalida(informe) {
  if (informe.estado === "pagada") return SALIDA.pagada;
  if (informe.estado === "sin-pagar") return SALIDA.sinPagar;
  if (informe.estado === "sin-mirar") return SALIDA.noSePudo;
  return SALIDA.soloCalculo;
}

/** Carga los archivos de `src` que comparten el sitio y el guion, con el cargador de Vite como los otros guiones. */
async function cargarModulos() {
  const { runnerImport } = await import("vite");
  const cargar = async (ruta) => (await runnerImport(fileURLToPath(new URL(ruta, import.meta.url)), { configFile: false, logLevel: "silent" })).module;
  const [comision, red, config, retiro, pagos, portero] = await Promise.all([
    cargar("../src/campana/comision.ts"),
    cargar("../src/campana/comision-red.ts"),
    cargar("../src/stellar/comision-config.ts"),
    cargar("../src/stellar/retiro-config.ts"),
    cargar("../src/stellar/pagos.ts"),
    cargar("../src/stellar/pago-portero.ts"),
  ]);
  return { comision, red, config, retiro, pagos, portero };
}

const aTexto = (x) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

async function principal() {
  const o = leerOpciones(process.argv.slice(2), process.env);
  if (o.error) {
    console.error(`${o.error}. Uso: node scripts/campana-comision.mjs <archivo de campaña> [--pb N] [--minimo X] [--costo X] [--cuenta G...] [--cobros G...] [--portero url] [--sitio url] [--sin-red] [--json]`);
    return SALIDA.uso;
  }
  let datos;
  try {
    datos = leerArchivo(readFileSync(resolve(o.archivo), "utf8"));
  } catch {
    console.error("no se pudo leer el archivo");
    return SALIDA.uso;
  }
  if (datos === null) {
    console.error("el archivo no es una campaña (JSON)");
    return SALIDA.uso;
  }
  const modulos = await cargarModulos();
  try {
    if (o.sitio) {
      const diferencias = await compararConElSitio(o, o.sitio, modulos);
      if (diferencias.length > 0) {
        for (const d of diferencias) console.error(d);
        return SALIDA.uso;
      }
    }
    const informe = await informeDeComision(datos, o, { modulos, sinRed: o.sinRed });
    if (o.json) console.log(aTexto(informe));
    else console.log(textoDelInforme(informe, await codigoEnTexto(informe.enlace)));
    return codigoDeSalida(informe);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "no se pudo armar el informe");
    return SALIDA.uso;
  }
}

const directo = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directo) process.exitCode = await principal();
