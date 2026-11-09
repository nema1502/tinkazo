import { Keypair, Networks, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk/base";
import { beforeEach, describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { armar, type Variante } from "./armar";
import { POLLAR_TESTNET, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { verificarFirma } from "./lista-blanca";
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
    expect(p.cupoDe(org.publicKey()).cuerpo).toMatchObject({ prendido: false, rige: "portero" });
    p.poner("pollar");
    expect(await p.procesar(t.xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado", rige: "pollar" } });
    expect(p.cupoDe(org.publicKey()).cuerpo).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
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

  it("mainnet todavía no tiene contrato: no patrocina nada", async () => {
    await montar({ RED: "mainnet" });
    expect(await p.procesar(tx({ firmante: Keypair.random() }).xdr)).toMatchObject({ estado: 503, cuerpo: { motivo: "apagado" } });
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
  const pregunta = () => p.cupoDe(Keypair.random().publicKey()).cuerpo;

  it("completo: prendido; apagado por el interruptor: no, con motivo apagado", async () => {
    expect(pregunta()).toMatchObject({ prendido: true, rige: "portero" });
    expect(pregunta()).not.toHaveProperty("motivo");
    p.poner("apagado");
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "apagado" });
  });

  it("sin llave del Worker: no está prendido, motivo config, aunque nadie lo haya apagado", async () => {
    await montar({}, { sinLlave: true });
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "config" });
    expect(p.faltaDeConfig()).toEqual(["llave"]);
  });

  it("sin cuenta patrocinadora o sin contrato (mainnet todavía no tiene): tampoco", async () => {
    p = new Portero(leerConfig({ RED: "testnet" }), cupos, red, await firmanteDe(llave.secret()), null, () => ahora);
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "config" });
    expect(p.faltaDeConfig()).toEqual(["cuenta"]);
    await montar({ RED: "mainnet" });
    expect(p.faltaDeConfig()).toEqual(["contrato", "billeteras-de-la-app"]);
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "config", red: "mainnet" });
  });

  it("devuelto a Pollar el portero no paga: prendido false, motivo pollar y rige Pollar (con o sin su llave)", async () => {
    p.poner("pollar");
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
    await montar({}, { sinLlave: true });
    p.poner("pollar");
    expect(pregunta()).toMatchObject({ prendido: false, motivo: "pollar", rige: "pollar" });
  });
});

describe("la alerta del fondo y la bitácora", () => {
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

  it("la bitácora cuenta reservar, enviar y el resultado, sin cuentas, llaves ni direcciones", async () => {
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
    const c = p.cupoDe(org.publicKey());
    expect(c.estado).toBe(200);
    expect(c.cuerpo).toMatchObject({ prendido: true, rige: "portero", red: "testnet", sellos: { usados: 1, max: 20, quedan: 19 }, sorteos: { usados: 0, max: 40, quedan: 40 } });
    expect(typeof c.cuerpo.liberaEn).toBe("number");
    expect(p.cupoDe("no-es-una-cuenta").estado).toBe(400);
  });
});
