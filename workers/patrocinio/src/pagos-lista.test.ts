import { Asset, Keypair, Memo, Networks, Operation, StrKey, xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import {
  AHORA_DE_PRUEBA,
  USDC_DE_CIRCLE,
  armarPago,
  comoFeeBump,
  comoVersionVieja,
  direccionM,
  notaDePremio,
  pagoUsdc,
  type VariantePago,
} from "./armar-pago";
import { EMISOR_USDC, ordenDeNota, sinSeparadores } from "./cobros";
import { type Autoridad, pesoDeLasFirmas } from "./lista-blanca";
import {
  type FormaDePago,
  type LecturaDePago,
  type PagoLeido,
  type ReglasDePago,
  type VeredictoDePago,
  firmasDelPago,
  leerPago,
  ventanaDelPago,
} from "./pagos-lista";
import { autoridadDe } from "./servicio";

const origen = Keypair.random();
const patrocinadora = Keypair.random();
const sorteadora = Keypair.random();
const cobros = Keypair.random();
const COBROS = cobros.publicKey();
/** El costo exacto del retiro: 0,50 USDC en diezmillonésimas. */
const COSTO = 5_000_000;

const reglas = (forma: FormaDePago): ReglasDePago => ({
  passphrase: Networks.PUBLIC,
  forma,
  cuentaCobros: COBROS,
  costoRetiro: COSTO,
  cuentasDelPortero: [patrocinadora.publicKey(), sorteadora.publicKey(), COBROS],
});

const armar = (forma: FormaDePago, v: Partial<VariantePago> = {}) => armarPago({ firmante: origen, forma, cobros: COBROS, ...v });
const leerComo = (forma: FormaDePago, v: Partial<VariantePago> = {}, r: ReglasDePago = reglas(forma)) => leerPago(armar(forma, v).xdr, r);
/** Lo que dice una lectura o un veredicto en una palabra: `ok` o `razon/detalle`. */
const dice = (l: LecturaDePago | VeredictoDePago): string => (l.ok ? "ok" : `${l.razon}/${l.detalle}`);
const otraCuenta = () => Keypair.random().publicKey();

function aceptado(l: LecturaDePago): PagoLeido {
  if (!l.ok) {
    throw new Error(`se esperaba un pago aceptado y se rechazó: ${l.razon}/${l.detalle}`);
  }
  return l.pago;
}

describe("el lector de pagos acepta lo que debe", () => {
  it("un premio bien armado, con su hash, su cuenta, su nota y su destino", () => {
    const persona = otraCuenta();
    const t = armar("premio", { persona, sorteo: "5", puesto: 0 });
    expect(aceptado(leerPago(t.xdr, reglas("premio")))).toEqual({
      forma: "premio",
      hash: t.hash,
      cuenta: origen.publicKey(),
      salidas: [{ destino: persona, monto: 30_000_000n }],
      nota: { tipo: "texto", valor: "tk:premio:5:0" },
      venceS: AHORA_DE_PRUEBA + 240,
      feeDeclarado: 1000,
      premio: { sorteo: "5", puesto: 0, destino: persona },
    });
  });

  it("un premio del último puesto que cabe", () => {
    const p = aceptado(leerComo("premio", { sorteo: "1234567890", puesto: 299 }));
    expect(p.premio).toMatchObject({ sorteo: "1234567890", puesto: 299 });
  });

  it.each([
    ["ninguna", null, { tipo: "ninguna" }],
    ["numérica", Memo.id("12345"), { tipo: "id", valor: "12345" }],
    ["de texto", Memo.text("gracias"), { tipo: "texto", valor: "gracias" }],
    ["la fija del sitio", Memo.text("tkz-retiro"), { tipo: "texto", valor: "tkz-retiro" }],
  ])("un retiro bien armado, con la nota %s", (_nombre, nota, esperada) => {
    const persona = otraCuenta();
    const t = armar("retiro", { persona, nota });
    expect(aceptado(leerPago(t.xdr, reglas("retiro")))).toEqual({
      forma: "retiro",
      hash: t.hash,
      cuenta: origen.publicKey(),
      salidas: [
        { destino: persona, monto: 10_000_000n },
        { destino: COBROS, monto: 5_000_000n },
      ],
      nota: esperada,
      venceS: AHORA_DE_PRUEBA + 240,
      feeDeclarado: 2000,
      premio: null,
    });
  });
});

describe("el lector de pagos rechaza lo que no tiene exactamente la forma", () => {
  const OTRAS: Array<[string, () => xdr.Operation]> = [
    [
      "pathPaymentStrictSend",
      () =>
        Operation.pathPaymentStrictSend({
          sendAsset: USDC_DE_CIRCLE,
          sendAmount: "1",
          destination: otraCuenta(),
          destAsset: USDC_DE_CIRCLE,
          destMin: "1",
          path: [],
        }),
    ],
    ["changeTrust", () => Operation.changeTrust({ asset: USDC_DE_CIRCLE })],
    ["setOptions", () => Operation.setOptions({ homeDomain: "tinkazo.app" })],
    ["accountMerge", () => Operation.accountMerge({ destination: otraCuenta() })],
    ["createAccount", () => Operation.createAccount({ destination: otraCuenta(), startingBalance: "1" })],
    ["manageSellOffer", () => Operation.manageSellOffer({ selling: USDC_DE_CIRCLE, buying: Asset.native(), amount: "1", price: "1", offerId: "0" })],
    [
      "invokeHostFunction",
      () => Operation.invokeContractFunction({ contract: StrKey.encodeContract(new Uint8Array(32).fill(1)), function: "seal", args: [] }),
    ],
  ];

  it.each(OTRAS)("en lugar del pago, un %s da tipo", (nombre, hacer) => {
    // Sin nota: el SDK no arma una invocación de contrato con nota, y de todos modos el tipo se mira antes.
    expect(dice(leerComo("premio", { operaciones: [hacer()], nota: null }))).toBe(`tipo/${nombre}`);
  });

  it("el costo del retiro cambiado por otra operación da tipo", () => {
    const l = leerComo("retiro", { operaciones: [pagoUsdc(otraCuenta(), "1.0000000"), Operation.changeTrust({ asset: USDC_DE_CIRCLE })] });
    expect(dice(l)).toBe("tipo/changeTrust");
  });

  it.each([
    ["un premio con tres pagos", "premio", 3],
    ["un retiro con tres pagos", "retiro", 3],
    ["un retiro con cuatro pagos", "retiro", 4],
  ] as const)("%s da operaciones", (_nombre, forma, cuantas) => {
    const operaciones = Array.from({ length: cuantas }, () => pagoUsdc(otraCuenta(), "1.0000000"));
    expect(dice(leerComo(forma, { operaciones }))).toBe(`operaciones/${cuantas}`);
  });

  it.each([
    ["XLM", Asset.native(), "nativo"],
    ["USDC de otro emisor", new Asset("USDC", Keypair.random().publicKey()), "otro"],
    ["otro código con el emisor de Circle", new Asset("EURC", EMISOR_USDC), "otro"],
    ["USDC de doce letras", new Asset("USDCUSDCUSDC", EMISOR_USDC), "otro"],
  ])("en el premio, pagar en %s da activo", (_nombre, activo, detalle) => {
    expect(dice(leerComo("premio", { operaciones: [pagoUsdc(otraCuenta(), "1.0000000", activo)] }))).toBe(`activo/${detalle}`);
  });

  it("en el retiro, pagar el costo en XLM da activo", () => {
    const l = leerComo("retiro", { operaciones: [pagoUsdc(otraCuenta(), "1.0000000"), pagoUsdc(COBROS, "0.5000000", Asset.native())] });
    expect(dice(l)).toBe("activo/nativo");
  });

  it.each([
    ["de menos (0,49)", "0.4900000"],
    ["de más (0,51)", "0.5100000"],
  ])("el costo %s da costo-monto", (_nombre, costo) => {
    expect(dice(leerComo("retiro", { costo }))).toBe("costo-monto/segunda");
  });

  it("el costo a otra cuenta da costo-destino", () => {
    const l = leerComo("retiro", { operaciones: [pagoUsdc(otraCuenta(), "1.0000000"), pagoUsdc(otraCuenta(), "0.5000000")] });
    expect(dice(l)).toBe("costo-destino/segunda");
  });

  it("el costo primero y el pago a la persona después da destino-cobros", () => {
    const l = leerComo("retiro", { operaciones: [pagoUsdc(COBROS, "0.5000000"), pagoUsdc(otraCuenta(), "1.0000000")] });
    expect(dice(l)).toBe("destino-cobros/primera");
  });

  it("el destino igual a la cuenta de cobros da destino-cobros, en el retiro y en el premio", () => {
    expect(dice(leerComo("retiro", { persona: COBROS }))).toBe("destino-cobros/primera");
    expect(dice(leerComo("premio", { persona: COBROS }))).toBe("destino-cobros/premio");
  });

  it.each(["premio", "retiro"] as const)("el destino igual al origen da destino-propio en el %s", (forma) => {
    expect(dice(leerComo(forma, { persona: origen.publicKey() }))).toBe("destino-propio/propio");
  });

  it.each([
    ["la patrocinadora", patrocinadora.publicKey()],
    ["la sorteadora", sorteadora.publicKey()],
  ])("%s como destino da destino-del-portero, en el retiro y en el premio", (_nombre, g) => {
    expect(dice(leerComo("premio", { persona: g }))).toBe("destino-del-portero/portero");
    expect(dice(leerComo("retiro", { persona: g }))).toBe("destino-del-portero/portero");
  });

  it("un destino multiplexado da destino-m, también la M de la cuenta de cobros", () => {
    expect(dice(leerComo("premio", { persona: direccionM(otraCuenta()) }))).toBe("destino-m/multiplexado");
    const costoAMultiplexada = [pagoUsdc(otraCuenta(), "1.0000000"), pagoUsdc(direccionM(COBROS), "0.5000000")];
    expect(dice(leerComo("retiro", { operaciones: costoAMultiplexada }))).toBe("destino-m/multiplexado");
  });

  it.each([
    ["la misma cuenta", () => origen.publicKey()],
    ["otra cuenta", otraCuenta],
  ])("una operación con origen propio (%s) da origen-de-operacion", (_nombre, quien) => {
    const operaciones = [Operation.payment({ destination: otraCuenta(), asset: USDC_DE_CIRCLE, amount: "1", source: quien() })];
    expect(dice(leerComo("premio", { operaciones }))).toBe("origen-de-operacion/propio");
  });

  it("el sobre envuelto da sobre con el hash de la transacción de adentro, para saber si esa ya está en el aire", () => {
    const t = armar("premio");
    const envuelto = leerPago(comoFeeBump(t.xdr, patrocinadora), reglas("premio"));
    expect(dice(envuelto)).toBe("sobre/fee-bump");
    expect(envuelto.ok ? "ok" : envuelto.hash).toBe(t.hash);
  });

  it("el sobre de la versión vieja da sobre, sin hash", () => {
    const viejo = leerPago(comoVersionVieja(armar("premio").xdr), reglas("premio"));
    expect(dice(viejo)).toBe("sobre/version");
    expect(viejo.ok ? "ok" : viejo.hash).toBeNull();
  });

  it("una cuenta de origen multiplexada da origen", () => {
    expect(dice(leerComo("premio", { origenM: true }))).toBe("origen/multiplexada");
  });

  it.each([
    ["la patrocinadora", patrocinadora],
    ["la sorteadora", sorteadora],
    ["la de cobros", cobros],
  ])("%s como origen da origen-del-portero", (_nombre, firmante) => {
    expect(dice(leerComo("premio", { firmante }))).toBe("origen-del-portero/origen");
    expect(dice(leerComo("retiro", { firmante }))).toBe("origen-del-portero/origen");
  });

  it("la de cobros como origen da origen-del-portero aunque falte en la lista de las cuentas del portero", () => {
    const sinCobrosEnLaLista = (forma: FormaDePago): ReglasDePago => ({
      ...reglas(forma),
      cuentasDelPortero: [patrocinadora.publicKey(), sorteadora.publicKey()],
    });
    expect(dice(leerComo("premio", { firmante: cobros }, sinCobrosEnLaLista("premio")))).toBe("origen-del-portero/origen");
    expect(dice(leerComo("retiro", { firmante: cobros }, sinCobrosEnLaLista("retiro")))).toBe("origen-del-portero/origen");
  });

  it("un origen propio solo en la segunda operación del retiro, la del costo, da origen-de-operacion", () => {
    const costoConOrigen = Operation.payment({ destination: COBROS, asset: USDC_DE_CIRCLE, amount: "0.5", source: origen.publicKey() });
    const l = leerComo("retiro", { operaciones: [pagoUsdc(otraCuenta(), "1.0000000"), costoConOrigen] });
    expect(dice(l)).toBe("origen-de-operacion/propio");
  });

  it("sin límite de tiempo da ventana sin-limite", () => {
    expect(dice(leerComo("premio", { venceS: 0 }))).toBe("ventana/sin-limite");
  });

  it("con minTime distinto de 0 da ventana desde", () => {
    expect(dice(leerComo("premio", { desdeS: 10 }))).toBe("ventana/desde");
  });

  it.each(["ledger", "secuencia", "firmantes"] as const)("condiciones que no son de tiempo (%s) dan ventana sin-ventana", (condiciones) => {
    expect(dice(leerComo("premio", { condiciones }))).toBe("ventana/sin-ventana");
  });

  it("la comisión declarada de más da fee-alta, en el premio y en el retiro", () => {
    expect(dice(leerComo("premio", { fee: 1001 }))).toBe("fee-alta/inclusion");
    expect(dice(leerComo("retiro", { feeTotal: 2001 }))).toBe("fee-alta/inclusion");
    expect(dice(leerComo("retiro", { fee: 1001 }))).toBe("fee-alta/inclusion");
  });

  it("la comisión justa pasa: 1000 en el premio y 2000 en el retiro", () => {
    expect(aceptado(leerComo("premio", { fee: 1000 })).feeDeclarado).toBe(1000);
    expect(aceptado(leerComo("retiro", { feeTotal: 2000 })).feeDeclarado).toBe(2000);
  });

  it.each(["premio", "retiro"] as const)("datos de Soroban en un %s dan recursos", (forma) => {
    expect(dice(leerComo(forma, { datosDeSoroban: true }))).toBe("recursos/datos-de-soroban");
  });

  it("un pago sin ninguna firma da firma sin-firma-valida", () => {
    expect(dice(leerComo("premio", { firmas: [] }))).toBe("firma/sin-firma-valida");
    expect(dice(leerComo("retiro", { firmas: [] }))).toBe("firma/sin-firma-valida");
  });

  it("un monto de cero o negativo, armado a mano en el XDR, da monto", () => {
    expect(dice(leerComo("premio", { montoCrudo: 0n }))).toBe("monto/no-positivo");
    expect(dice(leerComo("premio", { montoCrudo: -5n }))).toBe("monto/no-positivo");
    expect(dice(leerComo("retiro", { montoCrudo: 0n }))).toBe("monto/no-positivo");
  });

  it.each(["", "AAAA", "no es base64!!"])("un XDR que no se entiende (%j) da xdr, sin hash", (roto) => {
    const l = leerPago(roto, reglas("premio"));
    expect(dice(l)).toBe("xdr/no-se-entiende");
    expect(l.ok ? "ok" : l.hash).toBeNull();
  });

  it("un XDR cortado da xdr", () => {
    expect(dice(leerPago(armar("premio").xdr.slice(0, 40), reglas("premio")))).toBe("xdr/no-se-entiende");
  });

  it("un rechazo trae el hash de la transacción interna, para saber si ya la tiene el portero", () => {
    const t = armar("premio", { fee: 1001 });
    const l = leerPago(t.xdr, reglas("premio"));
    expect(l.ok ? "ok" : l.hash).toBe(t.hash);
  });

  it("un retiro sin cuenta de cobros o sin costo configurado no se acepta nunca", () => {
    const sinCobros: ReglasDePago = { ...reglas("retiro"), cuentaCobros: null, cuentasDelPortero: [patrocinadora.publicKey()] };
    expect(dice(leerComo("retiro", {}, sinCobros))).toBe("costo-destino/sin-configurar");
    expect(dice(leerComo("retiro", {}, { ...reglas("retiro"), costoRetiro: null }))).toBe("costo-destino/sin-configurar");
  });
});

describe("la nota del premio es exactamente tk:premio:<sorteo>:<puesto>", () => {
  it.each([
    ["sin nota", null],
    ["numérica", Memo.id("5")],
    ["con ceros adelante en el sorteo", Memo.text("tk:premio:05:0")],
    ["con ceros adelante en el puesto", Memo.text("tk:premio:5:00")],
    ["con el puesto 300", Memo.text("tk:premio:5:300")],
    ["con el sorteo 0", Memo.text("tk:premio:0:0")],
    ["sin el prefijo", Memo.text("premio:5:0")],
    ["con un espacio", Memo.text("tk:premio: 5:0")],
    ["con mayúsculas", Memo.text("TK:PREMIO:5:0")],
    ["con algo más al final", Memo.text("tk:premio:5:0 ")],
    ["de otro premio", Memo.text("gracias")],
    ["de texto que no es UTF-8", Memo.text(new Uint8Array([0xff, 0xfe, 0x41]))],
    ["de tipo hash", Memo.hash(new Uint8Array(32))],
    ["de tipo retorno", Memo.return(new Uint8Array(32))],
  ])("%s da nota", (_nombre, nota) => {
    expect(dice(leerComo("premio", { nota })).startsWith("nota/")).toBe(true);
  });

  it("la nota que arma el sitio se lee igual que como se escribe", () => {
    const p = aceptado(leerComo("premio", { sorteo: "42", puesto: 3 }));
    expect(p.nota).toEqual({ tipo: "texto", valor: notaDePremio("42", 3) });
    expect(p.premio).toMatchObject({ sorteo: "42", puesto: 3 });
  });
});

describe("la nota del retiro nunca se lee como la orden de una compra", () => {
  it.each(["tk:o:ABCD2345", "TK:0:abcd2345", "tk : o : ABCD-2345", "tk:premio:1:0", "Tk:"])("la nota %j da nota", (texto) => {
    expect(dice(leerComo("retiro", { nota: Memo.text(texto) }))).toBe("nota/retiro");
  });

  it("las notas de tipo hash y retorno, y un texto que no es UTF-8, dan nota", () => {
    expect(dice(leerComo("retiro", { nota: Memo.hash(new Uint8Array(32)) }))).toBe("nota/tipo");
    expect(dice(leerComo("retiro", { nota: Memo.return(new Uint8Array(32)) }))).toBe("nota/tipo");
    expect(dice(leerComo("retiro", { nota: Memo.text(new Uint8Array([0xff, 0xfe])) }))).toBe("nota/tipo");
  });

  it("la nota numérica que se leería como una orden se acepta: el costo se reconoce por el hash de la transacción", () => {
    expect(ordenDeNota({ tipo: "id", valor: "12345" })).not.toBeNull();
    expect(aceptado(leerComo("retiro", { nota: Memo.id("12345") })).nota).toEqual({ tipo: "id", valor: "12345" });
  });
});

describe("el lector de pagos no mezcla las dos formas", () => {
  it("un retiro mandado como premio da forma, y un premio mandado como retiro también", () => {
    expect(dice(leerPago(armar("retiro").xdr, reglas("premio")))).toBe("forma/de-retiro");
    expect(dice(leerPago(armar("premio").xdr, reglas("retiro")))).toBe("forma/de-premio");
  });
});

describe("la ventana de un pago ya leído", () => {
  const leido = () => aceptado(leerComo("premio"));

  it("hasta 300 segundos antes del vencimiento pasa, y 301 es larga", () => {
    const p = leido();
    expect(dice(ventanaDelPago(p, p.venceS - 300, 300))).toBe("ok");
    expect(dice(ventanaDelPago(p, p.venceS - 301, 300))).toBe("ventana/larga");
  });

  it("vence recién pasado su último segundo", () => {
    const p = leido();
    expect(dice(ventanaDelPago(p, p.venceS, 300))).toBe("ok");
    expect(dice(ventanaDelPago(p, p.venceS + 1, 300))).toBe("ventana/vencida");
  });

  it("un rechazo trae el hash del pago", () => {
    const p = leido();
    const v = ventanaDelPago(p, p.venceS + 1, 300);
    expect(v.ok ? "ok" : v.hash).toBe(p.hash);
  });

  it("con un VENTANA_MAX_S más largo, un pago igual vence a 300 segundos como mucho", () => {
    const p = leido();
    expect(dice(ventanaDelPago(p, p.venceS - 300, 600))).toBe("ok");
    expect(dice(ventanaDelPago(p, p.venceS - 301, 600))).toBe("ventana/larga");
  });

  it("con un VENTANA_MAX_S más corto vale el más corto", () => {
    const p = leido();
    expect(dice(ventanaDelPago(p, p.venceS - 121, 120))).toBe("ventana/larga");
  });

  it.each([
    ["la hora", Number.NaN, 300],
    ["el máximo", AHORA_DE_PRUEBA, Number.NaN],
    ["la hora en menos infinito", Number.NEGATIVE_INFINITY, 300],
    ["el máximo en infinito", AHORA_DE_PRUEBA, Number.POSITIVE_INFINITY],
  ])("con %s que no es un número finito, la ventana se rechaza y no pasa nunca", (_nombre, ahoraS, maximo) => {
    expect(dice(ventanaDelPago(leido(), ahoraS, maximo))).toBe("ventana/reloj");
  });
});

describe("las firmas de un pago ya leído, contra los firmantes y el umbral de la cuenta", () => {
  const aut = (firmantes: Array<[Keypair, number]>, umbral: number): Autoridad => ({
    firmantes: firmantes.map(([k, peso]) => ({ clave: k.rawPublicKey(), peso })),
    umbral,
  });
  /** Arma un premio, lo lee con las reglas de la red principal y le comprueba las firmas contra `autoridad`. */
  async function firmas(v: Partial<VariantePago>, autoridad: Autoridad | null, passphrase = Networks.PUBLIC): Promise<VeredictoDePago> {
    const t = armar("premio", v);
    return firmasDelPago(t.xdr, aceptado(leerPago(t.xdr, reglas("premio"))), autoridad, passphrase);
  }

  it("sin la lectura de la cadena vale la llave de la propia cuenta, con peso 1", async () => {
    expect(dice(await firmas({}, null))).toBe("ok");
  });

  it("la firma de otra llave no vale", async () => {
    expect(dice(await firmas({ firmas: [Keypair.random()] }, null))).toBe("firma/sin-firma-valida");
  });

  it("la firma de otra red no vale", async () => {
    expect(dice(await firmas({ passphrase: Networks.TESTNET }, null))).toBe("firma/sin-firma-valida");
  });

  it("el peso de las firmas tiene que llegar al umbral medio de la cuenta", async () => {
    const otra = Keypair.random();
    const dos = aut(
      [
        [origen, 1],
        [otra, 1],
      ],
      2,
    );
    expect(dice(await firmas({ firmas: [origen] }, dos))).toBe("firma/peso-insuficiente");
    expect(dice(await firmas({ firmas: [origen, otra] }, dos))).toBe("ok");
  });

  it("una cuenta con la llave maestra en cero pide a las otras", async () => {
    const a = Keypair.random();
    const b = Keypair.random();
    const cuenta = aut(
      [
        [origen, 0],
        [a, 1],
        [b, 1],
      ],
      2,
    );
    expect(dice(await firmas({ firmas: [origen] }, cuenta))).toBe("firma/sin-firma-valida");
    expect(dice(await firmas({ firmas: [a, b] }, cuenta))).toBe("ok");
  });

  it("un rechazo trae el hash del pago", async () => {
    const t = armar("premio", { firmas: [Keypair.random()] });
    const v = await firmasDelPago(t.xdr, aceptado(leerPago(t.xdr, reglas("premio"))), null, Networks.PUBLIC);
    expect(v.ok ? "ok" : v.hash).toBe(t.hash);
  });

  it("las firmas de otro sobre bien firmado no valen para el pago leído", async () => {
    const leidoDeUno = aceptado(leerPago(armar("premio").xdr, reglas("premio")));
    const otro = armar("premio");
    expect(dice(await firmasDelPago(otro.xdr, leidoDeUno, null, Networks.PUBLIC))).toBe("xdr/otro-sobre");
  });

  it("el mismo sobre comprobado con otra red da otro hash y no se aprueba", async () => {
    const t = armar("premio");
    const p = aceptado(leerPago(t.xdr, reglas("premio")));
    expect(dice(await firmasDelPago(t.xdr, p, null, Networks.TESTNET))).toBe("xdr/otro-sobre");
  });

  it("el sobre envuelto da sobre fee-bump", async () => {
    const t = armar("premio");
    const p = aceptado(leerPago(t.xdr, reglas("premio")));
    expect(dice(await firmasDelPago(comoFeeBump(t.xdr, patrocinadora), p, null, Networks.PUBLIC))).toBe("sobre/fee-bump");
  });

  it("un umbral que no es un número da firma umbral, aunque la firma sea buena", async () => {
    expect(dice(await firmas({}, aut([[origen, 1]], Number.NaN)))).toBe("firma/umbral");
  });
});

describe("lo que se exporta de los otros archivos del portero, sin cambiarlo", () => {
  it("pesoDeLasFirmas suma los pesos de las firmas válidas, cada firmante una sola vez", async () => {
    const t = armar("premio");
    const sobre = xdr.TransactionEnvelope.fromXDR(t.xdr, "base64");
    if (sobre.type !== "envelopeTypeTx") {
      throw new Error("se esperaba un sobre común");
    }
    const hash = Uint8Array.from(Buffer.from(t.hash, "hex"));
    const repetida = [...sobre.value.signatures, ...sobre.value.signatures];
    const una = await pesoDeLasFirmas(repetida, hash, { firmantes: [{ clave: origen.rawPublicKey(), peso: 3 }], umbral: 3 });
    expect(una.peso).toBe(3);
  });

  it("autoridadDe da los firmantes y el umbral de lo leído de la cadena, y null si no se leyó o no hay firmantes", () => {
    const firmantes = [{ clave: origen.rawPublicKey(), peso: 1 }];
    expect(autoridadDe(null)).toBeNull();
    expect(autoridadDe({ patrocinador: null, balance: 0n })).toBeNull();
    expect(autoridadDe({ patrocinador: null, balance: 0n, firmantes })).toEqual({ firmantes, umbral: 1 });
    expect(autoridadDe({ patrocinador: null, balance: 0n, firmantes, umbralMedio: 2 })).toEqual({ firmantes, umbral: 2 });
  });

  it("sinSeparadores saca los espacios y los guiones de cualquier tipo, y nada más", () => {
    expect(sinSeparadores("tk : o– AB−CD-23 45")).toBe("tk:oABCD2345");
    expect(sinSeparadores("tk:premio:5:0")).toBe("tk:premio:5:0");
  });
});
