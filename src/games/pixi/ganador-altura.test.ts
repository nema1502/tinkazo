import { describe, expect, it } from "vitest";
import { ajusteGanador, desplazamientoParaPiso, ENTRADA_RELATOR, reservaRelator } from "./ganador-altura";
// @ts-expect-error El predicado del auditor se ejecuta también como JavaScript en WebKit.
import { comprobarMuestra, comprobarSecuencia, esNombreDelCartel, comprobarAccesoPublico, comprobarNombreFinal } from "../../../scripts/lib/ganador-altura-comprobaciones.mjs";

describe("el cuerpo ganador delante del relator, sin cambiar su tamaño", () => {
  it("corrige solo los 10,93 px faltantes del RED real del Teleférico", () => {
    const cuerpo = { y: 318.27812306081967, h: 109.74566319538053 };
    const piso = 421.09375 - 4;
    const dy = desplazamientoParaPiso(cuerpo, piso);
    expect(dy).toBeCloseTo(-10.930036256200196, 9);
    expect(cuerpo.y + dy + cuerpo.h).toBeCloseTo(piso, 9);
    expect(cuerpo).toEqual({ y: 318.27812306081967, h: 109.74566319538053 });
  });

  it("usa el piso real también en alturas vecinas, no una reserva fija", () => {
    for (const alto of [520, 521, 560, 600, 601]) {
      const cuerpo = { y: alto - 160, h: 100 };
      const piso = alto - 140 - 4;
      expect(cuerpo.y + desplazamientoParaPiso(cuerpo, piso) + cuerpo.h).toBe(piso);
    }
  });

  it("preserva la posición cuando ya cabe, incluido el sostén del RED", () => {
    expect(desplazamientoParaPiso({ y: 308.1293, h: 80.7925 }, 421.09375 - 4)).toBe(0);
    expect(desplazamientoParaPiso({ y: 100, h: 50 }, 150)).toBe(0);
  });
});

describe("reserva durante la animación real del relator (job64)", () => {
  it("conserva cuatro píxeles aunque el compositor avance entre ambas lecturas", () => {
    // Cinco diferencias posrender de NHrvmG, sin relajar el predicado observable.
    const gaps = [3.3983154296875, 3.89453125, 3.993652343750057, 3.79931640625027, 3.996459960937372];
    const reserva = reservaRelator(112.90625 * .92, true);
    for (const gap of gaps) expect(gap + reserva).toBeGreaterThanOrEqual(4);
  });
  it("cubre la excursión completa desde scale(.92) hasta el pico real del Bézier", () => {
    expect(ENTRADA_RELATOR).toEqual({ duracion: 280, escalas: [.92, 1], curva: [.34, 1.56, .64, 1] });
    const h = 112.90625;
    const t = 1.56 / (3 * 1.56 - 2);
    const progresoMax = 3 * (1 - t) ** 2 * t * 1.56 + 3 * (1 - t) * t * t + t ** 3;
    const scaleMax = .92 + .08 * progresoMax;
    const viaje = h * (scaleMax - .92) / 2;
    expect(reservaRelator(h * .92, true)).toBeCloseTo(viaje, 10);
    expect(reservaRelator(h * scaleMax, true)).toBeLessThanOrEqual(viaje * scaleMax / .92 + 1e-10);
  });
  it("no reserva espacio cuando la animación ya terminó o no existe", () => {
    expect(reservaRelator(112.90625, false)).toBe(0);
  });
});

describe("identidad y acceso público, sin habilitar controles ocultos", () => {
  it("reconoce por uid la etiqueta del cartel y no un chip externo", () => {
    expect(esNombreDelCartel(42, [42])).toBe(true);
    expect(esNombreDelCartel(43, [42])).toBe(false);
  });
  const acceso = () => ({ accesible: true, visible: true, proof: { names: ["Carlos", "Ana"], round: 12, signature: "firma-real" },
    resultado: { names: ["Carlos", "Ana"], beacon: { round: 12, signature: "firma-real" }, winners: [0] }, lista: "Carlos Ana", pasos: "ronda12 y huella" });
  it("acepta información pública fiel sin exigir un ancla inexistente", () => {
    const checks = comprobarAccesoPublico(acceso());
    expect(checks.length).toBeGreaterThan(2);
    expect(checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });
  it("rechaza acceso oculto, comprobante sustituido o información ausente", () => {
    const a = acceso(); a.accesible = false; a.proof.round = 13; a.lista = ""; a.pasos = "";
    expect(comprobarAccesoPublico(a).filter((c: { ok: boolean }) => !c.ok).length).toBe(3);
  });
});

describe("encuadre local del RED real job59", () => {
  it("cabe entre ambos límites aunque la traslación sola sea imposible", () => {
    // Piñata521, cuadro420: cuerpo284px vs banda159px, no un proxy de halo.
    const cuerpo = { x: 407.63272576999157, y: 93.55616742208122, w: 204.12266889204716, h: 284.4438325779188 };
    const zona = { x0: 2, y0: 215.01177967212172 + 4, x1: 1022, y1: 382.09375 - 4 };
    const a = ajusteGanador(cuerpo, zona);
    expect(a.s).toBeLessThan(1);
    expect(a.caja.y).toBeCloseTo(zona.y0, 8);
    expect(a.caja.y + a.caja.h).toBeCloseTo(zona.y1, 8);
    expect(a.caja.w / cuerpo.w).toBeCloseTo(a.caja.h / cuerpo.h, 8);
  });
  it("corrige el piso transformado fraccional sin alejar cuando cabe", () => {
    const cuerpo = { x: 440, y: 310, w: 140, h: 107 };
    const a = ajusteGanador(cuerpo, { x0: 2, y0: 230, x1: 1022, y1: 420.658691 - 4 });
    expect(a.s).toBe(1);
    expect(a.caja.y + a.caja.h).toBeCloseTo(416.658691, 8);
  });
  it("preserva tamaño y posición cuando ya cabe", () => {
    const cuerpo = { x: 400, y: 260, w: 140, h: 100 };
    expect(ajusteGanador(cuerpo, { x0: 2, y0: 230, x1: 1022, y1: 400 })).toEqual({ s: 1, dx: 0, dy: 0, caja: cuerpo });
  });
});

describe("regresión de cada cuadro visible, no solo piso/viewport", () => {
  const caja = (y: number, h: number) => ({ x: 100, y, w: 180, h });
  const muestra = () => ({
    cuerpo: caja(220, 100), cartel: caja(60, 140),
    nombres: [{ original: "Rodrigo Sebastián Flores Mamani", texto: "Rodrigo Sebastián\nFlores Mamani", caja: caja(120, 40), enCartel: true, letraCSS: 24 }],
    minimoLetra: 16, placaVisible: true, relator: caja(400, 100), viewport: { w: 1024, h: 560 },
    frase: "¡EL TINKAZO ES PARA Rodrigo Sebastián Flores Mamani!",
    fixture: "¡EL TINKAZO ES PARA Rodrigo Sebastián Flores Mamani!",
    controles: [{ id: "st-skip", accesible: true }, { id: "st-sound", accesible: true }],
  });
  const falla = (m: ReturnType<typeof muestra>, nombre: string) =>
    comprobarMuestra(m).some((c: { nombre: string; ok: boolean }) => c.nombre === nombre && !c.ok);

  it("rechaza letra pequeña aunque el nombre completo quepa y admite una copia legible durante el pop", () => {
    const m = muestra();
    m.nombres[0]!.letraCSS = 11.1147;
    expect(falla(m, "nombre completo legible")).toBe(true);
    m.nombres.push({ ...m.nombres[0]!, letraCSS: 16 });
    expect(falla(m, "nombre completo legible")).toBe(false);
  });

  it("detecta el caramelo detrás del cartel aunque quepa sobre el relator", () => {
    const m = muestra(); m.cuerpo = caja(180, 100);
    expect(falla(m, "cuerpo separado del cartel")).toBe(true);
  });
  it("detecta el piso y un nombre truncado o recortado", () => {
    const m = muestra(); m.cuerpo = caja(310, 100);
    m.nombres[0]!.texto = "Rodrigo…"; m.nombres[0]!.caja = caja(-1, 40);
    expect(falla(m, "cuerpo separado del relator")).toBe(true);
    expect(falla(m, "nombre 0 completo")).toBe(true);
    expect(falla(m, "nombre 0 entero en viewport")).toBe(true);
  });
  it("rechaza silueta, nombre, controles o frase ausentes, sin saltarlos", () => {
    const m = muestra(); m.cuerpo.h = 0; m.nombres = []; m.controles = []; m.frase = "¡GANA!";
    for (const n of ["cuerpo medible", "nombre presente", "controles accesibles", "frase exacta"]) expect(falla(m, n)).toBe(true);
  });
  it("preserva el caso que cabe, incluido nombre dentro de su propio cartel", () => {
    const checks = comprobarMuestra(muestra());
    expect(checks.length).toBeGreaterThan(10);
    expect(checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("rechaza falta de muestras, huecos, reloj inválido o sostén ausente", () => {
    const cuadro = (n: number) => ({ cuadro: n, timestamp: n * 16, tiempo: n / 60, placaVisible: true, corona: { tiempoCartel: 2 } });
    for (const muestras of [[], [cuadro(1), cuadro(3), cuadro(4)],
      [cuadro(1), { ...cuadro(2), tiempo: NaN }, cuadro(3)],
      [cuadro(1), cuadro(2), { ...cuadro(3), corona: null }]]) {
      expect(comprobarSecuencia({ muestras, fallos: [], ultimoCuadro: 3 }, false).some((c: { ok: boolean }) => !c.ok)).toBe(true);
    }
  });
  it("acepta reducción sin show, pero no la usa para ocultar renders perdidos", () => {
    expect(comprobarSecuencia({ muestras: [], fallos: [], ultimoCuadro: 0 }, true).every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(comprobarSecuencia({ muestras: [], fallos: [], ultimoCuadro: 1 }, true).some((c: { ok: boolean }) => !c.ok)).toBe(true);
  });
});


// @ts-expect-error El criterio se serializa también dentro del observador WebKit.
import { valorCapturaFinal } from "../../../scripts/lib/ganador-altura-transicion.mjs";

describe("captura final sin una copia completa por render", () => {
  it("selecciona un solo sostén estable y ninguno antes de que exista", () => {
    const renders = [
      { placaVisible: false, tiempoCartel: -.3 },
      { placaVisible: true, tiempoCartel: 1.699 },
      { placaVisible: true, tiempoCartel: 1.7 },
      { placaVisible: true, tiempoCartel: 1.8 },
      { placaVisible: true, tiempoCartel: 2.1 },
    ];
    const seleccionar = (estados: typeof renders) => {
      let mejor = Infinity;
      const cuadros: number[] = [];
      for (const [i, corona] of estados.entries()) {
        const valor = valorCapturaFinal(corona, 100 + i * 16);
        if (!Number.isFinite(valor) || valor >= mejor) continue;
        mejor = valor; cuadros.push(i);
      }
      return cuadros;
    };
    expect(seleccionar(renders)).toEqual([2]);
    expect(seleccionar(renders.slice(0, 2))).toEqual([]);
  });
});

describe("resultado final delante de la barra fija (B3)", () => {
  it("rechaza la oclusión aun dentro del viewport, preserva scroll seguro y la regla previa sin barra", () => {
    const nombre = "Maximiliano Alexander Constantino Rosales";
    const final = { nombre, esperado: nombre, sinRecorte: true,
      caja: { x: 77.4883, y: 180.31396484375, w: 166.5418, h: 256.10205078125 },
      viewport: { w: 320, h: 521 } };
    const barra = { x: 0, y: 394.5, w: 320, h: 126.5 };
    expect(comprobarNombreFinal(final, barra)).toBe(false);
    expect(comprobarNombreFinal({ ...final, caja: { ...final.caja, y: final.caja.y - 46 } }, barra)).toBe(true);
    expect(comprobarNombreFinal(final, null)).toBe(true);
  });
});
