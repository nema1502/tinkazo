import { describe, expect, it } from "vitest";
import { ALTO_VIDEO, ANCHO_VIDEO, FPS_VIDEO, planDeShow, type RondaVideo } from "./plan";

const ronda = (sobre: Partial<RondaVideo> = {}): RondaVideo => ({
  nombres: ["Ana", "Beto", "Carla", "Diego", "Elena", "Franco", "Gabriela", "Hugo"],
  ganador: "Beto",
  seed: 12345,
  enlace: "https://tinkazo.app/verificar#e1-comprobante-de-prueba-con-nombres-y-cuenta-para-el-qr-del-video",
  premio: "Una polera",
  titulo: "Sorteo de la feria",
  ...sobre,
});

/** El plan del show en video: lo que se dibuja, cuadro a cuadro, sin navegador. */
describe("el plan de cuadros del video del sorteo", () => {
  it("es vertical 720x1280 a 30 cuadros por segundo", () => {
    const p = planDeShow(ronda());
    expect(p.ancho).toBe(ANCHO_VIDEO);
    expect(ANCHO_VIDEO).toBe(720);
    expect(p.alto).toBe(ALTO_VIDEO);
    expect(ALTO_VIDEO).toBe(1280);
    expect(p.fps).toBe(FPS_VIDEO);
    expect(FPS_VIDEO).toBe(30);
  });

  it("dura entre 20 y 30 segundos, en escenas que empiezan donde termina la anterior", () => {
    const p = planDeShow(ronda());
    expect(p.segundos).toBeGreaterThanOrEqual(20);
    expect(p.segundos).toBeLessThanOrEqual(30);
    expect(p.escenas.map((e) => e.id)).toEqual(["entrada", "show", "cartel", "cierre"]);
    let esperado = 0;
    for (const e of p.escenas) {
      expect(e.desde).toBe(esperado);
      expect(e.cuadros).toBe(Math.round(e.segundos * p.fps));
      esperado += e.cuadros;
    }
    expect(p.cuadros).toBe(esperado);
    expect(p.cuadros).toBe(Math.round(p.segundos * p.fps));
  });

  it("es reproducible: la misma ronda da el mismo plan cuadro por cuadro", () => {
    expect(planDeShow(ronda())).toEqual(planDeShow(ronda()));
    // Y con otra semilla, algo cambia: el orden de los carriles.
    expect(planDeShow(ronda({ seed: 999 })).laneDe).not.toEqual(planDeShow(ronda({ seed: 1 })).laneDe);
  });

  it("pone al ganador en el primer carril y a los demás en un orden sembrado", () => {
    const p = planDeShow(ronda());
    const i = ronda().nombres.indexOf("Beto");
    expect(p.laneDe[0]).toBe(i);
    expect(p.laneDe).toHaveLength(p.carriles);
    // Sin repetidos y todos dentro de la lista.
    expect(new Set(p.laneDe).size).toBe(p.laneDe.length);
    for (const idx of p.laneDe) expect(ronda().nombres[idx]).toBeDefined();
  });

  it("corren como mucho seis, y menos si la lista es chiquita", () => {
    expect(planDeShow(ronda()).carriles).toBe(6);
    const dos = planDeShow(ronda({ nombres: ["Ana", "Beto"] }));
    expect(dos.carriles).toBe(2);
    expect(dos.laneDe).toEqual([1, 0]);
  });

  it("da un dato de carrera por cuadro del show, con posiciones de 0 a 1", () => {
    const p = planDeShow(ronda());
    const show = p.escenas.find((e) => e.id === "show");
    expect(show).toBeDefined();
    expect(p.show).toHaveLength(show!.cuadros);
    for (const c of p.show) {
      expect(c.posiciones).toHaveLength(p.carriles);
      for (const pos of c.posiciones) {
        expect(pos).toBeGreaterThanOrEqual(0);
        expect(pos).toBeLessThanOrEqual(1);
      }
      expect(c.tension).toBeGreaterThanOrEqual(0);
      expect(c.tension).toBeLessThanOrEqual(1);
    }
  });

  it("arranca en la largada y termina con el ganador primero en la meta", () => {
    const p = planDeShow(ronda());
    const primero = p.show[0]!;
    const ultimo = p.show[p.show.length - 1]!;
    expect(primero.q).toBe(0);
    expect(ultimo.q).toBeCloseTo(1, 5);
    const maxUltimo = Math.max(...ultimo.posiciones);
    expect(ultimo.posiciones[0]).toBeCloseTo(maxUltimo, 9);
    expect(ultimo.posiciones[0]).toBeCloseTo(1, 5);
    // En la recta final (último 10 % del show) el ganador ya va primero.
    const recta = p.show[Math.floor(p.show.length * 0.9)]!;
    expect(recta.posiciones[0]).toBe(Math.max(...recta.posiciones));
  });

  it("rechaza una ronda sin nombres, sin el ganador en la lista o sin enlace", () => {
    expect(() => planDeShow(ronda({ nombres: [] }))).toThrow();
    expect(() => planDeShow(ronda({ ganador: "Zoila" }))).toThrow();
    expect(() => planDeShow(ronda({ enlace: "" }))).toThrow();
  });
});
