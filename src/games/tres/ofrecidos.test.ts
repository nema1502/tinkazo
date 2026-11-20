import { describe, expect, it } from "vitest";
import { JUEGOS_CON_3D, ofrece3D } from "./ofrecidos";
import { tiene3D } from "./registro";

describe("ofrece3D: cuándo el selector muestra Ver en 3D", () => {
  it("la carrera lo ofrece aunque su 3D no esté en el registro del kit", () => {
    expect(tiene3D("race")).toBe(false);
    expect(ofrece3D("race")).toBe(true);
  });

  it("en la lista y con módulo: sí (y la lista se puede ampliar sin tocar nada más)", () => {
    expect(ofrece3D("wheel", (j) => j === "wheel", ["race", "wheel"])).toBe(true);
  });

  it("el trompo está aprobado: en la lista y con módulo, lo ofrece", () => {
    expect(JUEGOS_CON_3D).toEqual(["race", "trompo", "pinata", "toborochi", "sapo", "guajojo", "bolillas"]);
    expect(tiene3D("trompo")).toBe(true);
    expect(ofrece3D("trompo")).toBe(true);
  });

  it("la piñata está aprobada: en la lista y con módulo, lo ofrece", () => {
    expect(tiene3D("pinata")).toBe(true);
    expect(ofrece3D("pinata")).toBe(true);
    expect(ofrece3D("pinata", tiene3D, ["race", "trompo"])).toBe(false);
  });

  it("el Toborochi está aprobado: en la lista y con módulo, lo ofrece", () => {
    expect(tiene3D("toborochi")).toBe(true);
    expect(ofrece3D("toborochi")).toBe(true);
    expect(ofrece3D("toborochi", tiene3D, ["race", "trompo", "pinata"])).toBe(false);
  });

  it("el sapo está aprobado: en la lista y con módulo, lo ofrece", () => {
    expect(tiene3D("sapo")).toBe(true);
    expect(ofrece3D("sapo")).toBe(true);
    expect(ofrece3D("sapo", tiene3D, ["race", "trompo", "pinata", "toborochi"])).toBe(false);
  });

  it("el Guajojó está aprobado: en la lista y con módulo, lo ofrece", () => {
    expect(tiene3D("guajojo")).toBe(true);
    expect(ofrece3D("guajojo")).toBe(true);
    expect(ofrece3D("guajojo", tiene3D, ["race", "trompo", "pinata", "toborochi", "sapo"])).toBe(false);
  });

  it("con módulo pero fuera de la lista: no (queda detrás de ?motor=3d)", () => {
    expect(tiene3D("trompo")).toBe(true);
    expect(ofrece3D("trompo", tiene3D, ["race"])).toBe(false);
  });

  it("en la lista y sin módulo: no", () => {
    expect(ofrece3D("wheel", () => false, ["race", "wheel"])).toBe(false);
  });

  it("en ninguna lista y sin módulo: no", () => {
    expect(ofrece3D("quien", () => false)).toBe(false);
  });
});
