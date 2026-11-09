/**
 * Cuenta, desde la cadena, qué se hizo con el contrato tinkazo-raffle.
 *
 * Lee los eventos `sealed` y `drawn` de cada contrato de la red (el vigente y los
 * anteriores de `src/stellar/deployments.json`), baja la transacción de cada uno de
 * Horizon, y calcula por día, semana y mes: sorteos sellados y registrados,
 * organizadores distintos y que vuelven, lugares en listas, cierres sin sortear,
 * ganadores, marcas (`#fila`, `#premios`), tiempo hasta el primer sorteo y listas
 * repetidas. Las cuentas de `docs/cuentas-internas.json` se descuentan y se cuentan aparte.
 *
 * Cualquiera lo corre y le da lo mismo si fija el mismo ledger de corte:
 *
 *   node scripts/metricas-cadena.mjs --red testnet --hasta-ledger 5565782
 *
 * Uso:
 *   node scripts/metricas-cadena.mjs --red testnet|mainnet
 *       [--hasta-ledger N]      corta en ese ledger (por defecto, el último cerrado)
 *       [--totales ruta]        dónde escribir los totales públicos (docs/metricas/totales-<red>.json)
 *       [--crudos carpeta]      dónde guardar los datos crudos y la foto del día (opcional; privado)
 *       [--desde-crudos carpeta] recalcula sin red, de los crudos guardados por una corrida anterior
 *       [--sin-escribir]        solo imprime
 *       [--concurrencia N]      pedidos a Horizon a la vez (4)
 *
 * Sale con 1 si una comprobación falla (huecos en los números de sorteo, un total que no
 * cuadra con `next_id`, un evento que no coincide con su transacción).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calcular,
  comprobar,
  decodificarEvento,
  dia,
  leerNextId,
  partesDelId,
  pedirJson,
  resumirTransaccion,
  traerEventos,
  traerEventosRpc,
  traerTransaccion,
  unir,
} from "./lib/metricas-cadena.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const REDES = {
  testnet: {
    passphrase: "Test SDF Network ; September 2015",
    horizon: "https://horizon-testnet.stellar.org",
    expert: "https://api.stellar.expert/explorer/testnet",
    rpc: "https://soroban-testnet.stellar.org",
  },
  mainnet: {
    passphrase: "Public Global Stellar Network ; September 2015",
    horizon: "https://horizon.stellar.org",
    expert: "https://api.stellar.expert/explorer/public",
    rpc: "https://mainnet.sorobanrpc.com",
  },
};

/** Los contratos de una red: el vigente primero, después los anteriores con su último sello oficial. */
export function contratosDe(despliegues, red) {
  const d = despliegues[red];
  if (!d?.contractId) return [];
  return [
    { contractId: d.contractId, vigente: true },
    ...(d.anteriores ?? []).map((a) => ({ contractId: a.contractId, vigente: false, ultimoId: a.ultimoId })),
  ];
}

/** Las huellas de las listas de ejemplo del sitio (la de docs/vectors.json): lo que sellan las pruebas. */
export function listasDeEjemplo(lista) {
  return new Set((lista.listasDeEjemplo ?? []).map((l) => l.listHash));
}

/** Las cuentas internas de la lista pública, de la red pedida (o de todas las redes si no dice cuál). */
export function cuentasInternas(lista, red) {
  return new Set((lista.cuentas ?? []).filter((c) => c.etiqueta === "interna" && (!c.red || c.red === red)).map((c) => c.direccion));
}

async function enParalelo(items, n, hacer) {
  let i = 0;
  const trabajadores = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const mio = i++;
      await hacer(items[mio], mio);
    }
  });
  await Promise.all(trabajadores);
}

function argumentos(argv) {
  const a = { red: "testnet", concurrencia: 4, escribir: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--red") a.red = v();
    else if (k === "--hasta-ledger") a.hastaLedger = Number(v());
    else if (k === "--totales") a.totales = v();
    else if (k === "--crudos") a.crudos = v();
    else if (k === "--desde-crudos") a.desdeCrudos = v();
    else if (k === "--concurrencia") a.concurrencia = Number(v());
    else if (k === "--sin-escribir") a.escribir = false;
    else throw new Error(`argumento desconocido: ${k}`);
  }
  if (!REDES[a.red]) throw new Error(`red desconocida: ${a.red}`);
  return a;
}

const leerJson = (ruta) => JSON.parse(readFileSync(ruta, "utf8"));
function escribirJson(ruta, obj) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, `${JSON.stringify(obj, null, 2)}\n`);
}
const iso = (seg) => new Date(seg * 1000).toISOString().replace(".000Z", "Z");

async function principal() {
  const a = argumentos(process.argv.slice(2));
  const red = REDES[a.red];
  const despliegues = leerJson(join(RAIZ, "src/stellar/deployments.json"));
  const listaInterna = leerJson(join(RAIZ, "docs/cuentas-internas.json"));
  const internas = cuentasInternas(listaInterna, a.red);
  const ejemplos = listasDeEjemplo(listaInterna);
  const contratos = contratosDe(despliegues, a.red);
  if (!contratos.length) {
    console.error(`No hay contrato de Tinkazo desplegado en ${a.red} (src/stellar/deployments.json).`);
    process.exit(2);
  }
  const log = (...x) => console.error(...x);

  let registrosEventos;
  let transacciones;
  let corteLedger;
  let ahora;
  let nextIds = {};
  let ventanaRpc = null;

  if (a.desdeCrudos) {
    const ev = leerJson(join(a.desdeCrudos, "eventos.json"));
    registrosEventos = ev.eventos;
    corteLedger = ev.corteLedger;
    ahora = ev.ahora;
    nextIds = ev.nextIds ?? {};
    ventanaRpc = ev.ventanaRpc ?? null;
    transacciones = leerJson(join(a.desdeCrudos, "transacciones.json"));
  } else {
    // El corte: un ledger, y su hora de cierre. Con el mismo ledger, el mismo resultado.
    const raiz = await pedirJson(red.horizon);
    corteLedger = a.hastaLedger ?? raiz.history_latest_ledger;
    const ledger = await pedirJson(`${red.horizon}/ledgers/${corteLedger}`);
    if (!ledger) throw new Error(`Horizon no tiene el ledger ${corteLedger}`);
    ahora = Math.floor(Date.parse(ledger.closed_at) / 1000);
    log(`Corte: ledger ${corteLedger}, ${iso(ahora)}`);

    registrosEventos = [];
    for (const c of contratos) {
      const regs = await traerEventos(red.expert, c.contractId, {
        alPagina: (n) => process.stderr.write(`\r  ${c.contractId.slice(0, 8)}… ${n} eventos`),
      });
      process.stderr.write("\n");
      registrosEventos.push(...regs.filter((r) => partesDelId(r.id).ledger <= corteLedger));
    }

    // Cada evento con su transacción, de Horizon (caché de una corrida anterior si hay).
    const previas = a.crudos && existsSync(join(a.crudos, "transacciones.json")) ? leerJson(join(a.crudos, "transacciones.json")) : {};
    transacciones = {};
    const faltan = [];
    for (const r of registrosEventos) {
      if (previas[r.id]) transacciones[r.id] = previas[r.id];
      else faltan.push(r);
    }
    let hechos = 0;
    await enParalelo(faltan, a.concurrencia, async (r) => {
      const rec = await traerTransaccion(red.horizon, r.id);
      if (rec) {
        transacciones[r.id] = {
          hash: rec.hash,
          ledger: rec.ledger,
          created_at: rec.created_at,
          successful: rec.successful,
          fee_charged: rec.fee_charged,
          source_account: rec.source_account,
          fee_account: rec.fee_account,
          envelope_xdr: rec.envelope_xdr,
        };
      }
      hechos++;
      if (hechos % 50 === 0 || hechos === faltan.length) process.stderr.write(`\r  transacciones ${hechos}/${faltan.length}`);
    });
    if (faltan.length) process.stderr.write("\n");

    for (const c of contratos) nextIds[c.contractId] = await leerNextId(red.rpc, c.contractId).catch(() => null);
    ventanaRpc = null;
    try {
      const vigente = contratos.find((c) => c.vigente);
      const r = await traerEventosRpc(red.rpc, vigente.contractId);
      ventanaRpc = { desdeLedger: r.desdeLedger, eventos: r.eventos.filter((e) => e.ledger <= corteLedger) };
    } catch (e) {
      log(`  (el RPC no dio sus eventos recientes: ${e.message})`);
    }
  }

  // Decodificar y unir. Un anterior vale hasta su último sello oficial: lo posterior no es de Tinkazo.
  const todos = registrosEventos.map(decodificarEvento).filter(Boolean);
  const ultimoDe = new Map(contratos.filter((c) => !c.vigente).map((c) => [c.contractId, c.ultimoId]));
  const ajenos = todos.filter((e) => ultimoDe.has(e.contrato) && Number.isFinite(ultimoDe.get(e.contrato)) && e.id > ultimoDe.get(e.contrato));
  const eventos = todos.filter((e) => !ajenos.includes(e));
  const resumenes = {};
  for (const e of eventos) {
    const t = transacciones[e.eventoId];
    if (t) resumenes[e.eventoId] = resumirTransaccion(t, red.passphrase);
  }
  const sinTransaccion = eventos.filter((e) => !resumenes[e.eventoId]).length;
  const { sorteos, problemas } = unir(eventos, resumenes);

  const cuadre = comprobar({ contratos, eventos, nextIds, problemas, sinTransaccion });
  // Una segunda fuente para lo reciente: el RPC cuenta los mismos eventos en su ventana.
  if (ventanaRpc?.desdeLedger) {
    const vigente = contratos.find((c) => c.vigente).contractId;
    const propios = eventos.filter((e) => e.contrato === vigente && e.ledger >= ventanaRpc.desdeLedger);
    const cuenta = (xs, t) => xs.filter((e) => e.tipo === t).length;
    const igual = cuenta(propios, "sealed") === cuenta(ventanaRpc.eventos, "sealed") && cuenta(propios, "drawn") === cuenta(ventanaRpc.eventos, "drawn");
    cuadre.lineas.push(
      `${igual ? "ok " : "MAL"} el RPC, en su ventana de unos 7 días, cuenta ${cuenta(ventanaRpc.eventos, "sealed")} sellos y ${cuenta(ventanaRpc.eventos, "drawn")} registros; el índice, ${cuenta(propios, "sealed")} y ${cuenta(propios, "drawn")}`,
    );
    if (!igual) cuadre.ok = false;
  }
  if (ajenos.length) cuadre.lineas.push(`-- ${ajenos.length} eventos en contratos anteriores después de su último sello oficial: no se cuentan`);

  const r = calcular(sorteos, { internas, ejemplos, ahora });
  const salida = {
    red: a.red,
    nota: "Cuántos, nunca quiénes: sin cuentas, listas ni nombres. `todas` es lo que hay en la cadena; `sinInternas` descuenta las cuentas de docs/cuentas-internas.json; `sinInternasNiEjemplo` descuenta además los sellos de la lista de ejemplo del sitio, que es la que sellan las pruebas.",
    corte: { ledger: corteLedger, cerroEn: iso(ahora) },
    contratos: contratos.map((c) => ({
      contrato: c.contractId,
      vigente: c.vigente,
      sellos: eventos.filter((e) => e.contrato === c.contractId && e.tipo === "sealed").length,
      registros: eventos.filter((e) => e.contrato === c.contractId && e.tipo === "drawn").length,
      nextId: nextIds[c.contractId] ?? null,
      ...(Number.isFinite(c.ultimoId) ? { ultimoIdOficial: c.ultimoId } : {}),
    })),
    eventosDespuesDelUltimoOficial: ajenos.length,
    comprobaciones: { ok: cuadre.ok, detalle: cuadre.lineas },
    cuentasInternas: { enLaLista: internas.size, ...r.internas },
    listasDeEjemplo: { enLaLista: ejemplos.size, ...r.ejemplo },
    todas: r.todas,
    sinInternas: r.sinInternas,
    sinInternasNiEjemplo: r.sinInternasNiEjemplo,
  };

  console.log(cuadre.lineas.join("\n"));
  const t = salida.sinInternasNiEjemplo.totales;
  console.log(
    `\n${a.red} hasta el ledger ${corteLedger} (${iso(ahora)}), entre paréntesis sin cuentas internas ni lista de ejemplo:\n` +
      `  sorteos sellados ${salida.todas.totales.sorteosSellados} (${t.sorteosSellados}), registrados ${salida.todas.totales.sorteosRegistrados} (${t.sorteosRegistrados}),\n` +
      `  organizadores ${salida.todas.totales.organizadoresDistintos} (${t.organizadoresDistintos}), lugares en listas ${salida.todas.totales.lugaresEnListas} (${t.lugaresEnListas}),\n` +
      `  cierres sin sortear ${salida.todas.totales.cierresSinSortear} (${t.cierresSinSortear}), ganadores ${salida.todas.totales.ganadores} (${t.ganadores})`,
  );

  if (a.escribir) {
    const totales = resolve(a.totales ?? join(RAIZ, "docs/metricas", `totales-${a.red}.json`));
    if (a.desdeCrudos) log("(recalculado de los crudos: los totales se escriben igual)");
    escribirJson(totales, salida);
    log(`Totales: ${totales}`);
    if (a.crudos && !a.desdeCrudos) {
      const hoy = dia(ahora);
      escribirJson(join(a.crudos, "eventos.json"), { red: a.red, corteLedger, ahora, contratos, nextIds, ventanaRpc, eventos: registrosEventos });
      escribirJson(join(a.crudos, "transacciones.json"), transacciones);
      escribirJson(join(a.crudos, `eventos-${hoy}.json`), { red: a.red, corteLedger, ahora, eventos: registrosEventos });
      escribirJson(join(a.crudos, `totales-${hoy}.json`), salida);
      log(`Crudos y foto del día: ${a.crudos}`);
    }
  }
  if (!cuadre.ok) {
    console.error("\nUna comprobación falló: los números no se pueden dar por buenos.");
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
