import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { Account, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ErrorDeArchivo,
  FRASES_DE_RED,
  crearSesion,
  decidir,
  descomprimir,
  fechaUtc,
  fuentesPorDefecto,
  hashesDelSobre,
  idDeRed,
  leerCabecera,
  leerComprobante,
  leerRegistros,
  organizacionDe,
  puntoDeControl,
  rutaDeArchivo,
  ubicarEnHorizon,
  verificarEncadenado,
  verificarTransaccion,
} from "./archivo-historial.mjs";

/**
 * Ninguna de estas pruebas toca la red: todo lo que baja el verificador sale de un
 * `fetch` falso, y el `fetch` de verdad se reemplaza por uno que falla fuerte.
 *
 * Los archivos de historial de las pruebas se arman a mano con el formato de la red
 * (XDR con marca de registro y gzip), con transacciones reales de testnet guardadas en
 * `src/stellar/fixtures/`, y las cabeceras reales están en `muestras-archivo/`.
 */

beforeAll(() => {
  vi.stubGlobal("fetch", async (url) => {
    throw new Error(`las pruebas no usan la red: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const json = (ruta) => JSON.parse(readFileSync(new URL(ruta, import.meta.url), "utf8"));
const horizon = (nombre) => json(`../../src/stellar/fixtures/horizon-${nombre}.json`);
const sobreDe = (fix) => Buffer.from(fix.envelope_xdr, "base64");

/* --------------------------------------------------- piezas de XDR para armar un archivo */

const sha = (...partes) => {
  const h = createHash("sha256");
  for (const p of partes) h.update(p);
  return h.digest();
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const marcar = (b) => Buffer.concat([u32((b.length | 0x80000000) >>> 0), b]);
const gz = (registros) => zlib.gzipSync(Buffer.concat(registros.map(marcar)));
const hexa = (h) => Buffer.from(h, "hex");

/** Una cabecera: hash ‖ LedgerHeader ‖ ext. `previo` puede no ser el hash de la anterior (para romper el enlace). */
function cabecera({ ledger, previo, txSetHash, txSetResultHash, cierre, version = 29, variante = 0 }) {
  const cuerpo = Buffer.concat([
    u32(version),
    previo,
    txSetHash, // StellarValue: txSetHash, closeTime, upgrades<>, ext (básico)
    u64(cierre),
    u32(0),
    u32(0),
    txSetResultHash,
    Buffer.alloc(32, variante), // bucketListHash
    u32(ledger),
    u64(1_000_000_000), // totalCoins
    u64(0), // feePool
    u32(0), // inflationSeq
    u64(0), // idPool
    u32(100), // baseFee
    u32(5_000_000), // baseReserve
    u32(100), // maxTxSetSize
    Buffer.alloc(128), // skipList
    u32(0), // ext
  ]);
  const hash = sha(cuerpo);
  return { ledger, hash, cuerpo, registro: Buffer.concat([hash, cuerpo, u32(0)]) };
}

/** El conjunto de transacciones de un ledger, generalizado (clásico + Soroban en paralelo) o clásico. */
function conjunto({ ledger, previo, clasicos, soroban, generalizado }) {
  if (!generalizado) {
    const todos = [...clasicos, ...soroban];
    return { hash: sha(previo, ...todos), registro: Buffer.concat([u32(ledger), previo, u32(todos.length), ...todos, u32(0)]) };
  }
  const lista = (l) => Buffer.concat([u32(l.length), ...l]);
  const faseClasica = Buffer.concat([u32(0), u32(1), u32(0), u32(1), u64(100), lista(clasicos)]);
  const faseSoroban = Buffer.concat([u32(1), u32(1), u64(100), u32(1), u32(1), lista(soroban)]);
  const gen = Buffer.concat([u32(1), previo, u32(2), faseClasica, faseSoroban]);
  return { hash: sha(gen), registro: Buffer.concat([u32(ledger), previo, u32(0), u32(1), gen]) };
}

// TransactionResultPair: hash ‖ feeCharged ‖ código ‖ (resultados de operaciones vacíos) ‖ ext
const parSimple = (hash, { falla = false } = {}) => Buffer.concat([hexa(hash), u64(100), u32(falla ? 0xffffffff : 0), u32(0), u32(0)]);
// fee bump: el hash de afuera, el código 1 (interior exitosa) o -13 (interior fallida) y el par de la interior
const parFeeBump = (externo, interno, { internoFalla = false } = {}) =>
  Buffer.concat([hexa(externo), u64(200), u32(internoFalla ? 0xfffffff3 : 1), hexa(interno), u64(100), u32(internoFalla ? 0xffffffff : 0), u32(0), u32(0), u32(0)]);

/** Un punto de control completo (ledgers 64 a 127) con el conjunto y los resultados del ledger `ledger`. */
const PUNTO = 127;
function crearPunto({ ledger = 100, clasicos = [], soroban = [], pares = [], generalizado = true, variante = 0, romperEnlaceEn = null, torcerHashEn = null }) {
  let previo = Buffer.alloc(32, 7);
  const cabeceras = [];
  let regConjunto;
  let regResultados;
  for (let n = 64; n <= 127; n++) {
    let txSetHash = Buffer.alloc(32, 1);
    let txSetResultHash = Buffer.alloc(32, 2);
    if (n === ledger) {
      const c = conjunto({ ledger, previo, clasicos, soroban, generalizado });
      const set = Buffer.concat([u32(pares.length), ...pares]);
      txSetHash = c.hash;
      txSetResultHash = sha(set);
      regConjunto = c.registro;
      regResultados = Buffer.concat([u32(ledger), set, u32(0)]);
    }
    const c = cabecera({
      ledger: n,
      previo: n === romperEnlaceEn ? Buffer.alloc(32, 5) : previo,
      txSetHash,
      txSetResultHash,
      cierre: 1_790_000_000 + n * 5,
      variante,
    });
    if (n === torcerHashEn) c.registro[40] ^= 0xff; // un byte de la cabecera cambia y el hash declarado ya no es el suyo
    cabeceras.push(c);
    previo = c.hash;
  }
  const H = cabeceras[ledger - 64];
  return {
    ledger,
    cierre: 1_790_000_000 + ledger * 5,
    hashCabecera: H.hash.toString("hex"),
    archivos: {
      ledger: gz(cabeceras.map((c) => c.registro)),
      transactions: gz([regConjunto]),
      results: gz([regResultados]),
    },
  };
}

/** Un `fetch` falso: sirve lo que está en `mapa` (URL -> Buffer | número de estado | Error), 404 si no, y anota los pedidos. */
function servidor() {
  const mapa = new Map();
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(String(url));
    const x = mapa.get(String(url));
    if (x === undefined) return new Response("no está", { status: 404 });
    if (x instanceof Error) throw x;
    if (typeof x === "number") return new Response("", { status: x });
    if (Buffer.isBuffer(x)) return new Response(x, { status: 200 });
    return new Response(JSON.stringify(x), { status: 200 });
  };
  return {
    f,
    pedidos,
    mapa,
    publicar(base, punto) {
      for (const c of ["ledger", "transactions", "results"]) mapa.set(rutaDeArchivo(base, c, PUNTO), punto.archivos[c]);
    },
  };
}
const sesionDe = (srv) => crearSesion({ fetch: srv.f, intentos: 1, esperaMs: 0 });

/* ---------------------------------------------------- transacciones reales de testnet */

const SELLO = horizon("66f498d7"); // un sello (Soroban), sin fee bump
const OTRA = horizon("e418ebc4"); // otra transacción de Soroban
const BUMP = horizon("5c1eaa8e"); // un fee bump: su hash es el de afuera
const BUMP_POR_INTERIOR = horizon("65060673-por-el-hash-interior"); // la misma, pedida por el hash de adentro
const H_SELLO = SELLO.hash;
const H_OTRA = OTRA.hash;
const H_BUMP_EXTERNO = BUMP.hash;
const H_BUMP_INTERNO = BUMP_POR_INTERIOR.hash;

const A = { nombre: "Organización A", url: "https://historial.a.example/h1" };
const B = { nombre: "Organización B", url: "https://archivo.b.example/h" };
const C = { nombre: "Organización C", url: "https://c.example/historia" };

/** El punto normal de las pruebas: un sello, otra transacción fallida y un fee bump que salió bien. */
const normal = (extra = {}) =>
  crearPunto({
    clasicos: [sobreDe(OTRA)],
    soroban: [sobreDe(SELLO), sobreDe(BUMP)],
    pares: [parSimple(H_OTRA, { falla: true }), parSimple(H_SELLO), parFeeBump(H_BUMP_EXTERNO, H_BUMP_INTERNO)],
    ...extra,
  });

async function correr(srv, args) {
  return verificarTransaccion({ red: "testnet", hash: H_SELLO, ledger: 100, sesion: sesionDe(srv), fetch: srv.f, ...args });
}

/* ================================================================== las pruebas */

describe("el punto de control y las rutas", () => {
  it("cada ledger se publica en el último de sus 64", () => {
    expect(puntoDeControl(5382106)).toBe(5382143); // 0x00521fff
    expect(puntoDeControl(63)).toBe(63);
    expect(puntoDeControl(64)).toBe(127);
    expect(puntoDeControl(127)).toBe(127);
    expect(puntoDeControl(128)).toBe(191);
    expect(puntoDeControl(1)).toBe(63);
    expect(puntoDeControl(65137735)).toBe(65137791);
  });
  it("un ledger que no existe no tiene punto de control", () => {
    for (const mal of [0, -1, 1.5, Number.NaN, "100", 2 ** 60]) expect(() => puntoDeControl(mal)).toThrow(RangeError);
  });
  it("la ruta parte el número en tres bytes y no repite barras", () => {
    expect(rutaDeArchivo("https://x.test/h/", "ledger", 5382143)).toBe("https://x.test/h/ledger/00/52/1f/ledger-00521fff.xdr.gz");
    expect(rutaDeArchivo("https://x.test/h", "results", 63)).toBe("https://x.test/h/results/00/00/00/results-0000003f.xdr.gz");
    expect(rutaDeArchivo("https://x.test/h//", "transactions", 65138047)).toBe("https://x.test/h/transactions/03/e1/ed/transactions-03e1ed7f.xdr.gz");
  });
});

describe("registros y descompresión", () => {
  it("lee los registros con su marca y reconoce un archivo cortado", () => {
    const a = Buffer.from("uno");
    const b = Buffer.from("dos dos");
    const completo = zlib.gunzipSync(gz([a, b]));
    expect(leerRegistros(completo).map(String)).toEqual(["uno", "dos dos"]);
    expect(() => leerRegistros(completo.subarray(0, completo.length - 2))).toThrow(ErrorDeArchivo);
    expect(() => leerRegistros(completo.subarray(0, 6))).toThrow(/a mitad de un registro/);
  });
  it("lo que ya llegó descomprimido sirve, y un gzip dañado es un problema de la descarga, no una contradicción", () => {
    const crudo = Buffer.concat([marcar(Buffer.from("x"))]);
    expect(descomprimir(crudo)).toEqual(crudo);
    const roto = zlib.gzipSync(Buffer.from("hola mundo hola mundo")).subarray(0, 14);
    const estadoAlDescomprimir = (buf) => {
      try {
        descomprimir(buf);
      } catch (e) {
        expect(e).toBeInstanceOf(ErrorDeArchivo);
        return e.estado;
      }
      return "sin error";
    };
    expect(estadoAlDescomprimir(roto)).toBe("sin-respuesta");
    // una página de error con código 200 tampoco es un archivo de historial
    expect(estadoAlDescomprimir(Buffer.from("<html><body>No encontrado</body></html>"))).toBe("sin-respuesta");
    expect(estadoAlDescomprimir(Buffer.alloc(0))).toBe("sin-respuesta");
  });
});

describe("cabeceras reales de testnet, anteriores al Protocolo 30", () => {
  const muestra = json("./muestras-archivo/cabeceras-testnet-5382105-5382106.json");
  const [previa, del_sello] = muestra.cabeceras.map((c) => ({ ...c, cabecera: leerCabecera(Buffer.from(c.xdr, "base64")) }));

  it("se leen, y su hash es el SHA-256 de su cabecera", () => {
    for (const m of [previa, del_sello]) {
      expect(m.cabecera.ledger).toBe(m.ledger);
      expect(m.cabecera.hash).toBe(m.hash);
      expect(m.cabecera.hashCalculado).toBe(m.hash);
      expect(m.cabecera.version).toBe(29); // PENDIENTE: probar con una cabecera posterior al 3-nov-2026 (Protocolo 30)
    }
  });
  it("la hora de cierre es la que Horizon dio para el mismo ledger", () => {
    const horaDeHorizon = Math.floor(Date.parse(SELLO.created_at) / 1000);
    expect(SELLO.ledger).toBe(del_sello.ledger);
    expect(del_sello.cabecera.cierre).toBe(horaDeHorizon);
    expect(fechaUtc(del_sello.cabecera.cierre)).toBe("2026-10-25 13:15:17 UTC");
  });
  it("dos cabeceras seguidas encadenan, y en otro orden o con un byte cambiado no", () => {
    expect(verificarEncadenado([previa.cabecera, del_sello.cabecera])).toEqual({ ok: true, problemas: [] });
    expect(del_sello.cabecera.previo).toBe(previa.hash);
    expect(verificarEncadenado([del_sello.cabecera, previa.cabecera]).ok).toBe(false);
    const torcida = Buffer.from(del_sello.xdr, "base64");
    torcida[60] ^= 1;
    const c = leerCabecera(torcida);
    expect(c.hash).not.toBe(c.hashCalculado);
    expect(verificarEncadenado([previa.cabecera, c]).ok).toBe(false);
  });
  it("una cabecera que este SDK no lee entera falla con un aviso y no con un hash falso", () => {
    expect(() => leerCabecera(Buffer.alloc(40))).toThrow(/SDK de Stellar/);
    const conCola = Buffer.concat([Buffer.from(del_sello.xdr, "base64"), Buffer.alloc(8)]);
    expect(() => leerCabecera(conCola)).toThrow(ErrorDeArchivo);
  });
});

describe("el encadenado de cabeceras", () => {
  const cabeceras = (opciones) => {
    const punto = crearPunto({ ...opciones });
    return leerRegistros(zlib.gunzipSync(punto.archivos.ledger)).map(leerCabecera);
  };
  it("64 cabeceras armadas bien encadenan", () => {
    const cs = cabeceras({ clasicos: [sobreDe(OTRA)], pares: [parSimple(H_OTRA)] });
    expect(cs).toHaveLength(64);
    expect(verificarEncadenado(cs)).toEqual({ ok: true, problemas: [] });
  });
  it("un enlace roto se nota y dice cuál", () => {
    const r = verificarEncadenado(cabeceras({ romperEnlaceEn: 90 }));
    expect(r.ok).toBe(false);
    expect(r.problemas).toEqual(["la cabecera del ledger 90 no apunta al hash de la del 89"]);
  });
  it("un hash declarado que no es el de la cabecera se nota", () => {
    const r = verificarEncadenado(cabeceras({ torcerHashEn: 70 }));
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toMatch(/ledger 70 no es el SHA-256/);
  });
  it("faltan ledgers, o la hora no crece", () => {
    const cs = cabeceras({});
    expect(verificarEncadenado([cs[0], cs[2]]).problemas.join(" ")).toMatch(/faltan ledgers/);
    expect(verificarEncadenado([cs[0], { ...cs[1], cierre: cs[0].cierre }]).problemas.join(" ")).toMatch(/no es posterior/);
  });
});

describe("el hash de un sobre", () => {
  const idRed = idDeRed(FRASES_DE_RED.testnet);
  const fixtures = ["0a8671d0", "2d6b998c", "5c1eaa8e", "65060673-por-el-hash-interior", "66f498d7", "b5075505", "e418ebc4", "ea551981", "ea551981-por-el-hash-interior"];

  it("la frase de red de cada red es la de siempre", () => {
    expect(FRASES_DE_RED).toEqual({ testnet: "Test SDF Network ; September 2015", mainnet: "Public Global Stellar Network ; September 2015" });
  });
  it("da el mismo hash que el SDK en las transacciones reales, con y sin fee bump", () => {
    for (const nombre of fixtures) {
      const fix = horizon(nombre);
      const sobre = xdr.TransactionEnvelope.fromXDR(sobreDe(fix));
      const sdk = TransactionBuilder.fromXDR(fix.envelope_xdr, Networks.TESTNET);
      const hs = hashesDelSobre(sobre, idRed);
      expect(hs.externo, nombre).toBe(Buffer.from(sdk.hash()).toString("hex"));
      if ("innerTransaction" in sdk) expect(hs.interno, nombre).toBe(Buffer.from(sdk.innerTransaction.hash()).toString("hex"));
      else expect(hs.interno, nombre).toBeNull();
    }
  });
  it("en un fee bump el hash del sello es el de la transacción interior, y no el de afuera", () => {
    const hs = hashesDelSobre(xdr.TransactionEnvelope.fromXDR(sobreDe(BUMP)), idRed);
    expect(hs.externo).toBe(H_BUMP_EXTERNO);
    expect(hs.interno).toBe(H_BUMP_INTERNO);
    expect(hs.externo).not.toBe(hs.interno);
    // Horizon contesta lo mismo pidiendo cualquiera de los dos
    expect(BUMP_POR_INTERIOR.envelope_xdr).toBe(BUMP.envelope_xdr);
  });
  it("una transacción V0 se firma como una V1", () => {
    const cuenta = new Account(Keypair.random().publicKey(), "1");
    const tx = new TransactionBuilder(cuenta, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
      .setTimeout(0)
      .build();
    const v1 = Buffer.from(tx.toEnvelope().toXDR()); // tipo ‖ transacción V1 ‖ firmas
    const v0 = Buffer.concat([u32(0), v1.subarray(8, v1.length - 4), u32(0)]); // sin el tipo de sobre ni el tipo de la cuenta de origen
    const sobre = xdr.TransactionEnvelope.fromXDR(v0);
    expect(sobre.type).toBe("envelopeTypeTxV0");
    expect(hashesDelSobre(sobre, idRed).externo).toBe(Buffer.from(tx.hash()).toString("hex"));
  });
});

describe("una fuente de verdad: lo que se comprueba y lo que no", () => {
  it("la transacción del sello, en un conjunto generalizado, sale bien y con la hora de la cabecera", async () => {
    const punto = normal();
    const srv = servidor();
    srv.publicar(A.url, punto);
    const r = await correr(srv, { fuentes: [A] });
    const f = r.resultados[0];
    expect(f.estado).toBe("ok");
    expect(f.motivo).toBe("");
    expect(f.cierre).toBe(punto.cierre);
    expect(f.hashCabecera).toBe(punto.hashCabecera);
    expect(f.ledger).toBe(100);
    expect(f.punto).toBe(PUNTO);
    expect(f.interna).toBe(false);
    expect(f.hashExterno).toBe(H_SELLO);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.comprobaciones.every((c) => c.ok)).toBe(true);
    expect(f.comprobaciones.map((c) => c.nombre).join("|")).toMatch(/encadenan.*txSetHash.*ledger anterior.*hash de la transacción.*txSetResultHash.*salió bien/);
  });
  it("también con un conjunto clásico", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal({ generalizado: false }));
    const r = await correr(srv, { fuentes: [A] });
    expect(r.resultados[0].estado).toBe("ok");
    expect(r.resultados[0].comprobaciones.find((c) => /txSetHash/.test(c.nombre)).detalle).toBe("conjunto clásico");
  });
  it("un fee bump se comprueba por el hash de adentro (el del sello) y por el de afuera", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    const interno = await correr(srv, { fuentes: [A], hash: H_BUMP_INTERNO });
    expect(interno.resultados[0]).toMatchObject({ estado: "ok", interna: true, hashExterno: H_BUMP_EXTERNO });
    const externo = await correr(srv, { fuentes: [A], hash: H_BUMP_EXTERNO });
    expect(externo.resultados[0]).toMatchObject({ estado: "ok", interna: false, hashExterno: H_BUMP_EXTERNO });
  });
  it("un fee bump cuya transacción interior falló no es un sello", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal({ pares: [parSimple(H_OTRA), parSimple(H_SELLO), parFeeBump(H_BUMP_EXTERNO, H_BUMP_INTERNO, { internoFalla: true })] }));
    const r = await correr(srv, { fuentes: [A], hash: H_BUMP_INTERNO });
    expect(r.resultados[0].estado).toBe("invalida");
    expect(r.resultados[0].motivo).toMatch(/salió bien.*txFeeBumpInnerFailed/);
    expect(r.decision).toMatchObject({ veredicto: "falla", codigo: 1 });
  });
  it("una transacción que la red rechazó existe y no es verde", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    const r = await correr(srv, { fuentes: [A], hash: H_OTRA });
    expect(r.resultados[0].estado).toBe("invalida");
    expect(r.resultados[0].motivo).toMatch(/salió bien.*txFailed/);
    expect(r.decision.codigo).toBe(1);
  });
  it("una transacción que no está en el conjunto del ledger no es verde, diga lo que diga Horizon", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    const r = await correr(srv, { fuentes: [A], hash: "ab".repeat(32) });
    expect(r.resultados[0].estado).toBe("invalida");
    expect(r.resultados[0].motivo).toMatch(/un sobre del conjunto tiene el hash/);
    expect(r.decision.veredicto).toBe("falla");
  });
  it("un conjunto que no es el que la cabecera dice, o resultados cambiados, se descubren", async () => {
    const otro = normal({ clasicos: [sobreDe(OTRA), sobreDe(OTRA)] });
    const bueno = normal();
    // las cabeceras del bueno con el conjunto del otro
    const srv = servidor();
    srv.mapa.set(rutaDeArchivo(A.url, "ledger", PUNTO), bueno.archivos.ledger);
    srv.mapa.set(rutaDeArchivo(A.url, "transactions", PUNTO), otro.archivos.transactions);
    srv.mapa.set(rutaDeArchivo(A.url, "results", PUNTO), bueno.archivos.results);
    expect((await correr(srv, { fuentes: [A] })).resultados[0].motivo).toMatch(/SHA-256 del conjunto es el txSetHash/);
    const otrosResultados = normal({ pares: [parSimple(H_OTRA, { falla: true }), parSimple(H_SELLO, {}), parSimple("cd".repeat(32))] });
    srv.mapa.set(rutaDeArchivo(A.url, "transactions", PUNTO), bueno.archivos.transactions);
    srv.mapa.set(rutaDeArchivo(A.url, "results", PUNTO), otrosResultados.archivos.results);
    const r = await correr(srv, { fuentes: [A], sesion: sesionDe(srv) });
    expect(r.resultados[0].motivo).toMatch(/SHA-256 de los resultados es el txSetResultHash/);
  });
  it("la hora de cierre sale de la cabecera aunque Horizon diga otra", async () => {
    const punto = normal();
    const srv = servidor();
    srv.publicar(A.url, punto);
    srv.mapa.set("https://horizon.prueba/transactions/" + H_SELLO, { ledger: 100, created_at: "2020-01-01T00:00:00Z", successful: true });
    const r = await correr(srv, { fuentes: [A], ledger: null, horizon: "https://horizon.prueba" });
    expect(r.ubicacion).toMatchObject({ origen: "Horizon", ledger: 100 });
    expect(r.ubicacion.cierreHorizon).toBe(1577836800);
    expect(r.resultados[0].cierre).toBe(punto.cierre);
  });
});

describe("la regla de las dos fuentes", () => {
  it("dos organizaciones con la misma cabecera dan verde", async () => {
    const punto = normal();
    const srv = servidor();
    srv.publicar(A.url, punto);
    srv.publicar(B.url, punto);
    const r = await correr(srv, { fuentes: [A, B] });
    expect(r.decision).toMatchObject({ veredicto: "verde", codigo: 0 });
    expect(r.decision.organizaciones).toEqual(["a.example", "b.example"]);
    expect(r.resultados.map((x) => x.hashCabecera)).toEqual([punto.hashCabecera, punto.hashCabecera]);
  });
  it("una sola organización que responde es una sola fuente, no verde", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    const r = await correr(srv, { fuentes: [A, B] });
    expect(r.resultados.map((x) => x.estado)).toEqual(["ok", "sin-respuesta"]);
    expect(r.resultados[1].motivo).toMatch(/HTTP 404/);
    expect(r.decision).toMatchObject({ veredicto: "una-sola-fuente", codigo: 2 });
  });
  it("dos direcciones de la misma organización cuentan como una", async () => {
    const punto = normal();
    const srv = servidor();
    const uno = { nombre: "réplica 1", url: "https://historia1.misma.example/h1" };
    const dos = { nombre: "réplica 2", url: "https://historia2.misma.example/h2" };
    srv.publicar(uno.url, punto);
    srv.publicar(dos.url, punto);
    const r = await correr(srv, { fuentes: [uno, dos] });
    expect(r.resultados.every((x) => x.estado === "ok")).toBe(true);
    expect(r.decision).toMatchObject({ veredicto: "una-sola-fuente", codigo: 2, organizaciones: ["misma.example"] });
  });
  it("si dos fuentes devuelven cabeceras distintas para el mismo ledger no se certifica nada", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    srv.publicar(B.url, normal({ variante: 3 }));
    const r = await correr(srv, { fuentes: [A, B] });
    expect(r.resultados.map((x) => x.estado)).toEqual(["ok", "ok"]);
    expect(r.decision).toMatchObject({ veredicto: "discrepan", codigo: 1 });
    expect(r.decision.motivo).toMatch(/cabeceras distintas/);
  });
  it("una fuente cuyo archivo no cuadra contradice a las que confirman", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    srv.publicar(B.url, normal());
    srv.publicar(C.url, normal({ romperEnlaceEn: 80 }));
    const r = await correr(srv, { fuentes: [A, B, C] });
    expect(r.resultados.map((x) => x.estado)).toEqual(["ok", "ok", "invalida"]);
    expect(r.resultados[2].motivo).toMatch(/encadenan/);
    expect(r.decision).toMatchObject({ veredicto: "discrepan", codigo: 1 });
    expect(r.decision.motivo).toContain("Organización C");
  });
  it("las que no responden no restan: caídas, cortadas o sin permiso", async () => {
    const punto = normal();
    const srv = servidor();
    srv.publicar(A.url, punto);
    srv.publicar(B.url, punto);
    srv.mapa.set(rutaDeArchivo(C.url, "ledger", PUNTO), new Error("conexión cortada"));
    srv.mapa.set(rutaDeArchivo(C.url, "transactions", PUNTO), 403);
    srv.mapa.set(rutaDeArchivo(C.url, "results", PUNTO), 503);
    // un servidor que contesta una página de error con código 200
    const D = { nombre: "Organización D", url: "https://d.example/h" };
    for (const c of ["ledger", "transactions", "results"]) srv.mapa.set(rutaDeArchivo(D.url, c, PUNTO), Buffer.from("<html>No encontrado</html>"));
    const r = await correr(srv, { fuentes: [A, B, C, D] });
    expect(r.resultados.map((x) => x.estado)).toEqual(["ok", "ok", "sin-respuesta", "sin-respuesta"]);
    expect(r.resultados[3].motivo).toMatch(/página de error/);
    expect(r.decision).toMatchObject({ veredicto: "verde", codigo: 0 });
  });
  it("sin ninguna fuente que responda, falla y lo dice", async () => {
    const r = await correr(servidor(), { fuentes: [A, B] });
    expect(r.decision).toMatchObject({ veredicto: "falla", codigo: 1, motivo: "ninguna fuente respondió" });
  });
  it("la reserva solo se consulta si hacen falta más fuentes", async () => {
    const punto = normal();
    const srv = servidor();
    srv.publicar(A.url, punto);
    srv.publicar(B.url, punto);
    srv.publicar(C.url, punto);
    const conDos = await correr(srv, { fuentes: [A, B], reserva: [C] });
    expect(conDos.reserva).toEqual([]);
    expect(srv.pedidos.some((u) => u.startsWith(C.url))).toBe(false);
    const faltaUna = await correr(srv, { fuentes: [A, { nombre: "caída", url: "https://caida.example/h" }], reserva: [C], sesion: sesionDe(srv) });
    expect(faltaUna.reserva).toEqual([C.url]);
    expect(faltaUna.decision).toMatchObject({ veredicto: "verde", codigo: 0 });
  });
  it("la misma sesión no baja dos veces el mismo archivo", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    const sesion = sesionDe(srv);
    await correr(srv, { fuentes: [A], sesion });
    await correr(srv, { fuentes: [A], sesion, hash: H_BUMP_INTERNO });
    expect(srv.pedidos.filter((u) => u.includes("/ledger/"))).toHaveLength(1);
  });
  it("decidir no inventa: los estados de las fuentes mandan", () => {
    const ok = (organizacion, h = "aa", p = "bb") => ({ estado: "ok", organizacion, hashCabecera: h, hashPunto: p, nombre: organizacion });
    expect(decidir([ok("x"), ok("y")]).codigo).toBe(0);
    expect(decidir([ok("x")]).codigo).toBe(2);
    expect(decidir([ok("x"), ok("y", "cc")]).codigo).toBe(1);
    expect(decidir([ok("x"), ok("y", "aa", "dd")]).codigo).toBe(1); // coinciden en el ledger y no en el punto de control
    expect(decidir([]).codigo).toBe(1);
    expect(decidir([{ estado: "invalida", nombre: "z", organizacion: "z" }]).motivo).toMatch(/ninguna fuente confirma/);
  });
});

describe("Horizon solo ubica el ledger", () => {
  it("con --ledger no se le pregunta nada", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    await correr(srv, { fuentes: [A] });
    expect(srv.pedidos.some((u) => u.includes("/transactions/") && !u.includes(".xdr.gz"))).toBe(false);
  });
  it("sin él, el ledger sale de Horizon; si Horizon se equivoca de ledger, la transacción no aparece y no hay verde", async () => {
    const srv = servidor();
    srv.publicar(A.url, normal());
    srv.mapa.set("https://horizon.prueba/transactions/" + H_SELLO, { ledger: 101, created_at: "2026-10-25T13:15:17Z", successful: true });
    const r = await correr(srv, { fuentes: [A], ledger: null, horizon: "https://horizon.prueba" });
    expect(r.ledger).toBe(101);
    expect(r.resultados[0].estado).toBe("invalida");
    expect(r.decision.codigo).toBe(1);
  });
  it("si Horizon no la conoce o no contesta, dice cómo seguir sin él", async () => {
    const srv = servidor();
    await expect(ubicarEnHorizon({ horizon: "https://horizon.prueba", hash: H_SELLO, fetch: srv.f })).rejects.toThrow(/no conoce la transacción.*--ledger/);
    srv.mapa.set("https://horizon.prueba/transactions/" + H_SELLO, new Error("sin red"));
    await expect(ubicarEnHorizon({ horizon: "https://horizon.prueba", hash: H_SELLO, fetch: srv.f })).rejects.toThrow(/no se pudo hablar con Horizon.*--ledger/);
    srv.mapa.set("https://horizon.prueba/transactions/" + H_SELLO, { ledger: "x" });
    await expect(ubicarEnHorizon({ horizon: "https://horizon.prueba", hash: H_SELLO, fetch: srv.f })).rejects.toThrow(/sin el ledger/);
  });
  it("no se pregunta por algo que no es un hash, ni en una red que no existe", async () => {
    const srv = servidor();
    await expect(verificarTransaccion({ red: "testnet", hash: "xyz", fuentes: [A], ledger: 100, fetch: srv.f })).rejects.toThrow(/64 caracteres/);
    await expect(verificarTransaccion({ red: "otra", hash: H_SELLO, fuentes: [A], ledger: 100, fetch: srv.f })).rejects.toThrow(/red desconocida/);
    expect(srv.pedidos).toEqual([]);
  });
});

describe("las fuentes de siempre", () => {
  it("en mainnet son cinco organizaciones distintas y una de reserva, todas por https", () => {
    const { fuentes, reserva } = fuentesPorDefecto("mainnet");
    expect(fuentes).toHaveLength(5);
    expect(new Set(fuentes.map((f) => organizacionDe(f.url))).size).toBe(5);
    expect(reserva.map((f) => organizacionDe(f.url))).toEqual(["publicnode.org"]);
    for (const f of [...fuentes, ...reserva]) expect(f.url).toMatch(/^https:\/\//);
    expect(fuentes.map((f) => organizacionDe(f.url))).toEqual(["stellar.org", "franklintempleton.com", "lobstr.co", "bdnodes.net", "moneygram.com"]);
  });
  it("en testnet es una sola, la de la SDF", () => {
    const { fuentes, reserva } = fuentesPorDefecto("testnet");
    expect(fuentes).toHaveLength(1);
    expect(organizacionDe(fuentes[0].url)).toBe("stellar.org");
    expect(reserva).toEqual([]);
    expect(() => fuentesPorDefecto("otra")).toThrow(/no hay fuentes/);
  });
  it("la organización es el dominio, no el servidor", () => {
    expect(organizacionDe("https://stellar-history1.franklintempleton.com/history1")).toBe("franklintempleton.com");
    expect(organizacionDe("https://archive.v1.stellar.lobstr.co")).toBe("lobstr.co");
    expect(organizacionDe("https://x.y.ejemplo.co.uk/h")).toBe("ejemplo.co.uk");
    expect(organizacionDe("http://127.0.0.1:8000/h")).toBe("127.0.0.1");
    expect(organizacionDe("https://localhost/h")).toBe("localhost");
  });
});

describe("el comprobante", () => {
  const stx = "ab".repeat(32);
  const dtx = "CD".repeat(32);
  const datos = { v: 2, names: ["a", "b"], round: 5, net: "testnet", contract: "C…", id: "7", stx, dtx };
  const fragmento = (obj, tipo) => {
    const crudo = Buffer.from(JSON.stringify(obj));
    return tipo + (tipo === "z" ? zlib.deflateRawSync(crudo) : crudo).toString("base64url");
  };

  it("lee el enlace de verificación comprimido, el sin comprimir, el fragmento solo y el archivo guardado", () => {
    const esperado = { red: "testnet", stx, dtx: dtx.toLowerCase() };
    expect(leerComprobante(`https://ejemplo.test/verificar.html#${fragmento(datos, "z")}`)).toEqual(esperado);
    expect(leerComprobante(`https://ejemplo.test/verificar.html?lang=en#${fragmento(datos, "r")}`)).toEqual(esperado);
    expect(leerComprobante(fragmento(datos, "z"))).toEqual(esperado);
    expect(leerComprobante(`#${fragmento(datos, "z")}`)).toEqual(esperado);
    expect(leerComprobante(JSON.stringify(datos, null, 2))).toEqual(esperado);
  });
  it("lo que no es un hash se descarta y la red se reconoce", () => {
    expect(leerComprobante(JSON.stringify({ net: "mainnet", stx: "zz", dtx: 5 }))).toEqual({ red: "mainnet", stx: null, dtx: null });
    expect(leerComprobante(JSON.stringify({ net: "public", stx }))).toMatchObject({ red: "mainnet" });
    expect(leerComprobante(JSON.stringify({ stx }))).toMatchObject({ red: null });
  });
  it("un enlace corto, un enlace sin comprobante o basura se rechazan con un motivo", () => {
    expect(() => leerComprobante("https://tinkazo.app/c/abc123#clave")).toThrow(/enlace corto/);
    expect(() => leerComprobante("https://ejemplo.test/verificar.html")).toThrow(/no trae un comprobante/);
    expect(() => leerComprobante("#xAAAA")).toThrow(/formato que no conozco/);
    expect(() => leerComprobante("#zAAAA")).toThrow();
  });
});

describe("la hora", () => {
  it("se muestra en UTC, sin milisegundos", () => {
    expect(fechaUtc(0)).toBe("1970-01-01 00:00:00 UTC");
    expect(fechaUtc(1792934117)).toBe("2026-10-25 13:15:17 UTC");
  });
});
