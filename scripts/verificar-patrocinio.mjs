#!/usr/bin/env node
/**
 * Que la red diga quién pagó la comisión.
 *
 * Dado el hash de un sello o de un sorteo, lee Horizon y dice si la transacción
 * la patrocinó otra cuenta (la billetera de la app, dentro de un fee-bump) o la
 * pagó la propia cuenta de quien firmó. No se le cree al panel de nadie: se lee
 * lo que quedó escrito en la cadena.
 *
 * Uso:
 *   node scripts/verificar-patrocinio.mjs <hash> [<hash> …] [opciones]
 *
 * Opciones:
 *   --red testnet|mainnet   La red (por defecto testnet).
 *   --cuenta G…             La cuenta del organizador. Muestra su saldo, cuántas
 *                           entradas le patrocinan y sus operaciones, y avisa si
 *                           alguna vez recibió fondos: ahí la prueba de 0 XLM
 *                           queda anulada.
 *   --billetera G…          La billetera que paga (la de la app). Muestra su saldo
 *                           de hoy: corré el guion con solo esta opción ANTES de
 *                           probar para anotar el saldo de antes.
 *   --antes <XLM>           El saldo de antes de la billetera. Comprueba, al
 *                           stroop, que lo que bajó son exactamente las comisiones
 *                           de los hashes (más 0,00003 XLM si en el medio se abrió
 *                           una cuenta nueva). Pide --billetera y algún hash.
 *   --espero-patrocinada    Falla si alguna transacción no está patrocinada. Es lo
 *                           que se espera por defecto.
 *   --espero-propia         El control negativo: falla si alguna transacción NO la
 *                           pagó su propia cuenta (por ejemplo, con la regla de
 *                           patrocinio apagada).
 *   --ayuda                 Esta ayuda.
 *
 * Sale con código 1 si alguna transacción no es lo esperado o si la prueba de
 * 0 XLM se anuló, y con 2 si los argumentos están mal. Sin dependencias: Node 22
 * y `fetch`.
 *
 * Ejemplos:
 *   # El saldo de antes de la billetera de la app:
 *   node scripts/verificar-patrocinio.mjs --billetera GAYWGZ4P…DGKU
 *   # Después de sellar y sortear con una cuenta nueva y sin XLM:
 *   node scripts/verificar-patrocinio.mjs <hash del sello> <hash del sorteo> \
 *     --cuenta G…ORGANIZADOR --billetera GAYWGZ4P…DGKU --antes 9999.9997600
 */

import {
  HORIZON,
  STROOPS_POR_ALTA,
  aStroops,
  aXlm,
  analizarCuenta,
  analizarTransaccion,
  cotejarBilletera,
  cumpleLoEsperado,
} from "./lib/patrocinio.mjs";

const AYUDA = `Que la red diga quién pagó la comisión.

  node scripts/verificar-patrocinio.mjs <hash> [<hash> …] [--red testnet|mainnet]
      [--cuenta G…] [--billetera G…] [--antes <XLM>] [--espero-patrocinada | --espero-propia]

  <hash>               el hash de un sello o de un sorteo (el de adentro o el del fee-bump)
  --red                testnet (por defecto) o mainnet
  --cuenta G…          la cuenta del organizador: saldo, entradas patrocinadas y si alguna vez recibió fondos
  --billetera G…       la billetera que paga: su saldo de hoy (corré el guion solo con esta opción antes de probar)
  --antes <XLM>        el saldo de antes de la billetera: comprueba al stroop que bajó lo que cuestan los hashes
  --espero-patrocinada falla si alguna transacción no está patrocinada (por defecto)
  --espero-propia      el control negativo: falla si alguna transacción NO la pagó su propia cuenta
  --ayuda              esta ayuda

Sale con 1 si algo no es lo esperado o la prueba de 0 XLM se anuló, y con 2 si los argumentos están mal.
`;

/* --------------------------------------------------------------- argumentos */

const HASH = /^[0-9a-f]{64}$/i;
const DIRECCION = /^G[A-Z2-7]{55}$/;

class ErrorDeUso extends Error {}

/** Lee los argumentos. Lanza `ErrorDeUso` con lo que hay que corregir. */
function leerArgumentos(argv) {
  const o = { hashes: [], red: "testnet", cuenta: null, billetera: null, antes: null, espero: null, ayuda: false };
  const valores = new Set(["--red", "--cuenta", "--billetera", "--antes"]);
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let valor = null;
    const igual = /^(--[a-z-]+)=(.*)$/.exec(arg);
    if (igual) {
      arg = igual[1];
      valor = igual[2];
    }
    if (arg === "--ayuda" || arg === "-h" || arg === "--help") o.ayuda = true;
    else if (arg === "--espero-patrocinada" || arg === "--espero-propia") {
      const que = arg === "--espero-propia" ? "propia" : "patrocinada";
      if (o.espero && o.espero !== que) throw new ErrorDeUso("--espero-patrocinada y --espero-propia no van juntas");
      o.espero = que;
    } else if (valores.has(arg)) {
      if (valor === null) valor = argv[++i];
      if (valor === undefined || valor.startsWith("--")) throw new ErrorDeUso(`${arg} necesita un valor`);
      o[arg.slice(2)] = valor;
    } else if (arg.startsWith("-")) {
      throw new ErrorDeUso(`no conozco la opción ${arg} (probá con --ayuda)`);
    } else {
      if (!HASH.test(arg)) throw new ErrorDeUso(`"${arg}" no es un hash de transacción (64 caracteres en hexadecimal)`);
      if (!o.hashes.includes(arg.toLowerCase())) o.hashes.push(arg.toLowerCase());
    }
  }
  if (o.ayuda) return o;
  o.espero ??= "patrocinada";
  if (!(o.red in HORIZON)) throw new ErrorDeUso(`--red tiene que ser testnet o mainnet, no "${o.red}"`);
  for (const campo of ["cuenta", "billetera"]) {
    if (o[campo] !== null && !DIRECCION.test(o[campo])) throw new ErrorDeUso(`--${campo} tiene que ser una dirección que empiece con G (56 caracteres)`);
  }
  if (o.antes !== null) {
    try {
      o.antes = aStroops(o.antes);
    } catch (e) {
      throw new ErrorDeUso(`--antes: ${e.message}`);
    }
    if (o.billetera === null) throw new ErrorDeUso("--antes necesita --billetera");
    if (o.hashes.length === 0) throw new ErrorDeUso("--antes necesita al menos un hash, para sumar sus comisiones");
  }
  if (o.hashes.length === 0 && o.cuenta === null && o.billetera === null) {
    throw new ErrorDeUso("falta qué comprobar: uno o más hashes, o --cuenta, o --billetera");
  }
  return o;
}

/* --------------------------------------------------------------------- red */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `GET` a Horizon. Devuelve `{ estado, cuerpo }`: un 404 no es un error (es la
 * respuesta de "no existe") y vuelve con `cuerpo: null`. Reintenta hasta tres
 * veces ante un corte, un 429 o un 5xx, que en Horizon pasan.
 */
async function pedir(url) {
  let ultimo = null;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      if (res.status === 404) return { estado: 404, cuerpo: null };
      if (res.ok) return { estado: res.status, cuerpo: await res.json() };
      ultimo = new Error(`Horizon contestó ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      ultimo = e;
    }
    if (intento < 3) await dormir(1000 * intento);
  }
  throw new Error(`${ultimo?.message ?? "sin respuesta"} (${url})`);
}

/** Todas las operaciones de la cuenta, de la más vieja a la más nueva, página por página. */
async function operacionesDe(base, cuenta) {
  const todas = [];
  let url = `${base}/accounts/${cuenta}/operations?order=asc&limit=200`;
  let truncadas = false;
  for (let pagina = 0; url; pagina++) {
    if (pagina >= 10) {
      truncadas = true;
      break;
    }
    const { cuerpo } = await pedir(url);
    const registros = cuerpo?._embedded?.records ?? [];
    todas.push(...registros);
    url = registros.length >= 200 ? (cuerpo._links?.next?.href ?? null) : null;
  }
  return { operaciones: todas, truncadas };
}

/* ----------------------------------------------------------------- salida */

let fallos = 0;
const bien = (texto) => console.log(`  ✓ ${texto}`);
const mal = (texto) => {
  fallos++;
  console.log(`  ✗ ${texto}`);
};
const dato = (texto) => console.log(`      ${texto}`);
const stroopsYXlm = (s) => `${s} stroops = ${aXlm(s)} XLM`;

/* ------------------------------------------------------------ transacciones */

/** Lee una transacción, dice qué pasó y devuelve su análisis (o `null` si no se pudo leer). */
async function revisarTransaccion(base, hash, o) {
  console.log(`\n${hash}`);
  let resp;
  try {
    resp = (await pedir(`${base}/transactions/${hash}`)).cuerpo;
  } catch (e) {
    mal(`no pude leer Horizon: ${e.message}`);
    return null;
  }
  if (!resp) {
    mal("no existe en esta red (¿el hash está mal, es de la otra red, o todavía no llegó? Probá de nuevo en unos segundos)");
    return null;
  }
  let a;
  try {
    a = analizarTransaccion(resp);
  } catch (e) {
    mal(`la respuesta de Horizon no sirve: ${e.message}`);
    return null;
  }

  const donde = `ledger ${a.ledger}${a.creada ? ` · ${a.creada}` : ""}`;
  if (a.exitosa) bien(`existe y fue exitosa · ${donde}`);
  else mal(`existe pero NO fue exitosa · ${donde}`);
  dato(a.esFeeBump ? `fee-bump: sí (hash de afuera ${a.hashDeAfuera}, hash de adentro ${a.hashDeAdentro})` : "fee-bump: no");
  dato(`pagó la comisión (fee_account): ${a.pagadaPor}`);
  dato(`de quién es la transacción (source_account): ${a.deLaCuenta}`);
  dato(`comisión cobrada: ${stroopsYXlm(a.comisionStroops)}`);

  const r = cumpleLoEsperado(a, o.espero);
  const veredicto =
    a.veredicto === "patrocinada"
      ? "PATROCINADA: la comisión la pagó otra cuenta, dentro de un fee-bump"
      : a.veredicto === "propia"
        ? "PAGÓ LA PROPIA CUENTA: no hubo patrocinio"
        : "NO SE PUDO DECIDIR quién pagó";
  if (r.ok) bien(veredicto);
  else if (a.exitosa) mal(`${veredicto} (se esperaba ${o.espero === "patrocinada" ? "que estuviera patrocinada" : "que pagara la propia cuenta"})`);
  else dato(veredicto);

  if (o.cuenta && a.deLaCuenta && a.deLaCuenta !== o.cuenta) {
    mal(`esta transacción no es de la cuenta indicada en --cuenta (es de ${a.deLaCuenta})`);
  }
  return a;
}

/* ------------------------------------------------------------------ cuenta */

async function revisarCuenta(base, o) {
  console.log(`\nCuenta del organizador ${o.cuenta}`);
  let cuentaHorizon;
  let ops;
  try {
    cuentaHorizon = (await pedir(`${base}/accounts/${o.cuenta}`)).cuerpo;
    ops = cuentaHorizon ? await operacionesDe(base, o.cuenta) : { operaciones: [], truncadas: false };
  } catch (e) {
    mal(`no pude leer Horizon: ${e.message}`);
    return;
  }
  const c = analizarCuenta({ cuenta: o.cuenta, cuentaHorizon, operaciones: ops.operaciones });
  if (!c.existe) {
    mal("la cuenta no existe en esta red");
    return;
  }
  bien("existe en la red");
  dato(`saldo hoy: ${c.saldoXlm} XLM`);
  dato(`entradas patrocinadas (num_sponsored): ${c.numPatrocinadas}`);
  dato(
    `operaciones (${c.totalDeOperaciones}${ops.truncadas ? ", las primeras" : ""}): ` +
      (c.operaciones.map(([tipo, n]) => (n > 1 ? `${tipo} ×${n}` : tipo)).join(", ") || "ninguna"),
  );

  // El control negativo espera que la cuenta pague con sus propios fondos: ahí haber recibido fondos es lo normal.
  if (o.espero === "propia") {
    dato(c.fondosRecibidos.length ? `recibió fondos (esperado en el control negativo): ${c.fondosRecibidos.map((f) => f.monto).join(", ")}` : "nunca recibió fondos");
    return;
  }
  for (const f of c.fondosRecibidos) {
    mal(`recibió fondos: ${f.tipo} de ${f.monto}${f.de ? ` (de ${f.de})` : ""}: la prueba de 0 XLM queda ANULADA`);
  }
  if (c.fondosRecibidos.length === 0 && !c.enCero) {
    mal(`tiene saldo (${c.saldoXlm} XLM) aunque no se ve de dónde llegó: la prueba de 0 XLM queda ANULADA`);
  }
  if (!c.anulada) bien("nunca recibió fondos y sigue en 0 XLM: la prueba de 0 XLM vale");
}

/* --------------------------------------------------------------- billetera */

async function revisarBilletera(base, o, analisis) {
  console.log(`\nBilletera que paga ${o.billetera}`);
  let datos;
  try {
    datos = (await pedir(`${base}/accounts/${o.billetera}`)).cuerpo;
  } catch (e) {
    mal(`no pude leer Horizon: ${e.message}`);
    return;
  }
  if (!datos) {
    mal("la billetera no existe en esta red");
    return;
  }
  const nativo = (datos.balances ?? []).find((b) => b.asset_type === "native");
  const ahora = aStroops(nativo?.balance ?? "0");
  bien(`saldo hoy: ${aXlm(ahora)} XLM`);

  if (o.antes === null) {
    if (o.hashes.length === 0) dato(`anotá este saldo: es el "antes" de la prueba. Después: --antes ${aXlm(ahora)}`);
    return;
  }

  const propias = analisis.filter((a) => a && a.pagadaPor === o.billetera);
  const ajenas = analisis.filter((a) => a && a.pagadaPor !== o.billetera);
  for (const a of ajenas) dato(`la comisión de ${a.hash} no la pagó esta billetera (la pagó ${a.pagadaPor}): no se suma`);
  const sinLeer = o.hashes.length - analisis.filter(Boolean).length;
  if (sinLeer > 0) {
    mal(`no se pudo leer ${sinLeer} de los hashes: no se puede comprobar la suma`);
    return;
  }
  if (propias.length === 0) {
    mal("ninguna de las transacciones la pagó esta billetera: no hay comisión que comparar");
    return;
  }
  const comisiones = propias.map((a) => a.comisionStroops);
  const r = cotejarBilletera({ antes: o.antes, ahora, comisiones });
  dato(`saldo antes: ${aXlm(o.antes)} XLM · saldo hoy: ${aXlm(ahora)} XLM`);
  dato(`bajó: ${stroopsYXlm(r.diferencia)}`);
  dato(`comisiones de ${propias.length === 1 ? "la transacción" : `las ${propias.length} transacciones`}: ${comisiones.join(" + ")} = ${stroopsYXlm(r.suma)}`);
  if (r.ok && r.altas === 0) {
    bien("coincide al stroop: lo que bajó la billetera son exactamente las comisiones");
  } else if (r.ok) {
    bien(`coincide al stroop: son las comisiones más ${STROOPS_POR_ALTA} stroops (${aXlm(STROOPS_POR_ALTA)} XLM) de la alta de una cuenta nueva`);
  } else if (r.diferencia < 0n) {
    mal(`no coincide: el saldo de hoy es MAYOR que el de antes en ${stroopsYXlm(-r.diferencia)} (¿entró plata a la billetera, o el "antes" está mal anotado?)`);
  } else {
    mal(
      `no coincide: la billetera bajó ${r.diferencia} stroops y las comisiones suman ${r.suma} (${r.suma + STROOPS_POR_ALTA} con una alta nueva): ` +
        `${r.sobra > 0n ? `sobran ${r.sobra}` : `faltan ${-r.sobra}`}. ` +
        "Si sobra, algo más usó la billetera en el medio (otra transacción, otra alta); si falta, la pagó otra cuenta o el saldo de antes está mal anotado",
    );
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  let o;
  try {
    o = leerArgumentos(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ErrorDeUso)) throw e;
    console.error(`✗ ${e.message}\n\n${AYUDA}`);
    process.exit(2);
  }
  if (o.ayuda) {
    console.log(AYUDA);
    return;
  }

  const base = HORIZON[o.red];
  console.log(`Quién pagó la comisión, según Horizon (${o.red}: ${base})`);
  console.log(`Se espera: ${o.espero === "patrocinada" ? "transacciones patrocinadas (las paga otra cuenta)" : "transacciones que paga su propia cuenta (control negativo)"}`);

  const analisis = [];
  for (const hash of o.hashes) analisis.push(await revisarTransaccion(base, hash, o));
  if (o.cuenta) await revisarCuenta(base, o);
  if (o.billetera) await revisarBilletera(base, o, analisis);

  console.log("");
  if (o.hashes.length > 0) {
    const cumplen = analisis.filter((a) => a && cumpleLoEsperado(a, o.espero).ok).length;
    console.log(`${cumplen} de ${o.hashes.length} transacciones ${o.espero === "patrocinada" ? "patrocinadas" : "pagadas por su propia cuenta"}.`);
  }
  console.log(fallos === 0 ? "✓ todo en orden" : `✗ ${fallos} ${fallos === 1 ? "comprobación falló" : "comprobaciones fallaron"}`);
  process.exit(fallos === 0 ? 0 : 1);
}

await main();
