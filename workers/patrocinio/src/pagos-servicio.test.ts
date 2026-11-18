/**
 * El portero de los pagos de premios y retiros, entero y sin red: un SQLite de prueba, una red de mentira (cuentas, sorteos y
 * envíos), un Horizon de mentira, dos RPC sueltos y el reloj a mano. Ninguna prueba espera de verdad ni toca la red.
 */
import {
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { AHORA_DE_PRUEBA, armarPago, comoFeeBump, type VariantePago } from "./armar-pago";
import { EMISOR_USDC } from "./cobros";
import { DIA_MS, type Env, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { verificarFirma } from "./lista-blanca";
import {
  PLAZO_PARA_RESERVAR_MS,
  PorteroDePagos,
  armarPorteroDePagos,
  pagosPrendidos,
  vueltaDeAlarma,
  type DependenciasDePagos,
} from "./pagos-servicio";
import { UsoDePagos } from "./pagos-uso";
import { ErrorDeRed, type Consulta, type CuentaEnRed, type Envio, type Red, type Simulacion } from "./red";
import { type Modo, firmanteDe } from "./servicio";
import { haciaHorizon } from "./servidores";
import { sqlDePrueba } from "./sqlite-prueba";

const T0 = AHORA_DE_PRUEBA * 1000;
const VENCE = AHORA_DE_PRUEBA + 240;
const patrocinadora = Keypair.random();
const llave = Keypair.random();
const cobros = Keypair.random();
const COBROS = cobros.publicKey();
const CONTRATO = deployments.mainnet.contractId;
/** Distinto de cualquier número que aparezca por casualidad en una cifra: así se puede buscar en la bitácora. */
const SORTEO = "987654321";
const LISTA = new Uint8Array(32).fill(0xab);
const RONDA = 99;
const COSTO = 5_000_000;

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// ---------- la red de mentira ----------

interface SorteoFalso {
  organizador: string;
  ganadores: number;
  estado: "Sealed" | "Drawn";
}

/** El `Option<Raffle>` que devuelve `get_raffle`, con las claves en el orden del contrato. */
function raffleScVal(id: bigint, s: SorteoFalso | null): xdr.ScVal {
  if (!s) return xdr.ScVal.scvVoid();
  const e = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    e("count", nativeToScVal(10, { type: "u32" })),
    e("id", nativeToScVal(id, { type: "u64" })),
    e("list_hash", nativeToScVal(LISTA, { type: "bytes" })),
    e("meta", nativeToScVal("premio", { type: "string" })),
    e("num_winners", nativeToScVal(s.ganadores, { type: "u32" })),
    e("organizer", new Address(s.organizador).toScVal()),
    e("round", nativeToScVal(BigInt(RONDA), { type: "u64" })),
    e("sealed_at", nativeToScVal(1_700_000_000n, { type: "u64" })),
    e("sealed_ledger", nativeToScVal(100, { type: "u32" })),
    e("status", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(s.estado)])),
  ]);
}

/** El número de sorteo que lee una simulación de `get_raffle`. */
function sorteoDeLaLectura(x: string): bigint {
  const env = xdr.TransactionEnvelope.fromXDR(x, "base64") as unknown as {
    value: { tx: { operations: Array<{ body: { value: { hostFunction: { value: { args: xdr.ScVal[] } } } } }> } };
  };
  const arg = env.value.tx.operations[0]?.body.value.hostFunction.value.args[0];
  return BigInt(scValToNative(arg as xdr.ScVal) as bigint);
}

class RedFalsa implements Red {
  sorteos = new Map<bigint, SorteoFalso>();
  cuentas = new Map<string, CuentaEnRed | null>();
  envio: Envio | (() => Envio) = { status: "PENDING" };
  consultas = new Map<string, Consulta>();
  fallaEnviar = false;
  lecturaCaida = false;
  /** Lo que pasa cada vez que se lee una cuenta: sirve para adelantar el reloj, como una red lenta. */
  alLeerCuenta: () => void = () => {};
  enviados: string[] = [];

  async simular(x: string): Promise<Simulacion> {
    if (this.lecturaCaida) throw new ErrorDeRed("rpc-corte");
    const id = sorteoDeLaLectura(x);
    return { ok: true, minResourceFee: 1000, retorno: raffleScVal(id, this.sorteos.get(id) ?? null).toXDR("base64") };
  }
  async leerCuenta(g: string): Promise<CuentaEnRed | null> {
    this.alLeerCuenta();
    return this.cuentas.get(g) ?? null;
  }
  async enviar(x: string): Promise<Envio> {
    this.enviados.push(x);
    if (this.fallaEnviar) throw new ErrorDeRed("corte");
    return typeof this.envio === "function" ? this.envio() : this.envio;
  }
  async consultar(hash: string): Promise<Consulta> {
    return this.consultas.get(hash) ?? { status: "NOT_FOUND" };
  }
}

/** Un RPC suelto: lo único que se le pregunta es por una transacción. */
class RpcSuelto {
  consultas = new Map<string, Consulta>();
  caido = false;
  /** Cuántas veces se le preguntó con un tiempo propio, como cuando la red acaba de rechazar un pago por su secuencia. */
  conTiempo = 0;
  async consultar(hash: string, senal?: AbortSignal): Promise<Consulta> {
    if (senal) this.conTiempo++;
    if (this.caido) throw new ErrorDeRed("rpc-corte");
    return this.consultas.get(hash) ?? { status: "NOT_FOUND" };
  }
}

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const linea = {
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: EMISOR_USDC,
  balance: "100.0000000",
  limit: "922337203685.4775807",
  buying_liabilities: "0.0000000",
  selling_liabilities: "0.0000000",
  is_authorized: true,
};
const nativo = { asset_type: "native", balance: "0.0000000", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" };
/** Una cuenta sana: con su línea del USDC de Circle, saldo y lugar. */
const sana = () => respuesta({ id: "G", balances: [nativo, linea], data: {} });

/** Un Horizon de mentira: toda cuenta es sana salvo la que se diga, y ninguna transacción existe salvo la que se diga. */
function horizonFalso() {
  const h = {
    pedidos: [] as string[],
    cuentas: new Map<string, () => Response>(),
    transacciones: new Map<string, () => Response>(),
    caido: false,
    fetch: async (url: string): Promise<Response> => {
      h.pedidos.push(url);
      if (h.caido) return respuesta({}, 503);
      const u = new URL(url);
      const cuenta = /^\/accounts\/([^/]+)$/.exec(u.pathname)?.[1];
      const tx = /^\/transactions\/([^/]+)$/.exec(u.pathname)?.[1];
      if (cuenta) return h.cuentas.get(cuenta)?.() ?? sana();
      if (tx) return h.transacciones.get(tx)?.() ?? respuesta({}, 404);
      return respuesta({}, 404);
    },
    pedir: undefined as unknown as ReturnType<typeof haciaHorizon>,
  };
  h.pedir = haciaHorizon(h.fetch);
  return h;
}

// ---------- el portero armado ----------

async function montar(env: Partial<Env> = {}) {
  const sql = sqlDePrueba();
  const cupos = new Cupos(sql);
  const registros: Array<[string, Record<string, string | number> | undefined]> = [];
  const registrar = (evento: string, datos?: Record<string, string | number>) => void registros.push([evento, datos]);
  const uso = new UsoDePagos(sql, registrar);
  const cfg = leerConfig({
    RED: "mainnet",
    ALTAS: "1",
    POLLAR_APP_ID: "app_x",
    PAGOS_PREMIO: "1",
    RETIROS: "1",
    CUENTA_COBROS: COBROS,
    COSTO_RETIRO: "0.50",
    CUENTA_PATROCINADORA: patrocinadora.publicKey(),
    ...env,
  });
  const red = new RedFalsa();
  const rpc = [new RpcSuelto(), new RpcSuelto()];
  const horizon = horizonFalso();
  const estado = { ahora: T0, modo: "portero" as Modo, alAire: 0 };
  const dependencias: DependenciasDePagos = {
    cfg,
    uso,
    cupos,
    red,
    redesSueltas: rpc,
    pedirHorizon: horizon.pedir,
    firmante: await firmanteDe(llave.secret()),
    cuentaPatrocinadora: patrocinadora.publicKey(),
    modo: () => estado.modo,
    reloj: () => estado.ahora,
    alQuedarEnElAire: () => void estado.alAire++,
    registrar,
  };
  const p = new PorteroDePagos(dependencias);
  return { sql, cupos, uso, cfg, red, rpc, horizon, p, estado, registros, dependencias };
}
type Montaje = Awaited<ReturnType<typeof montar>>;

/** Una cuenta del libro. */
function delLibro(m: Montaje): Keypair {
  const k = Keypair.random();
  m.cupos.admitir(k.publicKey(), "admin", m.estado.ahora);
  return k;
}

/** El sorteo `id` en la red, de `organizador`, y su sello pagado por el portero (salvo que se diga que no). */
interface OpcionesDeSorteo {
  id?: string;
  ganadores?: number;
  estado?: "Sealed" | "Drawn";
  /** Si el portero pagó el sello. Por defecto sí. */
  sello?: boolean;
  /** El organizador que dice la red, si no es el que paga. */
  en?: string;
}

function sorteoSellado(m: Montaje, organizador: string, o: OpcionesDeSorteo = {}) {
  const id = BigInt(o.id ?? SORTEO);
  m.red.sorteos.set(id, { organizador: o.en ?? organizador, ganadores: o.ganadores ?? 3, estado: o.estado ?? "Drawn" });
  if (o.sello !== false) {
    const insertar = "INSERT INTO sellos_portero (hash, organizador, huella_lista, ronda, ms) VALUES (?, ?, ?, ?, ?)";
    m.sql.exec(insertar, `sello-${id}`, o.en ?? organizador, hex(LISTA), RONDA, T0);
  }
}

const premio = (org: Keypair, o: Partial<VariantePago> = {}) =>
  armarPago({ firmante: org, forma: "premio", cobros: COBROS, sorteo: SORTEO, puesto: 0, ...o });
const retiro = (org: Keypair, o: Partial<VariantePago> = {}) => armarPago({ firmante: org, forma: "retiro", cobros: COBROS, ...o });
const aLaRed = (m: Montaje): FeeBumpTransaction => TransactionBuilder.fromXDR(m.red.enviados[0] as string, Networks.PUBLIC) as FeeBumpTransaction;

/** Lo que dice la red de una transacción que entró. */
const entro = (feeCharged = 200): Consulta => ({ status: "SUCCESS", feeCharged });
const fallo = (feeCharged = 200): Consulta => ({ status: "FAILED", feeCharged });

// ---------- un pago nuevo ----------

describe("un premio pagado", () => {
  it("lo envuelve en un fee-bump de la patrocinadora con 2 veces la inclusión, firmado solo con la llave del Worker, y queda enviado", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const ganadora = Keypair.random().publicKey();
    const t = premio(org, { persona: ganadora });
    expect(await m.p.procesar("premio", t.xdr)).toEqual({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "premio", vence: VENCE, status: "PENDING", estado: "en-camino" },
    });
    expect(m.red.enviados).toHaveLength(1);
    const bump = aLaRed(m);
    expect(bump.feeSource).toBe(patrocinadora.publicKey());
    expect(bump.fee).toBe(String(2 * 10_000));
    expect(hex(bump.innerTransaction.hash())).toBe(t.hash);
    expect(bump.signatures).toHaveLength(1);
    const firma = bump.signatures[0] as unknown as { signature: { value: Uint8Array } };
    expect(await verificarFirma(llave.rawPublicKey(), firma.signature.value, bump.hash())).toBe(true);
    expect(m.uso.buscar(t.hash)).toMatchObject({
      estado: "enviado",
      forma: "premio",
      cuenta: org.publicKey(),
      delLibro: true,
      contrato: CONTRATO,
      sorteo: SORTEO,
      puesto: 0,
      envuelta: hex(bump.hash()),
      estimado: 20_000,
      vence: VENCE,
    });
    expect(m.estado.alAire).toBeGreaterThan(0);
  });
});

describe("un retiro pagado", () => {
  it("lo envuelve con 3 veces la inclusión y guarda las dos filas: el pago y el costo que se exigió", async () => {
    const m = await montar();
    const org = delLibro(m);
    const t = retiro(org);
    expect(await m.p.procesar("retiro", t.xdr)).toMatchObject({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "retiro", status: "PENDING", estado: "en-camino" },
    });
    const bump = aLaRed(m);
    expect(bump.fee).toBe(String(3 * 10_000));
    expect(m.uso.buscar(t.hash)).toMatchObject({
      estado: "enviado",
      forma: "retiro",
      delLibro: true,
      estimado: 30_000,
      contrato: null,
      sorteo: null,
    });
    expect(m.sql.exec("SELECT * FROM retiros_cobrados").toArray()).toEqual([
      { hash: t.hash, envuelta: hex(bump.hash()), cuenta: org.publicKey(), costo: COSTO, ms: T0 },
    ]);
  });

  it("de una cuenta que no está en el libro también se paga, y su firma no se explica", async () => {
    const m = await montar();
    const fuera = Keypair.random();
    const t = retiro(fuera);
    expect(await m.p.procesar("retiro", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "enviado", delLibro: false });
    expect(m.uso.firmas(0)).toEqual({ premios: 0, retiros: 0 });
  });
});

describe("el mismo pago dos veces (el sitio reintenta)", () => {
  it("(ataque) da el mismo resultado, una sola reserva, y el reenvío es el mismo sobre envuelto", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const t = premio(org);
    await m.p.procesar("premio", t.xdr);
    m.red.envio = { status: "DUPLICATE" };
    expect(await m.p.procesar("premio", t.xdr)).toEqual({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "premio", vence: VENCE, status: "DUPLICATE", estado: "en-camino" },
    });
    expect(m.red.enviados).toHaveLength(2);
    expect(m.red.enviados[1]).toBe(m.red.enviados[0]);
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM pagos_portero").toArray()).toEqual([{ n: 1 }]);
    expect(m.uso.resumen(T0).premio.enElAire).toBe(1);
  });

  it("después de vencida se contesta por su hash y no por la ventana: en camino sin mandar nada, o lo que dijo la red", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const t = premio(org);
    await m.p.procesar("premio", t.xdr);
    m.estado.ahora = (AHORA_DE_PRUEBA + 400) * 1000;
    expect(await m.p.procesar("premio", t.xdr)).toEqual({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "premio", vence: VENCE, status: "DUPLICATE", estado: "en-camino" },
    });
    expect(m.red.enviados).toHaveLength(1);
    m.red.consultas.set(t.hash, entro(215));
    expect(await m.p.procesar("premio", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "DUPLICATE", estado: "ok" } });
    expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 215 });
    // Ya cerrado, también vencido: lo que dice su estado.
    expect(await m.p.procesar("premio", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "DUPLICATE", estado: "ok" } });
  });

  it("uno nuevo, vencido, sí se rechaza por su ventana", async () => {
    const m = await montar();
    const org = delLibro(m);
    m.estado.ahora = (AHORA_DE_PRUEBA + 400) * 1000;
    expect(await m.p.procesar("retiro", retiro(org).xdr)).toMatchObject({
      estado: 400,
      cuerpo: { motivo: "no-permitida", razon: "ventana", detalle: "vencida", pudoSalir: false },
    });
  });
});

// ---------- el premio y su sorteo ----------

describe("el premio mira el sorteo en la red", () => {
  it("(ataque) un sorteo de otro organizador da sorteo-ajeno, y uno que no existe también", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey(), { en: Keypair.random().publicKey() });
    expect(await m.p.procesar("premio", premio(org).xdr)).toEqual({
      estado: 403,
      cuerpo: { motivo: "sorteo-ajeno", detalle: "otro-organizador", pudoSalir: false },
    });
    expect(await m.p.procesar("premio", premio(org, { sorteo: "111" }).xdr)).toEqual({
      estado: 403,
      cuerpo: { motivo: "sorteo-ajeno", detalle: "no-existe", pudoSalir: false },
    });
    expect(m.red.enviados).toHaveLength(0);
  });

  it("un sorteo sin sortear da sin-sortear", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey(), { estado: "Sealed" });
    expect(await m.p.procesar("premio", premio(org).xdr)).toEqual({ estado: 409, cuerpo: { motivo: "sin-sortear", pudoSalir: false } });
  });

  it("(ataque) un puesto igual a la cantidad de ganadores no existe: no-permitida puesto", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey(), { ganadores: 3 });
    expect(await m.p.procesar("premio", premio(org, { puesto: 3 }).xdr)).toEqual({
      estado: 400,
      cuerpo: { motivo: "no-permitida", razon: "puesto", detalle: "no-existe", pudoSalir: false },
    });
    // El último puesto que existe sí se paga.
    expect(await m.p.procesar("premio", premio(org, { puesto: 2 }).xdr)).toMatchObject({ estado: 200 });
  });

  it("de una cuenta que no está en el libro da cuenta-ajena, sin mirar el sorteo", async () => {
    const m = await montar();
    const fuera = Keypair.random();
    sorteoSellado(m, fuera.publicKey());
    expect(await m.p.procesar("premio", premio(fuera).xdr)).toEqual({ estado: 403, cuerpo: { motivo: "cuenta-ajena", pudoSalir: false } });
    expect(m.red.enviados).toHaveLength(0);
  });

  it("(ataque) de un sello que no pagó el portero da no-es-nuestro, también con SOLO_SELLOS_PORTERO en 0", async () => {
    for (const env of [{}, { SOLO_SELLOS_PORTERO: "0" }]) {
      const m = await montar(env);
      const org = delLibro(m);
      sorteoSellado(m, org.publicKey(), { sello: false });
      expect(await m.p.procesar("premio", premio(org).xdr), JSON.stringify(env)).toEqual({
        estado: 403,
        cuerpo: { motivo: "no-es-nuestro", pudoSalir: false },
      });
      expect(m.red.enviados).toHaveLength(0);
    }
  });

  it("si la red no deja leer el sorteo, 502 red y no se reserva nada ni se le pregunta a Horizon", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    m.red.lecturaCaida = true;
    const t = premio(org);
    expect(await m.p.procesar("premio", t.xdr)).toMatchObject({ estado: 502, cuerpo: { motivo: "red", pudoSalir: false } });
    expect(m.uso.buscar(t.hash)).toBeNull();
    expect(m.horizon.pedidos).toHaveLength(0);
  });

  it("dos premios del mismo puesto: el segundo da puesto-usado con el hash del primero", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const primero = premio(org);
    await m.p.procesar("premio", primero.xdr);
    const otro = premio(org, { secuencia: "101" });
    expect(await m.p.procesar("premio", otro.xdr)).toEqual({
      estado: 409,
      cuerpo: { motivo: "puesto-usado", hash: primero.hash, estado: "en-camino", pudoSalir: false },
    });
  });

  it("(ataque) dos premios del mismo puesto a la vez: se reserva uno solo y el otro da puesto-usado", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const a = premio(org);
    const b = premio(org, { secuencia: "101" });
    const [ra, rb] = await Promise.all([m.p.procesar("premio", a.xdr), m.p.procesar("premio", b.xdr)]);
    expect([ra.estado, rb.estado].sort()).toEqual([200, 409]);
    expect([ra, rb].find((r) => r.estado === 409)?.cuerpo).toMatchObject({ motivo: "puesto-usado" });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM pagos_portero").toArray()).toEqual([{ n: 1 }]);
    expect(m.red.enviados).toHaveLength(1);
  });

  it("(ataque) el mismo sobre dos veces a la vez: una sola reserva, y los dos contestan en camino", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const t = premio(org);
    const [ra, rb] = await Promise.all([m.p.procesar("premio", t.xdr), m.p.procesar("premio", t.xdr)]);
    expect(ra).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, estado: "en-camino" } });
    expect(rb).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, estado: "en-camino" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM pagos_portero").toArray()).toEqual([{ n: 1 }]);
    expect(m.uso.resumen(T0).gasto24h).toBe(20_000);
  });
});

// ---------- lo que mira Horizon ----------

describe("la mirada previa en Horizon", () => {
  it("si Horizon no contesta, 502 red horizon, sin reservar nada", async () => {
    const m = await montar();
    const org = delLibro(m);
    m.horizon.caido = true;
    const t = retiro(org);
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "horizon", pudoSalir: false } });
    expect(m.uso.buscar(t.hash)).toBeNull();
    expect(m.red.enviados).toHaveLength(0);
  });

  it("lo que Horizon dice que fallaría es 400 fallaria con su razón, sin reservar nada", async () => {
    const m = await montar();
    const org = delLibro(m);
    m.horizon.cuentas.set(org.publicKey(), () => respuesta({ id: "G", balances: [nativo], data: {} }));
    const t = retiro(org);
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({
      estado: 400,
      cuerpo: { motivo: "fallaria", detalle: "origen-sin-linea", pudoSalir: false },
    });
    expect(m.uso.buscar(t.hash)).toBeNull();
  });

  it("(ataque) veinte fallaria de una cuenta en una hora: el siguiente da cupo-cuenta fallaria sin preguntarle a Horizon", async () => {
    const m = await montar();
    const org = delLibro(m);
    m.horizon.cuentas.set(org.publicKey(), () => respuesta({}, 404));
    const t = retiro(org);
    for (let i = 0; i < 20; i++) {
      expect(await m.p.procesar("retiro", t.xdr), `intento ${i + 1}`).toMatchObject({
        estado: 400,
        cuerpo: { motivo: "fallaria", detalle: "origen-sin-cuenta" },
      });
    }
    const pedidos = m.horizon.pedidos.length;
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({
      estado: 429,
      cuerpo: { motivo: "cupo-cuenta", que: "fallaria", liberaEn: T0 + 3_600_000, max: 20, pudoSalir: false },
    });
    expect(m.horizon.pedidos).toHaveLength(pedidos);
    // Otra cuenta no se ve afectada.
    expect(await m.p.procesar("retiro", retiro(delLibro(m)).xdr)).toMatchObject({ estado: 200 });
  });
});

// ---------- los interruptores ----------

describe("las variables, la pausa y el modo", () => {
  it("con PAGOS_PREMIO en 0 el premio da apagado variable y el retiro pasa, y al revés con RETIROS", async () => {
    const sinPremio = await montar({ PAGOS_PREMIO: "0" });
    const org = delLibro(sinPremio);
    sorteoSellado(sinPremio, org.publicKey());
    expect(await sinPremio.p.procesar("premio", premio(org).xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "apagado", forma: "premio", detalle: "variable", pudoSalir: false },
    });
    expect(await sinPremio.p.procesar("retiro", retiro(org).xdr)).toMatchObject({ estado: 200 });

    const sinRetiros = await montar({ RETIROS: "0" });
    const otra = delLibro(sinRetiros);
    sorteoSellado(sinRetiros, otra.publicKey());
    expect(await sinRetiros.p.procesar("retiro", retiro(otra).xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "apagado", forma: "retiro", detalle: "variable", pudoSalir: false },
    });
    expect(await sinRetiros.p.procesar("premio", premio(otra).xdr)).toMatchObject({ estado: 200 });
  });

  it("pausado por administración da apagado pausado a lo nuevo, y un reenvío de algo ya reservado se manda igual", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const primero = premio(org);
    await m.p.procesar("premio", primero.xdr);
    m.cupos.fijarAjuste("pagos_premio_pausado", "1", T0);
    expect(await m.p.procesar("premio", premio(org, { puesto: 1, secuencia: "101" }).xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "apagado", forma: "premio", detalle: "pausado", pudoSalir: false },
    });
    // El retiro no está pausado: los sellos y las otras formas siguen.
    expect(await m.p.procesar("retiro", retiro(delLibro(m)).xdr)).toMatchObject({ estado: 200 });
    // Lo ya reservado se vuelve a mandar.
    expect(await m.p.procesar("premio", primero.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: primero.hash } });
    expect(m.red.enviados.filter((x) => x === m.red.enviados[0])).toHaveLength(2);
  });

  it("con el portero apagado o devuelto a Pollar no paga ningún pago", async () => {
    for (const modo of ["apagado", "pollar"] as const) {
      const m = await montar();
      const org = delLibro(m);
      sorteoSellado(m, org.publicKey());
      m.estado.modo = modo;
      expect(await m.p.procesar("premio", premio(org).xdr), modo).toEqual({
        estado: 503,
        cuerpo: { motivo: "apagado", forma: "premio", detalle: "modo", pudoSalir: false },
      });
      expect(await m.p.procesar("retiro", retiro(org).xdr), modo).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado", detalle: "modo" } });
      expect(m.red.enviados).toHaveLength(0);
    }
  });

  it("sin las tablas, sin llave o sin cuenta que paga da apagado config", async () => {
    const sinTablas = await montar();
    Object.defineProperty(sinTablas.uso, "disponible", { value: () => false });
    expect(await sinTablas.p.procesar("retiro", retiro(delLibro(sinTablas)).xdr)).toMatchObject({
      estado: 503,
      cuerpo: { motivo: "apagado", detalle: "config" },
    });
    const m = await montar();
    const sinLlave = new PorteroDePagos({ ...m.dependencias, firmante: null });
    expect(await sinLlave.procesar("retiro", retiro(delLibro(m)).xdr)).toMatchObject({
      estado: 503,
      cuerpo: { motivo: "apagado", detalle: "config" },
    });
    const sinCuenta = new PorteroDePagos({ ...m.dependencias, cuentaPatrocinadora: null });
    expect(await sinCuenta.procesar("retiro", retiro(delLibro(m)).xdr)).toMatchObject({
      estado: 503,
      cuerpo: { motivo: "apagado", detalle: "config" },
    });
  });

  it("con todo apagado ni se lee el sobre ni se le pregunta nada a la red ni a Horizon", async () => {
    const m = await montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "0" });
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    expect(await m.p.procesar("premio", premio(org).xdr)).toMatchObject({ estado: 503, cuerpo: { detalle: "variable" } });
    expect(await m.p.procesar("retiro", retiro(org).xdr)).toMatchObject({ estado: 503, cuerpo: { detalle: "variable" } });
    expect(m.red.enviados).toHaveLength(0);
    expect(m.horizon.pedidos).toHaveLength(0);
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM pagos_portero").toArray()).toEqual([{ n: 0 }]);
    expect(m.p.cupoDe(org.publicKey())).toBeNull();
    expect(m.p.resumenDeEstado(T0, () => ({ cuantos: 0, monto: 0 }))).toBeNull();
  });
});

// ---------- lo que no entra ----------

describe("lo que la red no toma", () => {
  it("(ataque) dos costos distintos: el portero con 0,50 y un sobre con 0,40 da costo-monto, sin tocar la red", async () => {
    const m = await montar();
    const org = delLibro(m);
    expect(await m.p.procesar("retiro", retiro(org, { costo: "0.4000000" }).xdr)).toEqual({
      estado: 400,
      cuerpo: { motivo: "no-permitida", razon: "costo-monto", detalle: "segunda", pudoSalir: false },
    });
    expect(m.red.enviados).toHaveLength(0);
    expect(m.horizon.pedidos).toHaveLength(0);
  });

  it("(ataque) una nueva que la red no toma (txBadSeq) da rechazada, queda devuelta y no suma una firma explicada fuera del libro", async () => {
    const m = await montar();
    const dentro = delLibro(m);
    const fuera = Keypair.random();
    m.red.envio = { status: "ERROR", codigo: "txFeeBumpInnerFailed/txBadSeq" };
    const a = retiro(dentro);
    const b = retiro(fuera);
    expect(await m.p.procesar("retiro", a.xdr)).toEqual({
      estado: 400,
      cuerpo: { motivo: "rechazada", codigo: "txFeeBumpInnerFailed/txBadSeq", pudoSalir: false },
    });
    expect(await m.p.procesar("retiro", b.xdr)).toMatchObject({ estado: 400, cuerpo: { motivo: "rechazada", pudoSalir: false } });
    expect(m.uso.buscar(a.hash)?.estado).toBe("devuelto");
    expect(m.uso.buscar(b.hash)?.estado).toBe("devuelto");
    // Solo la del libro cuesta una firma de Pollar, que se explica: la de afuera no.
    expect(m.uso.firmas(0)).toEqual({ premios: 0, retiros: 1 });
  });

  it("TRY_AGAIN_LATER en una nueva da 502 red y la fila queda devuelta", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.envio = { status: "TRY_AGAIN_LATER" };
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "TRY_AGAIN_LATER", pudoSalir: false } });
    expect(m.uso.buscar(t.hash)?.estado).toBe("devuelto");
  });

  it("sin saldo en la cuenta que paga, 503 fondo saldo", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.envio = { status: "ERROR", codigo: "txInsufficientBalance" };
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "fondo", detalle: "saldo", codigo: "txInsufficientBalance", pudoSalir: false },
    });
    expect(m.uso.buscar(t.hash)?.estado).toBe("devuelto");
  });

  it("un devuelto se puede mandar otra vez: se reserva de nuevo", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.envio = { status: "TRY_AGAIN_LATER" };
    await m.p.procesar("retiro", t.xdr);
    m.red.envio = { status: "PENDING" };
    expect(await m.p.procesar("retiro", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
  });

  it("(ataque) una nueva que un RPC rechaza por su secuencia y otro ya tiene adentro no se devuelve: se cierra con lo que pasó", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const t = premio(org);
    m.red.envio = { status: "ERROR", codigo: "txFeeBumpInnerFailed/txBadSeq" };
    m.rpc[1]?.consultas.set(t.hash, entro(210));
    expect(await m.p.procesar("premio", t.xdr)).toEqual({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "premio", vence: VENCE, status: "DUPLICATE", estado: "ok" },
    });
    expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 210 });
    expect(m.uso.puestoUsado(CONTRATO, SORTEO, 0)).toEqual({ hash: t.hash, estado: "ok" });
    // Se les preguntó a los dos, cada uno con su tiempo corto.
    expect(m.rpc.map((r) => r.conTiempo)).toEqual([1, 1]);
  });

  it("una devuelta que ya entró no se manda de nuevo: se cierra con lo que dice la red", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.envio = { status: "TRY_AGAIN_LATER" };
    await m.p.procesar("retiro", t.xdr);
    expect(m.uso.buscar(t.hash)?.estado).toBe("devuelto");
    m.red.consultas.set(t.hash, entro(230));
    m.red.envio = { status: "PENDING" };
    expect(await m.p.procesar("retiro", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "DUPLICATE", estado: "ok" } });
    expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 230 });
    expect(m.red.enviados).toHaveLength(1);
  });

  it("si limpiar las tablas falla, el pago se manda igual, la alarma queda pedida y se anota", async () => {
    const m = await montar();
    Object.defineProperty(m.uso, "purgar", {
      value: () => {
        throw new Error("SQLITE_FULL");
      },
    });
    const t = retiro(delLibro(m));
    expect(await m.p.procesar("retiro", t.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
    expect(m.estado.alAire).toBeGreaterThan(0);
    expect(m.registros.some(([e, d]) => e === "error-interno" && d?.donde === "purgar-pagos")).toBe(true);
  });

  it("corte al mandar: 502 red con pudoSalir verdadero, queda reservado y la alarma lo cierra", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.fallaEnviar = true;
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "corte", pudoSalir: true } });
    expect(m.uso.buscar(t.hash)?.estado).toBe("reservado");
    m.red.consultas.set(t.hash, entro(215));
    m.estado.ahora += 20_000;
    expect(await m.p.reconciliar()).toBe(false);
    expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 215 });
  });

  it("(ataque) el reenvío de una fila reservada que la red rechaza con txBadSeq da DUPLICATE en camino y no se devuelve", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.fallaEnviar = true;
    await m.p.procesar("retiro", t.xdr);
    m.red.fallaEnviar = false;
    m.red.envio = { status: "ERROR", codigo: "txFeeBumpInnerFailed/txBadSeq" };
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({
      estado: 200,
      cuerpo: { hash: t.hash, forma: "retiro", vence: VENCE, status: "DUPLICATE", estado: "en-camino" },
    });
    expect(m.uso.buscar(t.hash)?.estado).toBe("reservado");
  });

  it("el plazo: si leer la cuenta tardó más de 36 s, 502 red plazo, sin reservar nada", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.alLeerCuenta = () => void (m.estado.ahora += PLAZO_PARA_RESERVAR_MS + 4_000);
    expect(await m.p.procesar("retiro", t.xdr)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "plazo", pudoSalir: false } });
    expect(m.uso.buscar(t.hash)).toBeNull();
    expect(m.red.enviados).toHaveLength(0);
  });

  it("una firma que no alcanza el umbral de la cuenta se rechaza antes de pagar", async () => {
    const m = await montar();
    const org = delLibro(m);
    m.red.cuentas.set(org.publicKey(), { patrocinador: null, balance: 0n, firmantes: [{ clave: org.rawPublicKey(), peso: 1 }], umbralMedio: 2 });
    expect(await m.p.procesar("retiro", retiro(org).xdr)).toMatchObject({
      estado: 400,
      cuerpo: { motivo: "no-permitida", razon: "firma", detalle: "peso-insuficiente" },
    });
    expect(m.red.enviados).toHaveLength(0);
  });
});

describe("los topes de las tablas se traducen para el sitio", () => {
  it("sin presupuesto: 503 fondo presupuesto", async () => {
    const m = await montar({ TOPE_PAGOS_STROOPS: "10000" });
    expect(await m.p.procesar("retiro", retiro(delLibro(m)).xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "fondo", detalle: "presupuesto", pudoSalir: false },
    });
  });

  it("el tercer retiro de una cuenta que la red rechazó dos veces da 429 cupo-cuenta rechazos, con cuándo se libera", async () => {
    const m = await montar();
    const org = delLibro(m);
    for (const secuencia of ["100", "101"]) {
      const t = retiro(org, { secuencia });
      await m.p.procesar("retiro", t.xdr);
      m.red.consultas.set(t.hash, fallo());
      m.estado.ahora += 20_000;
      await m.p.reconciliar();
      expect(m.uso.buscar(t.hash)?.estado).toBe("fallo");
    }
    expect(m.uso.resumen(m.estado.ahora).retiro.fallo24h).toBe(2);
    expect(await m.p.procesar("retiro", retiro(org, { secuencia: "102" }).xdr)).toEqual({
      estado: 429,
      cuerpo: { motivo: "cupo-cuenta", que: "rechazos", liberaEn: T0 + DIA_MS, max: 2, pudoSalir: false },
    });
  });

  it("otro pago en el aire de la misma cuenta: se le pregunta a la red, y si ya entró, el nuevo pasa", async () => {
    const m = await montar();
    const org = delLibro(m);
    const a = retiro(org);
    await m.p.procesar("retiro", a.xdr);
    const b = retiro(org, { secuencia: "101", monto: "2.0000000" });
    expect(await m.p.procesar("retiro", b.xdr)).toEqual({
      estado: 409,
      cuerpo: { motivo: "otro-en-curso", hash: a.hash, vence: VENCE, pudoSalir: false },
    });
    m.red.consultas.set(a.hash, entro(300));
    expect(await m.p.procesar("retiro", b.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: b.hash, status: "PENDING" } });
    expect(m.uso.buscar(a.hash)).toMatchObject({ estado: "ok", real: 300 });
  });

  it("con muchos en el aire a la vez, 503 fondo ocupado con la hora hasta la que esperar", async () => {
    const m = await montar({ PAGOS_RECHAZADOS_DIA: "2" });
    for (let i = 0; i < 2; i++) {
      await m.p.procesar("retiro", retiro(delLibro(m)).xdr);
    }
    expect(await m.p.procesar("retiro", retiro(delLibro(m)).xdr)).toEqual({
      estado: 503,
      cuerpo: { motivo: "fondo", detalle: "ocupado", reintentarEn: T0 + 5_000, pudoSalir: false },
    });
  });
});

// ---------- lo que queda en el aire ----------

describe("la alarma", () => {
  it("SUCCESS pasa a ok con lo cobrado y FAILED a fallo, que cuenta como rechazo", async () => {
    const m = await montar();
    const a = retiro(delLibro(m));
    const b = retiro(delLibro(m));
    await m.p.procesar("retiro", a.xdr);
    await m.p.procesar("retiro", b.xdr);
    m.red.consultas.set(a.hash, entro(215));
    m.red.consultas.set(b.hash, fallo(230));
    m.estado.ahora += 20_000;
    expect(await m.p.reconciliar()).toBe(false);
    expect(m.uso.buscar(a.hash)).toMatchObject({ estado: "ok", real: 215 });
    expect(m.uso.buscar(b.hash)).toMatchObject({ estado: "fallo", real: 230 });
    expect(m.uso.resumen(m.estado.ahora).retiro).toEqual({ enElAire: 0, ok24h: 1, fallo24h: 1 });
  });

  it("lo que todavía no pasó el margen sigue en el aire, y lo recién mandado no se pregunta", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    await m.p.procesar("retiro", t.xdr);
    expect(await m.p.reconciliar()).toBe(true);
    m.estado.ahora += 20_000;
    expect(await m.p.reconciliar()).toBe(true);
    expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
  });

  it("sin nada en el aire la vuelta no deja rastro en la bitácora: con los pagos apagados es la de siempre", async () => {
    const m = await montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    expect(await m.p.reconciliar()).toBe(false);
    expect(m.registros).toEqual([]);
  });

  describe("(ataque) pasado vence + 600, antes de devolver se pregunta a cada RPC y a Horizon", () => {
    async function envejecido() {
      const m = await montar();
      const org = delLibro(m);
      sorteoSellado(m, org.publicKey());
      const t = premio(org);
      await m.p.procesar("premio", t.xdr);
      m.estado.ahora = (VENCE + 601) * 1000;
      return { m, t };
    }

    it("con el primer RPC en NOT_FOUND y el segundo en SUCCESS, el premio queda ok y el puesto ocupado", async () => {
      const { m, t } = await envejecido();
      m.rpc[1]?.consultas.set(t.hash, entro(210));
      expect(await m.p.reconciliar()).toBe(false);
      expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 210 });
      expect(m.uso.puestoUsado(CONTRATO, SORTEO, 0)).toEqual({ hash: t.hash, estado: "ok" });
    });

    it("con los dos RPC en NOT_FOUND y Horizon con la transacción, se cierra por Horizon", async () => {
      const { m, t } = await envejecido();
      m.horizon.transacciones.set(t.hash, () => respuesta({ successful: true, fee_charged: "205" }));
      expect(await m.p.reconciliar()).toBe(false);
      expect(m.uso.buscar(t.hash)).toMatchObject({ estado: "ok", real: 205 });
    });

    it("con los dos RPC y Horizon diciendo que no está, pasa a devuelto y el puesto queda libre", async () => {
      const { m, t } = await envejecido();
      expect(await m.p.reconciliar()).toBe(false);
      expect(m.uso.buscar(t.hash)?.estado).toBe("devuelto");
      expect(m.uso.puestoUsado(CONTRATO, SORTEO, 0)).toBeNull();
      expect(m.registros.some(([e, d]) => e === "pago-devuelto" && d?.motivo === "vencida-sin-aparecer")).toBe(true);
    });

    it("con un RPC sin contestar, o con Horizon sin contestar, queda en el aire hasta la vuelta siguiente", async () => {
      const { m, t } = await envejecido();
      (m.rpc[0] as RpcSuelto).caido = true;
      expect(await m.p.reconciliar()).toBe(true);
      expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
      (m.rpc[0] as RpcSuelto).caido = false;
      m.horizon.caido = true;
      expect(await m.p.reconciliar()).toBe(true);
      expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
      m.horizon.caido = false;
      expect(await m.p.reconciliar()).toBe(false);
      expect(m.uso.buscar(t.hash)?.estado).toBe("devuelto");
    });

    it("sin ningún RPC suelto no se devuelve nada: no hay a quién preguntarle", async () => {
      const { m, t } = await envejecido();
      const sinRpc = new PorteroDePagos({ ...m.dependencias, redesSueltas: [] });
      expect(await sinRpc.reconciliar()).toBe(true);
      expect(m.uso.buscar(t.hash)?.estado).toBe("enviado");
    });
  });
});

describe("pudoSalir", () => {
  it("es verdadero solo con el hash reservado o enviado, también con el sobre envuelto, y falso con lo demás", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    expect(m.p.pudoSalir(t.xdr)).toBe(false);
    await m.p.procesar("retiro", t.xdr);
    expect(m.p.pudoSalir(t.xdr)).toBe(true);
    expect(m.p.pudoSalir(comoFeeBump(t.xdr, patrocinadora))).toBe(true);
    expect(m.p.pudoSalir("esto no es un sobre")).toBe(false);
    m.uso.cerrar(t.hash, "ok", 200);
    expect(m.p.pudoSalir(t.xdr)).toBe(false);
  });

  it("un error nuestro después de reservar escapa, y el hash sigue en el aire: el 500 dice que pudo salir", async () => {
    const m = await montar();
    const t = retiro(delLibro(m));
    m.red.enviar = async () => {
      throw new Error("algo nuestro");
    };
    await expect(m.p.procesar("retiro", t.xdr)).rejects.toThrow("algo nuestro");
    expect(m.p.pudoSalir(t.xdr)).toBe(true);
  });
});

describe("la bitácora", () => {
  it("nunca lleva la cuenta, el destino, la nota ni el sorteo", async () => {
    const m = await montar();
    const org = delLibro(m);
    sorteoSellado(m, org.publicKey());
    const ganadora = Keypair.random().publicKey();
    const destino = Keypair.random().publicKey();
    const a = premio(org, { persona: ganadora });
    const b = retiro(org, { persona: destino, secuencia: "101" });
    await m.p.procesar("premio", a.xdr);
    m.red.consultas.set(a.hash, entro());
    m.estado.ahora += 20_000;
    await m.p.reconciliar();
    await m.p.procesar("retiro", b.xdr);
    m.red.consultas.set(b.hash, fallo());
    m.estado.ahora += 20_000;
    await m.p.reconciliar();
    m.horizon.caido = true;
    await m.p.procesar("retiro", retiro(org, { persona: destino, secuencia: "102" }).xdr);
    const toda = JSON.stringify(m.registros);
    expect(m.registros.length).toBeGreaterThan(3);
    for (const prohibido of [org.publicKey(), ganadora, destino, COBROS, SORTEO, "tk:premio", "tkz-retiro"]) {
      expect(toda, prohibido).not.toContain(prohibido);
    }
    expect(m.registros.map(([e]) => e)).toEqual(expect.arrayContaining(["pago-reservado", "pago-enviado", "pago-resultado", "alarma-pagos"]));
  });
});

// ---------- lo que se ve de afuera ----------

describe("el bloque pagos de /cupo", () => {
  it("dice las tres formas, el costo y lo que está en curso", async () => {
    const m = await montar();
    const org = delLibro(m);
    expect(m.p.cupoDe(org.publicKey())).toEqual({
      premio: true,
      retiro: true,
      altaPremio: false,
      costoRetiro: { usdc: "0.50", monto: COSTO },
      enCurso: null,
    });
    const t = retiro(org);
    await m.p.procesar("retiro", t.xdr);
    expect(m.p.cupoDe(org.publicKey())).toMatchObject({ enCurso: { hash: t.hash, forma: "retiro", vence: VENCE } });
    // Otra cuenta no ve el pago de esta.
    expect(m.p.cupoDe(Keypair.random().publicKey())).toMatchObject({ enCurso: null });
  });

  it("una forma pausada o con el portero apagado se dice apagada, y el costo sigue", async () => {
    const m = await montar();
    m.cupos.fijarAjuste("pagos_premio_pausado", "1", T0);
    expect(m.p.cupoDe(Keypair.random().publicKey())).toMatchObject({ premio: false, retiro: true });
    m.estado.modo = "pollar";
    expect(m.p.cupoDe(Keypair.random().publicKey())).toMatchObject({ premio: false, retiro: false, costoRetiro: { usdc: "0.50", monto: COSTO } });
  });

  it("no aparece con las tres variables apagadas, y con solo el alta prendida aparece con todo en falso", async () => {
    const apagado = await montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    expect(apagado.p.cupoDe(Keypair.random().publicKey())).toBeNull();
    const soloAlta = await montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "1" });
    expect(soloAlta.p.cupoDe(Keypair.random().publicKey())).toEqual({
      premio: false,
      retiro: false,
      altaPremio: false,
      costoRetiro: null,
      enCurso: null,
    });
  });

  it("pagosPrendidos mira las tres", async () => {
    expect(pagosPrendidos({ pagosPremio: false, retiros: false, altasPremio: false })).toBe(false);
    expect(pagosPrendidos({ pagosPremio: false, retiros: false, altasPremio: true })).toBe(true);
    expect(pagosPrendidos({ pagosPremio: true, retiros: false, altasPremio: false })).toBe(true);
  });
});

describe("el bloque pagos de /estado", () => {
  const sinCostos = () => ({ cuantos: 0, monto: 0 });

  it("con todo prendido dice cada forma, el gasto, los topes y los costos cobrados", async () => {
    const m = await montar();
    const org = delLibro(m);
    const t = retiro(org);
    await m.p.procesar("retiro", t.xdr);
    m.red.consultas.set(t.hash, entro(300));
    m.estado.ahora += 20_000;
    await m.p.reconciliar();
    expect(m.p.resumenDeEstado(m.estado.ahora, () => ({ cuantos: 2, monto: 10_000_000 }))).toEqual({
      premio: { prendido: true, pausado: false, enElAire: 0, ok24h: 0, fallo24h: 0 },
      retiro: { prendido: true, pausado: false, enElAire: 0, ok24h: 1, fallo24h: 0, costo: { usdc: "0.50", monto: COSTO } },
      altaPremio: { prendido: false, pausado: false, hoy: 0 },
      gasto24h: 300,
      topeStroops: 20_000_000,
      rechazosPorDia: 20,
      altasPremioDia: 100,
      costosRetiro24h: 2,
      cobradoRetiros24h: "1",
    });
  });

  it("los topes que se movieron en caliente salen con su valor de ahora", async () => {
    const m = await montar();
    m.cupos.fijarAjuste("tope_pagos_stroops", "30000000", T0);
    m.cupos.fijarAjuste("pagos_rechazos_dia", "40", T0);
    m.cupos.fijarAjuste("altas_premio_dia", "200", T0);
    expect(m.p.resumenDeEstado(T0, sinCostos)).toMatchObject({ topeStroops: 30_000_000, rechazosPorDia: 40, altasPremioDia: 200 });
  });

  it("apagado y sin nada en el día no aparece, pero con una pausa puesta sí, y con un pago en el aire también", async () => {
    const m = await montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    expect(m.p.resumenDeEstado(T0, sinCostos)).toBeNull();
    m.cupos.fijarAjuste("retiros_pausado", "1", T0);
    expect(m.p.resumenDeEstado(T0, sinCostos)).toMatchObject({
      premio: { prendido: false, pausado: false },
      retiro: { prendido: false, pausado: true },
      altaPremio: { prendido: false, pausado: false, hoy: 0 },
    });
    const n = await montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    n.uso.reservar(
      {
        hash: "a".repeat(64),
        envuelta: null,
        forma: "retiro",
        cuenta: Keypair.random().publicKey(),
        delLibro: true,
        estimado: 30_000,
        vence: VENCE,
        premio: null,
        costo: COSTO,
      },
      T0,
      { topePagos: 20_000_000, rechazosPorDia: 20 },
    );
    expect(n.p.resumenDeEstado(T0, sinCostos)).toMatchObject({ gasto24h: 30_000, retiro: { enElAire: 1 } });
  });

  it("sin las tablas no hay bloque", async () => {
    const m = await montar();
    Object.defineProperty(m.uso, "disponible", { value: () => false });
    expect(m.p.resumenDeEstado(T0, sinCostos)).toBeNull();
  });
});

// ---------- fuera de la clase ----------

describe("vueltaDeAlarma", () => {
  const sin = () => {
    const anotado: Array<[string, Record<string, string | number> | undefined]> = [];
    return { anotado, registrar: (e: string, d?: Record<string, string | number>) => void anotado.push([e, d]) };
  };

  it("si la parte de los sellos lanza, la de los pagos corre igual, se anota y se vuelve a pedir la alarma", async () => {
    const { anotado, registrar } = sin();
    let pagosCorrio = false;
    const otraVuelta = await vueltaDeAlarma(
      [
        { donde: "alarma-sellos", correr: () => Promise.reject(new TypeError("algo")) },
        { donde: "alarma-pagos", correr: async () => ((pagosCorrio = true), false) },
      ],
      registrar,
    );
    expect(pagosCorrio).toBe(true);
    expect(otraVuelta).toBe(true);
    expect(anotado).toEqual([["error-interno", { donde: "alarma-sellos", error: "TypeError" }]]);
  });

  it("si la de los pagos lanza, la de los sellos ya corrió, y también se vuelve a pedir", async () => {
    const { anotado, registrar } = sin();
    let sellosCorrio = false;
    const otraVuelta = await vueltaDeAlarma(
      [
        { donde: "alarma-sellos", correr: async () => ((sellosCorrio = true), false) },
        { donde: "alarma-pagos", correr: () => Promise.reject(new Error("otro")) },
      ],
      registrar,
    );
    expect(sellosCorrio).toBe(true);
    expect(otraVuelta).toBe(true);
    expect(anotado).toEqual([["error-interno", { donde: "alarma-pagos", error: "Error" }]]);
  });

  it("sin nada en el aire ni errores no se vuelve a pedir, y con algo en el aire de cualquiera de las dos, sí", async () => {
    const { anotado, registrar } = sin();
    const parte = (donde: "alarma-sellos" | "alarma-pagos", queda: boolean) => ({ donde, correr: async () => queda });
    expect(await vueltaDeAlarma([parte("alarma-sellos", false), parte("alarma-pagos", false)], registrar)).toBe(false);
    expect(await vueltaDeAlarma([parte("alarma-sellos", true), parte("alarma-pagos", false)], registrar)).toBe(true);
    expect(await vueltaDeAlarma([parte("alarma-sellos", false), parte("alarma-pagos", true)], registrar)).toBe(true);
    expect(anotado).toEqual([]);
  });
});

describe("armarPorteroDePagos", () => {
  it("con una dependencia que lanza devuelve null y anota error-config, sin lanzar", async () => {
    const m = await montar();
    const anotado: Array<[string, Record<string, string | number> | undefined]> = [];
    const armado = armarPorteroDePagos(
      () => {
        throw new Error("no se pudo armar");
      },
      (e, d) => void anotado.push([e, d]),
    );
    expect(armado).toBeNull();
    expect(anotado).toEqual([["error-config", { faltaAltas: "pagos" }]]);
    // Con una dependencia que lanza al leerse, también.
    const conGetter = { ...m.dependencias };
    Object.defineProperty(conGetter, "cfg", {
      get() {
        throw new Error("cfg roto");
      },
    });
    expect(armarPorteroDePagos(() => conGetter, (e, d) => void anotado.push([e, d]))).toBeNull();
    expect(anotado).toHaveLength(2);
  });

  it("con todo en orden devuelve el portero y no anota nada", async () => {
    const m = await montar();
    const anotado: unknown[] = [];
    const armado = armarPorteroDePagos(() => m.dependencias, (...a) => void anotado.push(a));
    expect(armado).toBeInstanceOf(PorteroDePagos);
    expect(anotado).toEqual([]);
  });
});
