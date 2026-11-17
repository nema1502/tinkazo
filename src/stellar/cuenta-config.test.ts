import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  CUENTA_POR_DEFECTO,
  cuentasDelPiloto,
  demoDeRampa,
  minimoDePrueba,
  modoDeRampa,
  monedasActivas,
  planDelEquipo,
  practicaDeRampa,
  registroDeRampa,
  urlDeCuenta,
} from "./cuenta-config";

const PLANES = Keypair.random().publicKey();

describe("la carga de saldo (VITE_RAMPA)", () => {
  it("pollar prende la ventana entera; recibir solo traer y mandar; meru es otro nombre de recibir", () => {
    expect(modoDeRampa({ rampa: " Pollar " })).toBe("pollar");
    expect(modoDeRampa({ rampa: "recibir" })).toBe("recibir");
    expect(modoDeRampa({ rampa: "RECIBIR" })).toBe("recibir");
    expect(modoDeRampa({ rampa: "meru" })).toBe("recibir");
  });
  it("vacía o con cualquier otra cosa, apagada", () => {
    for (const r of [undefined, "", " ", "apagada", "stereum", "1", "true", "si", "pollar,recibir"]) expect(modoDeRampa({ rampa: r }), String(r)).toBe("apagada");
  });
  it("leída del entorno, sin nada puesto, apagada", () => {
    expect(modoDeRampa()).toBe("apagada");
    expect(cuentasDelPiloto()).toEqual([]);
    expect(minimoDePrueba()).toBeNull();
    expect(demoDeRampa()).toBe(false);
    expect(registroDeRampa()).toBe(false);
    expect(practicaDeRampa()).toBe(false);
  });
});

describe("las cuentas del piloto (VITE_RAMPA_CUENTAS)", () => {
  const ANA = Keypair.random().publicKey();
  const NORA = Keypair.random().publicKey();
  it("vacía, no hay lista: ninguna cuenta", () => {
    for (const c of [undefined, "", " ", ",", " , ,"]) expect(cuentasDelPiloto({ rampaCuentas: c }), String(c)).toEqual([]);
  });
  it("se lee con comas y con espacios, sin repetir", () => {
    expect(cuentasDelPiloto({ rampaCuentas: ANA })).toEqual([ANA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA},${NORA}` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: ` ${ANA} ,  ${NORA} ` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA} ${NORA}` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA},\n${NORA},${ANA}` })).toEqual([ANA, NORA]);
  });
  it("lo que no es una dirección se descarta", () => {
    const otraLetra = ANA[30] === "X" ? "Y" : "X";
    const rota = `${ANA.slice(0, 30)}${otraLetra}${ANA.slice(31)}`;
    expect(cuentasDelPiloto({ rampaCuentas: `GABC,${rota},${NORA},hola` })).toEqual([NORA]);
  });
});

describe("las banderas que valen solo en localhost", () => {
  const LOCALES = ["localhost", "127.0.0.1", "LOCALHOST"];
  const AJENOS = ["tinkazo.app", "www.tinkazo.app", "tinkazo-git-rama-x.vercel.app", "localhost.evil.com", ""];
  it("VITE_RAMPA_MINIMO: un número de bolivianos, y solo en localhost", () => {
    for (const host of LOCALES) expect(minimoDePrueba({ rampaMinimo: "50", host }), host).toBe(50);
    expect(minimoDePrueba({ rampaMinimo: " 120 ", host: "localhost" })).toBe(120);
    for (const host of AJENOS) expect(minimoDePrueba({ rampaMinimo: "50", host }), host).toBeNull();
  });
  it("VITE_RAMPA_MINIMO: lo que no es un monto entero y positivo no hace nada", () => {
    for (const m of [undefined, "", "0", "-5", "abc", "12.5", "1e3", "Infinity"]) expect(minimoDePrueba({ rampaMinimo: m, host: "localhost" }), String(m)).toBeNull();
  });
  it("VITE_RAMPA_DEMO: con 1 y solo en localhost", () => {
    for (const host of LOCALES) expect(demoDeRampa({ rampaDemo: "1", host }), host).toBe(true);
    for (const host of AJENOS) expect(demoDeRampa({ rampaDemo: "1", host }), host).toBe(false);
    for (const d of [undefined, "", "0", "no"]) expect(demoDeRampa({ rampaDemo: d, host: "localhost" }), String(d)).toBe(false);
  });
  it("VITE_RAMPA_PRACTICA: con 1 y solo en localhost", () => {
    for (const host of LOCALES) expect(practicaDeRampa({ rampaPractica: "1", host }), host).toBe(true);
    for (const host of AJENOS) expect(practicaDeRampa({ rampaPractica: "1", host }), host).toBe(false);
    expect(practicaDeRampa({ rampaPractica: "0", host: "localhost" })).toBe(false);
  });
});

describe("el registro de la carga (VITE_RAMPA_REGISTRO)", () => {
  it("nace apagado y se prende con 1", () => {
    expect(registroDeRampa({})).toBe(false);
    expect(registroDeRampa({ rampaRegistro: "0" })).toBe(false);
    expect(registroDeRampa({ rampaRegistro: "1" })).toBe(true);
    expect(registroDeRampa({ rampaRegistro: "1", host: "tinkazo.app" })).toBe(true);
  });
});

describe("las monedas (VITE_MONEDAS) y dónde está el Worker", () => {
  it("nacen apagadas, y apagadas no hay Worker", () => {
    expect(monedasActivas({})).toBe(false);
    expect(urlDeCuenta({ host: "tinkazo.app" })).toBeNull();
    expect(urlDeCuenta({ monedas: "0", host: "tinkazo.app" })).toBeNull();
  });
  it("prendidas, en tinkazo.app y www.tinkazo.app vale el dominio del proyecto", () => {
    expect(monedasActivas({ monedas: "1" })).toBe(true);
    for (const host of ["tinkazo.app", "www.tinkazo.app", "TINKAZO.APP"]) expect(urlDeCuenta({ monedas: "1", host }), host).toBe(CUENTA_POR_DEFECTO);
  });
  it("en localhost y en las vistas previas hace falta VITE_CUENTA_URL", () => {
    for (const host of ["localhost", "127.0.0.1", "tinkazo-git-rama-x.vercel.app", "evil-tinkazo.app", "tinkazo.app.evil.com", ""]) {
      expect(urlDeCuenta({ monedas: "1", host }), host).toBeNull();
    }
    expect(urlDeCuenta({ monedas: "1", host: "localhost", url: "http://localhost:8794/" })).toBe("http://localhost:8794");
  });
});

describe("el plan del equipo (VITE_PLAN_EQUIPO)", () => {
  const prendido = { monedas: "1", plan: "1", cuentaPlanes: PLANES, host: "tinkazo.app" };
  it("apagado por defecto: sin la bandera no se ofrece, tenga lo que tenga", () => {
    expect(planDelEquipo({ ...prendido, plan: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, plan: "0" })).toBeNull();
    expect(planDelEquipo({ ...prendido, plan: "apagada" })).toBeNull();
  });
  it("prendido, con una cuenta de planes de verdad y el Worker a mano, se ofrece", () => {
    expect(planDelEquipo(prendido)).toEqual({ cuenta: PLANES });
  });
  it("sin cuenta de planes, con una mal escrita, o sin Worker, no se ofrece", () => {
    expect(planDelEquipo({ ...prendido, cuentaPlanes: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, cuentaPlanes: "GABC" })).toBeNull();
    // Una letra cambiada de verdad: la cuenta es al azar, y si ya tenía una X ahí, va una Y.
    const otraLetra = PLANES[30] === "X" ? "Y" : "X";
    expect(planDelEquipo({ ...prendido, cuentaPlanes: `${PLANES.slice(0, 30)}${otraLetra}${PLANES.slice(31)}` })).toBeNull();
    expect(planDelEquipo({ ...prendido, monedas: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, host: "localhost" })).toBeNull();
  });
});
