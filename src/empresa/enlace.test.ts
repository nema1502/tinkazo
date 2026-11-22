import { describe, expect, it } from "vitest";
import { enlaceDeLaEmpresa, leerEnlaceDeLaEmpresa } from "./enlace";

const CLAVE = "c1a2b3c4d5e6f7g8h9i0j1";
const EVENTO = "cafe-del-sol-ab12";

describe("el enlace privado de la empresa", () => {
  it("el enlace lleva la campaña en la dirección y la clave nunca sale del fragmento", () => {
    const enlace = enlaceDeLaEmpresa(EVENTO, CLAVE, "https://tinkazo.app");
    expect(enlace).toBe(`https://tinkazo.app/empresa.html?c=${EVENTO}#${CLAVE}`);
    expect(enlace.startsWith("https://tinkazo.app/empresa.html?c=")).toBe(true);
    expect(enlace.indexOf("?")).toBeLessThan(enlace.indexOf("#"));
  });

  it("leer el enlace devuelve la misma campaña y la misma clave", () => {
    const enlace = enlaceDeLaEmpresa(EVENTO, CLAVE, "https://tinkazo.app");
    const u = new URL(enlace);
    expect(leerEnlaceDeLaEmpresa(u.search, u.hash)).toEqual({ evento: EVENTO, clave: CLAVE });
  });

  it("sin clave no es un enlace privado", () => {
    const u = new URL("https://tinkazo.app/empresa.html?c=" + EVENTO);
    expect(leerEnlaceDeLaEmpresa(u.search, u.hash)).toEqual({ evento: EVENTO, clave: null });
  });

  it("una clave o una campaña con otra forma anulan el enlace", () => {
    const u = new URL(`https://tinkazo.app/empresa.html?c=${EVENTO}#masDeVeinte`);
    expect(leerEnlaceDeLaEmpresa(u.search, u.hash)).toBeNull();
    const otro = new URL(`https://tinkazo.app/empresa.html?c=CAMPEON#${CLAVE}`);
    expect(leerEnlaceDeLaEmpresa(otro.search, otro.hash)).toBeNull();
    const sinCampana = new URL(`https://tinkazo.app/empresa.html#${CLAVE}`);
    expect(leerEnlaceDeLaEmpresa(sinCampana.search, sinCampana.hash)).toBeNull();
  });
});
