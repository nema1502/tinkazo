import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { CUENTA_POR_DEFECTO, modoDeRampa, monedasActivas, planDelEquipo, urlDeCuenta } from "./cuenta-config";

const PLANES = Keypair.random().publicKey();

describe("la carga de saldo (VITE_RAMPA)", () => {
  it("meru y pollar se prenden; todo lo demás la apaga", () => {
    expect(modoDeRampa({ rampa: "meru" })).toBe("meru");
    expect(modoDeRampa({ rampa: " Pollar " })).toBe("pollar");
    for (const r of [undefined, "", "apagada", "stereum", "1", "true"]) expect(modoDeRampa({ rampa: r }), String(r)).toBe("apagada");
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
    expect(planDelEquipo({ ...prendido, cuentaPlanes: `${PLANES.slice(0, 30)}X${PLANES.slice(31)}` })).toBeNull();
    expect(planDelEquipo({ ...prendido, monedas: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, host: "localhost" })).toBeNull();
  });
});
