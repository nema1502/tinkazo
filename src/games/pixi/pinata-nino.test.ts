import { describe, expect, it } from "vitest";
import { problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { ASOMA_DESPUES, SENTIDO_PINATA, respuestasPinata, type PlanDeLaPinata } from "./pinata-nino";
import { calendarioDePalos } from "./pinata-plan";

const T_HANG = 3.0;

/** Un azar sembrado (mulberry32). */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Arco = "remontada" | "susto" | "duelo" | "tapada";

/** El plan armado como lo arma `pinata.ts`: el orden de caída sorteado, el calendario de palos, la rotura y el cartel. */
function pinata(n: number, semilla: number, arco: Arco): PlanDeLaPinata {
  const rng = azar(semilla);
  const ganador = Math.floor(rng() * n);
  const rival = n >= 2 ? (ganador + 1 + Math.floor(rng() * (n - 1))) % n : ganador;
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador && i !== rival);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const orden = [...rest.reverse()];
  const base = Math.min(9, Math.max(5, 5 + Math.floor(n / 6)));
  const { palos, fin } = calendarioDePalos(orden, base, arco === "remontada", T_HANG);
  const tRotura = fin + (arco === "duelo" ? 1.2 : 0.6);
  const sueltan = palos.filter((p) => !p.miss);
  const asoma = arco === "susto" ? { idx: rng() < 0.5 && rival !== ganador ? rival : ganador, desde: (sueltan.at(-2)?.at ?? tRotura - 1) + ASOMA_DESPUES } : null;
  return { n, ganador, rival, palos, tRotura, tCartel: tRotura + 2.2, asoma };
}

const comoPlan = (p: PlanDeLaPinata): PlanDeRespuestas => ({ duracion: p.tCartel, sentido: SENTIDO_PINATA, respuestas: (t) => respuestasPinata(p, t) });
const ARCOS: Arco[] = ["remontada", "susto", "duelo", "tapada"];

describe("las respuestas de la piñata", () => {
  it("cumplen la prueba del plan con 2, 5, 18, 60 y 200 personas, en los cuatro arcos", () => {
    for (const n of [2, 5, 18, 60, 200]) {
      for (const arco of ARCOS) {
        for (let semilla = 1; semilla <= 4; semilla++) {
          const p = pinata(n, semilla * 104729 + n, arco);
          const mal = problemasDeRespuestas(comoPlan(p), { n, ganadores: [p.ganador], paso: 0.05 });
          expect(mal, `n=${n} arco=${arco} semilla=${semilla}`).toEqual([]);
        }
      }
    }
  });

  it("es de pie: al 25 % siguen casi todos, al 60 % quedan menos y después del golpe, quien gana", () => {
    const p = pinata(18, 7, "susto");
    const r25 = respuestasPinata(p, 0.25 * p.tCartel);
    const r60 = respuestasPinata(p, 0.6 * p.tCartel);
    expect(r25.adelante.quienes.length).toBeGreaterThan(r60.adelante.quienes.length);
    expect(r60.adelante.quienes.length).toBeGreaterThanOrEqual(2);
    expect(r60.adelante.quienes).toContain(p.ganador);
    const fin = respuestasPinata(p, p.tCartel + 1);
    expect(fin.adelante.quienes).toEqual([p.ganador]);
    expect(fin.progreso).toBe(1);
    expect(fin.paso).toMatchObject({ tipo: "gano", quien: p.ganador });
  });

  it("antes del golpe nadie gana: el progreso no llega a 1 y el cartel no está", () => {
    const p = pinata(18, 3, "duelo");
    for (let t = 0; t < p.tCartel; t += 0.1) {
      const r = respuestasPinata(p, t);
      expect(r.paso.tipo).not.toBe("gano");
      expect(r.progreso).toBeLessThan(1);
    }
  });

  it("el progreso solo sube", () => {
    const p = pinata(60, 5, "remontada");
    let previo = 0;
    for (let t = 0; t <= p.tCartel + 2; t += 0.07) {
      const r = respuestasPinata(p, t).progreso;
      expect(r).toBeGreaterThanOrEqual(previo);
      previo = r;
    }
  });

  it("la rival y quien gana siguen adentro hasta la rotura, y con ella cae la rival", () => {
    for (let semilla = 1; semilla <= 6; semilla++) {
      const p = pinata(18, semilla, "duelo");
      const antes = respuestasPinata(p, p.tRotura - 0.01).adelante.quienes;
      expect(antes).toContain(p.ganador);
      expect(antes).toContain(p.rival);
      const despues = respuestasPinata(p, p.tRotura + 0.01);
      expect(despues.adelante.quienes).toEqual([p.ganador]);
      expect(despues.paso).toMatchObject({ tipo: "salio", quien: p.rival, desde: p.tRotura });
    }
  });

  it("un palo que suelta caramelos es una salida con el primero que cayó; un palo al aire no cambia nada", () => {
    const p = pinata(18, 11, "tapada");
    const primero = p.palos.find((s) => !s.miss);
    const aire = p.palos.find((s) => s.miss);
    expect(primero).toBeDefined();
    const r = respuestasPinata(p, (primero?.at ?? 0) + 0.1);
    expect(r.paso).toMatchObject({ tipo: "salio", quien: primero?.drop[0] });
    if (aire && aire.at < (primero?.at ?? 0)) {
      expect(respuestasPinata(p, aire.at + 0.01).adelante.quienes.length).toBe(18);
    }
  });

  it("en el susto, un caramelo se asoma: es el ganador o la rival, y sigue adentro", () => {
    const vistos = new Set<number>();
    for (let semilla = 1; semilla <= 20; semilla++) {
      const p = pinata(18, semilla, "susto");
      expect(p.asoma).not.toBeNull();
      const r = respuestasPinata(p, (p.asoma?.desde ?? 0) + 0.05);
      // Lo último que pasó puede ser el asomarse o el palo siguiente; si es el asomarse, nombra a uno de los dos que quedan.
      if (r.paso.tipo === "casi") {
        expect([p.ganador, p.rival]).toContain(r.paso.quien);
        expect(r.adelante.quienes).toContain(r.paso.quien);
        vistos.add(r.paso.quien as number);
      }
    }
    expect(vistos.size).toBeGreaterThan(1);
  });

  it("hay tantos palos que sueltan como cayeron: con dos personas, ninguna sale hasta la rotura", () => {
    const p = pinata(2, 4, "remontada");
    for (let t = 0; t < p.tRotura; t += 0.1) expect(respuestasPinata(p, t).adelante.quienes).toHaveLength(2);
    expect(respuestasPinata(p, p.tRotura + 0.1).adelante.quienes).toEqual([p.ganador]);
  });
});
