import { describe, expect, it } from "vitest";
import { CENTAVO, DOLAR } from "./comision";
import { campanaDeEjemplo } from "./ejemplo";
import type { Campana } from "./modelo";
import {
  PREMIOS_CON_ENVIO_MAXIMOS,
  enviosDe,
  esDePersonasConDolares,
  esResultadoEnDolares,
  lineaDelResultadoEnDolares,
  montoDelPuesto,
} from "./personas-dolares";
import type { FilaDeGanadora, PasoDelPuente } from "./puente";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

/**
 * Lo que el panel de quien organiza sabe de una campaña de personas con premios en dólares, sin pantalla ni red: cuándo una
 * campaña es de ese modo, cuánto suma el envío de los premios, cuándo el resultado habla de plata, qué línea lleva y cuánto es el
 * premio de cada puesto. Una campaña de cuentas y una de premio en mano no son de este modo en ningún caso.
 */

const AHORA = Date.UTC(2026, 10, 21, 18, 0);
const CUARENTA = 40n * DOLAR;
const MEDIO = 50n * CENTAVO;

const deCuentas = (premios: bigint[] = [CUARENTA, CUARENTA, CUARENTA]): Campana => ({ ...campanaDeEjemplo(AHORA), premios });
const conDolares = (premios: bigint[] = [CUARENTA, CUARENTA, CUARENTA]): Campana => ({ ...deCuentas(premios), identidad: "persona" });
const enMano = (premios: bigint[] = [0n, 0n, 0n]): Campana => ({
  ...deCuentas(premios),
  identidad: "persona",
  premioEnMano: { es: "Auriculares", en: "Headphones" },
});

const fila = (cuenta: string, cambios: Partial<FilaDeGanadora> = {}): FilaDeGanadora => ({
  cuenta,
  nombre: "Ganadora",
  avisada: false,
  alta: "esperando",
  ...cambios,
});
const resultado = (filas: FilaDeGanadora[], conMarca = true): Extract<PasoDelPuente, { paso: "resultado" }> => ({
  paso: "resultado",
  filas,
  otraBilletera: false,
  ...(conMarca ? { enMano: true as const } : {}),
});

describe("cuándo una campaña es de personas con premios en dólares", () => {
  it("lo es con identidad persona y sin premio en mano", () => {
    expect(esDePersonasConDolares(conDolares())).toBe(true);
  });

  it("no lo es una campaña de cuentas, ni una de premio en mano, ni la que todavía no se leyó", () => {
    expect(esDePersonasConDolares(deCuentas())).toBe(false);
    expect(esDePersonasConDolares(enMano())).toBe(false);
    expect(esDePersonasConDolares(null)).toBe(false);
  });

  it("lleva ocho premios como mucho", () => {
    expect(PREMIOS_CON_ENVIO_MAXIMOS).toBe(8);
  });
});

describe("el envío de los premios", () => {
  it("es el costo de un envío por cada premio: tres premios con el costo en 0,50 suman 1,50", () => {
    expect(enviosDe(conDolares(), MEDIO)).toBe(150n * CENTAVO);
    expect(enviosDe(conDolares([CUARENTA]), MEDIO)).toBe(MEDIO);
    expect(enviosDe(conDolares(new Array<bigint>(8).fill(CUARENTA)), MEDIO)).toBe(4n * DOLAR);
  });

  it("es cero en una campaña de cuentas, en una de premio en mano y sin campaña", () => {
    expect(enviosDe(deCuentas(), MEDIO)).toBe(0n);
    expect(enviosDe(enMano(), MEDIO)).toBe(0n);
    expect(enviosDe(null, MEDIO)).toBe(0n);
  });

  it("sin costo no suma nada, y un costo que no es positivo cuenta como ninguno", () => {
    expect(enviosDe(conDolares(), 0n)).toBe(0n);
    expect(enviosDe(conDolares(), -MEDIO)).toBe(0n);
  });
});

describe("cuándo el resultado habla de plata", () => {
  const conCodigos = resultado([fila("A", { codigo: "0042" }), fila("B", { codigo: "7310" })]);

  it("con el resultado de personas a la vista y la campaña de personas con dólares", () => {
    expect(esResultadoEnDolares(conCodigos, conDolares())).toBe(true);
    expect(esResultadoEnDolares(resultado([fila("A")]), conDolares())).toBe(true);
  });

  it("nunca con la campaña sin leer: sin saber qué premio es, no se habla de plata", () => {
    expect(esResultadoEnDolares(conCodigos, null)).toBe(false);
  });

  it("nunca con premio en mano ni con una campaña de cuentas", () => {
    expect(esResultadoEnDolares(conCodigos, enMano())).toBe(false);
    expect(esResultadoEnDolares(conCodigos, deCuentas())).toBe(false);
  });

  it("nunca con el resultado de cuentas, aunque la campaña sea de personas con dólares", () => {
    expect(esResultadoEnDolares(resultado([fila("A", { codigo: "0042" })], false), conDolares())).toBe(false);
  });

  it("nunca en un paso que no es el resultado", () => {
    const otros: PasoDelPuente[] = [{ paso: "nada" }, { paso: "avisada" }, { paso: "boton-resultado" }, { paso: "lista-rara" }, { paso: "sala-borrada" }];
    for (const paso of otros) expect(esResultadoEnDolares(paso, conDolares()), paso.paso).toBe(false);
  });
});

describe("la línea del resultado en dólares", () => {
  it("con todos los códigos a la vista dice que se mire el código y se mande el premio", () => {
    expect(lineaDelResultadoEnDolares(resultado([fila("A", { codigo: "0042" }), fila("B", { codigo: "7310" })]))).toBe("cpoMandaConCodigo");
  });

  it("con un código que falta dice que se espere: nadie manda plata sin comprobar quién ganó", () => {
    expect(lineaDelResultadoEnDolares(resultado([fila("A", { codigo: "0042" }), fila("B")]))).toBe("cpoMandaSinCodigo");
    expect(lineaDelResultadoEnDolares(resultado([fila("A"), fila("B")]))).toBe("cpoMandaSinCodigo");
  });

  it("sin filas no hay códigos y dice que se espere", () => {
    expect(lineaDelResultadoEnDolares(resultado([]))).toBe("cpoMandaSinCodigo");
  });
});

describe("el premio de cada puesto", () => {
  it("es el monto de ese puesto, contado desde cero", () => {
    const c = conDolares([CUARENTA, 25n * DOLAR, 10n * DOLAR]);
    expect(montoDelPuesto(c, 0)).toBe(CUARENTA);
    expect(montoDelPuesto(c, 1)).toBe(25n * DOLAR);
    expect(montoDelPuesto(c, 2)).toBe(10n * DOLAR);
  });

  it("un puesto que la campaña no tiene no lleva monto", () => {
    const c = conDolares([CUARENTA]);
    expect(montoDelPuesto(c, 1)).toBeNull();
    expect(montoDelPuesto(c, -1)).toBeNull();
    expect(montoDelPuesto(c, 0.5)).toBeNull();
    expect(montoDelPuesto(null, 0)).toBeNull();
  });

  it("un premio que no es positivo no lleva monto: no hay nada que mandar", () => {
    expect(montoDelPuesto(conDolares([0n]), 0)).toBeNull();
  });
});

describe("los textos del modo en el panel", () => {
  const NUEVAS: [string, string, string][] = [
    ["cpoMandaSinCodigo", "Esperá a ver los códigos antes de mandar un premio.", "Wait until you see the codes before sending a prize."],
    [
      "cpoMandaConCodigo",
      "Mirá el código en el celular de quien ganó y mandale su premio a la dirección que te pase.",
      "Check the code on the winner's phone and send their prize to the address they give you.",
    ],
    ["cpoMandarMonto", "Mandar {monto}", "Send {monto}"],
    [
      "cpoOlvidarPremios",
      "Si la dejás ahora, ya no ves a quién le falta su premio.",
      "If you leave it now, you can no longer see who is still missing their prize.",
    ],
    ["cpoCodigosHasta", "Los nombres y los códigos se ven hasta el {fecha} a las {hora}.", "Names and codes stay visible until {fecha} at {hora}."],
    [
      "cpoCmCargarEnvioL",
      "{premios} de premio, {envios} de envío y {servicio} del servicio de Tinkazo.",
      "{premios} for the prize, {envios} to send it and {servicio} for Tinkazo's service.",
    ],
    [
      "cpoCmCargarFaltaEnvio",
      "Tenés {saldo}. Son {premios} de premio, {envios} de envío y {servicio} del servicio.",
      "You have {saldo}. That's {premios} for the prize, {envios} to send it and {servicio} for the service.",
    ],
    [
      "cpoCmBorradorEntrarEnvioL",
      "Entrá con Google y poné {total} dólares digitales: {premios} de premio, {envios} de envío y {servicio} del servicio.",
      "Sign in with Google and put in {total} digital dollars: {premios} for the prize, {envios} to send it and {servicio} for the service.",
    ],
  ];

  it.each(NUEVAS)("%s dice lo mismo en los dos idiomas", (clave, es, en) => {
    expect(TEXTOS_SALA_CAMPANA.es[clave]).toBe(es);
    expect(TEXTOS_SALA_CAMPANA.en[clave]).toBe(en);
  });

  it("van juntas al final de cada idioma, después de las de premio en mano y en el mismo orden", () => {
    const esperadas = NUEVAS.map(([clave]) => clave);
    for (const idioma of ["es", "en"] as const) {
      const claves = Object.keys(TEXTOS_SALA_CAMPANA[idioma]);
      expect(claves.slice(-esperadas.length), idioma).toEqual(esperadas);
      expect(claves[claves.length - esperadas.length - 1], idioma).toBe("cpoNoSeMarco");
    }
  });

  it("ninguna dice cuenta para el lugar donde se recibe el premio, ni nombra una ventana", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const [clave] of NUEVAS) {
        const texto = TEXTOS_SALA_CAMPANA[idioma][clave] ?? "";
        expect(texto, `${idioma}.${clave}`).not.toMatch(/\bcuenta\b|\baccount\b|ventana|window|billetera|wallet/iu);
      }
    }
  });

  it("las dos líneas del resultado que devuelve la función existen en los dos idiomas", () => {
    for (const clave of ["cpoMandaConCodigo", "cpoMandaSinCodigo"]) {
      expect(TEXTOS_SALA_CAMPANA.es[clave], clave).toBeTruthy();
      expect(TEXTOS_SALA_CAMPANA.en[clave], clave).toBeTruthy();
    }
  });
});
