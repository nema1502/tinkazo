import { describe, expect, it } from "vitest";
import { ATRASO_TOLERADO_S, puertaDeLaGrabacion, salaALaPar, type ParaGrabar } from "./puerta-de-la-grabacion";

/**
 * Cuándo graba la sala con celulares mirando (`puerta-de-la-grabacion.ts`). Lo grabado es lo que suelta el final del
 * celular: verlo tiene que querer decir que la sala va a la par (y entonces delante del celular) o que ya mostró quién
 * gana. Sin celulares, como siempre.
 */

const SHOW = { arranco: true, tardeAlArrancar: 0.1, reanclado: false, atraso: 0, seEscondio: false, oculto: false, retenido: false, retenidoS: 0, coronado: false };
const BIEN: ParaGrabar = { conEspectadores: true, cambioConQr: false, anclaALaPar: true, mismoJuego: true, show: SHOW };

describe("la sala a la par", () => {
  it("con el ancla retenida, el juego a la hora, sin esconderse ni atrasarse y con el juego del QR", () => {
    expect(salaALaPar(BIEN)).toBe(true);
  });
  it("no, con cualquiera de esas cosas que falte", () => {
    expect(salaALaPar({ ...BIEN, anclaALaPar: false })).toBe(false);
    expect(salaALaPar({ ...BIEN, cambioConQr: true })).toBe(false);
    expect(salaALaPar({ ...BIEN, mismoJuego: false })).toBe(false);
    expect(salaALaPar({ ...BIEN, show: null })).toBe(false);
    expect(salaALaPar({ ...BIEN, show: { ...SHOW, arranco: false } })).toBe(false);
    expect(salaALaPar({ ...BIEN, show: { ...SHOW, reanclado: true } })).toBe(false);
    expect(salaALaPar({ ...BIEN, show: { ...SHOW, seEscondio: true } })).toBe(false);
    // Escondida justo al decidir: su atraso es el del último cuadro, de antes de esconderse, y al volver va a estar atrás.
    expect(salaALaPar({ ...BIEN, show: { ...SHOW, oculto: true } })).toBe(false);
    expect(salaALaPar({ ...BIEN, show: { ...SHOW, atraso: ATRASO_TOLERADO_S + 0.01 } })).toBe(false);
  });
});

/** Un reloj de mentira para la puerta. */
function reloj(inicio = 0) {
  let t = inicio;
  const dormidos: { hasta: number; r: () => void }[] = [];
  return {
    ahora: () => t,
    dormir: (ms: number) => new Promise<void>((r) => dormidos.push({ hasta: t + ms, r })),
    async avanzar(ms: number) {
      t += ms;
      for (const d of dormidos.splice(0)) {
        if (d.hasta <= t) d.r();
        else dormidos.push(d);
      }
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("la puerta de la grabación", () => {
  it("sin celulares mirando se abre enseguida", async () => {
    const r = reloj();
    const p = puertaDeLaGrabacion({ conEspectadores: false, grabable: 8, ahora: r.ahora, dormir: r.dormir, aLaPar: () => false, coronada: new Promise(() => undefined) });
    expect(await p).toBe("sin-espectadores");
  });

  it("a la par, se abre cuando la cadena acepta, mirando la par en ese momento", async () => {
    const r = reloj();
    let miradas = 0;
    let abierta = "";
    void puertaDeLaGrabacion({ conEspectadores: true, grabable: 8, ahora: r.ahora, dormir: r.dormir, aLaPar: () => (miradas++, true), coronada: new Promise(() => undefined) }).then((x) => (abierta = x));
    await r.avanzar(7_000);
    expect(abierta).toBe("");
    expect(miradas).toBe(0);
    await r.avanzar(1_000);
    expect(abierta).toBe("a-la-par");
    expect(miradas).toBe(1);
  });

  it("sin la par, espera a que la sala muestre quién gana", async () => {
    const r = reloj();
    let coronar: () => void = () => undefined;
    let abierta = "";
    void puertaDeLaGrabacion({ conEspectadores: true, grabable: 8, ahora: r.ahora, dormir: r.dormir, aLaPar: () => false, coronada: new Promise<void>((c) => (coronar = c)) }).then((x) => (abierta = x));
    await r.avanzar(30_000);
    expect(abierta).toBe("");
    coronar();
    await r.avanzar(0);
    expect(abierta).toBe("tras-la-corona");
  });

  it("si la sala ya mostró quién gana antes de que la cadena acepte (sin show), se abre con eso", async () => {
    const r = reloj();
    const p = puertaDeLaGrabacion({ conEspectadores: true, grabable: 8, ahora: r.ahora, dormir: r.dormir, aLaPar: () => false, coronada: Promise.resolve() });
    expect(await p).toBe("tras-la-corona");
  });
});
