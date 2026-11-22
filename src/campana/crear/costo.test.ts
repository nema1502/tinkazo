import { describe, expect, it } from "vitest";
import { DOLAR, comisionDe, totalACargar } from "../comision";
import { comisionDelBuild } from "../../stellar/comision-config";
import { cuentaDePrueba } from "../cuentas-de-prueba";
import { armarCampana } from "./armar";
import { comisionDelArmado, costoDeLaCampana } from "./costo";
import { formularioInicial } from "./estado";

/** Los valores de producción: 2 % de los premios con un mínimo de 1,50 (`comisionDelBuild`). */
const PRODUCCION = { pb: 200n, minimo: 15_000_000n };

describe("costoDeLaCampana", () => {
  it("3 premios de 40 dan 120 en total y sin cobro no hay renglón del servicio", () => {
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: null })).toEqual({ premios: 120, comision: null, total: 120 });
  });

  it("con un servicio sale su renglón y el total lo incluye", () => {
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: { dolares: 6 } })).toEqual({ premios: 120, comision: 6, total: 126 });
  });
});

describe("el servicio en el armado es el mismo que cobra el panel", () => {
  const servicio = comisionDelArmado(PRODUCCION);

  it("1 premio de 5: el mínimo, 1,50, y 6,50 en total", () => {
    const c = servicio?.({ monto: 5, ganan: 1 });
    expect(c).toEqual({ dolares: 1.5 });
    expect(costoDeLaCampana({ premios: { monto: 5, ganan: 1 }, comision: c ?? null }).total).toBe(6.5);
  });

  it("3 premios de 40: 2,40, y 122,40 en total", () => {
    const c = servicio?.({ monto: 40, ganan: 3 });
    expect(c).toEqual({ dolares: 2.4 });
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: c ?? null }).total).toBeCloseTo(122.4, 10);
  });

  it("para cada premio y cuántos ganan, el armado y el cobro sobre la campaña armada dan lo mismo, al centavo", () => {
    for (const monto of [5, 10, 20, 40, 50, 75, 76, 100, 200, 500, 1000]) {
      for (const ganan of [1, 2, 3, 5, 10]) {
        const f = { ...formularioInicial("America/La_Paz", "k3f9"), nombre: "Panadería La Estrella", monto, ganan, fecha: "2026-11-21" };
        const campana = armarCampana(f, { bases: { es: "Bases", en: "Rules" } });
        // Los premios que lleva la campaña armada, como los lee el panel (`leerCampana` los pasa a bigint).
        const premios = (campana.premios as string[]).map(BigInt);
        expect(premios, `${monto} por ${ganan}`).toHaveLength(ganan);
        // Lo que cobra el panel (`numeros` de src/ui/campana-comision.ts): comisionDe sobre los premios de la campaña.
        const cobra = comisionDe(premios, PRODUCCION.pb, PRODUCCION.minimo);
        const dice = servicio?.({ monto, ganan });
        expect(dice?.dolares, `${monto} por ${ganan}`).toBe(Number(cobra) / Number(DOLAR));
        const total = costoDeLaCampana({ premios: { monto, ganan }, comision: dice ?? null }).total;
        expect(Math.round(total * 100), `${monto} por ${ganan}`).toBe(Number(totalACargar(premios, cobra) / 100_000n));
      }
    }
  });

  it("sin el cobro configurado no hay servicio, y sin premio elegido tampoco", () => {
    expect(comisionDelArmado(null)).toBeNull();
    expect(servicio?.({ monto: 0, ganan: 1 })).toBeNull();
  });

  it("con la configuración del build de producción dice lo mismo que cobra el panel", () => {
    // Las mismas variables que lee el panel (`comisionDelBuild`), con las del retiro, que el cobro necesita.
    const cfg = comisionDelBuild({
      VITE_COMISION_PB: "200",
      VITE_COMISION_MINIMO: "1.50",
      VITE_COMISION_CUENTA: cuentaDePrueba(2),
      VITE_RETIRO_COSTO: "0.50",
      VITE_RETIRO_CUENTA: cuentaDePrueba(1),
    });
    expect(cfg).not.toBeNull();
    const servicio = comisionDelArmado(cfg);
    expect(servicio?.({ monto: 5, ganan: 1 })).toEqual({ dolares: 1.5 });
    expect(servicio?.({ monto: 40, ganan: 3 })).toEqual({ dolares: 2.4 });
  });

  it("sin las cuentas del retiro el build no cobra, y el armado tampoco dice un servicio", () => {
    const cfg = comisionDelBuild({ VITE_COMISION_PB: "200", VITE_COMISION_MINIMO: "1.50", VITE_COMISION_CUENTA: cuentaDePrueba(2) });
    expect(comisionDelArmado(cfg)).toBeNull();
  });
});
