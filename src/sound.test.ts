// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ContextoFalso } from "./sonidos/audio-falso";
import { reanudarSiHaceFalta } from "./sound";

/**
 * El núcleo que no se corta: el iPhone nombra `interrupted` a su estado de contexto cortado (una llamada,
 * el ahorro de batería), y `src/sound.ts` solo reanudaba `suspended`: después de una interrupción el sorteo
 * entero corría mudo y nada lo volvía a prender. Acá se prueba la reanudación desde los dos estados y el camino
 * de la pestaña que vuelve a la vista, ejecutando el sonido de verdad y no leyendo el código.
 *
 * Esos dos cambios viven detrás del interruptor del adelgazado (`?musicagracia=1`), apagado por defecto: con él
 * apagado el sonido del show reanuda como siempre, solo desde `suspended`, y la pestaña que vuelve no toca nada.
 */

describe("reanudarSiHaceFalta", () => {
  it("un contexto suspendido se reanuda, como siempre", () => {
    const ctx = new ContextoFalso();
    ctx.state = "suspended";
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(ctx.state).toBe("running");
  });

  it("un contexto interrumpido (iPhone) también: acá estaba el hueco", () => {
    const ctx = new ContextoFalso();
    ctx.state = "interrupted";
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(ctx.state).toBe("running");
  });

  it("un contexto que ya está andando no se toca", () => {
    const ctx = new ContextoFalso();
    ctx.state = "running";
    const resume = vi.spyOn(ctx, "resume");
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(resume).not.toHaveBeenCalled();
  });

  it("un contexto cerrado no se reanuda (lanzaría o quedaría en nada)", () => {
    const ctx = new ContextoFalso();
    ctx.state = "closed";
    const resume = vi.spyOn(ctx, "resume");
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(resume).not.toHaveBeenCalled();
  });
});

/** Un sonido nuevo con un contexto falso en el estado dado, y el interruptor como se pida. */
async function sonidoConContexto(estado: string, prendido: boolean) {
  vi.resetModules();
  const ctx = new ContextoFalso();
  ctx.state = estado;
  const resume = vi.spyOn(ctx, "resume");
  const w = window as unknown as { AudioContext?: unknown };
  const ctorViejo = w.AudioContext;
  w.AudioContext = function () {
    return ctx;
  } as unknown;
  const margen = await import("./music-margen");
  margen.prenderAdelgazado(prendido);
  const sound = await import("./sound");
  return {
    ctx,
    resume,
    sound,
    limpiar: (): void => {
      w.AudioContext = ctorViejo;
      margen.prenderAdelgazado(null);
    },
  };
}

function volverALaVista(): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  delete (document as unknown as { visibilityState?: string }).visibilityState;
}

describe("el sonido del show con el interruptor apagado suena como en la rama principal", () => {
  it("un contexto suspendido se reanuda al sonar, como siempre", async () => {
    const t = await sonidoConContexto("suspended", false);
    try {
      t.sound.audio();
      expect(t.resume).toHaveBeenCalledTimes(1);
    } finally {
      t.limpiar();
    }
  });

  it("un contexto interrumpido no se toca: es el cambio nuevo y nadie lo escuchó", async () => {
    const t = await sonidoConContexto("interrupted", false);
    try {
      t.sound.audio();
      expect(t.resume).not.toHaveBeenCalled();
      expect(t.ctx.state).toBe("interrupted");
    } finally {
      t.limpiar();
    }
  });

  it("la pestaña que vuelve a la vista no reanuda nada, ni con un toque antes", async () => {
    const t = await sonidoConContexto("interrupted", false);
    try {
      t.sound.audio();
      t.sound.unlockAudioOnGesture();
      document.dispatchEvent(new Event("pointerdown"));
      t.resume.mockClear();
      t.ctx.state = "suspended";
      volverALaVista();
      expect(t.resume).not.toHaveBeenCalled();
    } finally {
      t.limpiar();
    }
  });
});

describe("el sonido del show con el interruptor prendido", () => {
  it("un contexto interrumpido (iPhone) se reanuda al sonar", async () => {
    const t = await sonidoConContexto("interrupted", true);
    try {
      t.sound.audio();
      expect(t.ctx.state).toBe("running");
    } finally {
      t.limpiar();
    }
  });

  it("al volver a la vista se reanuda un contexto interrumpido, y escondida no se toca", async () => {
    const t = await sonidoConContexto("running", true);
    try {
      t.sound.audio();
      t.sound.unlockAudioOnGesture();
      document.dispatchEvent(new Event("pointerdown"));
      t.ctx.state = "interrupted";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(t.ctx.state).toBe("interrupted");
      delete (document as unknown as { visibilityState?: string }).visibilityState;
      volverALaVista();
      expect(t.ctx.state).toBe("running");
    } finally {
      t.limpiar();
    }
  });

  it("un contexto armado de antemano que nunca vio un toque no se reanuda al volver a la vista", async () => {
    const t = await sonidoConContexto("running", true);
    try {
      t.sound.audio();
      t.ctx.state = "suspended";
      t.resume.mockClear();
      volverALaVista();
      expect(t.resume).not.toHaveBeenCalled();
    } finally {
      t.limpiar();
    }
  });

  it("después de un toque, un contexto suspendido sí se reanuda al volver a la vista", async () => {
    const t = await sonidoConContexto("running", true);
    try {
      t.sound.audio();
      t.sound.unlockAudioOnGesture();
      document.dispatchEvent(new Event("pointerdown"));
      t.ctx.state = "suspended";
      t.resume.mockClear();
      volverALaVista();
      expect(t.resume).toHaveBeenCalledTimes(1);
    } finally {
      t.limpiar();
    }
  });
});
