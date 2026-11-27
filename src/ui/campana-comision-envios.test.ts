import { describe, expect, it } from "vitest";
import { CENTAVO, DOLAR } from "../campana/comision";
import type { LecturaDeComision } from "../campana/comision-red";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { campanaDeEjemplo } from "../campana/ejemplo";
import type { Campana } from "../campana/modelo";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import type { ConfigDeComision } from "../stellar/comision-config";
import {
  type ContextoDeComision,
  type ControlDeComision,
  type DepsDeComision,
  type PedidoDePagoDeComision,
  crearControlDeComision,
} from "./campana-comision";

/**
 * El cobro de una campaña de personas con premios en dólares: lo que se pide cargar suma el envío de cada premio, y el título y
 * la línea lo dicen con las mismas cuentas que la sala exige al activar. El ejemplo es el de tres premios de 40, con el servicio
 * en 2 % (2,40) y el envío en 0,50 por premio: 123,90. Una campaña de cuentas dice exactamente los números y las líneas de hoy.
 * El control corre solo, con la red, el saldo y el servicio de mentira. Los textos que se comparan están escritos a mano.
 */

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const AHORA = Date.UTC(2026, 10, 21, 18, 0);
const ORIGEN = cuentaDePrueba(5);
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: cuentaDePrueba(2), costo: d(0.5), cobros: cuentaDePrueba(1) };
const TRES_DE_40 = [40n * DOLAR, 40n * DOLAR, 40n * DOLAR];

const deCuentas = (): Campana => ({ ...campanaDeEjemplo(AHORA), premios: TRES_DE_40 });
const conDolares = (): Campana => ({ ...deCuentas(), identidad: "persona" });
const enMano = (): Campana => ({ ...deCuentas(), premios: [0n, 0n, 0n], identidad: "persona", premioEnMano: { es: "Auriculares", en: "Headphones" } });

interface Armado {
  control: ControlDeComision;
  /** Lo que se le pasó a la ventana de cargar: la cuenta y lo que falta, ya escrito. */
  cargas: { cuenta: string; falta: string | undefined }[];
  /** Los pagos del servicio que se mandaron. */
  pedidos: PedidoDePagoDeComision[];
}

interface Opciones {
  saldo?: bigint;
  cuenta?: string | null;
  borrador?: boolean;
  idioma?: "es" | "en";
  config?: ConfigDeComision | null;
  red?: LecturaDeComision;
}

/** El control con la campaña ya mirada: la red, el saldo y el servicio contestaron. */
async function armar(campana: Campana, o: Opciones = {}): Promise<Armado> {
  const idioma = o.idioma ?? "es";
  const cuenta = o.cuenta === undefined ? ORIGEN : o.cuenta;
  const cargas: Armado["cargas"] = [];
  const pedidos: PedidoDePagoDeComision[] = [];
  const deps: DepsDeComision = {
    comision: () => (o.config === undefined ? CONFIG : o.config),
    billetera: async () => "google",
    mirarRed: async () => o.red ?? { tipo: "no-pagada", suma: 0n },
    saldo: async () => o.saldo ?? 0n,
    portero: async () => "atiende",
    pagar: async (p) => {
      pedidos.push(p);
      return { tipo: "listo", hash: "a".repeat(64) };
    },
    confirmar: async () => null,
    puedeVolverALista: async () => true,
    cargar: (cual, _alCerrar, falta) => void cargas.push({ cuenta: cual, falta }),
    candado: (_nombre, f) => f(),
  };
  const ctx: ContextoDeComision = {
    campana: () => campana,
    pide: () => null,
    cuenta: () => cuenta,
    enPrevia: () => true,
    crearSala: async () => null,
    alCambiar: () => undefined,
    aviso: () => undefined,
    tx: (clave) => TEXTOS_SALA_CAMPANA[idioma][clave] ?? clave,
    idioma: () => idioma,
    ahora: () => AHORA,
    esperar: () => () => undefined,
    almacen: null,
    puedeEntrar: () => true,
    conBorrador: () => o.borrador === true,
  };
  const control = crearControlDeComision(deps, ctx);
  await control.mirar();
  return { control, cargas, pedidos };
}

const titulo = (a: Armado): string | null => a.control.descripcion().titulo;
const linea = (a: Armado): string | null => a.control.descripcion().linea;

describe("lo que se pide cargar en una campaña de personas con premios en dólares", () => {
  it("sin saldo, el título pide 123,90 y la línea cuenta el premio, el envío y el servicio", async () => {
    const a = await armar(conDolares(), { saldo: 0n });
    expect(a.control.estado()).toEqual({ tipo: "falta-cargar", cargar: d(123.9), saldo: 0n, falta: d(123.9), sale: d(2.4), monto: d(2.4) });
    expect(titulo(a)).toBe("Cargá 123,90 dólares digitales");
    expect(linea(a)).toBe("120,00 de premio, 1,50 de envío y 2,40 del servicio de Tinkazo.");
    expect(a.control.descripcion().principal).toEqual({ texto: "Cargar dólares digitales", accion: "cargar", apagado: false });
  });

  it("con 122,40 en la cuenta falta 1,50, y la línea lo cuenta con lo que ya tiene", async () => {
    const a = await armar(conDolares(), { saldo: d(122.4) });
    expect(a.control.estado()).toMatchObject({ tipo: "falta-cargar", cargar: d(123.9), falta: d(1.5) });
    expect(titulo(a)).toBe("Cargá 1,50 dólares digitales más");
    expect(linea(a)).toBe("Tenés 122,40. Son 120,00 de premio, 1,50 de envío y 2,40 del servicio.");
  });

  it("la ventana de cargar recibe lo que falta con el envío sumado", async () => {
    const sin = await armar(conDolares(), { saldo: 0n });
    sin.control.cargar();
    expect(sin.cargas).toEqual([{ cuenta: ORIGEN, falta: "123,90" }]);
    const aMedias = await armar(conDolares(), { saldo: d(122.4) });
    aMedias.control.cargar();
    expect(aMedias.cargas).toEqual([{ cuenta: ORIGEN, falta: "1,50" }]);
  });

  it("con 123,90 justos ofrece pagar el servicio, y lo que sale es solo el servicio", async () => {
    const a = await armar(conDolares(), { saldo: d(123.9) });
    expect(a.control.estado()).toEqual({ tipo: "lista", sale: d(2.4), saldo: d(123.9) });
    expect(titulo(a)).toBe("Pagá 2,40 a Tinkazo");
    expect(linea(a)).toBe("Tenés 123,90. Es el servicio. Los 120,00 quedan para el premio.");
    expect(a.control.descripcion().principal?.texto).toBe("Pagar 2,40");
  });

  it("un borrador sin cuenta entrada dice cuánto va a poner en total, con el envío aparte", async () => {
    const a = await armar(conDolares(), { cuenta: null, borrador: true });
    expect(a.control.estado()).toEqual({ tipo: "otra-billetera", monto: d(2.4), entrar: true });
    expect(linea(a)).toBe("Entrá con Google y poné 123,90 dólares digitales: 120,00 de premio, 1,50 de envío y 2,40 del servicio.");
    expect(a.control.descripcion().principal?.texto).toBe("Entrar con Google");
    // Con un borrador el pago sale de la cuenta de Google: no hay plegado para pagar desde otro lado.
    expect(a.control.descripcion().plegado).toBeNull();
  });

  it("un archivo firmado sin cuenta entrada dice lo de siempre: entrar y pagar el servicio con un toque", async () => {
    const a = await armar(conDolares(), { cuenta: null, borrador: false });
    expect(linea(a)).toBe("Entrá con Google y pagás 2,40 con un toque.");
  });

  it("en inglés dice lo mismo con sus palabras", async () => {
    const sin = await armar(conDolares(), { saldo: 0n, idioma: "en" });
    expect(titulo(sin)).toBe("Load 123.90 digital dollars");
    expect(linea(sin)).toBe("120.00 for the prize, 1.50 to send it and 2.40 for Tinkazo's service.");
    const aMedias = await armar(conDolares(), { saldo: d(122.4), idioma: "en" });
    expect(titulo(aMedias)).toBe("Add 1.50 more digital dollars");
    expect(linea(aMedias)).toBe("You have 122.40. That's 120.00 for the prize, 1.50 to send it and 2.40 for the service.");
    const sinCuenta = await armar(conDolares(), { cuenta: null, borrador: true, idioma: "en" });
    expect(linea(sinCuenta)).toBe("Sign in with Google and put in 123.90 digital dollars: 120.00 for the prize, 1.50 to send it and 2.40 for the service.");
  });

  it("con un solo premio el envío es uno: 5 de premio, 0,50 de envío y 1,50 de servicio son 7,00", async () => {
    const a = await armar({ ...conDolares(), premios: [5n * DOLAR] }, { saldo: 0n });
    expect(titulo(a)).toBe("Cargá 7,00 dólares digitales");
    expect(linea(a)).toBe("5,00 de premio, 0,50 de envío y 1,50 del servicio de Tinkazo.");
  });

  it("si el envío no cuesta nada, las líneas son las de siempre y no nombran un envío de 0,00", async () => {
    const a = await armar(conDolares(), { saldo: 0n, config: { ...CONFIG, costo: 0n } });
    expect(titulo(a)).toBe("Cargá 122,40 dólares digitales");
    expect(linea(a)).toBe("120,00 de premio y 2,40 del servicio de Tinkazo.");
  });

  it("lo que se paga no cambia: sale el servicio, y el envío queda en la cuenta para mandar los premios", async () => {
    const a = await armar(conDolares(), { saldo: d(123.9) });
    await a.control.pagar();
    expect(a.pedidos).toHaveLength(1);
    expect(a.pedidos[0]).toMatchObject({ origen: ORIGEN, cuenta: CONFIG.cuenta, cobros: CONFIG.cobros, costo: d(0.5), sale: d(2.4) });
    expect(a.control.estado()).toEqual({ tipo: "pagada" });
  });

  it("el pago a mano desde otro lado, cuando se ofrece, pide el servicio y no el envío", async () => {
    const a = await armar(conDolares(), { saldo: 0n });
    expect(a.control.descripcion().plegado).toBe("cerrado");
    expect(a.control.datosDelPlegado()?.monto).toBe(d(2.4));
  });
});

describe("una campaña de cuentas dice exactamente lo de hoy", () => {
  it("sin saldo pide 122,40 y la línea cuenta el premio y el servicio", async () => {
    const a = await armar(deCuentas(), { saldo: 0n });
    expect(a.control.estado()).toEqual({ tipo: "falta-cargar", cargar: d(122.4), saldo: 0n, falta: d(122.4), sale: d(2.4), monto: d(2.4) });
    expect(titulo(a)).toBe("Cargá 122,40 dólares digitales");
    expect(linea(a)).toBe("120,00 de premio y 2,40 del servicio de Tinkazo.");
  });

  it("con 120 en la cuenta falta 2,40", async () => {
    const a = await armar(deCuentas(), { saldo: d(120) });
    expect(titulo(a)).toBe("Cargá 2,40 dólares digitales más");
    expect(linea(a)).toBe("Tenés 120,00. Son 120,00 de premio y 2,40 del servicio.");
    a.control.cargar();
    expect(a.cargas).toEqual([{ cuenta: ORIGEN, falta: "2,40" }]);
  });

  it("con 122,40 justos ofrece pagar: no pide ningún envío", async () => {
    const a = await armar(deCuentas(), { saldo: d(122.4) });
    expect(a.control.estado()).toEqual({ tipo: "lista", sale: d(2.4), saldo: d(122.4) });
    expect(titulo(a)).toBe("Pagá 2,40 a Tinkazo");
  });

  it("un borrador sin cuenta entrada dice 122,40, con el premio y el servicio", async () => {
    const a = await armar(deCuentas(), { cuenta: null, borrador: true });
    expect(linea(a)).toBe("Entrá con Google y poné 122,40 dólares digitales: 120,00 de premio y 2,40 del servicio.");
  });

  it("en inglés también", async () => {
    const a = await armar(deCuentas(), { saldo: 0n, idioma: "en" });
    expect(titulo(a)).toBe("Load 122.40 digital dollars");
    expect(linea(a)).toBe("120.00 for the prize and 2.40 for Tinkazo's service.");
  });
});

describe("una campaña de premio en mano sigue sin cobro", () => {
  it("el cobro no existe para ella: ni título, ni línea, ni nada que cargar", async () => {
    const a = await armar(enMano(), { saldo: 0n });
    expect(a.control.activo()).toBe(false);
    expect(a.control.estado()).toEqual({ tipo: "pagada" });
    expect(a.control.descripcion()).toEqual({ titulo: null, linea: null, principal: null, secundario: null, plegado: null });
  });
});
