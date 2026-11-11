/**
 * El sorteo por el servidor (`/v1/sorteo`): el portero de mainnet manda el `draw` desde su cuenta sorteadora, con la
 * firma de la ronda que ya calculó el navegador, y solo para los sellos que pagó él. Y el `draw` que manda la persona,
 * con la misma regla. Todo con una red de mentira y el reloj a mano: ninguna prueba toca la red.
 */
import { Address, Keypair, Networks, SorobanDataBuilder, TransactionBuilder, nativeToScVal, scValToNative, xdr, type FeeBumpTransaction, type Transaction } from "@stellar/stellar-sdk/base";
import { beforeEach, describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { armar } from "./armar";
import { registrador } from "./registrador";
import { leerConfig } from "./config";
import { Cupos } from "./cupos";
import { verificarFirma } from "./lista-blanca";
import { PorIp } from "./por-ip";
import { ErrorDeRed, type Consulta, type CuentaEnRed, type Envio, type Red, type Simulacion } from "./red";
import { Portero, firmanteDe, type Respuesta } from "./servicio";
import { CODIGO_YA_SORTEADO, Sorteadora, atenderSorteo, leerRetornoDelSorteo } from "./sorteadora";
import { sqlDePrueba } from "./sqlite-prueba";

const CONTRATO = deployments.testnet.contractId;
const patrocinadora = Keypair.random();
const llave = Keypair.random();
const sorteadora = Keypair.random();
const FIRMA = "ab03".repeat(48);
const FIRMA_MALA = "00".repeat(96);
const LISTA = new Uint8Array(32).fill(0xab);
const RONDA = 99;

interface SorteoFalso {
  organizador: string;
  lista: Uint8Array;
  ronda: number;
  ganadores?: number;
  estado?: "Sealed" | "Drawn";
}

/** El `Option<Raffle>` que devuelve `get_raffle`, con las claves en el orden del contrato. */
function raffleScVal(id: bigint, s: SorteoFalso | null): xdr.ScVal {
  if (!s) return xdr.ScVal.scvVoid();
  const e = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    e("count", nativeToScVal(10, { type: "u32" })),
    e("id", nativeToScVal(id, { type: "u64" })),
    e("list_hash", nativeToScVal(s.lista, { type: "bytes" })),
    e("meta", nativeToScVal("premio", { type: "string" })),
    e("num_winners", nativeToScVal(s.ganadores ?? 1, { type: "u32" })),
    e("organizer", new Address(s.organizador).toScVal()),
    e("round", nativeToScVal(BigInt(s.ronda), { type: "u64" })),
    e("sealed_at", nativeToScVal(1_700_000_000n, { type: "u64" })),
    e("sealed_ledger", nativeToScVal(100, { type: "u32" })),
    e("status", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(s.estado ?? "Sealed")])),
  ]);
}

/** El método y los argumentos de la invocación de una transacción (o de la interna de un fee-bump). */
function invocacion(x: string): { metodo: string; id: bigint; firma: Uint8Array | null; tx: Transaction } {
  const t = TransactionBuilder.fromXDR(x, Networks.TESTNET);
  const interna = ("innerTransaction" in t ? t.innerTransaction : t) as Transaction;
  const env = xdr.TransactionEnvelope.fromXDR(interna.toXDR(), "base64") as unknown as { value: { tx: { operations: Array<{ body: { value: { hostFunction: { value: { functionName: unknown; args: xdr.ScVal[] } } } } }> } } };
  const llamada = env.value.tx.operations[0]?.body.value.hostFunction.value;
  const metodo = String(llamada?.functionName);
  const args = llamada?.args ?? [];
  const id = metodo === "seal" || !args[0] ? 0n : BigInt(scValToNative(args[0]) as bigint);
  const firma = metodo === "draw" && args[1] ? (scValToNative(args[1]) as Uint8Array) : null;
  return { metodo, id, firma, tx: interna };
}

/** Una red de mentira que entiende `get_raffle` y `draw`, y anota qué le mandaron. */
class RedSorteo implements Red {
  sorteos = new Map<bigint, SorteoFalso>();
  cuentas = new Map<string, CuentaEnRed>();
  /** Lo que contesta cada envío, en orden; después del último, PENDING. */
  envios: Array<Envio | "corte"> = [];
  enviados: string[] = [];
  simulados: string[] = [];
  lecturas = 0;
  retraso = 0;
  /** Si leer un sorteo falla por la red. */
  lecturaCaida = false;
  /**
   * Como Stellar Core desde el protocolo 19: una sola transacción pendiente por cuenta de origen (la interna) hasta que
   * cierra el ledger. Otra con otra secuencia vuelve con TRY_AGAIN_LATER; una con la misma secuencia es un intento de
   * reemplazarla por comisión y vuelve con txInsufficientFee. Apagado por defecto: las demás pruebas mandan sin ledger.
   */
  unaPorCuenta = false;
  pendientes = new Map<string, { secuencia: string; hash: string }>();
  entraron = new Set<string>();
  /** Los rechazos por la regla de una pendiente por cuenta, en orden. */
  rechazos: string[] = [];
  /** Se llama en cada espera de la sorteadora (el reloj de la prueba); por defecto, nada. */
  alEsperar: () => void | Promise<void> = () => {};

  /** Cierra el ledger a mano: lo pendiente entra y la secuencia de cada cuenta pasa a la de su transacción. */
  cerrarLedger(): void {
    for (const [cuenta, p] of this.pendientes) {
      this.entraron.add(p.hash);
      const c = this.cuentas.get(cuenta);
      if (c) this.cuentas.set(cuenta, { ...c, secuencia: p.secuencia });
    }
    this.pendientes.clear();
  }

  private async espera() {
    if (this.retraso) await new Promise((r) => setTimeout(r, this.retraso));
  }
  async simular(x: string): Promise<Simulacion> {
    await this.espera();
    const { metodo, id, firma } = invocacion(x);
    this.simulados.push(metodo);
    if (metodo === "get_raffle") {
      if (this.lecturaCaida) throw new ErrorDeRed("rpc-corte");
      return { ok: true, minResourceFee: 1000, retorno: raffleScVal(id, this.sorteos.get(id) ?? null).toXDR("base64") };
    }
    if (metodo === "draw") {
      const s = this.sorteos.get(id);
      if (!s) return { ok: false, motivo: "fallaria", detalle: "HostError: Error(Contract, #1)", codigoContrato: 1 };
      if (s.estado === "Drawn") return { ok: false, motivo: "fallaria", detalle: "HostError: Error(Contract, #2)", codigoContrato: CODIGO_YA_SORTEADO };
      if (firma && firma.every((b) => b === 0)) return { ok: false, motivo: "fallaria", detalle: "HostError: Error(Contract, #8)", codigoContrato: 8 };
      return { ok: true, minResourceFee: 60_000, datos: new SorobanDataBuilder().setResourceFee(60_000).build().toXDR("base64") };
    }
    return { ok: true, minResourceFee: 40_000 };
  }
  async leerCuenta(g: string): Promise<CuentaEnRed | null> {
    this.lecturas++;
    await this.espera();
    return this.cuentas.get(g) ?? null;
  }
  async enviar(x: string): Promise<Envio> {
    await this.espera();
    this.enviados.push(x);
    const e = this.envios.shift() ?? { status: "PENDING" };
    if (e === "corte") throw new ErrorDeRed("corte");
    if (this.unaPorCuenta && e.status === "PENDING") {
      const { tx } = invocacion(x);
      const hash = Buffer.from(tx.hash()).toString("hex");
      const previa = this.pendientes.get(tx.source);
      if (previa && previa.hash !== hash) {
        const rechazo: Envio = previa.secuencia === tx.sequence ? { status: "ERROR", codigo: "txInsufficientFee" } : { status: "TRY_AGAIN_LATER" };
        this.rechazos.push(rechazo.codigo ?? rechazo.status);
        return rechazo;
      }
      this.pendientes.set(tx.source, { secuencia: tx.sequence, hash });
    }
    return e;
  }
  async consultar(hash: string): Promise<Consulta> {
    return this.entraron.has(hash) ? { status: "SUCCESS", feeCharged: 50_000 } : { status: "NOT_FOUND" };
  }
}

let ahora = Date.now();
let red: RedSorteo;
let cupos: Cupos;
let p: Portero;
let lineas: string[];

async function montar(env: Parameters<typeof leerConfig>[0] = {}) {
  red = new RedSorteo();
  cupos = new Cupos(sqlDePrueba());
  lineas = [];
  const registrar = registrador({ log: (l) => lineas.push(l), error: (l) => lineas.push(l) });
  const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", SORTEO_SERVIDOR: "1", CUENTA_SORTEADORA: sorteadora.publicKey(), MAX_SELLOS_MES: "100", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
  // La espera de la sorteadora no usa el reloj de verdad: cada vuelta le avisa a esta red, que decide si cierra el ledger.
  const deEstaRed = red;
  const esperar = async () => {
    await deEstaRed.alEsperar();
  };
  const s = cfg.sorteoServidor ? new Sorteadora({ passphrase: cfg.passphrase, contractId: CONTRATO, cuenta: sorteadora.publicKey(), red, firmante: await firmanteDe(sorteadora.secret()), esperar }) : null;
  p = new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => {}, registrar, null, s);
  red.cuentas.set(sorteadora.publicKey(), { patrocinador: null, balance: 20_000_000n, secuencia: "500" });
}

/** Una cuenta del libro con sorteos oficiales. */
function admitida(sorteos = 3): Keypair {
  const k = Keypair.random();
  red.cuentas.set(k.publicKey(), { patrocinador: null, balance: 100_000_000n });
  cupos.admitir(k.publicKey(), "cupon", ahora);
  cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:h:${k.publicKey()}`, sorteos, dias: 60 }, ahora);
  return k;
}

/** Un sello que pagó el portero (queda en `sellos_portero`), y el sorteo `id` en la red con esa lista y esa ronda. */
async function selloDelPortero(org: Keypair, id: bigint, lista = LISTA): Promise<string> {
  const t = armar({ contrato: CONTRATO, firmante: org, hashLista: lista });
  const r = await p.procesar(t.xdr);
  expect(r.estado).toBe(200);
  red.sorteos.set(id, { organizador: org.publicKey(), lista, ronda: RONDA });
  return t.hash;
}

const usados = (g: string) => cupos.consultar(g, ahora, { maxSellos: 100, maxSorteos: 100 });
/** Lo que se mandó a la red sin contar los sellos de la preparación. */
const draws = () => red.enviados.filter((x) => invocacion(x).metodo === "draw");

beforeEach(async () => {
  ahora = Date.now();
  await montar();
});

describe("leer el sorteo de la red", () => {
  it("get_raffle trae el organizador, la huella, la ronda, los ganadores y si ya se sorteó; sin sorteo, null", () => {
    const org = Keypair.random().publicKey();
    expect(leerRetornoDelSorteo(raffleScVal(7n, { organizador: org, lista: LISTA, ronda: 1234, ganadores: 3, estado: "Drawn" }).toXDR("base64"))).toEqual({
      id: 7n,
      organizador: org,
      huellaLista: "ab".repeat(32),
      ronda: 1234,
      ganadores: 3,
      sorteado: true,
    });
    expect(leerRetornoDelSorteo(xdr.ScVal.scvVoid().toXDR("base64"))).toBeNull();
  });

  it("lo que no tiene la forma del contrato no se adivina: falla", () => {
    expect(() => leerRetornoDelSorteo(nativeToScVal(7n, { type: "u64" }).toXDR("base64"))).toThrow();
    expect(() => leerRetornoDelSorteo("no-es-xdr")).toThrow();
  });
});

describe("POST /v1/sorteo: el camino entero", () => {
  it("manda el draw desde la sorteadora, con la secuencia de la red, envuelto en el fee-bump de la patrocinadora", async () => {
    const org = admitida();
    const sello = await selloDelPortero(org, 1n);
    const r = await p.sortear("1", FIRMA);
    expect(r).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(draws()).toHaveLength(1);
    const bump = TransactionBuilder.fromXDR(draws()[0] as string, Networks.TESTNET) as FeeBumpTransaction;
    expect(bump.feeSource).toBe(patrocinadora.publicKey());
    const interna = bump.innerTransaction;
    expect(interna.source).toBe(sorteadora.publicKey());
    expect(interna.sequence).toBe("501");
    expect((r.cuerpo as { hash: string }).hash).toBe(Buffer.from(interna.hash()).toString("hex"));
    // La interna la firma la llave de la sorteadora; el sobre, la del Worker.
    const firmaInterna = (interna.signatures[0] as unknown as { signature: { value: Uint8Array } }).signature.value;
    expect(await verificarFirma(sorteadora.rawPublicKey(), firmaInterna, interna.hash())).toBe(true);
    // Los recursos son los de la simulación, y la inclusión, la de la red.
    expect(Number(interna.fee)).toBe(60_000 + 100);
    // Cuenta contra el organizador, no contra la sorteadora, y usa lo guardado para su sello.
    expect(usados(org.publicKey()).sorteos).toBe(1);
    expect(usados(sorteadora.publicKey()).sorteos).toBe(0);
    const reserva = cupos.exportar(true).reserva?.find((f) => f.hash === sello);
    expect(reserva?.usada).toBe((r.cuerpo as { hash: string }).hash);
    // Un sorteo nunca gasta sorteos oficiales: el sello gastó uno de tres.
    expect(cupos.quedan({ cuenta: org.publicKey() }, ahora).quedan).toBe(2);
  });

  it("la persona nunca firma: no se le pide nada a su cuenta", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    const antes = red.lecturas;
    await p.sortear("1", FIRMA);
    // Se leyó solo la sorteadora (su secuencia).
    expect(red.lecturas - antes).toBe(1);
  });
});

describe("POST /v1/sorteo: lo que no se paga", () => {
  it("con el organizador fuera del libro, 403 no-es-nuestro, sin simular el draw ni reservar", async () => {
    const ajena = Keypair.random();
    red.sorteos.set(3n, { organizador: ajena.publicKey(), lista: LISTA, ronda: RONDA });
    expect(await p.sortear("3", FIRMA)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(red.simulados).not.toContain("draw");
    expect(red.enviados).toHaveLength(0);
    expect(usados(ajena.publicKey()).sorteos).toBe(0);
  });

  it("del libro pero sellado por fuera (Freighter): sin fila en sellos_portero, 403", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    // Otro sorteo del mismo organizador, con otra lista, que el portero no pagó.
    red.sorteos.set(2n, { organizador: org.publicKey(), lista: new Uint8Array(32).fill(1), ronda: RONDA });
    expect(await p.sortear("2", FIRMA)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    // Con la misma lista y otra ronda, tampoco.
    red.sorteos.set(4n, { organizador: org.publicKey(), lista: LISTA, ronda: RONDA + 1 });
    expect(await p.sortear("4", FIRMA)).toMatchObject({ estado: 403 });
    expect(draws()).toHaveLength(0);
  });

  it("un sorteo que no existe es 403 y no se reserva nada", async () => {
    expect(await p.sortear("77", FIRMA)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(red.enviados).toHaveLength(0);
  });

  it("una firma que no pasa la simulación da 400 fallaria y nada reservado", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    expect(await p.sortear("1", FIRMA_MALA)).toMatchObject({ estado: 400, cuerpo: { motivo: "fallaria" } });
    expect(draws()).toHaveLength(0);
    expect(usados(org.publicKey()).sorteos).toBe(0);
    expect(cupos.exportar(true).uso?.filter((f) => f.metodo === "draw")).toHaveLength(0);
  });

  it("la ronda que la red todavía no alcanzó (RoundNotReady) da 409 ronda-no-lista para reintentar, no 400 fallaria", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    const simular = red.simular.bind(red);
    red.simular = async (x) => (invocacion(x).metodo === "draw" ? { ok: false, motivo: "fallaria", detalle: "HostError: Error(Contract, #7)", codigoContrato: 7 } : simular(x));
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 409, cuerpo: { motivo: "ronda-no-lista", reintentarEn: ahora + 5000 } });
    expect(draws()).toHaveLength(0);
    expect(usados(org.publicKey()).sorteos).toBe(0);
  });

  it("el cuerpo mal escrito da 400 cuerpo, sin leer la red", async () => {
    for (const [s, f] of [
      ["", FIRMA],
      ["-1", FIRMA],
      ["1.5", FIRMA],
      ["18446744073709551616", FIRMA],
      ["1", "03".repeat(48)],
      ["1", "zz".repeat(96)],
    ] as const) {
      expect(await p.sortear(s, f), `${s} ${f.length}`).toMatchObject({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(red.simulados).toHaveLength(0);
  });

  it("sin la red para leer el sorteo, 502 y nada reservado", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.lecturaCaida = true;
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 502, cuerpo: { motivo: "red" } });
    expect(draws()).toHaveLength(0);
  });
});

describe("POST /v1/sorteo: ya sorteado y repetido", () => {
  it("AlreadyDrawn da {ya:true}: leído de get_raffle o de la simulación, sin mandar nada", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.sorteos.set(1n, { organizador: org.publicKey(), lista: LISTA, ronda: RONDA, estado: "Drawn" });
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 200, cuerpo: { ya: true } });
    expect(red.simulados).not.toContain("draw");
    // Se sorteó entre leer y simular: la simulación dice AlreadyDrawn.
    red.sorteos.set(1n, { organizador: org.publicKey(), lista: LISTA, ronda: RONDA });
    const simular = red.simular.bind(red);
    red.simular = async (x) => (invocacion(x).metodo === "draw" ? { ok: false, motivo: "fallaria", detalle: "HostError: Error(Contract, #2)", codigoContrato: CODIGO_YA_SORTEADO } : simular(x));
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 200, cuerpo: { ya: true } });
    expect(draws()).toHaveLength(0);
    expect(usados(org.publicKey()).sorteos).toBe(0);
  });

  it("pedido otra vez mientras va en camino: el mismo hash, sin mandar otro ni contar otro", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    const a = await p.sortear("1", FIRMA);
    const b = await p.sortear("1", FIRMA);
    expect(b).toEqual({ estado: 200, cuerpo: { hash: (a.cuerpo as { hash: string }).hash, status: "DUPLICATE" } });
    expect(draws()).toHaveLength(1);
    expect(usados(org.publicKey()).sorteos).toBe(1);
  });

  it("dos pedidos del mismo sorteo a la vez: sale uno solo", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.retraso = 5;
    const [a, b] = await Promise.all([p.sortear("1", FIRMA), p.sortear("1", FIRMA)]);
    expect([a.estado, b.estado]).toEqual([200, 200]);
    expect(draws()).toHaveLength(1);
    expect(usados(org.publicKey()).sorteos).toBe(1);
  });

  it("si la red lo rechazó, se puede volver a pedir; cuando entró, la red dice que ya está", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.envios = [{ status: "ERROR", codigo: "txFeeBumpInnerFailed/txInsufficientBalance" }];
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
    expect(usados(org.publicKey()).sorteos).toBe(0);
    const ok = await p.sortear("1", FIRMA);
    expect(ok).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    cupos.cerrar((ok.cuerpo as { hash: string }).hash, "ok", 54_000);
    red.sorteos.set(1n, { organizador: org.publicKey(), lista: LISTA, ronda: RONDA, estado: "Drawn" });
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 200, cuerpo: { ya: true } });
    expect(draws()).toHaveLength(2);
  });

  it("lo guardado del sello que tomó otro sorteo ya cerrado (antes de prender la bandera) no frena el suyo: manda la red", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    // Un draw de la misma cuenta, mandado sin la regla, se quedó con lo guardado de este sello y entró.
    cupos.reservar({ hash: "e".repeat(64), cuenta: org.publicKey(), metodo: "draw", estimado: 1000, vence: Math.floor(ahora / 1000) + 240 }, ahora, { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000 });
    cupos.cerrar("e".repeat(64), "ok", 1000);
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(draws()).toHaveLength(1);
  });
});

describe("POST /v1/sorteo: las secuencias de la sorteadora", () => {
  it("dos sorteos a la vez: el segundo espera a que entre el primero y sale con la secuencia que sigue, sin rechazos", async () => {
    const a = admitida();
    const b = admitida();
    await selloDelPortero(a, 1n);
    await selloDelPortero(b, 2n, new Uint8Array(32).fill(2));
    // Desde acá, la red acepta una sola pendiente por cuenta, y el ledger cierra en la segunda espera.
    red.unaPorCuenta = true;
    let esperas = 0;
    red.alEsperar = () => {
      if (++esperas === 2) red.cerrarLedger();
    };
    const antes = red.lecturas;
    red.retraso = 5;
    const [ra, rb] = await Promise.all([p.sortear("1", FIRMA), p.sortear("2", FIRMA)]);
    expect(ra).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(rb).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(red.rechazos).toEqual([]);
    const secuencias = draws().map((x) => (TransactionBuilder.fromXDR(x, Networks.TESTNET) as FeeBumpTransaction).innerTransaction.sequence);
    expect(secuencias).toEqual(["501", "502"]);
    expect(red.lecturas - antes).toBe(1);
  });

  it("la respuesta sale con el hash sin esperar a que entre: lo que se retiene es la cola", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.unaPorCuenta = true;
    // El ledger no cierra hasta que la prueba lo diga: igual el pedido contesta.
    let soltar: () => void = () => {};
    const trabada = new Promise<void>((res) => (soltar = res));
    red.alEsperar = () => trabada;
    const r = await p.sortear("1", FIRMA);
    expect(r).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    soltar();
  });

  it("si el primero no entra en el plazo, el siguiente relee la cuenta; con la misma secuencia la red dice txInsufficientFee y llega como red ocupada, no como fondo", async () => {
    const a = admitida();
    const b = admitida();
    await selloDelPortero(a, 1n);
    await selloDelPortero(b, 2n, new Uint8Array(32).fill(2));
    red.unaPorCuenta = true;
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    // El ledger no cerró en las diez esperas: la sorteadora olvida la secuencia y la relee (la red todavía dice 500).
    const antes = red.lecturas;
    expect(await p.sortear("2", FIRMA)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "ocupada" } });
    expect(red.lecturas - antes).toBe(1);
    expect(red.rechazos).toEqual(["txInsufficientFee"]);
    // No se pagó nada: el sorteo del mes vuelve.
    expect(usados(b.publicKey()).sorteos).toBe(0);
    // Cierra el ledger: el reintento sale con la secuencia que sigue.
    red.cerrarLedger();
    const ok = await p.sortear("2", FIRMA);
    expect(ok).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect((TransactionBuilder.fromXDR(draws().at(-1) as string, Networks.TESTNET) as FeeBumpTransaction).innerTransaction.sequence).toBe("502");
  });

  it("TRY_AGAIN_LATER y txInsufficientFee de la sorteadora son red ocupada (502), que el sitio reintenta; solo la falta de saldo es fondo", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.envios = [{ status: "TRY_AGAIN_LATER" }];
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "ocupada" } });
    red.envios = [{ status: "ERROR", codigo: "txInsufficientFee" }];
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "ocupada" } });
    red.envios = [{ status: "ERROR", codigo: "txFeeBumpInnerFailed/txInsufficientFee" }];
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 502, cuerpo: { motivo: "red", detalle: "ocupada" } });
    red.envios = [{ status: "ERROR", codigo: "txInsufficientBalance" }];
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
    expect(usados(org.publicKey()).sorteos).toBe(0);
  });

  it("con una secuencia vieja relee la cuenta y reintenta una vez; lo del primer intento vuelve", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.envios = [{ status: "ERROR", codigo: "txFeeBumpInnerFailed/txBadSeq" }];
    // Alguien usó la sorteadora por fuera: la red ya va en 700.
    const leer = red.leerCuenta.bind(red);
    let vuelta = 0;
    red.leerCuenta = async (g) => {
      const c = await leer(g);
      return g === sorteadora.publicKey() && c ? { ...c, secuencia: vuelta++ === 0 ? "500" : "700" } : c;
    };
    const r = await p.sortear("1", FIRMA);
    expect(r).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    const secuencias = draws().map((x) => (TransactionBuilder.fromXDR(x, Networks.TESTNET) as FeeBumpTransaction).innerTransaction.sequence);
    expect(secuencias).toEqual(["501", "701"]);
    expect(usados(org.publicKey()).sorteos).toBe(1);
    expect(cupos.exportar(true).uso?.filter((f) => f.metodo === "draw").map((f) => f.estado)).toEqual(expect.arrayContaining(["devuelto", "enviado"]));
  });

  it("si la secuencia sigue vieja después de releer, 502 y no cuenta nada", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.envios = [
      { status: "ERROR", codigo: "txFeeBumpInnerFailed/txBadSeq" },
      { status: "ERROR", codigo: "txBadSeq" },
    ];
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 502, cuerpo: { motivo: "red" } });
    expect(draws()).toHaveLength(2);
    expect(usados(org.publicKey()).sorteos).toBe(0);
  });

  it("después de un corte al mandar, la próxima vez vuelve a leer la secuencia", async () => {
    const a = admitida();
    await selloDelPortero(a, 1n);
    await selloDelPortero(a, 2n, new Uint8Array(32).fill(2));
    red.envios = ["corte"];
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 502 });
    const antes = red.lecturas;
    await p.sortear("2", FIRMA);
    expect(red.lecturas - antes).toBe(1);
  });

  it("sin la cuenta sorteadora en la red, 503 fondo", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.cuentas.delete(sorteadora.publicKey());
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
    expect(draws()).toHaveLength(0);
  });
});

describe("POST /v1/sorteo: los topes del organizador", () => {
  it("cuenta contra el tope de sorteos del mes del organizador", async () => {
    await montar({ MAX_SELLOS_MES: "1" });
    const org = admitida();
    await selloDelPortero(org, 1n);
    // Ya usó su único sorteo del mes, mandado por él.
    cupos.reservar({ hash: "f".repeat(64), cuenta: org.publicKey(), metodo: "draw", estimado: 1000, vence: Math.floor(ahora / 1000) + 240 }, ahora, { maxSellos: 1, maxSorteos: 1, topeGeneral: 150_000_000, reservaSorteo: 82_000 });
    cupos.cerrar("f".repeat(64), "ok", 1000);
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-cuenta", que: "sorteos" } });
    expect(draws()).toHaveLength(0);
  });

  it("apagado, devuelto a Pollar o sin la bandera: 503 apagado", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    p.poner("apagado");
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
    p.poner("pollar");
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
    await montar({ SORTEO_SERVIDOR: "0" });
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
    await montar({ CUENTA_SORTEADORA: "" });
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
    expect(red.simulados).toHaveLength(0);
  });

  it("la bitácora anota el sorteo del servidor sin ninguna cuenta", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    await p.sortear("1", FIRMA);
    expect(lineas.some((l) => JSON.parse(l).evento === "sorteo-servidor")).toBe(true);
    for (const l of lineas) expect(l).not.toMatch(/\b[GC][A-Z2-7]{55}\b/);
  });
});

describe("el draw que manda la persona, con ALTAS=1 (con o sin el sorteo del servidor)", () => {
  const drawDe = (org: Keypair, id: bigint) => armar({ contrato: CONTRATO, firmante: org, metodo: "draw", raffleId: id });

  it("de un sello del portero se paga, cuenta contra quien lo manda y usa lo guardado de ese sello", async () => {
    const org = admitida();
    const sello = await selloDelPortero(org, 1n);
    const t = drawDe(org, 1n);
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: t.hash } });
    expect(cupos.exportar(true).reserva?.find((f) => f.hash === sello)?.usada).toBe(t.hash);
    // Y el servidor ya no lo vuelve a mandar.
    expect(await p.sortear("1", FIRMA)).toEqual({ estado: 200, cuerpo: { hash: t.hash, status: "DUPLICATE" } });
  });

  it("de un sello que no pagó el portero, 403 no-es-nuestro, sin simular ni reservar", async () => {
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.sorteos.set(9n, { organizador: org.publicKey(), lista: new Uint8Array(32).fill(5), ronda: RONDA });
    red.simulados = [];
    expect(await p.procesar(drawDe(org, 9n).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(red.simulados).toEqual(["get_raffle"]);
    expect(usados(org.publicKey()).sorteos).toBe(0);
  });

  it("lo manda otra cuenta del libro: se paga si el sello es del portero, y no si el sorteo es de alguien de afuera", async () => {
    const org = admitida();
    const otra = admitida();
    await selloDelPortero(org, 1n);
    expect(await p.procesar(drawDe(otra, 1n).xdr)).toMatchObject({ estado: 200 });
    // El sello es del portero aunque lo mande otra cuenta del libro: el sorteo da lo mismo y cuenta contra quien manda.
    expect(usados(otra.publicKey()).sorteos).toBe(1);
    red.sorteos.set(5n, { organizador: Keypair.random().publicKey(), lista: LISTA, ronda: RONDA });
    expect(await p.procesar(drawDe(org, 5n).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
  });

  it("con SORTEO_SERVIDOR=0 la regla vale igual: el draw de un sorteo que no selló el portero da 403 no-es-nuestro", async () => {
    await montar({ SORTEO_SERVIDOR: "0" });
    const org = admitida();
    red.sorteos.set(9n, { organizador: org.publicKey(), lista: new Uint8Array(32).fill(5), ronda: RONDA });
    red.simulados = [];
    expect(await p.procesar(drawDe(org, 9n).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(red.simulados).toEqual(["get_raffle"]);
    expect(usados(org.publicKey()).sorteos).toBe(0);
    // Uno sellado por fuera con 300 ganadores, tampoco.
    red.sorteos.set(10n, { organizador: org.publicKey(), lista: new Uint8Array(32).fill(6), ronda: RONDA, ganadores: 300 });
    expect(await p.procesar(drawDe(org, 10n).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(draws()).toHaveLength(0);
  });

  it("con SORTEO_SERVIDOR=0, el draw de un sello del portero se paga como siempre y usa lo guardado de ese sello", async () => {
    await montar({ SORTEO_SERVIDOR: "0" });
    const org = admitida();
    const sello = await selloDelPortero(org, 1n);
    const t = drawDe(org, 1n);
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: t.hash } });
    expect(cupos.exportar(true).reserva?.find((f) => f.hash === sello)?.usada).toBe(t.hash);
    // Y el sorteo del servidor sigue apagado.
    expect(await p.sortear("1", FIRMA)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("si la red no deja leer el sorteo, 502 red y no se paga: el sitio reintenta", async () => {
    await montar({ SORTEO_SERVIDOR: "0" });
    const org = admitida();
    await selloDelPortero(org, 1n);
    red.lecturaCaida = true;
    expect(await p.procesar(drawDe(org, 1n).xdr)).toMatchObject({ estado: 502, cuerpo: { motivo: "red" } });
    expect(draws()).toHaveLength(0);
  });

  it("SOLO_SELLOS_PORTERO=0 vuelve a lo de antes, para el plan B: el draw de cualquier sorteo pasa con la cuenta en el libro", async () => {
    await montar({ SORTEO_SERVIDOR: "0", SOLO_SELLOS_PORTERO: "0" });
    const org = admitida();
    red.sorteos.set(9n, { organizador: org.publicKey(), lista: new Uint8Array(32).fill(5), ronda: RONDA });
    expect(await p.procesar(drawDe(org, 9n).xdr)).toMatchObject({ estado: 200 });
    expect(red.simulados).not.toContain("get_raffle");
  });
});

describe("la configuración", () => {
  it("el draw solo de sellos del portero vale en mainnet con ALTAS, con o sin el sorteo del servidor; SOLO_SELLOS_PORTERO=0 lo apaga", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", SORTEO_SERVIDOR: "1" }).soloSellosDelPortero).toBe(true);
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", SORTEO_SERVIDOR: "0" }).soloSellosDelPortero).toBe(true);
    expect(leerConfig({ RED: "mainnet", ALTAS: "1" }).soloSellosDelPortero).toBe(true);
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", SOLO_SELLOS_PORTERO: "0" }).soloSellosDelPortero).toBe(false);
    // Solo un "0" lo apaga: lo mal escrito no afloja la regla.
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", SOLO_SELLOS_PORTERO: "no" }).soloSellosDelPortero).toBe(true);
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", SORTEO_SERVIDOR: "1" }).soloSellosDelPortero).toBe(false);
    expect(leerConfig({ RED: "testnet", ALTAS: "1", SORTEO_SERVIDOR: "1" }).soloSellosDelPortero).toBe(false);
    expect(leerConfig({}).soloSellosDelPortero).toBe(false);
  });
});

describe("la ruta", () => {
  const cfgMainnet = () => leerConfig({ RED: "mainnet", ALTAS: "1", SORTEO_SERVIDOR: "1", CUENTA_SORTEADORA: sorteadora.publicKey() });
  const pedido = (cuerpo: unknown, init: { origen?: string | null; metodo?: string; ip?: string } = {}) =>
    new Request("https://pm.tinkazo.app/v1/sorteo", {
      method: init.metodo ?? "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": init.ip ?? "203.0.113.7", ...(init.origen === null ? {} : { Origin: init.origen ?? "https://tinkazo.app" }) },
      ...((init.metodo ?? "POST") === "POST" ? { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) } : {}),
    });
  const llamadas: Array<[string, string]> = [];
  const llamar = async (s: string, f: string): Promise<Respuesta> => {
    llamadas.push([s, f]);
    return { estado: 200, cuerpo: { ya: true } };
  };

  it("en testnet no existe", async () => {
    expect(await atenderSorteo(pedido({ sorteo: "1", firma: FIRMA }), leerConfig({}), new PorIp(), llamar)).toBeNull();
  });

  it("pasa el sorteo y la firma al objeto, con CORS para el sitio", async () => {
    llamadas.length = 0;
    const r = (await atenderSorteo(pedido({ sorteo: "12", firma: FIRMA.toUpperCase() }), cfgMainnet(), new PorIp(), llamar)) as Response;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ya: true });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    expect(llamadas).toEqual([["12", FIRMA]]);
    // El número también vale como número.
    await atenderSorteo(pedido({ sorteo: 13, firma: FIRMA }), cfgMainnet(), new PorIp(), llamar);
    expect(llamadas[1]).toEqual(["13", FIRMA]);
  });

  it("lo que no es del sitio, no es POST, no es JSON o pasa del tope por dirección, sin llamar al objeto", async () => {
    llamadas.length = 0;
    const cfg = cfgMainnet();
    expect((await atenderSorteo(pedido({ sorteo: "1", firma: FIRMA }, { origen: "https://otro.example" }), cfg, new PorIp(), llamar))?.status).toBe(403);
    expect((await atenderSorteo(pedido({ sorteo: "1", firma: FIRMA }, { origen: null }), cfg, new PorIp(), llamar))?.status).toBe(403);
    expect((await atenderSorteo(pedido(null, { metodo: "GET" }), cfg, new PorIp(), llamar))?.status).toBe(405);
    expect((await atenderSorteo(pedido(null, { metodo: "OPTIONS" }), cfg, new PorIp(), llamar))?.status).toBe(204);
    for (const malo of ["{", "[]", { sorteo: "1" }, { firma: FIRMA }, { sorteo: "x", firma: FIRMA }, { sorteo: "1", firma: "03" }, { sorteo: 1.5, firma: FIRMA }]) {
      const r = (await atenderSorteo(pedido(malo), cfg, new PorIp(), llamar)) as Response;
      expect(r.status, JSON.stringify(malo)).toBe(400);
      expect(await r.json()).toEqual({ motivo: "cuerpo" });
    }
    const porIp = new PorIp();
    let ultimo = 0;
    for (let i = 0; i <= cfg.porIpPorHora; i++) ultimo = ((await atenderSorteo(pedido({ sorteo: "1", firma: FIRMA }), cfg, porIp, llamar)) as Response).status;
    expect(ultimo).toBe(429);
    expect(llamadas).toHaveLength(cfg.porIpPorHora);
  });

  it("con la bandera apagada, 503 apagado sin llamar al objeto", async () => {
    llamadas.length = 0;
    const r = (await atenderSorteo(pedido({ sorteo: "1", firma: FIRMA }), leerConfig({ RED: "mainnet", ALTAS: "1" }), new PorIp(), llamar)) as Response;
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ motivo: "apagado" });
    expect(llamadas).toHaveLength(0);
  });
});
