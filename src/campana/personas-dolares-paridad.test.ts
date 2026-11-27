import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREMIOS_CON_ENVIO_MAXIMOS as TOPE_DE_LA_SALA, leerParaActivar } from "../../workers/sala/src/activar";
import { HORA_DE_LA_PRUEBA, VARIABLES_DE_ACTIVAR, montarMundoDeActivar, type MundoDeActivar } from "../sala/activar-mundo";
import { validarCampanaParaElFirmador } from "../sala/validar-campana";
import type { ConfigDeComision } from "../stellar/comision-config";
import { network } from "../stellar/config";
import { type ContextoDeComision, type DepsDeComision, crearControlDeComision } from "../ui/campana-comision";
import { CENTAVO, DOLAR } from "./comision";
import { armarCampana } from "./crear/armar";
import { basesAutomaticas, basesFinales } from "./crear/bases";
import { UNIDADES_POR_DOLAR } from "./crear/constantes";
import { comisionDelArmado, costoDeLaCampana } from "./crear/costo";
import { type FormularioDeCampana, formularioInicial } from "./crear/estado";
import { instanteDe } from "./crear/horas";
import { GANAN_MAXIMO_CON_ENVIO } from "./crear/modo";
import { cuentaDePrueba } from "./cuentas-de-prueba";
import { type Campana, leerCampana } from "./modelo";
import { PREMIOS_CON_ENVIO_MAXIMOS as TOPE_DEL_PANEL } from "./personas-dolares";
import { TEXTOS_CREAR_CAMPANA } from "./textos-crear";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

vi.mock("cloudflare:workers", async () => await import("../sala/cloudflare-falso"));

/**
 * Las campañas de personas con premios en dólares pasan por tres lugares que se escribieron por separado: la página que arma
 * la campaña, el panel de quien organiza y la sala que la activa. Acá se comprueba que los tres dicen lo mismo: el mismo tope
 * de premios, la misma plata para el mismo ejemplo, y que el archivo que sale del armado es el que la sala activa.
 *
 * El ejemplo es el de siempre: tres premios de 40, con el servicio en 2 % (mínimo 1,50) y el envío en 0,50 por premio. Son 120
 * de premios, 2,40 de servicio y 1,50 de envío: 123,90. Los tres parten de la misma configuración, la de la sala de la prueba.
 */

const LA_PAZ = "America/La_Paz";
const CLIENTE = "cliente-de-prueba.apps.example.org";
const PRENDIDAS = { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE };
const GANAN = 3;
const MONTO = 40;

/** Dólares escritos con punto, como van en las variables de la sala, pasados a stroops. */
function enStroops(escrito: string): bigint {
  const [entero = "0", decimales = ""] = escrito.split(".");
  return BigInt(entero) * DOLAR + BigInt(decimales.padEnd(7, "0"));
}
/** Stroops escritos como los devuelve la red: con siete decimales. */
const comoSaldo = (stroops: bigint): string => `${stroops / DOLAR}.${(stroops % DOLAR).toString().padStart(7, "0")}`;
const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;

/** El cobro del sitio, con los mismos números que tiene la sala: el archivo de variables de la sala pide que sean iguales. */
const CONFIG: ConfigDeComision = {
  pb: BigInt(VARIABLES_DE_ACTIVAR.COMISION_PB),
  minimo: enStroops(VARIABLES_DE_ACTIVAR.COMISION_MINIMO),
  cuenta: cuentaDePrueba(2),
  costo: enStroops(VARIABLES_DE_ACTIVAR.COSTO_RETIRO),
  cobros: cuentaDePrueba(1),
};

const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";

/** El formulario lleno de una campaña nueva: tres personas ganan 40 dólares digitales, mañana. */
function formulario(): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    color: "verde",
    monto: MONTO,
    ganan: GANAN,
    fecha: "2026-11-22",
    lugar: "Hackathon",
  };
}

/** El archivo como lo arma la página en el modo nuevo: con la identidad de personas y las bases de ese modo. */
function archivoDelArmado(): Record<string, unknown> {
  const f = formulario();
  const automaticas = basesAutomaticas(
    {
      marca: f.nombre,
      ganan: f.ganan,
      monto: f.monto ?? MONTO,
      sorteoMs: instanteDe(f.fecha, f.sorteo, f.zona) ?? HORA_DE_LA_PRUEBA,
      zona: f.zona,
      conRedes: false,
      costo: { es: null, en: null },
      personas: true,
    },
    dic,
  );
  return armarCampana(f, { bases: basesFinales(f.bases, automaticas).bases, identidad: "persona" });
}

/** El Total a poner del armado: los premios, el servicio y un envío por premio, con las cuentas de la página. */
function totalDelArmado(): bigint {
  const premios = { monto: MONTO, ganan: GANAN };
  // Lo que cuesta mandar un premio le llega a la página en dólares, sacado del costo del retiro del sitio.
  const envio = Number(CONFIG.costo) / Number(UNIDADES_POR_DOLAR);
  const costo = costoDeLaCampana({ premios, comision: comisionDelArmado(CONFIG)?.(premios) ?? null, envios: envio * GANAN });
  return d(costo.total);
}

/** La campaña como la lee el sitio del archivo del armado. */
function campanaDelArmado(): Campana {
  const leida = leerCampana({ ...archivoDelArmado(), red: network.name });
  if (!leida.ok) throw new Error(`el sitio no lee el archivo del armado: ${leida.campo}`);
  return leida.campana;
}

/** Lo que el panel pide cargar con la cuenta en cero, y cómo lo dice. */
async function cargaDelPanel(campana: Campana): Promise<{ cargar: bigint; titulo: string | null }> {
  const deps: DepsDeComision = {
    comision: () => CONFIG,
    billetera: async () => "google",
    mirarRed: async () => ({ tipo: "no-pagada", suma: 0n }),
    saldo: async () => 0n,
    portero: async () => "atiende",
    pagar: async () => ({ tipo: "listo", hash: "a".repeat(64) }),
    confirmar: async () => null,
    puedeVolverALista: async () => true,
    cargar: () => undefined,
    candado: (_nombre, f) => f(),
  };
  const ctx: ContextoDeComision = {
    campana: () => campana,
    pide: () => null,
    cuenta: () => cuentaDePrueba(5),
    enPrevia: () => true,
    crearSala: async () => null,
    alCambiar: () => undefined,
    aviso: () => undefined,
    tx: (clave) => TEXTOS_SALA_CAMPANA.es[clave] ?? clave,
    idioma: () => "es",
    ahora: () => HORA_DE_LA_PRUEBA,
    esperar: () => () => undefined,
    almacen: null,
    puedeEntrar: () => true,
    conBorrador: () => true,
  };
  const control = crearControlDeComision(deps, ctx);
  await control.mirar();
  const estado = control.estado();
  if (estado.tipo !== "falta-cargar") throw new Error(`el panel no pide cargar: ${estado.tipo}`);
  return { cargar: estado.cargar, titulo: control.descripcion().titulo };
}

describe("el tope de premios de una campaña de personas con dólares", () => {
  it("es el mismo número en el armado, en el panel y en la sala", () => {
    expect(TOPE_DE_LA_SALA).toBe(8);
    expect(GANAN_MAXIMO_CON_ENVIO).toBe(TOPE_DE_LA_SALA);
    expect(TOPE_DEL_PANEL).toBe(TOPE_DE_LA_SALA);
  });
});

describe("el archivo que arma la página en el modo nuevo", () => {
  it("lo acepta el validador con que la página lo revisa antes de bajarlo o de mandarlo a activar", () => {
    const archivo = archivoDelArmado();
    expect(archivo.identidad).toBe("persona");
    expect("premio_en_mano" in archivo).toBe(false);
    expect("organizadora" in archivo).toBe(false);
    expect(validarCampanaParaElFirmador(JSON.stringify(archivo), HORA_DE_LA_PRUEBA)).toEqual({ ok: true });
  });

  it("con la cuenta de quien organiza lo lee la activación de la sala, como una campaña de personas", () => {
    const archivo = archivoDelArmado();
    const leida = leerParaActivar(JSON.stringify({ ...archivo, organizadora: cuentaDePrueba(5) }), HORA_DE_LA_PRUEBA);
    expect(leida).toMatchObject({ ok: true, identidad: "persona", evento: archivo.evento, organizadora: cuentaDePrueba(5) });
    if (leida.ok) expect(leida.premios).toEqual([40n * DOLAR, 40n * DOLAR, 40n * DOLAR]);
  });

  it("con el tope de personas que ganan también pasa por los dos", () => {
    const f = { ...formulario(), ganan: GANAN_MAXIMO_CON_ENVIO, monto: 5 };
    const automaticas = basesAutomaticas(
      { marca: f.nombre, ganan: f.ganan, monto: 5, sorteoMs: HORA_DE_LA_PRUEBA, zona: f.zona, conRedes: false, costo: { es: null, en: null }, personas: true },
      dic,
    );
    const archivo = armarCampana(f, { bases: automaticas, identidad: "persona" });
    expect(validarCampanaParaElFirmador(JSON.stringify(archivo), HORA_DE_LA_PRUEBA)).toEqual({ ok: true });
    const leida = leerParaActivar(JSON.stringify({ ...archivo, organizadora: cuentaDePrueba(5) }), HORA_DE_LA_PRUEBA);
    expect(leida.ok).toBe(true);
    if (leida.ok) expect(leida.premios).toHaveLength(TOPE_DE_LA_SALA);
  });
});

describe("la plata de tres premios de 40, en los tres lugares", () => {
  let m: MundoDeActivar;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    m = await montarMundoDeActivar(PRENDIDAS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("el Total a poner del armado es 123,90", () => {
    expect(totalDelArmado()).toBe(d(123.9));
  });

  it("el panel pide cargar 123,90 con la campaña que sale del armado", async () => {
    const carga = await cargaDelPanel(campanaDelArmado());
    expect(carga.cargar).toBe(d(123.9));
    expect(carga.titulo).toBe("Cargá 123,90 dólares digitales");
    expect(carga.cargar).toBe(totalDelArmado());
  });

  it("la sala exige lo mismo: el servicio pagado y, en la cuenta, los premios más el envío de cada uno", async () => {
    const archivo = archivoDelArmado();
    const evento = String(archivo.evento);
    const pedido = { texto: JSON.stringify({ ...archivo, organizadora: m.organizadora.cuenta }), sesion: m.organizadora.token };

    // Sin pagar, la sala dice cuánto tiene que llegarle. Lo que sale de la cuenta de quien organiza es eso más el costo del retiro.
    const sinPagar = await m.activar(pedido);
    expect(sinPagar.status).toBe(402);
    const debe = (await sinPagar.json()) as { error: string; falta: string };
    expect(debe.error).toBe("no-pagada");
    const servicio = BigInt(debe.falta) + CONFIG.costo;
    expect(servicio).toBe(d(2.4));

    // Con el servicio pagado y la cuenta en cero, lo que falta es todo lo que la sala exige tener.
    m.horizon.pagos = [m.pagoCompleto(evento, { monto: comoSaldo(BigInt(debe.falta)) })];
    m.horizon.saldo = comoSaldo(0n);
    const sinFondos = await m.activar(pedido);
    expect(sinFondos.status).toBe(402);
    const falta = (await sinFondos.json()) as { error: string; falta: string };
    expect(falta.error).toBe("sin-fondos");
    const fondos = BigInt(falta.falta);
    expect(fondos).toBe(d(121.5));

    // Los tres números son el mismo.
    expect(fondos + servicio).toBe(d(123.9));
    expect(fondos + servicio).toBe(totalDelArmado());
    expect(fondos + servicio).toBe((await cargaDelPanel(campanaDelArmado())).cargar);

    // Con un stroop de menos no alcanza, y con lo justo la sala firma el archivo del armado tal cual.
    m.horizon.saldo = comoSaldo(fondos - 1n);
    const casi = await m.activar(pedido);
    expect(casi.status).toBe(402);
    expect(await casi.json()).toEqual({ error: "sin-fondos", falta: "1" });
    m.horizon.saldo = comoSaldo(fondos);
    const firmada = await m.activar(pedido);
    expect(firmada.status).toBe(200);
    const respuesta = (await firmada.json()) as { texto: string; evento: string };
    expect(respuesta.texto).toBe(pedido.texto);
    expect(respuesta.evento).toBe(evento);
  });
});
