#!/usr/bin/env node
/**
 * Comprueba, leyendo los archivos públicos de historial de Stellar, que una transacción
 * (un sello o un sorteo de Tinkazo, o cualquier otra) estuvo en un ledger y a qué hora
 * cerró ese ledger. No le pide nada a Tinkazo, y a Horizon solo en qué ledger buscar.
 * Solo lectura: no firma ni manda nada.
 *
 *   node scripts/verificar-archivo.mjs <testnet|mainnet> <hash de la transacción> [opciones]
 *   node scripts/verificar-archivo.mjs --enlace <enlace|archivo.json|#fragmento> [opciones]
 *
 * La lógica está en scripts/lib/archivo-historial.mjs (qué se comprueba y qué no).
 * Sale con 0 si es verde, 2 si solo una organización lo confirma y 1 si falla.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { crearSesion, fechaUtc, fuentesPorDefecto, leerComprobante, verificarTransaccion } from "./lib/archivo-historial.mjs";

const HORIZON = { testnet: "https://horizon-testnet.stellar.org", mainnet: "https://horizon.stellar.org" };

const AYUDA = `uso:
  node scripts/verificar-archivo.mjs <testnet|mainnet> <hash de la transacción> [opciones]
  node scripts/verificar-archivo.mjs --enlace <enlace de verificación | comprobante.json | #fragmento> [opciones]

Baja de los archivos de historial de Stellar el punto de control (64 ledgers) de la
transacción y comprueba que las cabeceras encadenan, que la transacción está en el
conjunto del ledger, que salió bien y a qué hora cerró. En un fee bump vale el hash de
la transacción interior (el del sello) o el de afuera.

opciones:
  --fuentes url1,url2,...  direcciones de archivos de historial; reemplazan a las de siempre
                           (scripts/lib/fuentes-historial.json: en mainnet la SDF y cuatro
                           organizaciones, en testnet solo la SDF)
  --ledger N               el ledger de la transacción, sin preguntarle a Horizon
  --horizon URL            otro Horizon, solo para ubicar el ledger
  --detalle                muestra cada comprobación de cada fuente
  --ayuda                  esta ayuda

salida: 0 verde (dos o más organizaciones devuelven la misma cabecera), 2 una sola fuente,
1 cualquier otra cosa (no verificado, las fuentes discrepan, uso incorrecto).`;

function leerArgumentos(argv) {
  const o = { posicionales: [], fuentes: null, ledger: null, horizon: null, enlace: null, detalle: false, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const nombre = eq >= 0 ? a.slice(0, eq) : a;
    const valor = () => {
      if (eq >= 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new Error(`a ${nombre} le falta el valor`);
      return v;
    };
    switch (nombre) {
      case "--fuentes":
        o.fuentes = valor().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--ledger": {
        const n = Number(valor());
        if (!Number.isSafeInteger(n) || n < 1) throw new Error("--ledger es un número entero positivo");
        o.ledger = n;
        break;
      }
      case "--horizon":
        o.horizon = valor();
        break;
      case "--enlace":
        o.enlace = valor();
        break;
      case "--detalle":
        o.detalle = true;
        break;
      case "--ayuda":
      case "-h":
        o.ayuda = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`opción desconocida: ${a}`);
        o.posicionales.push(a);
    }
  }
  return o;
}

const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const seg = (s) => `${s.toFixed(1).replace(".", ",")} s`;

function imprimir(salida, detalle, porDefecto) {
  const { red, hash, ledger, ubicacion, resultados, decision } = salida;
  const punto = resultados.find((r) => r.punto)?.punto;
  console.log(`transacción ${hash}`);
  console.log(
    `red ${red} · ledger ${ledger} (${ubicacion.origen === "Horizon" ? "lo dice Horizon, solo como pista: lo prueba el archivo" : "dado con --ledger"})` +
      (punto ? ` · punto de control ${punto}` : ""),
  );
  console.log(`fuentes consultadas: ${resultados.length}${salida.reserva.length ? ` (${salida.reserva.length} de reserva)` : ""}`);
  for (const r of resultados) {
    const marca = r.estado === "ok" ? "[OK]" : r.estado === "invalida" ? "[NO]" : "[--]";
    console.log(`\n${marca} ${r.nombre}  ${r.url}`);
    if (r.estado === "ok") {
      console.log(`     cierre ${fechaUtc(r.cierre)} · ledger ${r.ledger} · protocolo ${r.version}${r.interna ? " · transacción interior de un fee bump" : ""}`);
      console.log(`     cabecera ${r.hashCabecera}`);
    } else {
      console.log(`     ${r.estado === "invalida" ? r.motivo : `sin respuesta: ${r.motivo}`}`);
    }
    if (r.bytes) console.log(`     ${miles(r.bytes)} bytes · ${seg(r.segundos)}`);
    if (detalle) for (const c of r.comprobaciones) console.log(`     ${c.ok ? "+" : "-"} ${c.nombre}${c.detalle ? ` (${c.detalle})` : ""}`);
  }
  const ok = resultados.filter((r) => r.estado === "ok");
  const quien = decision.organizaciones.join(", ");
  const que = ok[0] ? `estuvo en el ledger ${ledger}, que cerró el ${fechaUtc(ok[0].cierre)}` : "";
  const corto = `${hash.slice(0, 8)}…`;
  console.log("");
  if (ubicacion.cierreHorizon && ok[0] && ubicacion.cierreHorizon !== ok[0].cierre) {
    console.log(`AVISO: Horizon dice que ese ledger cerró el ${fechaUtc(ubicacion.cierreHorizon)}; vale la hora del archivo.`);
  }
  if (decision.veredicto === "verde") {
    console.log(`VERDE: la transacción ${corto} ${que}. Lo confirman ${decision.organizaciones.length} organizaciones (${quien}) con la misma cabecera de ledger.`);
  } else if (decision.veredicto === "una-sola-fuente") {
    console.log(`UNA SOLA FUENTE: la transacción ${corto} ${que}, según una sola organización (${quien}); ${decision.motivo}.`);
    if (red === "testnet" && porDefecto) {
      console.log("En testnet, hasta donde se sabe, solo la SDF publica el historial, así que con las fuentes de siempre nunca hay una segunda; y la red entera se borra el 16 de diciembre de 2026.");
    }
  } else {
    console.log(`NO VERIFICADO: ${decision.motivo}.`);
    if (resultados.length && resultados.every((r) => r.estado === "sin-respuesta" && /HTTP 404/.test(r.motivo))) {
      console.log("Si la transacción es muy reciente, el punto de control todavía puede no estar publicado: probá de nuevo en unos 10 minutos.");
    }
  }
  if (decision.codigo !== 1) {
    console.log("Esto prueba que esas fuentes publican un historial coherente con la transacción adentro; no comprueba las firmas SCP con las que la red lo aceptó.");
  }
}

async function principal(argv) {
  const o = leerArgumentos(argv);
  if (o.ayuda || (argv.length === 0)) {
    console.log(AYUDA);
    return o.ayuda ? 0 : 1;
  }
  let red;
  let hashes;
  if (o.enlace !== null) {
    if (o.posicionales.length) throw new Error("con --enlace no se pasan la red ni el hash");
    if (o.ledger !== null) throw new Error("--ledger no va con --enlace: el sello y el sorteo están en ledgers distintos");
    let texto = o.enlace;
    if (existsSync(texto) && statSync(texto).isFile()) {
      if (statSync(texto).size > 5 * 1024 * 1024) throw new Error("el archivo del comprobante es demasiado grande");
      texto = readFileSync(texto, "utf8");
    }
    const c = leerComprobante(texto);
    if (!c.red) throw new Error("el comprobante no dice en qué red está (campo net): probá con <red> <hash>");
    if (!c.stx && !c.dtx) throw new Error("el comprobante no trae el hash de ninguna transacción (stx ni dtx)");
    red = c.red;
    hashes = [c.stx && { etiqueta: "sello (stx)", hash: c.stx }, c.dtx && { etiqueta: "sorteo (dtx)", hash: c.dtx }].filter(Boolean);
  } else {
    if (o.posicionales.length !== 2) throw new Error("uso: <testnet|mainnet> <hash de la transacción> (o --ayuda)");
    [red] = o.posicionales;
    hashes = [{ etiqueta: "", hash: o.posicionales[1] }];
  }
  if (red !== "testnet" && red !== "mainnet") throw new Error(`red desconocida: ${red} (testnet o mainnet)`);

  const porDefecto = o.fuentes === null;
  let fuentes;
  let reserva = [];
  if (porDefecto) {
    ({ fuentes, reserva } = fuentesPorDefecto(red));
  } else {
    fuentes = o.fuentes.map((u) => {
      const url = new URL(u);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`fuente inválida: ${u}`);
      return { nombre: url.hostname, url: u };
    });
    if (!fuentes.length) throw new Error("--fuentes no trae ninguna dirección");
  }

  const sesion = crearSesion();
  let codigo = 0;
  for (const { etiqueta, hash } of hashes) {
    if (etiqueta) console.log(`\n=== ${etiqueta} ===`);
    const salida = await verificarTransaccion({ red, hash, fuentes, reserva, ledger: o.ledger, horizon: o.horizon ?? HORIZON[red], sesion });
    imprimir(salida, o.detalle, porDefecto);
    const c = salida.decision.codigo;
    codigo = c === 1 || codigo === 1 ? 1 : Math.max(codigo, c);
  }
  return codigo;
}

// Con `exitCode` y no `exit()`: así la salida se termina de escribir aunque vaya a una tubería.
principal(process.argv.slice(2)).then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (e) => {
    console.error(`error: ${e?.message ?? e}`);
    process.exitCode = 1;
  },
);
