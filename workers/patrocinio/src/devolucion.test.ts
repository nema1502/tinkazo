/**
 * El portero devuelve el sorteo de un sello que entró tarde y el contrato rechazó (`RoundTooSoon`), comprobado con lo que
 * guardó la red. Es lo que pasó el 13 de noviembre de 2026 en la red principal con una cuenta de un solo sorteo.
 */
import { Keypair, Networks } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { armar } from "./armar";
import { selloQueEntro } from "./cadena-prueba";
import { DIA_MS, POLLAR_TESTNET, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { ErrorDeRed, type Consulta, type CuentaEnRed, type Envio, type Red, type Simulacion } from "./red";
import { DEVOLUCIONES_POR_DIA, ESPERA_RECONCILIAR_MS, Portero, TOPE_ASENTAR_MS, firmanteDe } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

const CONTRATO = deployments.testnet.contractId;
const patrocinadora = Keypair.random();
const llave = Keypair.random();

/** Una red de mentira: contesta lo que se le diga. `consultar` puede esperar a que la prueba la suelte. */
class RedFalsa implements Red {
  simulacion: Simulacion = { ok: true, minResourceFee: 40_000 };
  cuentas = new Map<string, CuentaEnRed | null>();
  envio: Envio = { status: "PENDING" };
  consultas = new Map<string, Consulta>();
  preguntas: string[] = [];
  /** Si está, cada consulta espera a esta promesa antes de contestar. */
  frenar: Promise<void> | null = null;
  caida = false;
  async simular(): Promise<Simulacion> {
    return this.simulacion;
  }
  async leerCuenta(g: string): Promise<CuentaEnRed | null> {
    return this.cuentas.get(g) ?? null;
  }
  async enviar(): Promise<Envio> {
    return this.envio;
  }
  async consultar(hash: string): Promise<Consulta> {
    this.preguntas.push(hash);
    if (this.frenar) await this.frenar;
    if (this.caida) throw new ErrorDeRed("corte");
    return this.consultas.get(hash) ?? { status: "NOT_FOUND" };
  }
}

let ahora = Date.now();
let red: RedFalsa;
let cupos: Cupos;
let anotado: Array<{ evento: string; datos?: Record<string, string | number> }>;

beforeEach(() => {
  ahora = Date.now();
  red = new RedFalsa();
  cupos = new Cupos(sqlDePrueba());
  anotado = [];
});
afterEach(() => {
  vi.useRealTimers();
});

const registrar = (evento: string, datos?: Record<string, string | number>) => void anotado.push({ evento, ...(datos ? { datos } : {}) });

/** El portero de la red principal con las altas (cada sello gasta sorteos oficiales), con la frase de testnet para firmar con llaves de prueba. */
async function portero(env: Parameters<typeof leerConfig>[0] = {}) {
  const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", MAX_SELLOS_MES: "100", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
  return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => {}, registrar);
}

/** Una cuenta del libro con `sorteos` sorteos oficiales. */
function admitida(sorteos: number): Keypair {
  const k = Keypair.random();
  red.cuentas.set(k.publicKey(), { patrocinador: null, balance: 100_000_000n });
  cupos.admitir(k.publicKey(), "cupon", ahora);
  cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:h:${k.publicKey()}`, sorteos, dias: 60 }, ahora);
  return k;
}

const RONDA = 33_939_006;
let lista = 0;
/** Un sello de esa cuenta, con su ronda y una lista distinta cada vez. */
const sello = (k: Keypair, o: { ronda?: number; ganadores?: number } = {}) =>
  armar({ contrato: CONTRATO, firmante: k, ronda: BigInt(o.ronda ?? RONDA), hashLista: new Uint8Array(32).fill(++lista % 250), ...(o.ganadores ? { ganadores: o.ganadores } : {}) });

const quedan = (k: Keypair) => cupos.quedan({ cuenta: k.publicKey() }, ahora).quedan;
const sellosDelMes = (k: Keypair) => cupos.consultar(k.publicKey(), ahora, { maxSellos: 100, maxSorteos: 100 }).sellos;
/** Lo que la red dirá de ese sello: entró `faltaban` segundos antes de su ronda y el contrato lo rechazó. */
const entroTarde = (t: { xdr: string; hash: string }, faltaban = 25, extra: Partial<Parameters<typeof selloQueEntro>[0]> = {}) =>
  red.consultas.set(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban, cobrado: 6_000, ...extra }));
/** Pasa el tiempo para que la alarma mire lo que quedó en el aire. */
const pasaLaEspera = () => (ahora += ESPERA_RECONCILIAR_MS + 1_000);

describe("la noche del 13 de noviembre, con la devolución", () => {
  it("una cuenta de un sorteo: el sello entra tarde, el contrato lo rechaza y el sorteo vuelve", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    expect((await m.procesar(a.xdr)).estado).toBe(200);
    expect(quedan(org)).toBe(0);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    // Vuelve al saldo de antes del intento: el sorteo oficial y el sello del mes.
    expect(quedan(org)).toBe(1);
    expect(sellosDelMes(org)).toBe(0);
    // La comisión que cobró la red queda contada como gastada.
    expect(cupos.buscar(a.hash)).toMatchObject({ estado: "fallo", real: 6_000 });
    expect(cupos.resumen(ahora)).toMatchObject({ gasto24h: 6_000, sellos24h: 1, devueltos24h: 1 });
    expect(anotado).toContainEqual({ evento: "sorteo-devuelto", datos: { hash: a.hash.slice(0, 8), motivo: "ronda-cerca", faltaban: 25, sorteos: 1 } });
    // Y el próximo sello pasa.
    expect((await m.procesar(sello(org).xdr)).estado).toBe(200);
  });

  it("con más de 50 ganadores el sello gastó dos, y vuelven los dos: ni uno más", async () => {
    const org = admitida(3);
    const m = await portero();
    const a = sello(org, { ganadores: 60 });
    expect((await m.procesar(a.xdr)).estado).toBe(200);
    expect(quedan(org)).toBe(1);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(3);
  });

  it("queda en el estado para la vigilancia y en el exporte", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    expect((await m.estado()).cuerpo).toMatchObject({ devueltos24h: 1, sellos24h: 1 });
    expect(cupos.exportar(true).devoluciones).toEqual([{ hash: a.hash, cuenta: org.publicKey(), ms: ahora, sorteos: 1, ronda: RONDA, faltaban: 25 }]);
    // Pasado un día ya no cuenta en el estado, pero sigue en el exporte.
    ahora += DIA_MS;
    expect(cupos.resumen(ahora).devueltos24h).toBe(0);
    expect(cupos.exportar(true).devoluciones).toHaveLength(1);
  });
});

describe("una sola vez por intento, aunque el pedido se repita", () => {
  it("la alarma otra vez, el mismo sello reenviado y /cupo no devuelven de nuevo", async () => {
    const org = admitida(2);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(2);
    await m.reconciliar();
    expect(await m.procesar(a.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "DUPLICATE", estado: "fallo" } });
    await m.cupoDe(org.publicKey());
    expect(quedan(org)).toBe(2);
    expect(sellosDelMes(org)).toBe(0);
    expect(cupos.devolverSelloTardio(a.hash, ahora, { ronda: RONDA, faltaban: 25, tope: DEVOLUCIONES_POR_DIA })).toEqual({ que: "repetido" });
    expect(anotado.filter((x) => x.evento === "sorteo-devuelto")).toHaveLength(1);
  });

  it("dos que cierran el mismo sello a la vez (la alarma y /cupo) devuelven una sola vez", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a);
    pasaLaEspera();
    let soltar: () => void = () => {};
    red.frenar = new Promise<void>((r) => (soltar = r));
    const ambos = Promise.all([m.reconciliar(), m.cupoDe(org.publicKey())]);
    await new Promise((r) => setTimeout(r, 5));
    soltar();
    const [, cupo] = await ambos;
    expect(quedan(org)).toBe(1);
    expect(cupos.exportar(true).devoluciones).toHaveLength(1);
    expect((cupo.cuerpo as { oficial: { sorteos: { quedan: number } } }).oficial.sorteos.quedan).toBe(1);
  });

  it("nadie gana sorteos provocando rechazos: después de tres en un día, el cuarto no vuelve", async () => {
    const org = admitida(10);
    const m = await portero();
    for (let i = 0; i < DEVOLUCIONES_POR_DIA; i++) {
      const t = sello(org);
      await m.procesar(t.xdr);
      entroTarde(t);
    }
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(10);
    const cuarto = sello(org);
    await m.procesar(cuarto.xdr);
    entroTarde(cuarto);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(9);
    expect(anotado).toContainEqual({ evento: "devolucion-negada", datos: { hash: cuarto.hash.slice(0, 8), motivo: "tope" } });
    // Pasado el día, el tope vuelve a empezar.
    ahora += DIA_MS;
    const otro = sello(org);
    await m.procesar(otro.xdr);
    entroTarde(otro);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(9);
  });
});

describe("solo el rechazo por la ronda muy cerca, comprobado en la cadena", () => {
  it("un sello que entró con 30 s o más y falló igual: no vuelve (la falla fue otra)", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a, 31);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(0);
    expect(anotado).toContainEqual({ evento: "sello-fallido", datos: { hash: a.hash.slice(0, 8), motivo: "a-tiempo" } });
  });

  it("un sello que falló por recursos, o sin los datos de la red para comprobarlo: no vuelve", async () => {
    const org = admitida(2);
    const m = await portero();
    const a = sello(org);
    const b = sello(org);
    await m.procesar(a.xdr);
    await m.procesar(b.xdr);
    entroTarde(a, 25, { desenlace: "sin-recursos" });
    red.consultas.set(b.hash, { status: "FAILED", feeCharged: 6_000 });
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(0);
    expect(cupos.buscar(a.hash)?.estado).toBe("fallo");
    expect(cupos.buscar(b.hash)?.estado).toBe("fallo");
  });

  it("un sello que salió bien no devuelve nada", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a, 56, { desenlace: "bien" });
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(0);
    expect(cupos.exportar(true).devoluciones).toHaveLength(0);
  });

  it("lo que diga la página no cuenta: sin la red, nada vuelve", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    red.caida = true;
    pasaLaEspera();
    await m.reconciliar();
    await m.cupoDe(org.publicKey());
    expect(await m.procesar(a.xdr)).toMatchObject({ estado: 200 });
    expect(quedan(org)).toBe(0);
    expect(cupos.buscar(a.hash)?.estado).toBe("enviado");
  });

  it("un sorteo que falló no toca los sorteos oficiales", async () => {
    const org = admitida(1);
    const m = await portero({ SOLO_SELLOS_PORTERO: "0" });
    const d = armar({ contrato: CONTRATO, firmante: org, metodo: "draw", raffleId: 7n });
    await m.procesar(d.xdr);
    red.consultas.set(d.hash, { status: "FAILED", feeCharged: 6_000 });
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(1);
    expect(cupos.exportar(true).devoluciones).toHaveLength(0);
  });
});

describe("el reintento que ya está en camino", () => {
  it("/cupo pregunta por los sellos en el aire de la cuenta: el que entró tarde ya vuelve antes de la alarma", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a);
    // La página vio la falla y pregunta enseguida, antes de los 15 s de la alarma.
    ahora += 5_000;
    const c = (await m.cupoDe(org.publicKey())).cuerpo as { sellos: { quedan: number }; oficial: { sorteos: { quedan: number } } };
    expect(c.oficial.sorteos.quedan).toBe(1);
    expect(c.sellos.quedan).toBe(1);
    expect(red.preguntas).toEqual([a.hash]);
  });

  it("el sello nuevo llega con el anterior todavía en el aire: se averigua, vuelve el sorteo y el nuevo pasa", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    entroTarde(a);
    ahora += 5_000;
    const b = sello(org, { ronda: RONDA + 7 });
    expect(await m.procesar(b.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: b.hash, status: "PENDING" } });
    // Gastó uno: el del sello nuevo. El del que entró tarde volvió.
    expect(quedan(org)).toBe(0);
    expect(cupos.buscar(a.hash)?.estado).toBe("fallo");
    expect(cupos.exportar(true).devoluciones).toHaveLength(1);
  });

  it("si el anterior sigue sin aparecer, el nuevo da 402 como siempre y nada vuelve", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    ahora += 5_000;
    expect(await m.procesar(sello(org, { ronda: RONDA + 7 }).xdr)).toMatchObject({ estado: 402, cuerpo: { motivo: "sin-sorteos" } });
    expect(quedan(org)).toBe(0);
    expect(cupos.buscar(a.hash)?.estado).toBe("enviado");
  });

  it("con el sello nuevo ya en camino, la devolución del anterior deja el saldo bien: menos uno, el del nuevo", async () => {
    const org = admitida(2);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    const b = sello(org, { ronda: RONDA + 7 });
    await m.procesar(b.xdr);
    expect(quedan(org)).toBe(0);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    expect(quedan(org)).toBe(1);
    expect(cupos.buscar(b.hash)?.estado).toBe("enviado");
  });

  it("con el RPC colgado, /cupo no espera más de lo debido y contesta con lo que sabe", async () => {
    const org = admitida(1);
    const m = await portero();
    const a = sello(org);
    await m.procesar(a.xdr);
    red.frenar = new Promise<void>(() => {});
    vi.useFakeTimers();
    const p = m.cupoDe(org.publicKey());
    await vi.advanceTimersByTimeAsync(TOPE_ASENTAR_MS + 10);
    const c = (await p).cuerpo as { oficial: { sorteos: { quedan: number } } };
    expect(c.oficial.sorteos.quedan).toBe(0);
  });
});

describe("en la red de prueba, sin sorteos oficiales", () => {
  it("vuelve el sello del mes", async () => {
    const cfg = { ...leerConfig({ RED: "testnet" }), contractId: CONTRATO };
    const m = new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => {}, registrar);
    const org = Keypair.random();
    red.cuentas.set(org.publicKey(), { patrocinador: POLLAR_TESTNET, balance: 100_000_000n });
    const a = sello(org);
    expect((await m.procesar(a.xdr)).estado).toBe(200);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
    entroTarde(a);
    pasaLaEspera();
    await m.reconciliar();
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(cupos.buscar(a.hash)).toMatchObject({ estado: "fallo", real: 6_000 });
  });
});

describe("Cupos.devolverSelloTardio, sin el portero", () => {
  it("solo un sello en fallo: lo que está en el aire, salió bien, ya se devolvió o es un sorteo, no", () => {
    const org = admitida(3);
    const lim = { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000, porSorteos: true };
    const d = { ronda: RONDA, faltaban: 25, tope: DEVOLUCIONES_POR_DIA };
    const reservar = (hash: string, metodo: "seal" | "draw" = "seal") => cupos.reservar({ hash, cuenta: org.publicKey(), metodo, estimado: 100_000, vence: Math.floor(ahora / 1000) + 240, ganadores: 1 }, ahora, lim);
    reservar("a".repeat(64));
    expect(cupos.devolverSelloTardio("a".repeat(64), ahora, d)).toEqual({ que: "no-aplica" });
    cupos.cerrar("a".repeat(64), "ok", 5_000);
    expect(cupos.devolverSelloTardio("a".repeat(64), ahora, d)).toEqual({ que: "no-aplica" });
    reservar("b".repeat(64));
    cupos.devolver("b".repeat(64));
    expect(cupos.devolverSelloTardio("b".repeat(64), ahora, d)).toEqual({ que: "no-aplica" });
    reservar("c".repeat(64), "draw");
    cupos.cerrar("c".repeat(64), "fallo", 5_000);
    expect(cupos.devolverSelloTardio("c".repeat(64), ahora, d)).toEqual({ que: "no-aplica" });
    expect(cupos.devolverSelloTardio("d".repeat(64), ahora, d)).toEqual({ que: "no-aplica" });
    expect(quedan(org)).toBe(2);
    reservar("e".repeat(64));
    cupos.cerrar("e".repeat(64), "fallo", 5_000);
    expect(cupos.devolverSelloTardio("e".repeat(64), ahora, d)).toEqual({ que: "devuelto", sorteos: 1 });
    expect(cupos.devolverSelloTardio("e".repeat(64), ahora, d)).toEqual({ que: "repetido" });
    expect(quedan(org)).toBe(2);
  });
});
