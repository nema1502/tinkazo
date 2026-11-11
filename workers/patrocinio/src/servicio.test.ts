import { Keypair, Networks, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { armar, type Variante } from "./armar";
import { POLLAR_TESTNET, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { verificarFirma } from "./lista-blanca";
import { Planes } from "./plan";
import { ErrorDeRed, type Consulta, type CuentaEnRed, type Envio, type Red, type Simulacion } from "./red";
import { ESPERA_RECONCILIAR_MS, Portero, firmanteDe } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

const CONTRATO = deployments.testnet.contractId;
const patrocinadora = Keypair.random();
const llave = Keypair.random();

/** Una red de mentira: contesta lo que se le diga y anota qué le mandaron. */
class RedFalsa implements Red {
  simulacion: Simulacion = { ok: true, minResourceFee: 40_000 };
  cuentas = new Map<string, CuentaEnRed | null>();
  envio: Envio | (() => Envio) = { status: "PENDING" };
  consultas = new Map<string, Consulta>();
  fallaEnviar = false;
  retraso = 0;
  enviados: string[] = [];
  lecturas = 0;
  simulados = 0;

  private async espera() {
    if (this.retraso) await new Promise((r) => setTimeout(r, this.retraso));
  }
  async simular(): Promise<Simulacion> {
    this.simulados++;
    await this.espera();
    return this.simulacion;
  }
  async leerCuenta(g: string): Promise<CuentaEnRed | null> {
    this.lecturas++;
    await this.espera();
    return this.cuentas.get(g) ?? null;
  }
  async enviar(x: string): Promise<Envio> {
    await this.espera();
    this.enviados.push(x);
    if (this.fallaEnviar) throw new ErrorDeRed("corte");
    return typeof this.envio === "function" ? this.envio() : this.envio;
  }
  async consultar(hash: string): Promise<Consulta> {
    return this.consultas.get(hash) ?? { status: "NOT_FOUND" };
  }
}

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
let ahora = T0;
let red: RedFalsa;
let cupos: Cupos;
let p: Portero;

async function montar(env: Parameters<typeof leerConfig>[0] = {}, opciones: { sinLlave?: boolean } = {}) {
  red = new RedFalsa();
  cupos = new Cupos(sqlDePrueba());
  const cfg = leerConfig({ RED: "testnet", ...env });
  const firmante = opciones.sinLlave ? null : await firmanteDe(llave.secret());
  p = new Portero(cfg, cupos, red, firmante, patrocinadora.publicKey(), () => ahora);
}

/**
 * Un portero de mainnet con el contrato que diga la prueba, no el de la lista: así lo que se prueba no depende de si
 * `deployments.json` ya tiene contrato en mainnet (lo que lee de la lista se prueba aparte).
 */
async function montarMainnet(contractId: string | null) {
  await montar({ RED: "mainnet" });
  p = new Portero({ ...leerConfig({ RED: "mainnet" }), contractId }, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
}

/** Inventado, con la forma de un contrato real: 32 bytes en cero, nunca un contrato real. */
const CONTRATO_SIMULADO = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

/** Una transacción firmada, con la ventana contada desde el reloj de la prueba. */
function tx(v: Partial<Variante> & { firmante: Keypair }) {
  const t = armar({ contrato: CONTRATO, ...v });
  return t;
}
/** El reloj de la prueba es de noviembre; las transacciones se arman con la hora real. Se alinean. */
function relojReal() {
  ahora = Date.now();
}

const abre = (k: Keypair, patrocinador: string | null = POLLAR_TESTNET) => red.cuentas.set(k.publicKey(), { patrocinador, balance: 100_000_000n });

beforeEach(async () => {
  relojReal();
  await montar();
});

describe("un sello pagado", () => {
  it("lo envuelve en un fee-bump de la cuenta patrocinadora, firmado con la llave del Worker, y cuenta", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    const r = await p.procesar(t.xdr);
    expect(r).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, status: "PENDING", quedan: 19, quedanSorteos: 40 } });
    expect(red.enviados).toHaveLength(1);
    const bump = TransactionBuilder.fromXDR(red.enviados[0] as string, Networks.TESTNET) as FeeBumpTransaction;
    expect(bump.feeSource).toBe(patrocinadora.publicKey());
    expect(Buffer.from(bump.innerTransaction.hash()).toString("hex")).toBe(t.hash);
    // La firma es de la llave del Worker (peso 1), no de la cuenta patrocinadora ni de nadie más.
    const firma = bump.signatures[0];
    expect(bump.signatures).toHaveLength(1);
    expect(await verificarFirma(llave.rawPublicKey(), (firma as unknown as { signature: { value: Uint8Array } }).signature.value, bump.hash())).toBe(true);
    // Lo que ofrece pagar: los recursos declarados más dos operaciones de inclusión (la interna y el sobre) a NUESTRA oferta.
    expect(bump.fee).toBe(String(50_000 + 2 * leerConfig({}).inclusionBump));
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
  });

  it("si mientras esperaba a la red otro pedido del mismo hash lo cerró, se contesta DUPLICATE y no se vuelve a mandar", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    const lim = { maxSellos: 20, maxSorteos: 40, topeGeneral: 150_000_000, reservaSorteo: 82_000 };
    // Entre mirar `previa` y reservar hay un await (la simulación): ahí entra el otro pedido, que reserva y la red cierra.
    red.simular = async () => {
      cupos.reservar({ hash: t.hash, cuenta: org.publicKey(), metodo: "seal", estimado: 130_000, vence: Math.floor(ahora / 1000) + 240 }, ahora, lim);
      cupos.cerrar(t.hash, "ok", 54_000);
      return { ok: true, minResourceFee: 40_000 };
    };
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, status: "DUPLICATE", estado: "ok" } });
    expect(red.enviados).toHaveLength(0);
    expect(cupos.consultar(org.publicKey(), ahora, lim).sellos).toBe(1);
  });

  it("el mismo hash dos veces da el mismo resultado y cuenta uno (se reenvía a la red, que lo aplica una vez)", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    const a = await p.procesar(t.xdr);
    const b = await p.procesar(t.xdr);
    expect(b).toEqual(a);
    expect(red.enviados).toHaveLength(2);
    expect(red.enviados[1]).toBe(red.enviados[0]);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
    // Una vez cerrado, se contesta sin volver a mandar nada.
    cupos.cerrar(t.hash, "ok", 40_000);
    const c = await p.procesar(t.xdr);
    expect(c).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, status: "DUPLICATE", estado: "ok" } });
    expect(red.enviados).toHaveLength(2);
  });

  it("un reintento de algo que la red ya cerró se contesta sin volver a mandar", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    await p.procesar(t.xdr);
    red.consultas.set(t.hash, { status: "SUCCESS", feeCharged: 31_000 });
    const b = await p.procesar(t.xdr);
    expect(b).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, status: "DUPLICATE", estado: "ok" } });
    expect(red.enviados).toHaveLength(1);
    expect(cupos.buscar(t.hash)).toMatchObject({ estado: "ok", real: 31_000 });
  });

  it("si al reenviar la red dice TRY_AGAIN_LATER sobre algo que ya había tomado, no se devuelve ni se rechaza", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    await p.procesar(t.xdr);
    red.envio = { status: "TRY_AGAIN_LATER" };
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 200, cuerpo: { hash: t.hash, status: "DUPLICATE", quedan: 19 } });
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
  });

  it("la cuenta se lee de la cadena una sola vez por pedido (firmantes y quién la abrió), y otra vez en el pedido siguiente", async () => {
    const org = Keypair.random();
    abre(org);
    await p.procesar(tx({ firmante: org }).xdr);
    expect(red.lecturas).toBe(1);
    await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(9) }).xdr);
    expect(red.lecturas).toBe(2);
  });

  it("la cuenta de prueba de testnet entra sin haberla abierto la app", async () => {
    const org = Keypair.random();
    await montar({ CUENTAS_PRUEBA: org.publicKey() });
    expect((await p.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    // No se pregunta quién la abrió: se lee solo para los firmantes (aquí, ni eso: la cuenta no existe y vale su llave).
    expect(red.lecturas).toBe(1);
  });
});

describe("mainnet cierra ante la duda", () => {
  /** Un portero de mainnet con el contrato y la frase de testnet, para poder firmar con llaves de prueba. */
  const deMainnet = async (env: Parameters<typeof leerConfig>[0]) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };

  it("la lista de billeteras de la app vacía no deja pasar a nadie, y CUENTAS_PRUEBA no abre ninguna puerta", async () => {
    const org = Keypair.random();
    abre(org);
    expect(leerConfig({ RED: "mainnet" }).patrocinadoresApp.size).toBe(0);
    expect(leerConfig({ RED: "mainnet", CUENTAS_PRUEBA: org.publicKey() }).prueba.size).toBe(0);
    expect(leerConfig({ RED: "testnet", CUENTAS_PRUEBA: org.publicKey() }).prueba.has(org.publicKey())).toBe(true);
    const m = await deMainnet({ CUENTAS_PRUEBA: org.publicKey() });
    expect(await m.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
    expect(red.enviados).toHaveLength(0);
  });

  it("con la billetera de la app cargada, pasan las cuentas que ella abrió y no las de Pollar", async () => {
    const mia = Keypair.random();
    const org = Keypair.random();
    const ajena = Keypair.random();
    abre(org, mia.publicKey());
    abre(ajena, POLLAR_TESTNET);
    const m = await deMainnet({ PATROCINADORES_APP: mia.publicKey() });
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect((await m.procesar(tx({ firmante: ajena }).xdr)).estado).toBe(403);
  });
});

describe("firmantes y umbrales de la cuenta, leídos de la cadena", () => {
  const LIM = { maxSellos: 20, maxSorteos: 40 };
  const conFirmantes = (k: Keypair, firmantes: Array<[Keypair, number]>, umbralMedio: number, patrocinador: string | null = POLLAR_TESTNET) =>
    red.cuentas.set(k.publicKey(), { patrocinador, balance: 0n, firmantes: firmantes.map(([f, peso]) => ({ clave: f.rawPublicKey(), peso })), umbralMedio });
  /** La transacción de `k`, firmada por quienes se diga (sin la firma de `k` salvo que esté en la lista). */
  const firmadaPor = (k: Keypair, quienes: Keypair[], v: Partial<Variante> = {}) => {
    const sin = armar({ contrato: CONTRATO, firmante: k, firmaDe: "ninguna", ...v });
    const t = TransactionBuilder.fromXDR(sin.xdr, Networks.TESTNET);
    t.sign(...quienes);
    return { xdr: t.toXDR(), hash: sin.hash };
  };

  it("una cuenta de dos firmas de dos, con la maestra en cero: pasa con las dos y no con una", async () => {
    const cuenta = Keypair.random();
    const a = Keypair.random();
    const b = Keypair.random();
    conFirmantes(cuenta, [[cuenta, 0], [a, 1], [b, 1]], 2);
    expect((await p.procesar(firmadaPor(cuenta, [a, b]).xdr)).estado).toBe(200);
    expect(await p.procesar(firmadaPor(cuenta, [a], { hashLista: new Uint8Array(32).fill(2) }).xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "firma", detalle: "peso-insuficiente" } });
    expect(await p.procesar(firmadaPor(cuenta, [cuenta], { hashLista: new Uint8Array(32).fill(3) }).xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "firma" } });
    expect(cupos.consultar(cuenta.publicKey(), ahora, LIM).sellos).toBe(1);
  });

  it("un firmante de peso 2 alcanza solo; el mismo firmante dos veces no suma dos", async () => {
    const cuenta = Keypair.random();
    const grande = Keypair.random();
    const chico = Keypair.random();
    conFirmantes(cuenta, [[cuenta, 0], [grande, 2], [chico, 1]], 2);
    expect((await p.procesar(firmadaPor(cuenta, [grande]).xdr)).estado).toBe(200);
    expect(await p.procesar(firmadaPor(cuenta, [chico, chico], { hashLista: new Uint8Array(32).fill(2) }).xdr)).toMatchObject({ estado: 400, cuerpo: { detalle: "peso-insuficiente" } });
  });

  it("la maestra con peso suficiente sigue valiendo; con peso menor que el umbral medio, no (la red cobraría y fallaría)", async () => {
    const cuenta = Keypair.random();
    conFirmantes(cuenta, [[cuenta, 2]], 2);
    expect((await p.procesar(firmadaPor(cuenta, [cuenta]).xdr)).estado).toBe(200);
    const debil = Keypair.random();
    conFirmantes(debil, [[debil, 1]], 2);
    expect(await p.procesar(firmadaPor(debil, [debil]).xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "firma", detalle: "peso-insuficiente" } });
    expect(red.enviados).toHaveLength(1);
  });

  it("la firma de alguien que no es firmante de la cuenta no suma", async () => {
    const cuenta = Keypair.random();
    const a = Keypair.random();
    conFirmantes(cuenta, [[cuenta, 0], [a, 1]], 1);
    expect(await p.procesar(firmadaPor(cuenta, [Keypair.random()]).xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "firma", detalle: "sin-firma-valida" } });
  });
});

describe("403: cuentas que no abrió nuestra app", () => {
  it("una cuenta con llaves propias, sin patrocinador, o con otro patrocinador, o que no existe", async () => {
    const a = Keypair.random();
    const b = Keypair.random();
    const c = Keypair.random();
    abre(a, null);
    abre(b, patrocinadora.publicKey());
    for (const k of [a, b, c]) {
      const r = await p.procesar(tx({ firmante: k }).xdr);
      expect(r, k.publicKey()).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
      expect(cupos.consultar(k.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    }
    expect(red.enviados).toHaveLength(0);
    expect(red.simulados).toBe(0);
  });
});

describe("400: lo que no se paga no gasta cupo", () => {
  it("firma de otra cuenta: el cupo de la víctima queda intacto", async () => {
    const victima = Keypair.random();
    abre(victima);
    const t = tx({ firmante: victima, firmaDe: Keypair.random() });
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 400, cuerpo: { motivo: "no-permitida", razon: "firma" } });
    const sinFirma = tx({ firmante: victima, firmaDe: "ninguna" });
    expect(await p.procesar(sinFirma.xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "firma" } });
    expect(cupos.consultar(victima.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(red.enviados).toHaveLength(0);
  });

  it("operación ajena, extend, otro contrato, organizador distinto, ventana larga y fee alta", async () => {
    const org = Keypair.random();
    abre(org);
    const casos: Array<Partial<Variante>> = [{ operacion: "pago" }, { metodo: "extend" }, { contrato: deployments.testnet.anteriores[0]?.contractId as string }, { organizador: Keypair.random().publicKey() }, { ventanaS: 3600 }, { resourceFee: 20_000_000 }];
    for (const v of casos) expect((await p.procesar(tx({ firmante: org, ...v }).xdr)).estado, JSON.stringify(v)).toBe(400);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(red.lecturas).toBe(0);
  });

  it("recursos declarados por encima de 1,5 veces lo que simula la red más el margen: fee-alta, sin contar ni mandar", async () => {
    const org = Keypair.random();
    abre(org);
    const techo = Math.ceil(1.5 * 40_000) + leerConfig({}).margenRecursos;
    expect(await p.procesar(tx({ firmante: org, resourceFee: techo + 1 }).xdr)).toMatchObject({ estado: 400, cuerpo: { motivo: "fee-alta" } });
    expect(red.enviados).toHaveLength(0);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(cupos.reservadoParaSorteos(ahora)).toBe(0);
    // Justo en el techo pasa.
    expect((await p.procesar(tx({ firmante: org, resourceFee: techo }).xdr)).estado).toBe(200);
    // Si la red simula más, el techo sube con ella.
    red.simulacion = { ok: true, minResourceFee: 100_000 };
    expect((await p.procesar(tx({ firmante: org, resourceFee: techo + 1, hashLista: new Uint8Array(32).fill(5) }).xdr)).estado).toBe(200);
  });

  it("la simulación dice que va a fallar: no se paga y no cuenta", async () => {
    const org = Keypair.random();
    abre(org);
    red.simulacion = { ok: false, motivo: "fallaria", detalle: "Error(Contract, #5)" };
    expect(await p.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 400, cuerpo: { motivo: "fallaria" } });
    expect(red.enviados).toHaveLength(0);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
  });

  it("una simulación que pide restaurar entradas tampoco se paga", async () => {
    const org = Keypair.random();
    abre(org);
    red.simulacion = { ok: false, motivo: "restaurar", detalle: "x" };
    expect(await p.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 400, cuerpo: { razon: "restaurar" } });
  });
});

describe("429: el cupo de la cuenta", () => {
  it("el sello 20 pasa y el 21 da 429 con liberaEn y max", async () => {
    const org = Keypair.random();
    abre(org);
    for (let i = 1; i <= 20; i++) {
      const r = await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(i) }).xdr);
      expect(r.estado, `sello ${i}`).toBe(200);
    }
    const r = await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(99) }).xdr);
    expect(r.estado).toBe(429);
    const d = new Date(ahora);
    expect(r.cuerpo).toEqual({ motivo: "cupo-cuenta", que: "sellos", liberaEn: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), max: 20 });
    expect(red.enviados).toHaveLength(20);
  });

  it("treinta pedidos a la vez de una cuenta no pasan del tope", async () => {
    const org = Keypair.random();
    abre(org);
    red.retraso = 5;
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(i + 1) }).xdr)));
    expect(rs.filter((x) => x.estado === 200)).toHaveLength(20);
    expect(rs.filter((x) => x.estado === 429)).toHaveLength(10);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(20);
  });

  it("treinta pedidos a la vez del mismo hash cuentan uno", async () => {
    const org = Keypair.random();
    abre(org);
    red.retraso = 5;
    const t = tx({ firmante: org });
    const rs = await Promise.all(Array.from({ length: 30 }, () => p.procesar(t.xdr)));
    expect(rs.every((x) => x.estado === 200)).toBe(true);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
  });

  it("una cuenta verificada tiene 50", async () => {
    const org = Keypair.random();
    await montar({ CUENTAS_VERIFICADAS: org.publicKey() });
    abre(org);
    for (let i = 1; i <= 50; i++) expect((await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(i) }).xdr)).estado, `sello ${i}`).toBe(200);
    expect((await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(99) }).xdr)).estado).toBe(429);
  });
});

describe("503: el fondo y el interruptor", () => {
  it("con el tope general casi lleno, un seal se rechaza y el draw de un sello ya aceptado pasa", async () => {
    // Cada seal estima 130.000 (1,5 × 40.000 + 50.000 + 2 × 10.000) y guarda 82.000 para su sorteo: 212.000. El tope deja entrar uno.
    await montar({ TOPE_GENERAL_STROOPS: "250000" });
    const a = Keypair.random();
    const b = Keypair.random();
    abre(a);
    abre(b);
    expect((await p.procesar(tx({ firmante: a }).xdr)).estado).toBe(200);
    expect(await p.procesar(tx({ firmante: b }).xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
    expect(cupos.consultar(b.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect((await p.procesar(tx({ firmante: a, metodo: "draw" }).xdr)).estado).toBe(200);
  });

  it("apagado: 503 apagado, sin tocar la red; y volver a Pollar lo dice", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    p.poner("apagado");
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado", rige: "ninguno" } });
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ prendido: false, rige: "portero" });
    p.poner("pollar");
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado", rige: "pollar" } });
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
    expect(red.lecturas + red.simulados + red.enviados.length).toBe(0);
    p.poner("portero");
    expect((await p.procesar(t.xdr)).estado).toBe(200);
  });

  it("la variable APAGADO=1 manda sobre el objeto", async () => {
    await montar({ APAGADO: "1" });
    expect((await p.procesar(tx({ firmante: Keypair.random() }).xdr)).estado).toBe(503);
  });

  it("sin la llave del Worker no se paga nada", async () => {
    await montar({}, { sinLlave: true });
    const org = Keypair.random();
    abre(org);
    expect(await p.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("una red sin contrato en la lista no patrocina nada", async () => {
    await montarMainnet(null);
    expect(await p.procesar(tx({ firmante: Keypair.random() }).xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("el portero de mainnet toma el contrato de la lista, o ninguno si todavía no hay", () => {
    const mainnetEnLista = (deployments as unknown as { mainnet: { contractId?: string } | null }).mainnet;
    expect(leerConfig({ RED: "mainnet" }).contractId).toBe(mainnetEnLista?.contractId ?? null);
  });

  describe("con una lista que trae contrato en mainnet (simulada: corre siempre)", () => {
    afterEach(() => {
      vi.doUnmock("../../../src/stellar/deployments.json");
      vi.resetModules();
    });

    // La frase simulada es inventada, distinta de la que vale sin entrada: así se ve que el portero la toma de la lista.
    it("el portero de mainnet toma el contrato y la frase de esa entrada", async () => {
      const FRASE_SIMULADA = "Frase simulada de la entrada ; noviembre de 2026";
      expect(FRASE_SIMULADA).not.toBe(Networks.PUBLIC);
      vi.resetModules();
      vi.doMock("../../../src/stellar/deployments.json", () => ({
        default: {
          ...deployments,
          mainnet: { ...deployments.testnet, contractId: CONTRATO_SIMULADO, networkPassphrase: FRASE_SIMULADA, anteriores: [] },
        },
      }));
      const { leerConfig: leerConLista } = await import("./config");
      const cfg = leerConLista({ RED: "mainnet" });
      expect(cfg.contractId).toBe(CONTRATO_SIMULADO);
      expect(cfg.passphrase).toBe(FRASE_SIMULADA);
      expect(leerConLista({ RED: "testnet" }).contractId).toBe(CONTRATO);
    });
  });

  it("un ajuste por la clave de administración rige en el pedido siguiente", async () => {
    const org = Keypair.random();
    abre(org);
    expect(p.ajustar("max_sellos_mes", 1)).toBe(true);
    expect((await p.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect((await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(2) }).xdr)).estado).toBe(429);
    expect(p.ajustar("max_sellos_mes", 5)).toBe(true);
    expect((await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(3) }).xdr)).estado).toBe(200);
    expect(p.ajustar("inventado", 5)).toBe(false);
    // Techos duros: ni con la clave se sube el tope general de 100 XLM ni la comisión por transacción por encima del tope configurado.
    expect(p.ajustar("tope_general_stroops", 1_000_000_000)).toBe(true);
    expect(p.ajustar("tope_general_stroops", 1_000_000_001)).toBe(false);
    expect(p.ajustar("tope_tx_stroops", leerConfig({}).topeTx + 1)).toBe(false);
    expect(p.ajustar("tope_tx_stroops", 5_000_000)).toBe(true);
    expect(p.ajustar("tope_tx_stroops", -1)).toBe(false);
  });
});

describe("la red la rechaza sin que entre, o no se sabe", () => {
  it("TRY_AGAIN_LATER devuelve el cupo y se puede volver a mandar", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    red.envio = { status: "TRY_AGAIN_LATER" };
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 502, cuerpo: { motivo: "red" } });
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(cupos.gastoDeLaVentana(ahora)).toBe(0);
    red.envio = { status: "PENDING" };
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 200, cuerpo: { quedan: 19 } });
  });

  it("ERROR devuelve el cupo; sin saldo en el fondo dice 503 fondo", async () => {
    const org = Keypair.random();
    abre(org);
    red.envio = { status: "ERROR", codigo: "txBadSeq" };
    expect(await p.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 400, cuerpo: { motivo: "rechazada", codigo: "txBadSeq" } });
    red.envio = { status: "ERROR", codigo: "txInsufficientBalance" };
    expect(await p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(2) }).xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
  });

  it("un corte al mandar: sigue contando, y si nunca aparece y vence, la alarma devuelve el cupo", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    red.fallaEnviar = true;
    expect((await p.procesar(t.xdr)).estado).toBe(502);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(1);
    // Todavía puede entrar: no se toca.
    ahora += ESPERA_RECONCILIAR_MS + 1;
    expect(await p.reconciliar()).toBe(true);
    expect(cupos.buscar(t.hash)?.estado).toBe("reservado");
    // Pasada la ventana de la transacción más el margen (10 minutos) sin aparecer en la red: no entró nunca.
    ahora += 8 * 60_000;
    expect(await p.reconciliar()).toBe(true);
    expect(cupos.buscar(t.hash)?.estado).toBe("reservado");
    ahora += 10 * 60_000;
    expect(await p.reconciliar()).toBe(false);
    expect(cupos.buscar(t.hash)?.estado).toBe("devuelto");
    expect(cupos.consultar(org.publicKey(), ahora - 18 * 60_000, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
  });

  it("entró y salió bien, o entró y falló: se pagó, cuenta, y se anota lo que cobró la red", async () => {
    const org = Keypair.random();
    abre(org);
    const bien = tx({ firmante: org });
    const mal = tx({ firmante: org, hashLista: new Uint8Array(32).fill(2) });
    await p.procesar(bien.xdr);
    await p.procesar(mal.xdr);
    red.consultas.set(bien.hash, { status: "SUCCESS", feeCharged: 31_000 });
    red.consultas.set(mal.hash, { status: "FAILED", feeCharged: 12_000 });
    ahora += ESPERA_RECONCILIAR_MS + 1;
    expect(await p.reconciliar()).toBe(false);
    expect(cupos.buscar(bien.hash)).toMatchObject({ estado: "ok", real: 31_000 });
    expect(cupos.buscar(mal.hash)).toMatchObject({ estado: "fallo", real: 12_000 });
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(2);
  });
});

describe("el estimado y lo guardado no dependen de lo que declara el cliente", () => {
  const LIM = { maxSellos: 20, maxSorteos: 40 };

  it("dos sellos que declaran distinto tienen el mismo estimado, y la oferta del fee-bump es la nuestra", async () => {
    const org = Keypair.random();
    abre(org);
    const cfg = leerConfig({});
    const barato = tx({ firmante: org, fee: 100 });
    const caro = tx({ firmante: org, fee: cfg.inclusionBump, resourceFee: 55_000, hashLista: new Uint8Array(32).fill(2) });
    await p.procesar(barato.xdr);
    await p.procesar(caro.xdr);
    const esperado = Math.ceil(1.5 * 40_000) + cfg.margenRecursos + 2 * cfg.inclusionBump;
    expect(cupos.buscar(barato.hash)?.estimado).toBe(esperado);
    expect(cupos.buscar(caro.hash)?.estimado).toBe(esperado);
    // La oferta es la de la configuración + los recursos que declaró, sin importar la inclusión que declaró.
    const ofertas = red.enviados.map((x) => Number((TransactionBuilder.fromXDR(x, Networks.TESTNET) as FeeBumpTransaction).fee));
    expect(ofertas).toEqual([50_000 + 2 * cfg.inclusionBump, 55_000 + 2 * cfg.inclusionBump]);
  });

  it("un fee declarado de 1 XLM (casi todo de inclusión) ya no entra: la oferta del bump nunca pasa de lo nuestro", async () => {
    const org = Keypair.random();
    abre(org);
    // Antes la lista blanca lo aceptaba (el total declarado cabía en 1 XLM) y el bump ofrecía casi 2 XLM.
    const r = await p.procesar(tx({ firmante: org, fee: 9_900_000 }).xdr);
    expect(r).toMatchObject({ estado: 400, cuerpo: { motivo: "no-permitida", razon: "fee-alta", detalle: "inclusion" } });
    expect(red.enviados).toHaveLength(0);
    expect(cupos.reservadoParaSorteos(ahora)).toBe(0);
    expect(cupos.gastoDeLaVentana(ahora)).toBe(0);
  });

  it("el peor caso: ocho sellos de una cuenta, todos con lo máximo que se acepta, retienen 8 montos fijos y no más", async () => {
    const org = Keypair.random();
    abre(org);
    const cfg = leerConfig({});
    for (let i = 1; i <= 8; i++) {
      const t = tx({ firmante: org, fee: cfg.inclusionBump, resourceFee: 60_000 + 50_000, hashLista: new Uint8Array(32).fill(i) });
      expect((await p.procesar(t.xdr)).estado, `sello ${i}`).toBe(200);
      cupos.cerrar(t.hash, "ok", 54_000);
    }
    // Al cerrar bien el sello, lo guardado para su sorteo sigue siendo el monto fijo (el costo del sello es otro costo).
    expect(cupos.reservadoParaSorteos(ahora)).toBe(8 * cfg.reservaSorteo);
    expect(cupos.reservadoParaSorteos(ahora) + cupos.gastoDeLaVentana(ahora)).toBe(8 * (cfg.reservaSorteo + 54_000));
    // Y el fondo sigue abierto para otra cuenta.
    const otra = Keypair.random();
    abre(otra);
    expect((await p.procesar(tx({ firmante: otra }).xdr)).estado).toBe(200);
    expect(cupos.consultar(org.publicKey(), ahora, LIM).sellos).toBe(8);
  });

  it("sellos baratos y sorteos con recursos inflados: el gasto real nunca pasa el presupuesto más 20 reservas fijas", async () => {
    const cfg = leerConfig({});
    // Un fondo para 20 sellos con sus reservas y poco más.
    const sello = Math.ceil(1.5 * 40_000) + cfg.margenRecursos + 2 * cfg.inclusionBump;
    const tope = 20 * (sello + cfg.reservaSorteo);
    await montar({ TOPE_GENERAL_STROOPS: String(tope) });
    const org = Keypair.random();
    abre(org);
    const idsSello: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const t = tx({ firmante: org, hashLista: new Uint8Array(32).fill(i) });
      expect((await p.procesar(t.xdr)).estado, `sello ${i}`).toBe(200);
      cupos.cerrar(t.hash, "ok", 54_000);
      idsSello.push(t.hash);
    }
    // Ahora la red simula mucho más para el sorteo (recursos inflados): el techo y el estimado del sorteo suben con ella.
    red.simulacion = { ok: true, minResourceFee: 600_000 };
    let pasaron = 0;
    for (let i = 1; i <= 20; i++) {
      const t = tx({ firmante: org, metodo: "draw", resourceFee: 900_000, raffleId: BigInt(i) });
      const r = await p.procesar(t.xdr);
      if (r.estado === 200) {
        pasaron++;
        cupos.cerrar(t.hash, "ok", 900_000); // la red cobra lo declarado, el peor caso
      } else {
        expect(r, `sorteo ${i}`).toMatchObject({ estado: 503, cuerpo: { motivo: "fondo" } });
      }
    }
    const gasto = cupos.gastoDeLaVentana(ahora);
    expect(gasto).toBeLessThanOrEqual(tope + 20 * cfg.reservaSorteo);
    expect(pasaron).toBeLessThan(20);
  });

  it("lo guardado para el sorteo de un sello sin sortear se suelta a las 6 horas", async () => {
    const org = Keypair.random();
    abre(org);
    await p.procesar(tx({ firmante: org }).xdr);
    const cfg = leerConfig({});
    expect(cupos.reservadoParaSorteos(ahora)).toBe(cfg.reservaSorteo);
    expect(cupos.reservadoParaSorteos(ahora + 6 * 3_600_000 - 1)).toBe(cfg.reservaSorteo);
    expect(cupos.reservadoParaSorteos(ahora + 6 * 3_600_000 + 1)).toBe(0);
  });
});

describe("lo que queda en el aire antes de mandar", () => {
  it("la alarma se pide apenas se reserva, antes de importar la llave y de mandar", async () => {
    const org = Keypair.random();
    abre(org);
    let pedidas = 0;
    let pedidasAlMandar = -1;
    red.envio = () => {
      pedidasAlMandar = pedidas;
      return { status: "PENDING" };
    };
    p = new Portero(leerConfig({ RED: "testnet" }), cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => void pedidas++);
    await p.procesar(tx({ firmante: org }).xdr);
    expect(pedidasAlMandar).toBe(1);
    // Mismo hash otra vez: no vuelve a pedir antes de mandar, pero sí al quedar enviada.
    expect(pedidas).toBeGreaterThanOrEqual(1);
  });

  it("si el objeto muere entre reservar y mandar, la alarma del objeto nuevo devuelve la reserva pasado el vencimiento", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    // Se reserva a mano, como lo deja un objeto que murió antes de mandar: sin `enviado` y sin nadie que mire.
    cupos.reservar({ hash: t.hash, cuenta: org.publicKey(), metodo: "seal", estimado: 130_000, vence: Math.floor(ahora / 1000) + 240 }, ahora, { maxSellos: 20, maxSorteos: 40, topeGeneral: 150_000_000, reservaSorteo: 82_000 });
    expect(cupos.enElAire()).toBe(1);
    // El objeto nuevo (otra instancia sobre el mismo SQLite) barre esa fila: a los 2 minutos todavía puede haber entrado.
    const nuevo = new Portero(leerConfig({ RED: "testnet" }), cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
    ahora += 2 * 60_000;
    expect(await nuevo.reconciliar()).toBe(true);
    expect(cupos.buscar(t.hash)?.estado).toBe("reservado");
    // Si la red la cerró en ese tiempo, se cuenta como pagada.
    red.consultas.set(t.hash, { status: "SUCCESS", feeCharged: 50_000 });
    expect(await nuevo.reconciliar()).toBe(false);
    expect(cupos.buscar(t.hash)).toMatchObject({ estado: "ok", real: 50_000 });
  });

  it("y si nunca apareció, pasado el vencimiento la reserva se devuelve y el sello vuelve al cupo", async () => {
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    cupos.reservar({ hash: t.hash, cuenta: org.publicKey(), metodo: "seal", estimado: 130_000, vence: Math.floor(ahora / 1000) + 240 }, ahora, { maxSellos: 20, maxSorteos: 40, topeGeneral: 150_000_000, reservaSorteo: 82_000 });
    const antes = ahora;
    ahora += 30 * 60_000;
    expect(await p.reconciliar()).toBe(false);
    expect(cupos.buscar(t.hash)?.estado).toBe("devuelto");
    expect(cupos.consultar(org.publicKey(), antes, { maxSellos: 20, maxSorteos: 40 }).sellos).toBe(0);
    expect(cupos.reservadoParaSorteos(antes)).toBe(0);
  });
});

describe("/cupo dice la verdad sobre si está prendido", () => {
  const pregunta = async () => (await p.cupoDe(Keypair.random().publicKey())).cuerpo;

  it("completo: prendido; apagado por el interruptor: no, con motivo apagado", async () => {
    expect(await pregunta()).toMatchObject({ prendido: true, rige: "portero" });
    expect(await pregunta()).not.toHaveProperty("motivo");
    p.poner("apagado");
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "apagado" });
  });

  it("sin llave del Worker: no está prendido, motivo config, aunque nadie lo haya apagado", async () => {
    await montar({}, { sinLlave: true });
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "config" });
    expect(p.faltaDeConfig()).toEqual(["llave"]);
  });

  it("sin cuenta patrocinadora o sin contrato en la lista: tampoco", async () => {
    p = new Portero(leerConfig({ RED: "testnet" }), cupos, red, await firmanteDe(llave.secret()), null, () => ahora);
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "config" });
    expect(p.faltaDeConfig()).toEqual(["cuenta"]);
    await montarMainnet(null);
    expect(p.faltaDeConfig()).toEqual(["contrato", "billeteras-de-la-app"]);
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "config", red: "mainnet" });
  });

  it("con contrato en mainnet y sin la lista de billeteras de la app: tampoco, y solo falta esa lista", async () => {
    await montarMainnet(CONTRATO_SIMULADO);
    expect(p.faltaDeConfig()).toEqual(["billeteras-de-la-app"]);
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "config", red: "mainnet" });
  });

  it("devuelto a Pollar el portero no paga: prendido false, motivo pollar y rige Pollar (con o sin su llave)", async () => {
    p.poner("pollar");
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
    await montar({}, { sinLlave: true });
    p.poner("pollar");
    expect(await pregunta()).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
  });
});

describe("la alerta del fondo y la aviso", () => {
  const conSaldo = (saldo: bigint | null) => red.cuentas.set(patrocinadora.publicKey(), saldo === null ? null : { patrocinador: null, balance: saldo });

  it("/estado dice el saldo leído de la red y alerta:true por debajo del umbral", async () => {
    conSaldo(500_000_000n);
    const bien = (await p.estado()).cuerpo;
    expect(bien).toMatchObject({ balanceStroops: "500000000", alerta: false, saldoAlertaStroops: 200_000_000, patrocinadora: patrocinadora.publicKey() });
    expect(bien).not.toHaveProperty("motivoAlerta");
    conSaldo(199_999_999n);
    expect((await p.estado()).cuerpo).toMatchObject({ balanceStroops: "199999999", alerta: true, motivoAlerta: "saldo-bajo" });
    await montar({ SALDO_ALERTA_STROOPS: "1000" });
    conSaldo(1000n);
    expect((await p.estado()).cuerpo).toMatchObject({ alerta: false });
  });

  it("si no se puede leer el saldo también es alerta: callar no es estar bien", async () => {
    conSaldo(null);
    expect((await p.estado()).cuerpo).toMatchObject({ balanceStroops: null, alerta: true, motivoAlerta: "saldo-no-leido" });
    red.leerCuenta = async () => {
      throw new ErrorDeRed("corte");
    };
    expect((await p.estado()).cuerpo).toMatchObject({ alerta: true, motivoAlerta: "saldo-no-leido" });
  });

  it("la aviso cuenta reservar, enviar y el resultado, sin cuentas, llaves ni direcciones", async () => {
    const eventos: Array<[string, Record<string, string | number> | undefined]> = [];
    p = new Portero(leerConfig({ RED: "testnet" }), cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => {}, (e, d) => eventos.push([e, d]));
    const org = Keypair.random();
    abre(org);
    const t = tx({ firmante: org });
    await p.procesar(t.xdr);
    red.consultas.set(t.hash, { status: "SUCCESS", feeCharged: 54_000 });
    ahora += ESPERA_RECONCILIAR_MS + 1;
    await p.reconciliar();
    expect(eventos.map(([e]) => e)).toEqual(["reservado", "enviado", "resultado", "alarma"]);
    const texto = JSON.stringify(eventos);
    for (const secreto of [org.publicKey(), patrocinadora.publicKey(), llave.publicKey(), llave.secret(), t.hash]) expect(texto).not.toContain(secreto);
    expect(texto).toContain(t.hash.slice(0, 8));
    expect(eventos[2]?.[1]).toMatchObject({ estado: "ok", real: 54_000 });
  });
});

describe("el cupo que se consulta", () => {
  it("dice lo que queda, cuándo se libera, si está prendido y quién rige", async () => {
    const org = Keypair.random();
    abre(org);
    await p.procesar(tx({ firmante: org }).xdr);
    const c = await p.cupoDe(org.publicKey());
    expect(c.estado).toBe(200);
    expect(c.cuerpo).toMatchObject({ prendido: true, rige: "portero", red: "testnet", sellos: { usados: 1, max: 20, quedan: 19 }, sorteos: { usados: 0, max: 40, quedan: 40 } });
    expect(typeof c.cuerpo.liberaEn).toBe("number");
    expect((await p.cupoDe("no-es-una-cuenta")).estado).toBe(400);
  });
});

describe("el plan del equipo sube el cupo", () => {
  const DIA = 86_400_000;
  const jsonPlan = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
  const conPlan = (vence: number, sellos = 50, sorteos = 100) => jsonPlan({ activo: true, vence, cupo: { sellos, sorteos } });
  const sinPlan = () => jsonPlan({ activo: false });

  /** El portero con un Worker de la cuenta de mentira, que contesta lo que se le diga y anota a quién le preguntaron. */
  async function montarConPlan(responder: (cuenta: string) => Promise<Response> | Response, env: Parameters<typeof leerConfig>[0] = {}, espera = 1_500) {
    const preguntas: string[] = [];
    const f = (async (url: unknown) => {
      const cuenta = /\/v1\/cuenta\/(G[A-Z0-9]+)\/plan$/.exec(String(url))?.[1] ?? "";
      preguntas.push(cuenta);
      return responder(cuenta);
    }) as unknown as typeof fetch;
    const avisos: string[] = [];
    const planes = new Planes("https://cuenta.tinkazo.app", f, () => ahora, (e) => void avisos.push(e), espera);
    red = new RedFalsa();
    cupos = new Cupos(sqlDePrueba());
    p = new Portero(leerConfig({ RED: "testnet", ...env }), cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora, () => {}, () => {}, planes);
    return { preguntas, avisos };
  }

  const sello = (org: Keypair, i: number) => p.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(i) }).xdr);
  const sorteo = (org: Keypair, i: number) => p.procesar(tx({ firmante: org, metodo: "draw", raffleId: BigInt(i) }).xdr);

  it("con el plan activo la cuenta sella 50 al mes, no 20; el 51 da 429 con max 50", async () => {
    const org = Keypair.random();
    await montarConPlan(() => conPlan(ahora + 10 * DIA));
    abre(org);
    for (let i = 1; i <= 50; i++) expect((await sello(org, i)).estado, `sello ${i}`).toBe(200);
    const r = await sello(org, 99);
    expect(r.estado).toBe(429);
    expect(r.cuerpo).toMatchObject({ motivo: "cupo-cuenta", que: "sellos", max: 50 });
  });

  it("con el plan activo los sorteos propios suben a 100 al mes (sin plan, 40)", async () => {
    const org = Keypair.random();
    await montarConPlan(() => conPlan(ahora + 10 * DIA));
    abre(org);
    for (let i = 1; i <= 100; i++) expect((await sorteo(org, i)).estado, `sorteo ${i}`).toBe(200);
    expect(await sorteo(org, 101)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-cuenta", que: "sorteos", max: 100 } });

    const otra = Keypair.random();
    await montarConPlan(() => sinPlan());
    abre(otra);
    for (let i = 1; i <= 40; i++) expect((await sorteo(otra, i)).estado, `sorteo ${i}`).toBe(200);
    expect(await sorteo(otra, 41)).toMatchObject({ estado: 429, cuerpo: { que: "sorteos", max: 40 } });
  });

  it("sin plan sigue siendo 20: el sello 21 da 429 con max 20", async () => {
    const org = Keypair.random();
    await montarConPlan(() => sinPlan());
    abre(org);
    for (let i = 1; i <= 20; i++) expect((await sello(org, i)).estado, `sello ${i}`).toBe(200);
    expect(await sello(org, 99)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-cuenta", que: "sellos", max: 20 } });
  });

  it("el plan sube lo que ya se usó: quien llegó a 20 y compra el plan puede seguir hasta 50", async () => {
    const org = Keypair.random();
    let tiene = false;
    const m = await montarConPlan(() => (tiene ? conPlan(ahora + 30 * DIA) : sinPlan()));
    abre(org);
    for (let i = 1; i <= 20; i++) expect((await sello(org, i)).estado).toBe(200);
    expect((await sello(org, 21)).estado).toBe(429);
    tiene = true;
    // Lo recordado de «sin plan» dura un minuto: pasado eso, el portero se entera.
    ahora += 61_000;
    const r = await sello(org, 22);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ quedan: 29 });
    expect(m.preguntas.length).toBeGreaterThanOrEqual(2);
  });

  it("/cupo dice los números del plan: lo que queda sale de 50 y de 100", async () => {
    const org = Keypair.random();
    await montarConPlan(() => conPlan(ahora + 10 * DIA));
    abre(org);
    await sello(org, 1);
    const c = await p.cupoDe(org.publicKey());
    expect(c.estado).toBe(200);
    expect(c.cuerpo).toMatchObject({ prendido: true, rige: "portero", sellos: { usados: 1, max: 50, quedan: 49 }, sorteos: { usados: 0, max: 100, quedan: 100 } });
  });

  it("al vencer el plan, /cupo vuelve a 20 y 40 (no se recuerda un plan más allá de su vencimiento)", async () => {
    const org = Keypair.random();
    const vence = ahora + 2 * 60_000;
    await montarConPlan(() => conPlan(vence));
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 50 }, sorteos: { max: 100 } });
    ahora = vence + 1;
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 }, sorteos: { max: 40 } });
  });

  it("la respuesta se recuerda: varios pedidos de la cuenta preguntan una sola vez", async () => {
    const org = Keypair.random();
    const m = await montarConPlan(() => conPlan(ahora + 10 * DIA));
    abre(org);
    for (let i = 1; i <= 5; i++) await sello(org, i);
    await p.cupoDe(org.publicKey());
    expect(m.preguntas).toEqual([org.publicKey()]);
  });

  it("la consulta caída: el cupo es el de siempre, el pedido se paga igual y no se rompe nada", async () => {
    const org = Keypair.random();
    const m = await montarConPlan(() => Promise.reject(new TypeError("fetch failed")));
    abre(org);
    for (let i = 1; i <= 20; i++) expect((await sello(org, i)).estado, `sello ${i}`).toBe(200);
    expect(await sello(org, 21)).toMatchObject({ estado: 429, cuerpo: { max: 20 } });
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ prendido: true, sellos: { max: 20 } });
    expect(m.preguntas).toHaveLength(1);
    expect(m.avisos).toContain("plan-sin-respuesta");
  });

  it("la consulta que nunca contesta no frena el pedido más que el tiempo máximo", async () => {
    const org = Keypair.random();
    await montarConPlan(() => new Promise<Response>(() => {}), {}, 40);
    abre(org);
    const antes = Date.now();
    expect((await sello(org, 1)).estado).toBe(200);
    expect(Date.now() - antes).toBeLessThan(1_000);
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 } });
  });

  it("la consulta que contesta basura o un error cuenta como caída", async () => {
    const org = Keypair.random();
    for (const respuesta of [() => jsonPlan({ error: "libro" }, 503), () => jsonPlan({ activo: true }), () => new Response("no es json")]) {
      await montarConPlan(respuesta);
      expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 }, sorteos: { max: 40 } });
    }
  });

  it("el plan nunca baja un cupo: uno más chico que el de siempre no cambia nada, y una cuenta verificada se queda con el suyo", async () => {
    const org = Keypair.random();
    await montarConPlan(() => conPlan(ahora + DIA, 10, 15));
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 }, sorteos: { max: 40 } });
    await montarConPlan(() => conPlan(ahora + DIA, 50, 100), { CUENTAS_VERIFICADAS: org.publicKey(), MAX_SELLOS_VERIFICADA: "80" });
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 80 }, sorteos: { max: 160 } });
  });

  it("el plan de una cuenta no sube el cupo de otra", async () => {
    const con = Keypair.random();
    const sin = Keypair.random();
    await montarConPlan((cuenta) => (cuenta === con.publicKey() ? conPlan(ahora + DIA) : sinPlan()));
    expect((await p.cupoDe(con.publicKey())).cuerpo).toMatchObject({ sellos: { max: 50 } });
    expect((await p.cupoDe(sin.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 } });
  });

  it("sin CUENTA_URL (el portero de siempre) no se pregunta nada: el cupo es el de siempre", async () => {
    const org = Keypair.random();
    expect(leerConfig({}).cuentaUrl).toBeNull();
    abre(org);
    expect((await p.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 20 }, sorteos: { max: 40 } });
  });

  it("el plan no cambia lo demás: ni el tope general ni el apagado ni la regla de que la abrió la app", async () => {
    const org = Keypair.random();
    await montarConPlan(() => conPlan(ahora + DIA));
    // Una cuenta que no abrió nuestra app sigue sin pasar, tenga plan o no.
    expect((await sello(org, 1)).estado).toBe(403);
    abre(org);
    p.poner("apagado");
    expect((await sello(org, 2)).estado).toBe(503);
    p.poner("portero");
    cupos.fijarAjuste("tope_general_stroops", "1", ahora);
    expect((await sello(org, 3)).estado).toBe(503);
  });
});

describe("mainnet: los sorteos del mes son tantos como los sellos", () => {
  /** Un portero de mainnet con el contrato y la frase de testnet, para poder firmar con llaves de prueba. */
  const deMainnet = async (env: Parameters<typeof leerConfig>[0]) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };

  it("con MAX_SELLOS_MES=100, /cupo dice 100 sorteos y no 200; con el ajuste, los sorteos lo siguen", async () => {
    const org = Keypair.random();
    const m = await deMainnet({ MAX_SELLOS_MES: "100" });
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ red: "mainnet", sellos: { max: 100 }, sorteos: { max: 100 } });
    m.ajustar("max_sellos_mes", 30);
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 30 }, sorteos: { max: 30 } });
  });

  it("el sorteo 3 de una cuenta con 2 sellos por mes da 429", async () => {
    const mia = Keypair.random();
    const org = Keypair.random();
    abre(org, mia.publicKey());
    const m = await deMainnet({ MAX_SELLOS_MES: "2", PATROCINADORES_APP: mia.publicKey() });
    const sorteo = (i: number) => m.procesar(tx({ firmante: org, metodo: "draw", raffleId: BigInt(i) }).xdr);
    expect((await sorteo(1)).estado).toBe(200);
    expect((await sorteo(2)).estado).toBe(200);
    expect(await sorteo(3)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-cuenta", que: "sorteos", max: 2 } });
  });
});

describe("mainnet con ALTAS=1: la puerta mira solo el libro", () => {
  /** Un portero de mainnet con el contrato y la frase de testnet, para poder firmar con llaves de prueba. */
  const deMainnet = async (env: Parameters<typeof leerConfig>[0]) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };
  const fondoDePollar = Keypair.random();
  /** Desde que cada sello gasta sorteos oficiales, una admitida que sella tiene que tener alguno. */
  const dar = (k: Keypair, sorteos = 3) => cupos.otorgar({ usuario: `cuenta:${k.publicKey()}`, cuenta: k.publicKey(), origen: "admin", ref: `admin:${k.publicKey()}`, sorteos, dias: 60 }, ahora);

  it("una cuenta con la reserva del fondo de Pollar y sin alta da 403, sin simular ni recordarla", async () => {
    const org = Keypair.random();
    abre(org, fondoDePollar.publicKey());
    const m = await deMainnet({ ALTAS: "1", PATROCINADORES_APP: fondoDePollar.publicKey() });
    expect(await m.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
    expect(await m.procesar(tx({ firmante: org, metodo: "draw", raffleId: 7n }).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
    expect(red.simulados).toBe(0);
    expect(red.enviados).toHaveLength(0);
    expect(cupos.cuentaConocida(org.publicKey())).toBe(false);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 100, maxSorteos: 100 })).toMatchObject({ sellos: 0, sorteos: 0 });
  });

  it("una cuenta vista antes y sin alta da 403", async () => {
    const org = Keypair.random();
    abre(org, fondoDePollar.publicKey());
    cupos.recordarCuenta(org.publicKey(), ahora);
    const m = await deMainnet({ ALTAS: "1", PATROCINADORES_APP: fondoDePollar.publicKey() });
    expect(await m.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
    expect(red.enviados).toHaveLength(0);
  });

  it("una admitida pasa, abra quien abra su cuenta, y sin la lista de billeteras de la app", async () => {
    const org = Keypair.random();
    const propia = Keypair.random();
    abre(org, fondoDePollar.publicKey());
    abre(propia, null);
    cupos.admitir(org.publicKey(), "cupon", ahora);
    cupos.admitir(propia.publicKey(), "admin", ahora);
    dar(org);
    dar(propia);
    const m = await deMainnet({ ALTAS: "1" });
    expect(m.faltaDeConfig()).toEqual([]);
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ prendido: true, rige: "portero", red: "mainnet" });
    expect(await m.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect((await m.procesar(tx({ firmante: propia }).xdr)).estado).toBe(200);
    expect((await m.procesar(tx({ firmante: org, metodo: "draw", raffleId: 3n }).xdr)).estado).toBe(200);
    expect(red.enviados).toHaveLength(3);
  });

  it("lo de siempre sigue valiendo para la admitida: apagado, el tope del mes y el general", async () => {
    const org = Keypair.random();
    abre(org, null);
    cupos.admitir(org.publicKey(), "pago", ahora);
    dar(org);
    const m = await deMainnet({ ALTAS: "1", MAX_SELLOS_MES: "1" });
    m.poner("apagado");
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(503);
    m.poner("portero");
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect(await m.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(9) }).xdr)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-cuenta", que: "sellos" } });
  });

  it("con ALTAS apagado mainnet hace lo de hoy: la billetera de la app abre la puerta y el libro no hace falta", async () => {
    const org = Keypair.random();
    abre(org, fondoDePollar.publicKey());
    const m = await deMainnet({ ALTAS: "0", PATROCINADORES_APP: fondoDePollar.publicKey() });
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect(cupos.cuentaConocida(org.publicKey())).toBe(true);
    expect(cupos.estaEnElLibro(org.publicKey())).toBe(false);
    // Y sin la lista, como hoy, falta la configuración.
    expect((await deMainnet({ ALTAS: "0" })).faltaDeConfig()).toEqual(["billeteras-de-la-app"]);
  });

  it("ALTAS=0 con la lista vacía es el corte: ni las cuentas que ya estaban en el libro pasan", async () => {
    const org = Keypair.random();
    abre(org, null);
    cupos.admitir(org.publicKey(), "cupon", ahora);
    dar(org);
    const prendido = await deMainnet({ ALTAS: "1" });
    expect((await prendido.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    const corte = await deMainnet({ ALTAS: "0" });
    expect(await corte.procesar(tx({ firmante: org, hashLista: new Uint8Array(32).fill(4) }).xdr)).toMatchObject({ estado: 403, cuerpo: { motivo: "cuenta-ajena" } });
    expect(red.enviados).toHaveLength(1);
    expect(cupos.estaEnElLibro(org.publicKey())).toBe(true);
  });

  it("en testnet ALTAS se ignora: una cuenta de la app sin alta pasa como hoy", async () => {
    const org = Keypair.random();
    abre(org);
    await montar({ ALTAS: "1" });
    abre(org);
    expect((await p.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect(cupos.estaEnElLibro(org.publicKey())).toBe(false);
  });
});

describe("mainnet con ALTAS=1: cada sello gasta sorteos oficiales", () => {
  const deMainnet = async (env: Parameters<typeof leerConfig>[0] = {}) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };
  /** Una cuenta del libro con `sorteos` sorteos oficiales para 60 días. */
  const admitida = (sorteos: number) => {
    const k = Keypair.random();
    abre(k, null);
    cupos.admitir(k.publicKey(), "cupon", ahora);
    if (sorteos > 0) cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:h:${k.publicKey()}`, sorteos, dias: 60 }, ahora);
    return k;
  };
  const lista = (i: number) => new Uint8Array(32).fill(i);
  const quedan = (k: Keypair) => cupos.quedan({ cuenta: k.publicKey() }, ahora).quedan;

  it("del libro y sin sorteos da 402 sin-sorteos: no se manda nada ni se cuenta el mes", async () => {
    const org = admitida(0);
    const m = await deMainnet();
    expect(await m.procesar(tx({ firmante: org }).xdr)).toEqual({ estado: 402, cuerpo: { motivo: "sin-sorteos", vencieron: 0 } });
    expect(red.enviados).toHaveLength(0);
    expect(cupos.consultar(org.publicKey(), ahora, { maxSellos: 100, maxSorteos: 100 }).sellos).toBe(0);
  });

  it("con uno, sella una vez y la segunda da 402; el mismo sello reenviado no gasta otro", async () => {
    const org = admitida(1);
    const m = await deMainnet();
    const t = tx({ firmante: org, hashLista: lista(1) });
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    expect(quedan(org)).toBe(0);
    expect(await m.procesar(tx({ firmante: org, hashLista: lista(2) }).xdr)).toMatchObject({ estado: 402, cuerpo: { motivo: "sin-sorteos" } });
    expect(red.enviados).toHaveLength(2);
  });

  it("los vencidos no alcanzan, y la respuesta dice cuántos vencieron", async () => {
    const org = admitida(0);
    // Se le dieron hace 61 días, para 60: vencieron.
    cupos.otorgar({ usuario: "u", cuenta: org.publicKey(), origen: "cupon", ref: "cupon:viejo", sorteos: 3, dias: 60 }, ahora - 61 * 86_400_000);
    const m = await deMainnet();
    expect(await m.procesar(tx({ firmante: org }).xdr)).toMatchObject({ estado: 402, cuerpo: { motivo: "sin-sorteos", vencieron: 3 } });
  });

  it("con 60 ganadores gasta dos: con uno solo da 402 y con dos pasa", async () => {
    const org = admitida(1);
    const m = await deMainnet();
    expect((await m.procesar(tx({ firmante: org, ganadores: 60 }).xdr)).estado).toBe(402);
    cupos.otorgar({ usuario: "u", cuenta: org.publicKey(), origen: "admin", ref: "admin:otro", sorteos: 1, dias: 60 }, ahora);
    expect((await m.procesar(tx({ firmante: org, ganadores: 60, hashLista: lista(3) }).xdr)).estado).toBe(200);
    expect(quedan(org)).toBe(0);
  });

  it("si la red lo rechaza sin que entre, el sorteo vuelve", async () => {
    const org = admitida(1);
    const m = await deMainnet();
    red.envio = { status: "ERROR", codigo: "txBadSeq" };
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(400);
    expect(quedan(org)).toBe(1);
  });

  it("un draw no gasta sorteos oficiales: pasa aunque no le quede ninguno", async () => {
    const org = admitida(0);
    const m = await deMainnet();
    expect((await m.procesar(tx({ firmante: org, metodo: "draw", raffleId: 5n }).xdr)).estado).toBe(200);
    expect(red.enviados).toHaveLength(1);
  });

  it("treinta sellos a la vez con cinco sorteos: pasan cinco y los demás dan 402", async () => {
    const org = admitida(5);
    const m = await deMainnet();
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => m.procesar(tx({ firmante: org, hashLista: lista(i + 10) }).xdr)));
    expect(res.filter((x) => x.estado === 200)).toHaveLength(5);
    expect(res.filter((x) => x.estado === 402)).toHaveLength(25);
    expect(red.enviados).toHaveLength(5);
    expect(quedan(org)).toBe(0);
  });

  it("en testnet nada de esto: un sello pasa sin derechos, como hoy", async () => {
    const org = Keypair.random();
    abre(org);
    await montar({ ALTAS: "1" });
    abre(org);
    expect((await p.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect(cupos.quedan({ cuenta: org.publicKey() }, ahora).quedan).toBe(0);
  });
});

describe("mainnet con ALTAS=1: /cupo suma oficial", () => {
  /** Con el tope del mes de mainnet (`MAX_SELLOS_MES = 100`). */
  const deMainnet = async (env: Parameters<typeof leerConfig>[0] = {}) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", MAX_SELLOS_MES: "100", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };
  const DIA = 86_400_000;

  it("del libro: acceso, los sorteos que quedan con el próximo vencimiento, y sellos.quedan es el menor", async () => {
    const org = Keypair.random();
    abre(org, null);
    cupos.admitir(org.publicKey(), "cupon", ahora);
    cupos.otorgar({ usuario: "u", cuenta: org.publicKey(), origen: "cupon", ref: "cupon:a", sorteos: 3, dias: 60 }, ahora);
    cupos.otorgar({ usuario: "u", cuenta: org.publicKey(), origen: "admin", ref: "admin:b", sorteos: 10, dias: 365 }, ahora);
    const m = await deMainnet();
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({
      prendido: true,
      sellos: { usados: 0, max: 100, quedan: 13 },
      oficial: { acceso: true, sorteos: { quedan: 13, proximoVence: { fecha: ahora + 60 * DIA, cuantos: 3 } } },
    });
    // Con el tope del mes más bajo que los sorteos, manda el mes.
    m.ajustar("max_sellos_mes", 5);
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 5, quedan: 5 }, oficial: { sorteos: { quedan: 13 } } });
    // Un sello gasta uno.
    expect((await m.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { usados: 1, quedan: 4 }, oficial: { sorteos: { quedan: 12 } } });
  });

  it("del libro sin sorteos, o con los suyos vencidos: acceso y quedan 0", async () => {
    const org = Keypair.random();
    cupos.admitir(org.publicKey(), "cupon", ahora);
    cupos.otorgar({ usuario: "u", cuenta: org.publicKey(), origen: "cupon", ref: "cupon:viejo", sorteos: 3, dias: 60 }, ahora - 61 * DIA);
    const m = await deMainnet();
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { quedan: 0 }, oficial: { acceso: true, sorteos: { quedan: 0, proximoVence: null } } });
  });

  it("fuera del libro: sin acceso, sin sorteos y sellos.quedan 0, aunque tenga cupo del mes", async () => {
    const org = Keypair.random();
    cupos.recordarCuenta(org.publicKey(), ahora);
    const m = await deMainnet();
    expect((await m.cupoDe(org.publicKey())).cuerpo).toMatchObject({ sellos: { max: 100, quedan: 0 }, oficial: { acceso: false, sorteos: null } });
  });

  it("con ALTAS=0 en mainnet, y en testnet aunque diga ALTAS=1, /cupo sigue como hoy: sin oficial", async () => {
    const org = Keypair.random();
    cupos.admitir(org.publicKey(), "cupon", ahora);
    const sinAltas = await deMainnet({ ALTAS: "0" });
    const a = (await sinAltas.cupoDe(org.publicKey())).cuerpo;
    expect(a).not.toHaveProperty("oficial");
    expect(a).toMatchObject({ sellos: { quedan: 100 } });
    await montar({ ALTAS: "1" });
    const b = (await p.cupoDe(org.publicKey())).cuerpo;
    expect(b).not.toHaveProperty("oficial");
    expect(b).toMatchObject({ sellos: { max: 20, quedan: 20 }, sorteos: { max: 40 } });
  });
});

describe("mainnet con ALTAS=1: cada sello que paga el portero queda en sellos_portero", () => {
  const deMainnet = async (env: Parameters<typeof leerConfig>[0] = {}) => {
    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, cupos, red, await firmanteDe(llave.secret()), patrocinadora.publicKey(), () => ahora);
  };
  const admitida = (sorteos = 3) => {
    const k = Keypair.random();
    abre(k, null);
    cupos.admitir(k.publicKey(), "cupon", ahora);
    cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:h:${k.publicKey()}`, sorteos, dias: 60 }, ahora);
    return k;
  };
  const filas = () => cupos.exportar(true).sellos_portero ?? [];
  const lista = new Uint8Array(32).fill(0xab);

  it("anota el organizador, la huella de la lista y la ronda; reenviado, una fila; el draw no anota", async () => {
    const org = admitida();
    const m = await deMainnet();
    const t = tx({ firmante: org, hashLista: lista });
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    expect((await m.procesar(tx({ firmante: org, metodo: "draw", raffleId: 4n }).xdr)).estado).toBe(200);
    expect(filas()).toEqual([{ hash: t.hash, organizador: org.publicKey(), huella_lista: "ab".repeat(32), ronda: 99, ms: ahora }]);
  });

  it("lo que no se paga no se anota: sin sorteos, y si la red lo rechaza sin que entre se borra", async () => {
    const sin = admitida(1);
    const m = await deMainnet();
    expect((await m.procesar(tx({ firmante: sin, hashLista: lista }).xdr)).estado).toBe(200);
    expect(await m.procesar(tx({ firmante: sin, hashLista: new Uint8Array(32).fill(1) }).xdr)).toMatchObject({ estado: 402 });
    expect(filas()).toHaveLength(1);
    const org = admitida();
    red.envio = { status: "ERROR", codigo: "txBadSeq" };
    expect((await m.procesar(tx({ firmante: org, hashLista: lista }).xdr)).estado).toBe(400);
    expect(filas().map((f) => f.organizador)).toEqual([sin.publicKey()]);
  });

  it("en testnet y en mainnet sin altas no se anota nada", async () => {
    const org = Keypair.random();
    abre(org);
    await montar({ ALTAS: "1" });
    abre(org);
    expect((await p.procesar(tx({ firmante: org }).xdr)).estado).toBe(200);
    expect(filas()).toHaveLength(0);
    const fondo = Keypair.random();
    const otra = Keypair.random();
    abre(otra, fondo.publicKey());
    const sinAltas = await deMainnet({ ALTAS: "0", PATROCINADORES_APP: fondo.publicKey() });
    expect((await sinAltas.procesar(tx({ firmante: otra }).xdr)).estado).toBe(200);
    expect(filas()).toHaveLength(0);
  });
});
