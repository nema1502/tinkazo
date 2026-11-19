import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cuantosGrupos, grupoDe } from "../grupos";
import { writeStory } from "../drama";

/** El plan toma `clamp` de overlay.ts, que lee `location` al cargarse, y vitest corre en Node. */
let planCableCar: typeof import("./cablecar-plan").planCableCar;
let T_DOCK: number;
let T_RUN: number;
beforeAll(async () => {
  vi.stubGlobal("location", { search: "" });
  ({ planCableCar, T_DOCK, T_RUN } = await import("./cablecar-plan"));
}, 60_000);

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

describe("teleférico por grupos: el plan", () => {
  it.each([2, 3, 8, 16, 18, 40, 60, 200])("con %i personas y un premio, cada grupo sin premio baja entero y a la cumbre llega solo quien gana", (n) => {
    for (const seed of [1, 2, 3, 4]) {
      const w = n > 3 ? 3 : 0;
      const P = planCableCar(lista(n), [w], rngOf(seed));
      const K = cuantosGrupos(n);
      expect(P.C).toBe(K);
      // Todos están en una sola lista de bajada, y quien gana es el único que llega arriba.
      expect([...P.rank].sort((a, b) => a - b)).toEqual(lista(n).map((_, i) => i));
      expect(P.rank[0]).toBe(w);
      expect(P.surv).toEqual([w]);
      expect(P.left[0]).toBe(n);
      expect(P.left[P.R]).toBe(1);
      expect(P.leftAt(T_DOCK)).toBe(1);
      expect(P.aboard(P.winnerCab, T_DOCK)).toEqual([w]);
      for (let cab = 0; cab < P.C; cab++) if (cab !== P.winnerCab) expect(P.aboard(cab, T_DOCK)).toEqual([]);
      // Las paradas de los grupos sin premio bajan un grupo entero.
      const gw = grupoDe(w, n);
      for (let r = 0; r < P.R; r++) {
        const baja = P.rank.slice(P.left[r + 1], P.left[r]);
        if (!P.enteras[r]) continue;
        const g = grupoDe(baja[0] ?? 0, n);
        expect(g).not.toBe(gw);
        expect(baja.every((i) => grupoDe(i, n) === g)).toBe(true);
        expect(baja.length).toBe(lista(n).filter((_, i) => grupoDe(i, n) === g).length);
      }
      // En la última se baja uno solo, del grupo de quien gana: el que decide. Antes de esa bajada quedan dos.
      const ultima = P.rank.slice(P.left[P.R], P.left[P.R - 1]);
      if (n >= 2) {
        expect(ultima).toHaveLength(1);
        expect(grupoDe(ultima[0] ?? -1, n)).toBe(gw);
        expect(P.left[P.R - 1]).toBe(2);
      }
      // Quien gana no baja nunca; la cabina de quien gana no se suelta, y todas las demás sí.
      expect(P.offAt.has(w)).toBe(false);
      expect(P.detachT[P.winnerCab]).toBe(Infinity);
      for (let cab = 0; cab < P.C; cab++) if (cab !== P.winnerCab) expect(Number.isFinite(P.detachT[cab] as number)).toBe(true);
    }
  });

  it.each([
    [3, 2], [8, 2], [8, 3], [8, 7], [18, 2], [18, 5], [18, 17], [40, 3], [60, 5], [200, 5], [200, 10],
  ])("con %i personas y %i premios, a la cumbre llegan exactamente quienes ganan, en una sola cabina", (n, m) => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const winners = Array.from({ length: m }, (_, i) => (3 + i * 7 + seed) % n).filter((v, i, a) => a.indexOf(v) === i);
      const P = planCableCar(lista(n), winners, rngOf(seed));
      const M = winners.length;
      expect([...P.rank].sort((a, b) => a - b)).toEqual(lista(n).map((_, i) => i));
      expect([...P.rank.slice(0, M)].sort((a, b) => a - b)).toEqual([...winners].sort((a, b) => a - b));
      expect(P.left[P.R]).toBe(M);
      expect(P.leftAt(T_DOCK)).toBe(M);
      expect([...P.aboard(P.winnerCab, T_DOCK)].sort((a, b) => a - b)).toEqual([...winners].sort((a, b) => a - b));
      for (let cab = 0; cab < P.C; cab++) if (cab !== P.winnerCab) expect(P.aboard(cab, T_DOCK)).toEqual([]);
      // Nadie que gana se baja, y todos los demás sí.
      for (const x of winners) expect(P.offAt.has(x)).toBe(false);
      for (let i = 0; i < n; i++) if (!winners.includes(i)) expect(P.offAt.has(i)).toBe(true);
      // En la última se baja uno por cabina con premio (si esa cabina tiene a alguien que no gana).
      const cabsConPremio = new Set(winners.map((x) => P.cabinOf.get(x)));
      const conSuplente = [...cabsConPremio].filter((cab) => (P.pax[cab as number] ?? []).some((i) => !winners.includes(i))).length;
      expect((P.left[P.R - 1] as number) - (P.left[P.R] as number)).toBe(conSuplente);
      // Sube una cabina con premio, la anfitriona: las demás se sueltan.
      expect(cabsConPremio.has(P.winnerCab)).toBe(true);
      expect(P.detachT[P.winnerCab]).toBe(Infinity);
      for (let cab = 0; cab < P.C; cab++) if (cab !== P.winnerCab) expect(Number.isFinite(P.detachT[cab] as number)).toBe(true);
    }
  });

  it("si ganan todos, llegan todos y nadie se baja", () => {
    const P = planCableCar(lista(3), [0, 1, 2], rngOf(4));
    expect(P.left[P.R]).toBe(3);
    expect([...P.aboard(P.winnerCab, T_DOCK)].sort()).toEqual([0, 1, 2]);
    expect(P.offAt.size).toBe(0);
  });

  it("con el mismo azar, el mismo plan", () => {
    const a = planCableCar(lista(50), [7], rngOf(11));
    const b = planCableCar(lista(50), [7], rngOf(11));
    expect(a.rank).toEqual(b.rank);
    expect(a.left).toEqual(b.left);
    expect(a.groupOfCab).toEqual(b.groupOfCab);
  });

  it.each([
    [2, 1], [8, 1], [18, 1], [50, 1], [200, 1], [8, 3], [18, 5], [60, 5], [200, 10],
  ])("con %i personas y %i premios, el contador baja cuando el relator lo dice y cuenta a los que siguen arriba", (n, m) => {
    // El relator dice "Quedan N" en `tOff` (cablecar.ts): el contador tiene que
    // decir lo mismo desde ese instante, ni antes ni después. Cuando los premios
    // se pasan a la cabina del primero, la cuenta no cambia.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const winners = Array.from({ length: m }, (_, i) => (3 + i * 7 + seed) % n).filter((v, i, a) => a.indexOf(v) === i);
      const P = planCableCar(lista(n), winners, rngOf(seed));
      for (const s of P.stops) {
        expect(P.leftAt(s.tOff - 1e-6)).toBe(P.left[s.round]);
        expect(P.leftAt(s.tOff)).toBe(P.left[s.round + 1]);
      }
      // En cualquier momento del viaje, el contador es la gente que sigue en las cabinas.
      for (let x = 2.05; x < 16.4; x += 0.05) {
        let arriba = 0;
        for (let cab = 0; cab < P.C; cab++) arriba += P.aboard(cab, x).length;
        expect(P.leftAt(x)).toBe(arriba + P.volando(x).length);
      }
    }
  });

  it.each([8, 18, 40])("con %i personas, nada del plan dice cuál de los dos de la última estación gana", (n) => {
    // El auditor de delatores (21 de octubre de 2026): en la última cabina el
    // nombre de la izquierda ganaba siempre, y la puerta y la mordaza nombraban
    // siempre a uno de los que llegan arriba, con la cabina todavía llena. Desde
    // el 13 de noviembre de 2026 a la última estación llegan dos y uno se baja:
    // el orden de los dos en la cabina y a quién nombra el giro salen a ciegas.
    let primero = 0;
    let nombraAlGanador = 0;
    let azar = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const w = (seed * 7) % n;
      const P = planCableCar(lista(n), [w], rngOf(seed));
      const ult = P.stops.find((s) => s.last);
      expect(ult).toBeDefined();
      const aBordo = P.aboard(P.winnerCab, (ult?.tOff ?? 0) - 1e-6);
      expect(aBordo).toHaveLength(2);
      expect(aBordo).toContain(w);
      if (aBordo[0] === w) primero++;
      expect(aBordo).toContain(P.nombrado);
      if (P.nombrado === w) nombraAlGanador++;
      azar += 1 / aBordo.length;
    }
    expect(primero / N).toBeGreaterThan(0.4);
    expect(primero / N).toBeLessThan(0.6);
    expect(nombraAlGanador / azar).toBeGreaterThan(0.8);
    expect(nombraAlGanador / azar).toBeLessThan(1.2);
  });

  it.each([8, 18, 40])("con %i personas, el que se baja en la última sale parejo de entre los del grupo de quien gana", (n) => {
    // Quién llega a la última estación junto a quien gana se sortea a ciegas: cada
    // compañero de grupo tiene la misma chance, sin importar su lugar en la lista.
    const w = 3;
    const cuenta = new Map<number, number>();
    const N = 600;
    for (let seed = 1; seed <= N; seed++) {
      const P = planCableCar(lista(n), [w], rngOf(seed));
      const ultimo = P.rank[1] as number;
      cuenta.set(ultimo, (cuenta.get(ultimo) ?? 0) + 1);
    }
    const companeros = lista(n).map((_, i) => i).filter((i) => i !== w && grupoDe(i, n) === grupoDe(w, n));
    expect([...cuenta.keys()].sort((a, b) => a - b)).toEqual(companeros);
    for (const c of companeros) {
      expect((cuenta.get(c) ?? 0) / N).toBeGreaterThan(0.6 / companeros.length);
      expect((cuenta.get(c) ?? 0) / N).toBeLessThan(1.4 / companeros.length);
    }
  });

  it.each([2, 8, 18, 200])("con %i personas, el arco del director sale primero de la semilla y no depende del plan", (n) => {
    // El arco elige el giro (la puerta, la mordaza, el apagón o la ráfaga). Sale antes que el plan: así no cambia con
    // cuántos grupos hay, ni con cuántos premios, ni con cómo se reparte la última estación.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = n > 3 ? 3 : 0;
      const esperado = writeStory(rngOf(seed), Math.max(2, n), w % Math.max(2, n)).arc;
      expect(planCableCar(lista(n), [w], rngOf(seed)).story.arc).toBe(esperado);
      expect(planCableCar(lista(n), [w, (w + 1) % n], rngOf(seed)).story.arc).toBe(esperado);
    }
  });

  it.each([
    [18, 2], [18, 3], [40, 2], [40, 5], [200, 3],
  ])("con %i personas y %i premios en cabinas distintas, nada del final dice cuál es el primer premio", (n, m) => {
    // Con premios en varias cabinas, la junta vuela a una sola, y en ella caen la puerta, la mordaza y la cámara de la
    // última estación. Era siempre la del primer premio: con el primero solo en su cabina, se sabía quién era unos
    // 2,5 s antes del cartel (revisión del 13 de noviembre de 2026). Ahora la anfitriona sale a ciegas entre las cabinas
    // con premio, y a quién nombra el giro sale de ella.
    const K = cuantosGrupos(n);
    let delPrimero = 0;
    let nombraAlPrimero = 0;
    let azarPrimero = 0;
    const N = 600;
    for (let seed = 1; seed <= N; seed++) {
      // Un premio por grupo, cada uno en un grupo distinto, y el primero en un grupo que cambia con la semilla.
      const winners = Array.from({ length: m }, (_, i) => ((seed + i) % K) + K * ((seed * 3 + i) % Math.max(1, Math.floor(n / K) - 1)));
      expect(new Set(winners.map((x) => grupoDe(x, n))).size).toBe(m);
      const P = planCableCar(lista(n), winners, rngOf(seed));
      const conPremio = new Set(winners.map((x) => P.cabinOf.get(x)));
      expect(conPremio.has(P.winnerCab)).toBe(true);
      if (P.winnerCab === P.cabinOf.get(winners[0] ?? -1)) delPrimero++;
      // A quién nombran la puerta, la mordaza y el apagón: uno de los que van en la anfitriona en la última estación.
      const ult = P.stops.find((s) => s.last);
      const aBordo = P.aboard(P.winnerCab, (ult?.tOff ?? 0) - 1e-6);
      expect(aBordo).toContain(P.nombrado);
      if (P.nombrado === winners[0]) nombraAlPrimero++;
      if (aBordo.includes(winners[0] ?? -1)) azarPrimero += 1 / aBordo.length;
      // Arriba llegan todos, en la anfitriona.
      expect([...P.aboard(P.winnerCab, T_DOCK)].sort((a, b) => a - b)).toEqual([...winners].sort((a, b) => a - b));
    }
    expect(delPrimero / N).toBeGreaterThan(0.75 / m);
    expect(delPrimero / N).toBeLessThan(1.25 / m);
    expect(nombraAlPrimero / azarPrimero).toBeGreaterThan(0.75);
    expect(nombraAlPrimero / azarPrimero).toBeLessThan(1.25);
  });

  it("con varios premios, la onda del foco no lleva el color de la cara del primero", () => {
    // El color de la onda era el de la cara de winners[0], y con varios premios decía quién era el primero en el
    // silencio del foco. Con un solo premio sigue siendo el de su cara.
    const fuente = readFileSync(new URL("./cablecar.ts", import.meta.url), "utf8");
    const foco = fuente.slice(fuente.indexOf("function focoDeLaCabina"), fuente.indexOf("function direct"));
    expect(foco).toContain("if (P.surv.length > 1) return { arco: P.story.arc, x, y, r, rival: null };");
    expect(foco.indexOf("P.surv.length > 1")).toBeLessThan(foco.indexOf("colorDeNombre"));
  });

  it.each([18, 30, 37, 40, 60, 100, 150, 200])("con %i personas, la parada que decide se toma su tiempo aunque haya diez cabinas", (n) => {
    // Con 37 personas o más hay diez cabinas y once paradas en los mismos doce segundos de viaje, y la parada que
    // decide duraba 1 s de juego: con la puerta, el relator decía cuatro líneas en 0,9 s, el "¡se queda!" se veía
    // 0,2 s y la pregunta casi no tenía lugar (revisión del 13 de noviembre de 2026). Ahora la última parada, el
    // viaje que llega a ella y el apagón tienen un piso en segundos de juego, y ese tiempo sale de los otros viajes.
    for (const m of [1, 2, 5]) {
      for (let seed = 1; seed <= 40; seed++) {
        const winners = Array.from({ length: m }, (_, i) => (3 + i * 7 + seed) % n).filter((v, i, a) => a.indexOf(v) === i);
        const P = planCableCar(lista(n), winners, rngOf(seed));
        const ult = P.stops.find((s) => s.last);
        const previa = P.stops.filter((s) => !s.last).at(-1);
        if (!ult || !previa) throw new Error("faltan paradas");
        // El viaje sigue terminando a la misma hora.
        expect(ult.t1).toBeCloseTo(T_RUN, 6);
        if (!P.deAUno) continue;
        const giro = P.puerta || P.mordaza;
        expect(ult.t1 - ult.t0).toBeGreaterThanOrEqual((giro ? 2.7 : 2.2) + (P.juntados.length ? 0.6 : 0) - 1e-9);
        expect(ult.tOff - ult.t0).toBeGreaterThanOrEqual(1.2);
        if (P.puerta) {
          expect(P.puertaA - ult.t0).toBeGreaterThanOrEqual(0.45);
          expect(P.puertaB - P.puertaA).toBeGreaterThanOrEqual(0.45);
          expect(ult.tOff - P.puertaB).toBeGreaterThanOrEqual(0.45);
        }
        if (P.mordaza) {
          expect(P.mA - ult.t0).toBeGreaterThanOrEqual(0.45);
          expect(P.mB - P.mA).toBeGreaterThanOrEqual(0.45);
          expect(ult.tOff - P.mB).toBeGreaterThanOrEqual(0.45);
        }
        // La pregunta tiene su lugar en el viaje a la última estación: después de lo último que dijo el relator y
        // antes de la llegada, sin que la ráfaga se le encime.
        expect(P.tPregunta).toBeGreaterThanOrEqual(previa.tOff + 0.6);
        expect(ult.t0 - P.tPregunta).toBeGreaterThanOrEqual(0.45);
        if (P.apagon) {
          expect(P.vuelve - P.corte).toBeGreaterThanOrEqual(0.6);
          expect(P.tPregunta).toBeGreaterThanOrEqual(P.vuelve + 0.6);
        }
        if (P.rafaga) expect(Math.abs(P.rafagaT() - P.tPregunta)).toBeGreaterThanOrEqual(0.7);
        // Lo que se saca de los otros viajes no los deja en nada.
        for (const s of P.stops) expect(s.t1 - s.t0).toBeGreaterThanOrEqual(0.25);
        for (const L of P.legs) if (L.kind === "glide") expect(L.span).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it("con una sola persona no hay paradas que dibujar", () => {
    const P = planCableCar(["Sola"], [0], rngOf(3));
    expect(P.rank).toEqual([0]);
    expect(P.R).toBe(1);
  });
});
