import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error El predicado del auditor se ejecuta también como JavaScript en WebKit.
import { comprobarMuestra, nombreFinalDe } from "../../../scripts/lib/ganador-altura-comprobaciones.mjs";
// @ts-expect-error Opciones del auditor, JavaScript sin tipos.
import { AYUDA, conMotor, leerOpciones, motorEfectivo, motorEnPagina } from "../../../scripts/lib/ganador-altura-opciones.mjs";
// @ts-expect-error Telemetría del auditor, JavaScript sin tipos.
import { LIMITE_MS, crearEsperas, progresoEnPagina, sondeo } from "../../../scripts/lib/ganador-altura-esperas.mjs";

type Check = { nombre: string; ok: boolean; rol?: string };
const GANADORA = "María Fernanda Guadalupe Quispe Mamani Zu";
const ANA = "Ana María de los Ángeles Condori Flores";

describe("identidad explícita del nombre final", () => {
  it("no asocia a 'Ana María …' con la ganadora 'María Fernanda …', ni como texto suelto ni como chip ajeno", () => {
    expect(nombreFinalDe(ANA, null, [GANADORA])).toBeNull();
    expect(nombreFinalDe(ANA, { rol: "chip", original: ANA }, [GANADORA])).toBeNull();
    expect(nombreFinalDe("Ana María de los…", { rol: "chip", original: ANA }, [GANADORA])).toBeNull();
  });
  it("reconoce el chip puente y el chip propio de la ganadora por su identidad, no por el texto dibujado", () => {
    expect(nombreFinalDe("María Fernanda Guadalupe\nQuispe Mamani Zu", { rol: "puente", original: GANADORA }, [GANADORA]))
      .toEqual({ original: GANADORA, rol: "puente" });
    expect(nombreFinalDe("María Fernanda Gu…", { rol: "chip", original: GANADORA }, [GANADORA]))
      .toEqual({ original: GANADORA, rol: "chip" });
  });
});

describe("solo las superficies del nombre final cuentan", () => {
  it("las inscripciones de los gajos no son nombre final, aunque igualen el nombre corto", () => {
    expect(nombreFinalDe("María Z.", null, [GANADORA])).toBeNull();
    expect(nombreFinalDe("María", null, ["María"])).toBeNull();
    expect(nombreFinalDe(GANADORA, null, [GANADORA])).toBeNull();
  });
  it("un rol desconocido no cuenta", () => {
    expect(nombreFinalDe(GANADORA, { rol: "decorado", original: GANADORA }, [GANADORA])).toBeNull();
  });

  // Muestra de la ruleta: cartel legible, cuatro gajos María Z. pegados al relator y Ana María en la lista.
  const caja = (x: number, y: number, w = 160, h = 30) => ({ x, y, w, h });
  const muestra = () => ({
    cuerpo: caja(100, 220, 180, 100), cartel: caja(100, 60, 180, 140), placaVisible: true,
    nombres: [{ original: GANADORA, texto: "María Fernanda Guadalupe\nQuispe Mamani Zu", caja: caja(110, 120, 160, 40),
      enCartel: true, letraCSS: 24, rol: "cartel" }] as Record<string, unknown>[],
    minimoLetra: 16, relator: caja(100, 400, 400, 100), viewport: { w: 1024, h: 560 },
    controles: [{ id: "st-skip", accesible: true }, { id: "st-sound", accesible: true }],
  });
  const dibujados = [
    ...[0, 1, 2, 3].map((i) => ({ texto: "María Z.", rotulo: null, caja: caja(120 + i * 40, 390, 40, 20) })),
    { texto: ANA, rotulo: { rol: "chip", original: ANA }, caja: caja(120, 395) },
    { texto: ANA, rotulo: null, caja: caja(120, 395) },
  ];

  it("la ruleta con gajos y otra María junto al relator no genera comprobaciones de nombre falsas", () => {
    const m = muestra();
    for (const d of dibujados) {
      const f = nombreFinalDe(d.texto, d.rotulo, [GANADORA]);
      if (f) m.nombres.push({ ...f, texto: d.texto, caja: d.caja, enCartel: false, letraCSS: 16 });
    }
    expect(m.nombres).toHaveLength(1);
    const checks: Check[] = comprobarMuestra(m);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.find((c) => c.nombre === "nombre 0 completo")?.rol).toBe("cartel");
  });
  it("el chip propio de la ganadora sigue exigiendo nombre completo y distancia al relator", () => {
    const m = muestra();
    const f = nombreFinalDe("María Fernanda Gu…", { rol: "chip", original: GANADORA }, [GANADORA]);
    m.nombres.push({ ...f, texto: "María Fernanda Gu…", caja: caja(120, 380), enCartel: false, letraCSS: 16 });
    const fallas = comprobarMuestra(m).filter((c: Check) => !c.ok).map((c: Check) => c.nombre);
    expect(fallas).toEqual(expect.arrayContaining(["nombre 1 completo", "nombre 1 separado del relator"]));
  });
});

describe("--motor 2d|3d", () => {
  it("2d fuerza motor=pixi y 3d fuerza motor=3d, conservando parámetros y hash", () => {
    const url = "http://127.0.0.1:5185/?lead=3&pace=rapido&grande=0&auditar=camara&lang=es#sortear";
    expect(conMotor(url, "2d")).toBe("http://127.0.0.1:5185/?lead=3&pace=rapido&grande=0&auditar=camara&lang=es&motor=pixi#sortear");
    expect(conMotor(url, "3d")).toBe("http://127.0.0.1:5185/?lead=3&pace=rapido&grande=0&auditar=camara&lang=es&motor=3d#sortear");
    expect(conMotor("http://x/?motor=3d&a=1", "2d")).toBe("http://x/?motor=pixi&a=1");
  });
  it("el motor efectivo sale de lo que vio la página", () => {
    expect(motorEfectivo(["3d", "3d"])).toBe("3d");
    expect(motorEfectivo(["2d"])).toBe("2d");
    expect(motorEfectivo(["2d", "3d"])).toBe("mixto");
    expect(motorEfectivo([null, null])).toBe("sin-show");
    expect(motorEfectivo([])).toBe("sin-show");
  });
  it("lee el canvas 3D visible antes que el de Pixi", () => {
    const doc = (ids: string[]) => ({ getElementById: (id: string) => ids.includes(id)
      ? { isConnected: true, getClientRects: () => [1] } : null });
    const estilo = () => ({ display: "block", visibility: "visible" });
    const leer = (ids: string[]) => Function("document", "getComputedStyle", `return (${motorEnPagina})()`)(doc(ids), estilo);
    expect(leer(["tres-canvas", "pixi-canvas"])).toBe("3d");
    expect(leer(["pixi-canvas"])).toBe("2d");
    expect(leer([])).toBeNull();
  });
  it("lee --motor, con 2d por defecto, y rechaza valores ajenos o 3d con --fase estadio", () => {
    expect(leerOpciones([]).motor).toBe("2d");
    expect(leerOpciones(["--motor", "3d", "--fase", "estadio-lista"]).motor).toBe("3d");
    expect(() => leerOpciones(["--motor", "webgl"])).toThrow("--motor: valor no válido webgl");
    expect(() => leerOpciones(["--motor", "3d"])).toThrow("--fase estadio fuerza motor=pixi; --motor 3d requiere estadio-lista o resultado");
  });
  it("preserva los valores por defecto y los errores existentes", () => {
    const o = leerOpciones([]);
    expect(o).toMatchObject({ ayuda: false, base: "http://127.0.0.1:5185", out: ".evidence/arreglos-sorteos/antes",
      vistas: ["1024x521", "1024x560", "1024x600", "390x560"], fase: "estadio", comprobar: false, relator: "original",
      nombres: "largos", lang: "es", movimiento: "normal", dispositivo: "viewport" });
    expect(o.juegos.length).toBeGreaterThan(0);
    expect(leerOpciones(["--help"]).ayuda).toBe(true);
    expect(() => leerOpciones(["--comprobar"])).toThrow("--comprobar requiere --fase estadio-lista");
    expect(() => leerOpciones(["--lang", "en"])).toThrow("Los controles de matriz requieren --comprobar");
    expect(() => leerOpciones(["--juegos", "x"])).toThrow("Juego o viewport no válido");
    expect(() => leerOpciones(["--out", "/tmp/x"])).toThrow("--out debe estar dentro de .evidence/arreglos-sorteos");
    expect(() => leerOpciones(["--fase", "estadio-lista", "--comprobar", "--lang", "en"])).toThrow("--relator original requiere --lang es");
  });
  it("--help documenta --motor y sale sin abrir el navegador", () => {
    expect(AYUDA).toContain("--motor M        2d|3d (2d)");
    const r = spawnSync(process.execPath, ["scripts/audit-ganador-altura.mjs", "--help"],
      { encoding: "utf8", env: { ...process.env, PLAYWRIGHT_PATH: "/no/existe" } });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe(AYUDA.trim());
    expect(r.stdout).toContain("--movimiento M   normal|reduce (normal)");
  });
});

describe("telemetría de las esperas de 40 s", () => {
  it("no sube el límite de 40 s", () => expect(LIMITE_MS).toBe(40000));
  it("registra inicio, fin y el progreso de la página al terminar bien", async () => {
    let t = 1000;
    const e = crearEsperas({ ahora: () => t });
    const pagina = [{ cuadro: 10, ahora: 50 }, { cuadro: 90, ahora: 1550, sondeos: 15 }];
    await e.esperar("placa", LIMITE_MS, async (ms: number) => { expect(ms).toBe(40000); t += 1500; }, async () => pagina.shift());
    expect(e.registros).toEqual([{ nombre: "placa", limiteMs: 40000, inicio: 1000, fin: 2500, duracionMs: 1500, ok: true,
      error: null, paginaInicio: { cuadro: 10, ahora: 50 }, paginaFin: { cuadro: 90, ahora: 1550, sondeos: 15 } }]);
  });
  it("en un timeout conserva el error, adjunta las esperas y distingue una página que no responde", async () => {
    let t = 0;
    const e = crearEsperas({ ahora: () => t, lecturaMs: 5 });
    let lecturas = 0;
    const error = await e.esperar("placa", LIMITE_MS, async () => { t += 40000; throw new Error("Timeout 40000ms exceeded"); },
      () => (lecturas++ ? new Promise(() => {}) : Promise.resolve({ cuadro: 3 }))).catch((x: Error) => x);
    expect(String(error)).toContain("Timeout 40000ms exceeded");
    expect((error as Error & { esperas: unknown }).esperas).toBe(e.registros);
    expect(e.registros[0]).toMatchObject({ nombre: "placa", ok: false, duracionMs: 40000, error: "Error: Timeout 40000ms exceeded",
      paginaInicio: { cuadro: 3 }, paginaFin: { sinRespuesta: true, esperaMs: 5 } });
  });
  it("cuenta cada sondeo en la página y guarda la hora del último", () => {
    const window: Record<string, unknown> = { listo: false };
    let ahora = 10;
    const evaluar = () => Function("window", "performance", `return ${sondeo("placa", () => (window as { listo: boolean }).listo)}`)(
      window, { now: () => ahora });
    // La función se serializa: dentro de la página `window` es el global, aquí el falso.
    expect(evaluar()).toBe(false);
    ahora = 20; window.listo = true;
    expect(evaluar()).toBe(true);
    expect((window.__esperas as Record<string, unknown>).placa).toEqual({ sondeos: 2, primerSondeo: 10, ultimoSondeo: 20 });
    const progreso = Function("window", "performance", "document", "getComputedStyle", `return (${progresoEnPagina})("placa")`)(
      { ...window, __altura: { leerCuadro: () => 7, ultima: () => ({ muestras: 1, ultimaMuestra: { timestamp: 5, tiempo: 1.5, placaVisible: true } }) } },
      { now: () => 30 }, { getElementById: () => null }, () => ({}));
    expect(progreso).toEqual({ ahora: 30, cuadro: 7, muestras: 1, ultimaMuestra: { timestamp: 5, tiempo: 1.5, placaVisible: true },
      sondeos: 2, primerSondeo: 10, ultimoSondeo: 20, motor: null });
  });
});

describe("marca de rol en stage.ts: solo con ?auditar=camara", () => {
  const source = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
  it("crea el registro de rótulos solo para el auditor de cámara y lo publica en __tinkazo", () => {
    expect(source).toMatch(/const rotulos = auditaCon\("camara"\) \? new WeakMap<Text, \{ rol: "puente" \| "chip"; original: string \}>\(\) : null;/);
    expect(source).toMatch(/rotulos\?\.set\(label, \{ rol: completo \? "puente" : "chip", original: faceOf \}\);/);
    expect(source).toMatch(/rotuloDe: \(n: unknown\) => rotulos\?\.get\(n as Text\) \?\? null/);
  });
});
