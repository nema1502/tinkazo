/**
 * El sorteo de un sello que entró tarde vuelve para usarse. Si el derecho del que salió venció (o está por vencer) entre
 * el sello y la devolución, volver a ese derecho no sirve: la cuenta quedaría sin sorteo aunque el registro diga
 * devuelto. Entonces vuelve en un derecho nuevo, con el mismo origen, que vence `VIGENCIA_DEVUELTO_MS` después.
 *
 * El sello de prueba vence a los 240 s de la hora real (`armar.ts`): por eso el derecho se otorga antes de tiempo, para
 * que le quede lo que dice cada prueba justo cuando se sella.
 */
import { describe, expect, it } from "vitest";
import { DIA_MS } from "./config";
import { MINIMO_PARA_USAR_MS, VIGENCIA_DEVUELTO_MS } from "./cupos";
import { escena } from "./devolucion-prueba";

/** Una escena con una cuenta cuyo derecho de `sorteos` (de un día) vence `leQueda` ms después de la hora real. */
async function conDerechoQueVence(sorteos: number, leQueda: number) {
  const ahoraReal = Date.now();
  const s = escena({ ahora: ahoraReal - DIA_MS + leQueda });
  const org = s.admitida(sorteos, 1);
  s.e.ahora = ahoraReal;
  return { s, org, m: await s.portero() };
}

describe("el sorteo devuelto a un derecho que venció", () => {
  it("vence entre el sello y la devolución: vuelve en un derecho nuevo y se puede usar", async () => {
    const { s, org, m } = await conDerechoQueVence(1, 60_000);
    const a = s.sello(org);
    expect((await m.procesar(a.xdr)).estado).toBe(200);
    s.entroTarde(a);
    s.e.ahora += 2 * 60_000;
    await m.reconciliar();
    expect(s.quedan(org)).toBe(1);
    expect(s.e.cupos.quedan({ cuenta: org.publicKey() }, s.e.ahora).proximoVence?.fecha).toBe(s.e.ahora + VIGENCIA_DEVUELTO_MS);
    expect(s.e.anotado).toContainEqual({ evento: "vencido-al-devolver", datos: { hash: a.hash.slice(0, 8), sorteos: 1 } });
    // Y el próximo sello pasa.
    expect((await m.procesar(s.sello(org, { ronda: 33_939_100 }).xdr)).estado).toBe(200);
    expect(s.quedan(org)).toBe(0);
  });

  it("con menos de lo mínimo para usarlo también va a uno nuevo", async () => {
    const { s, org, m } = await conDerechoQueVence(1, MINIMO_PARA_USAR_MS);
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.entroTarde(a);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(org)).toBe(1);
    expect(s.e.cupos.quedan({ cuenta: org.publicKey() }, s.e.ahora).proximoVence?.fecha).toBe(s.e.ahora + VIGENCIA_DEVUELTO_MS);
  });

  it("con tiempo de sobra vuelve a su derecho, como siempre, sin derecho nuevo", async () => {
    const s = escena();
    const org = s.admitida(1, 60);
    const m = await s.portero();
    const b = s.sello(org);
    await m.procesar(b.xdr);
    s.entroTarde(b);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(org)).toBe(1);
    expect(s.e.anotado.some((x) => x.evento === "vencido-al-devolver")).toBe(false);
    expect(s.e.cupos.exportar(true).derechos).toHaveLength(1);
  });

  it("un derecho de cinco que venció no revive los que no se usaron: vuelve solo el del sello", async () => {
    const { s, org, m } = await conDerechoQueVence(5, 60_000);
    const a = s.sello(org);
    await m.procesar(a.xdr);
    expect(s.quedan(org)).toBe(4);
    s.entroTarde(a);
    s.e.ahora += 2 * 60_000;
    await m.reconciliar();
    expect(s.quedan(org)).toBe(1);
    expect(s.e.cupos.quedan({ cuenta: org.publicKey() }, s.e.ahora).vencieron).toBe(4);
  });
});
