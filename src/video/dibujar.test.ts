import { describe, expect, it } from "vitest";
import { dibujarCuadro, VERIFICACION_EN, VERIFICACION_ES } from "./dibujar";
import { planDeShow, type PlanVideo } from "./plan";

/**
 * Un contexto 2D falso: anota cada llamada y cada propiedad puesta, para
 * mirar qué se dibujó sin un navegador. Solo para las pruebas.
 */
function ctxFalso() {
  const log: Array<[string, unknown[]]> = [];
  const ctx = {
    canvas: { width: 720, height: 1280 },
    set fillStyle(v: string | CanvasGradient) { log.push(["fillStyle", [v]]); },
    set strokeStyle(v: string | CanvasGradient) { log.push(["strokeStyle", [v]]); },
    set font(v: string) { log.push(["font", [v]]); },
    set textAlign(v: string) { log.push(["textAlign", [v]]); },
    set textBaseline(v: string) { log.push(["textBaseline", [v]]); },
    set globalAlpha(v: number) { log.push(["globalAlpha", [v]]); },
    set lineWidth(v: number) { log.push(["lineWidth", [v]]); },
    set lineJoin(v: string) { log.push(["lineJoin", [v]]); },
    measureText(t: string) { log.push(["measureText", [t]]); return { width: t.length * 12 }; },
    fillRect(...a: unknown[]) { log.push(["fillRect", a]); },
    strokeRect(...a: unknown[]) { log.push(["strokeRect", a]); },
    roundRect(...a: unknown[]) { log.push(["roundRect", a]); },
    fillText(...a: unknown[]) { log.push(["fillText", a]); },
    strokeText(...a: unknown[]) { log.push(["strokeText", a]); },
    beginPath(...a: unknown[]) { log.push(["beginPath", a]); },
    closePath(...a: unknown[]) { log.push(["closePath", a]); },
    moveTo(...a: unknown[]) { log.push(["moveTo", a]); },
    lineTo(...a: unknown[]) { log.push(["lineTo", a]); },
    arc(...a: unknown[]) { log.push(["arc", a]); },
    fill(...a: unknown[]) { log.push(["fill", a]); },
    stroke(...a: unknown[]) { log.push(["stroke", a]); },
    save(...a: unknown[]) { log.push(["save", a]); },
    restore(...a: unknown[]) { log.push(["restore", a]); },
    drawImage(...a: unknown[]) { log.push(["drawImage", a]); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const textos = (log: Array<[string, unknown[]]>): string[] => log.filter(([m]) => m === "fillText").map(([, a]) => String(a[0]));

const ronda = {
  nombres: ["Ana", "Beto", "Carla", "Diego", "Elena", "Franco", "Gabriela", "Hugo"],
  ganador: "Beto",
  seed: 12345,
  enlace: "https://tinkazo.app/verificar#e1-comprobante-de-prueba",
  premio: "Una polera",
  titulo: "Sorteo de la feria",
};

function plan(): PlanVideo {
  return planDeShow(ronda);
}

describe("el dibujo de un cuadro del video", () => {
  it("dibuja los nombres que corren en la escena del show", () => {
    const { ctx, log } = ctxFalso();
    const p = plan();
    dibujarCuadro(ctx, p, p.escenas.find((e) => e.id === "show")!.desde + 5, {});
    const t = textos(log).join(" | ");
    for (const i of p.laneDe) expect(t).toContain(ronda.nombres[i]);
  });

  it("en la escena del cartel dice quién ganó", () => {
    const { ctx, log } = ctxFalso();
    const p = plan();
    dibujarCuadro(ctx, p, p.escenas.find((e) => e.id === "cartel")!.desde + 10, {});
    expect(textos(log).join(" | ")).toContain("Beto");
  });

  it("cierra con «Verificalo vos», su par en inglés y el enlace para comprobar", () => {
    const { ctx, log } = ctxFalso();
    const p = plan();
    const cierre = p.escenas.find((e) => e.id === "cierre")!;
    dibujarCuadro(ctx, p, cierre.desde + 5, {});
    const t = textos(log).join(" | ");
    expect(t).toContain(VERIFICACION_ES);
    expect(t).toContain(VERIFICACION_EN);
    expect(t).toContain(ronda.enlace);
  });

  it("pone el QR del comprobante cuando se le da uno", () => {
    const { ctx, log } = ctxFalso();
    const p = plan();
    const cierre = p.escenas.find((e) => e.id === "cierre")!;
    const qr = { width: 100, height: 100 } as unknown as CanvasImageSource;
    dibujarCuadro(ctx, p, cierre.desde + 5, { qr });
    expect(log.some(([m, a]) => m === "drawImage" && a[0] === qr)).toBe(true);
  });

  it("es reproducible: la misma ronda y el mismo cuadro dibujan lo mismo", () => {
    const a = ctxFalso();
    const b = ctxFalso();
    const p = plan();
    dibujarCuadro(a.ctx, p, 100, {});
    dibujarCuadro(b.ctx, p, 100, {});
    expect(a.log).toEqual(b.log);
  });

  it("rechaza un cuadro que no está en el plan", () => {
    const { ctx } = ctxFalso();
    const p = plan();
    expect(() => dibujarCuadro(ctx, p, -1, {})).toThrow();
    expect(() => dibujarCuadro(ctx, p, p.cuadros, {})).toThrow();
  });
});
