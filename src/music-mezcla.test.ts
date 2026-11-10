// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERFIL_BASE } from "./sonidos/carrera";

/**
 * La mezcla del bombo y del bajo (`MEZCLA_GRAVE_DE_HOY` y `MEZCLA_GRAVE_PARLANTE_CHICO` en `src/music.ts`).
 *
 * Ningún sonido se cambia sin que alguien lo escuche. La mezcla para parlante chico baja la música de los diez juegos
 * (la carrera, 1,2 LU), así que solo vale con el arreglo de una candidata de la carrera o si eligió "parlante chico"
 * en la página de escucha. Sin eso, el bombo, el kick y el bajo suenan con los valores de `origin/main`.
 */

/** Los valores de `origin/main`, escritos acá a mano: si alguien toca la mezcla de hoy, esta prueba lo dice. */
const DE_MAIN = {
  bomboSeno: 0.56,
  bomboCuerpo: 0.3,
  kickSeno: 0.45,
  kickCuerpo: 0.24,
  bajoTriangulo: 1,
  bajoSierra: 0.42,
};
/** Los de la mezcla para parlante chico (commit 0f090010). */
const PARLANTE_CHICO = {
  bomboSeno: 0.4,
  bomboCuerpo: 0.42,
  kickSeno: 0.33,
  kickCuerpo: 0.32,
  bajoTriangulo: 0.6,
  bajoSierra: 0.6,
};

interface Registro {
  /** El nivel al que llega cada envolvente (`linearRampToValueAtTime` de una ganancia), en el orden en que se armaron. */
  picos: number[];
  /** Las ganancias fijas (`gain.value = x`) que se asignaron, en orden. */
  fijas: number[];
}

/** Un contexto de audio de mentira que anota las ganancias y no suena. Alcanza para armar la banda y tocar sus instrumentos. */
function contextoFalso(): { ctx: BaseAudioContext; destino: AudioNode; registro: Registro } {
  const registro: Registro = { picos: [], fijas: [] };
  const ctx: Record<string, unknown> = { currentTime: 0, sampleRate: 100 };
  const nodo = (anota: boolean): unknown => {
    const guardado: Record<string | symbol, unknown> = {};
    const parametro = (): unknown => {
      let valor = 0;
      return {
        get value(): number {
          return valor;
        },
        set value(v: number) {
          valor = v;
          if (anota) registro.fijas.push(v);
        },
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: (v: number) => {
          if (anota) registro.picos.push(v);
        },
        exponentialRampToValueAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
      };
    };
    const n: unknown = new Proxy(guardado, {
      get(_, p) {
        if (p in guardado) return guardado[p];
        if (p === "context") return ctx;
        if (p === "connect") return (destino?: unknown) => destino ?? n;
        if (p === "start" || p === "stop" || p === "disconnect") return () => undefined;
        // Cualquier otro nombre es un parámetro de audio (gain, frequency, Q...): solo el de las ganancias se anota.
        guardado[p] = parametro();
        return guardado[p];
      },
      set(_, p, v) {
        guardado[p] = v;
        return true;
      },
    });
    return n;
  };
  const contexto = new Proxy(ctx, {
    get(t, p) {
      if (p in t) return t[p as string];
      if (p === "destination") return (t[p] ??= nodo(false));
      if (p === "createBuffer") return (_canales: number, largo: number) => ({ getChannelData: () => new Float32Array(largo) });
      if (typeof p === "string" && p.startsWith("create")) return () => nodo(p === "createGain");
      return undefined;
    },
  }) as unknown as BaseAudioContext;
  return { ctx: contexto, destino: nodo(false) as AudioNode, registro };
}

/** Carga `src/music.ts` con lo que se eligió para el bombo y el bajo (`BOMBO_Y_BAJO`). */
async function cargar(elegido: "hoy" | "chico") {
  vi.resetModules();
  vi.doMock("./sonidos/carrera-elegidas", () => ({
    ELEGIDAS: { musica: "hoy", pasos: "hoy", echarse: "hoy", obstaculos: "hoy", final: "hoy", festejo: "hoy" },
    BOMBO_Y_BAJO: elegido,
  }));
  return import("./music");
}

afterEach(() => {
  vi.doUnmock("./sonidos/carrera-elegidas");
  vi.resetModules();
});

type Musica = Awaited<ReturnType<typeof cargar>>;

/** Los niveles con que suenan el bombo, el kick y el bajo de una banda armada con `parlanteChico` (o sin decirlo). */
function medirBanda(m: Musica, parlanteChico?: boolean) {
  const { ctx, destino, registro } = contextoFalso();
  const banda = m.armarBanda(ctx, destino, 0x0a110a, 1, parlanteChico);
  const tocar = (f: () => void): Registro => {
    registro.picos.length = 0;
    registro.fijas.length = 0;
    f();
    return { picos: [...registro.picos], fijas: [...registro.fijas] };
  };
  const bombo = tocar(() => m.instrumentosGraves.bombo(banda, 1, 1));
  const kick = tocar(() => m.instrumentosGraves.kick(banda, 1));
  const bajo = tocar(() => m.instrumentosGraves.bass(banda, 1, 0));
  return {
    // El bombo arma tres envolventes: el seno, el golpe de ruido (0,18) y el cuerpo. El kick, dos: el seno y el cuerpo.
    bomboSeno: bombo.picos[0],
    ruidoDelBombo: bombo.picos[1],
    bomboCuerpo: bombo.picos[2],
    kickSeno: kick.picos[0],
    kickCuerpo: kick.picos[1],
    // El bajo: una envolvente de 0,32 y dos ondas, el triángulo y la sierra, cada una con su ganancia fija.
    envolventeDelBajo: bajo.picos[0],
    bajoTriangulo: bajo.fijas[0],
    bajoSierra: bajo.fijas[1],
  };
}

describe("la mezcla del bombo y del bajo", () => {
  it("las dos mezclas valen lo que valen: la de hoy es la de origin/main y la de parlante chico es la nueva", async () => {
    const m = await cargar("hoy");
    expect(m.MEZCLA_GRAVE_DE_HOY).toEqual(DE_MAIN);
    expect(m.MEZCLA_GRAVE_PARLANTE_CHICO).toEqual(PARLANTE_CHICO);
    expect(m.mezclaGrave(false)).toBe(m.MEZCLA_GRAVE_DE_HOY);
    expect(m.mezclaGrave(true)).toBe(m.MEZCLA_GRAVE_PARLANTE_CHICO);
  });

  it("sin perfil y sin pedirlo, el bombo, el kick y el bajo suenan con los valores de main", async () => {
    const m = await cargar("hoy");
    const r = medirBanda(m);
    expect(r.bomboSeno).toBe(DE_MAIN.bomboSeno);
    expect(r.bomboCuerpo).toBe(DE_MAIN.bomboCuerpo);
    expect(r.kickSeno).toBe(DE_MAIN.kickSeno);
    expect(r.kickCuerpo).toBe(DE_MAIN.kickCuerpo);
    expect(r.bajoTriangulo).toBe(DE_MAIN.bajoTriangulo);
    expect(r.bajoSierra).toBe(DE_MAIN.bajoSierra);
  });

  it("lo que no es de la mezcla no cambia: el golpe de ruido del bombo y la envolvente del bajo", async () => {
    const m = await cargar("hoy");
    for (const chico of [false, true]) {
      const r = medirBanda(m, chico);
      expect(r.ruidoDelBombo).toBeCloseTo(0.18, 10);
      expect(r.envolventeDelBajo).toBeCloseTo(0.32, 10);
    }
  });

  it("pedida la mezcla de parlante chico, suenan los valores nuevos", async () => {
    const m = await cargar("hoy");
    const r = medirBanda(m, true);
    expect(r.bomboSeno).toBe(PARLANTE_CHICO.bomboSeno);
    expect(r.bomboCuerpo).toBe(PARLANTE_CHICO.bomboCuerpo);
    expect(r.kickSeno).toBe(PARLANTE_CHICO.kickSeno);
    expect(r.kickCuerpo).toBe(PARLANTE_CHICO.kickCuerpo);
    expect(r.bajoTriangulo).toBe(PARLANTE_CHICO.bajoTriangulo);
    expect(r.bajoSierra).toBe(PARLANTE_CHICO.bajoSierra);
  });

  it("pedida la de hoy a una banda, suena la de hoy aunque se haya elegido parlante chico para todo", async () => {
    const m = await cargar("chico");
    expect(medirBanda(m, false).bomboSeno).toBe(DE_MAIN.bomboSeno);
  });

  it("la música de la carrera con el arreglo de una candidata (perfil) suena con la de parlante chico", async () => {
    const m = await cargar("hoy");
    const { ctx, destino, registro } = contextoFalso();
    // Un solo paso de la música: el bombo del uno es lo primero que suena, con el seno, el ruido y el cuerpo.
    m.tocarMusicaEn(ctx, destino, { seed: 1, perfil: PERFIL_BASE, segundos: 0.1, nivel: () => 0.5 });
    const [seno, , cuerpo] = registro.picos;
    expect(seno).toBeCloseTo(PARLANTE_CHICO.bomboSeno * 0.8, 10);
    expect(cuerpo).toBeCloseTo(PARLANTE_CHICO.bomboCuerpo * 0.8, 10);
  });

  it("la música sin perfil (la de los otros nueve juegos y la de hoy en la carrera) suena con la de main", async () => {
    const m = await cargar("hoy");
    const { ctx, destino, registro } = contextoFalso();
    m.tocarMusicaEn(ctx, destino, { seed: 1, perfil: null, segundos: 0.1, nivel: () => 0.5 });
    const [seno, , cuerpo] = registro.picos;
    expect(seno).toBeCloseTo(DE_MAIN.bomboSeno * 0.8, 10);
    expect(cuerpo).toBeCloseTo(DE_MAIN.bomboCuerpo * 0.8, 10);
  });

  it("si se eligió parlante chico, vale también sin perfil: en la música y en las bandas sin pedirlo", async () => {
    const m = await cargar("chico");
    const { ctx, destino, registro } = contextoFalso();
    m.tocarMusicaEn(ctx, destino, { seed: 1, perfil: null, segundos: 0.1, nivel: () => 0.5 });
    expect(registro.picos[0]).toBeCloseTo(PARLANTE_CHICO.bomboSeno * 0.8, 10);
    const r = medirBanda(m);
    expect(r.bomboSeno).toBe(PARLANTE_CHICO.bomboSeno);
    expect(r.bajoSierra).toBe(PARLANTE_CHICO.bajoSierra);
  });

  it("el renderizador del par puede pedir cualquiera de las dos sin mirar lo que se eligió", async () => {
    const m = await cargar("hoy");
    for (const [chico, esperado] of [
      [false, DE_MAIN],
      [true, PARLANTE_CHICO],
    ] as const) {
      const { ctx, destino, registro } = contextoFalso();
      m.tocarMusicaEn(ctx, destino, { seed: 1, perfil: null, segundos: 0.1, nivel: () => 0.5, parlanteChico: chico });
      expect(registro.picos[0]).toBeCloseTo(esperado.bomboSeno * 0.8, 10);
    }
  });
});
