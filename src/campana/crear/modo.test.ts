import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAXIMO_DE_GANAN, formularioInicial, type ConservadoDelArchivo, type FormularioDeCampana } from "./estado";
import { GANAN_MAXIMO_CON_ENVIO, modoDelFormulario, pedidoDeModo, type ModoDelArmado, type PedidoDeModo } from "./modo";

/**
 * Cómo decide el armador qué campaña arma: de cuentas (la de siempre), de personas con el premio en mano o de personas con el
 * premio en dólares. No hay ningún control a la vista: deciden los dos interruptores del sitio, lo que pide la dirección de la
 * página y, por encima de todo, el archivo que se abrió.
 */

const LA_PAZ = "America/La_Paz";
const nuevo = (): FormularioDeCampana => formularioInicial(LA_PAZ, "k3f9");

/** Lo que guarda el armador de un archivo abierto. */
const abierto = (cambios: Partial<ConservadoDelArchivo> = {}): FormularioDeCampana => ({
  ...nuevo(),
  conservado: {
    organizadora: null,
    contrato: null,
    promo: null,
    comprobante: null,
    recibirHastaMs: null,
    entrada: "google",
    estado: "abierta",
    red: "mainnet",
    anotadas: 0,
    lugar: null,
    ...cambios,
  },
});

const deCuentas = (): FormularioDeCampana => abierto();
const enMano = (): FormularioDeCampana => abierto({ identidad: "persona", premioEnMano: { es: "Auriculares", en: "Headphones" } });
const dePersonasConMontos = (): FormularioDeCampana => abierto({ identidad: "persona" });

const PEDIDOS: PedidoDeModo[] = [
  { nueva: "cuentas", archivoConDolares: false },
  { nueva: "personas-en-mano", archivoConDolares: false },
  { nueva: "personas-dolares", archivoConDolares: true },
  { nueva: "personas-en-mano", archivoConDolares: true },
  { nueva: "cuentas", archivoConDolares: true },
];

describe("pedidoDeModo: la tabla de los interruptores y la dirección", () => {
  type Fila = [sinBilletera: boolean, conGoogle: boolean, identidad: string | null, nueva: ModoDelArmado, archivoConDolares: boolean];
  const FILAS: Fila[] = [
    // Sin anotarse sin billetera, siempre cuentas, diga lo que diga lo demás.
    [false, false, null, "cuentas", false],
    [false, false, "persona", "cuentas", false],
    [false, false, "cuenta", "cuentas", false],
    [false, true, null, "cuentas", false],
    [false, true, "persona", "cuentas", false],
    [false, true, "cuenta", "cuentas", false],
    // Con anotarse sin billetera y sin la bandera nueva: lo de hoy.
    [true, false, null, "cuentas", false],
    [true, false, "otra", "cuentas", false],
    [true, false, "cuenta", "cuentas", false],
    [true, false, "persona", "personas-en-mano", false],
    // Con las dos: personas con dólares por defecto.
    [true, true, null, "personas-dolares", true],
    [true, true, "otra", "personas-dolares", true],
    [true, true, "", "personas-dolares", true],
    [true, true, "persona", "personas-en-mano", true],
    [true, true, "cuenta", "cuentas", true],
  ];

  it.each(FILAS)("sin billetera %s, con Google %s e identidad %s: una campaña nueva es de %s", (sinBilletera, conGoogle, identidad, nueva, archivoConDolares) => {
    expect(pedidoDeModo({ sinBilletera, conGoogle, identidad })).toEqual({ nueva, archivoConDolares });
  });

  it("solo los valores exactos persona y cuenta cuentan en la dirección", () => {
    for (const identidad of ["Persona", "persona ", " persona", "PERSONA", "personas"]) {
      expect(pedidoDeModo({ sinBilletera: true, conGoogle: false, identidad }).nueva, identidad).toBe("cuentas");
      expect(pedidoDeModo({ sinBilletera: true, conGoogle: true, identidad }).nueva, identidad).toBe("personas-dolares");
    }
    for (const identidad of ["Cuenta", "cuenta ", "cuentas"]) {
      expect(pedidoDeModo({ sinBilletera: true, conGoogle: true, identidad }).nueva, identidad).toBe("personas-dolares");
    }
  });

  it("un archivo de personas con montos se arma con dólares solo con los dos interruptores", () => {
    for (const identidad of [null, "persona", "cuenta"]) {
      expect(pedidoDeModo({ sinBilletera: true, conGoogle: true, identidad }).archivoConDolares, String(identidad)).toBe(true);
      expect(pedidoDeModo({ sinBilletera: true, conGoogle: false, identidad }).archivoConDolares, String(identidad)).toBe(false);
      expect(pedidoDeModo({ sinBilletera: false, conGoogle: true, identidad }).archivoConDolares, String(identidad)).toBe(false);
      expect(pedidoDeModo({ sinBilletera: false, conGoogle: false, identidad }).archivoConDolares, String(identidad)).toBe(false);
    }
  });
});

describe("modoDelFormulario: el archivo abierto manda", () => {
  it("una campaña nueva toma el modo que se pidió", () => {
    for (const pedido of PEDIDOS) expect(modoDelFormulario(nuevo(), pedido, false), JSON.stringify(pedido)).toBe(pedido.nueva);
  });

  it("un archivo de cuentas sigue de cuentas, se pida lo que se pida", () => {
    for (const pedido of PEDIDOS) expect(modoDelFormulario(deCuentas(), pedido, false), JSON.stringify(pedido)).toBe("cuentas");
  });

  it("un archivo de personas con su premio escrito sigue en mano, se pida lo que se pida", () => {
    for (const pedido of PEDIDOS) expect(modoDelFormulario(enMano(), pedido, false), JSON.stringify(pedido)).toBe("personas-en-mano");
  });

  it("un archivo de personas con montos es de personas con dólares con los dos interruptores, y si no pide el premio escrito", () => {
    for (const pedido of PEDIDOS) {
      const esperado: ModoDelArmado = pedido.archivoConDolares ? "personas-dolares" : "personas-en-mano";
      expect(modoDelFormulario(dePersonasConMontos(), pedido, false), JSON.stringify(pedido)).toBe(esperado);
    }
  });

  it("un premio escrito sin la identidad de personas no cambia nada: es de cuentas", () => {
    const raro = abierto({ premioEnMano: { es: "Auriculares", en: "Headphones" } });
    for (const pedido of PEDIDOS) expect(modoDelFormulario(raro, pedido, false)).toBe("cuentas");
  });

  it("lo que decide es el archivo y el pedido, no lo que la persona lleva escrito en el paso del premio", () => {
    const conDolares: PedidoDeModo = { nueva: "personas-dolares", archivoConDolares: true };
    expect(modoDelFormulario({ ...nuevo(), premioEnMano: "Auriculares" }, conDolares, false)).toBe("personas-dolares");
    expect(modoDelFormulario({ ...dePersonasConMontos(), premioEnMano: "Auriculares" }, conDolares, false)).toBe("personas-dolares");
    expect(modoDelFormulario({ ...nuevo(), monto: 40 }, { nueva: "personas-en-mano", archivoConDolares: false }, false)).toBe("personas-en-mano");
  });
});

describe("modoDelFormulario: la demostración", () => {
  it("la campaña de la demostración es siempre de cuentas, se pida lo que se pida", () => {
    for (const pedido of PEDIDOS) expect(modoDelFormulario(nuevo(), pedido, true), JSON.stringify(pedido)).toBe("cuentas");
  });

  it("un archivo abierto manda también ahí, como hoy", () => {
    for (const pedido of PEDIDOS) {
      expect(modoDelFormulario(deCuentas(), pedido, true)).toBe("cuentas");
      expect(modoDelFormulario(enMano(), pedido, true)).toBe("personas-en-mano");
      expect(modoDelFormulario(dePersonasConMontos(), pedido, true)).toBe(pedido.archivoConDolares ? "personas-dolares" : "personas-en-mano");
    }
  });
});

describe("el tope de personas que ganan cuando cada premio se manda", () => {
  it("son 8, y nunca más que el tope de siempre", () => {
    expect(GANAN_MAXIMO_CON_ENVIO).toBe(8);
    expect(GANAN_MAXIMO_CON_ENVIO).toBeLessThanOrEqual(MAXIMO_DE_GANAN);
  });
});

describe("modo.ts es puro", () => {
  it("solo importa tipos y no toca la página, el reloj ni las variables del sitio", () => {
    const fuente = readFileSync("src/campana/crear/modo.ts", "utf8");
    expect(fuente).not.toMatch(/^\s*import\s+(?!type\b)/mu);
    expect(fuente).not.toMatch(/\b(?:document|window|localStorage|location|Date)\b|import\.meta/u);
  });
});
