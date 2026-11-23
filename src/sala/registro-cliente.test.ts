import { describe, expect, it } from "vitest";
import { anotarEquipoEnSala } from "./equipos";

/**
 * El pedido de anotar un equipo, visto desde el cliente (`src/sala/equipos.ts`): cuando la página sabe que corrige
 * (llevó la cuenta anterior, issue #119) lo dice en el cuerpo; standalone, no manda nada. Y el motivo nuevo
 * «cupón» (cupón ya entregado, no se cambia la cuenta) llega al celular con su texto claro.
 */

/** Un `fetch` de mentira que contesta `estado` con `cuerpo` y deja ver el cuerpo que el cliente mandó. */
const con = (estado: number, respuesta: unknown, captura?: (cuerpo: string) => void) => ({
  fetch: (async (_url: string | URL, init?: RequestInit) => {
    captura?.(String(init?.body ?? ""));
    return new Response(JSON.stringify(respuesta), { status: estado });
  }) as never,
});

const G1 = `G${"A".repeat(55)}`;
const G2 = `G${"B".repeat(55)}`;

describe("la corrección viaja en el cuerpo del alta", () => {
  it("sin corrección (alta de siempre) el cuerpo no lleva cuenta anterior", async () => {
    let cuerpo = "";
    expect(await anotarEquipoEnSala("https://s.test", "AbCd1234", G1, "CIFRADO", "L".repeat(22), con(201, { n: 1, estado: "solicitud" }, (x) => (cuerpo = x)))).toMatchObject({ ok: true });
    expect(JSON.parse(cuerpo).correccion).toBeUndefined();
  });

  it("con la cuenta anterior, el cuerpo la lleva como corrección", async () => {
    let cuerpo = "";
    expect(await anotarEquipoEnSala("https://s.test", "AbCd1234", G2, "CIFRADO", "L".repeat(22), con(201, { n: 1, estado: "solicitud" }, (x) => (cuerpo = x)), G1)).toMatchObject({ ok: true });
    expect(JSON.parse(cuerpo)).toMatchObject({ cuenta: G2, correccion: G1 });
  });
});

describe("el motivo nuevo «cupon» y los que ya había", () => {
  it("409 con «cupon»: el cupón ya está entregado y la cuenta no se cambia", async () => {
    expect(await anotarEquipoEnSala("s", "i", G2, "d", "L".repeat(22), con(409, { error: "cupon" }))).toEqual({ ok: false, motivo: "cupon" });
  });
  it("los motivos de antes se mapean igual que siempre", async () => {
    expect(await anotarEquipoEnSala("s", "i", G1, "d", "L".repeat(22), con(409, { error: "ajena" }))).toEqual({ ok: false, motivo: "ajena" });
    expect(await anotarEquipoEnSala("s", "i", G1, "d", "L".repeat(22), con(409, { error: "sin-registro" }))).toEqual({ ok: false, motivo: "sin-registro" });
    expect(await anotarEquipoEnSala("s", "i", G1, "d", "L".repeat(22), con(429, { error: "llena" }))).toEqual({ ok: false, motivo: "llena" });
  });
});
