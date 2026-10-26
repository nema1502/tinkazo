import { describe, expect, it } from "vitest";
import {
  AUDITORES,
  agrupar,
  buscarAuditor,
  contar,
  correrEnPool,
  duracion,
  estimarSegundos,
  formatearResumen,
  informeDe,
  ordenar,
  planDe,
  resumenDeBateria,
} from "./bateria.mjs";
import { FUERA_DEL_SELECTOR, SELECTOR } from "./juegos.mjs";

const ids = (plan) => plan.map((t) => t.id);
const auditores = (plan) => [...new Set(plan.map((t) => t.auditor))];

describe("qué corre la batería", () => {
  it("por defecto, todo lo de nivel `siempre`, sin mezcla ni física", () => {
    const a = auditores(planDe());
    expect(a).toContain("audit-ui");
    expect(a).toContain("smoke");
    expect(a).not.toContain("audit-mezcla");
    expect(a).not.toContain("audit-fisica");
  });

  it("la mezcla solo con --noche y la física solo con --fisica", () => {
    expect(auditores(planDe({ noche: true }))).toContain("audit-mezcla");
    expect(auditores(planDe({ noche: true }))).not.toContain("audit-fisica");
    expect(auditores(planDe({ fisica: true }))).toContain("audit-fisica");
    expect(auditores(planDe({ fisica: true }))).not.toContain("audit-mezcla");
  });

  it("los que miran juegos corren los diez del selector, nunca los que salieron", () => {
    const plan = planDe();
    const game = plan.filter((t) => t.auditor === "audit-game").map((t) => t.objetivo);
    expect(game).toEqual(SELECTOR);
    const rigor = plan.filter((t) => t.auditor === "audit-rigor");
    expect(rigor).toHaveLength(1);
    expect(rigor[0].args[0]).toBe("todos");
    for (const t of plan) for (const f of FUERA_DEL_SELECTOR) expect(t.args).not.toContain(f);
  });

  it("--todos-los-juegos suma los que salieron, uno por corrida", () => {
    const plan = planDe({ todosLosJuegos: true });
    const game = plan.filter((t) => t.auditor === "audit-game").map((t) => t.objetivo);
    expect(game).toEqual([...SELECTOR, ...FUERA_DEL_SELECTOR]);
    const rigor = plan.filter((t) => t.auditor === "audit-rigor").map((t) => t.objetivo);
    expect(rigor).toEqual(["todos", "tombola", "pasanaku", "stellar"]);
  });

  it("--solo acepta el nombre entero o corto y corre ese nivel aunque sea de noche", () => {
    expect(auditores(planDe({ solo: ["smoke", "ui", "paginas", "mezcla"] })).sort()).toEqual(["audit-mezcla", "audit-ui", "check-paginas", "smoke"]);
    expect(() => planDe({ solo: ["nada"] })).toThrow(/no conozco el auditor nada/);
    expect(buscarAuditor("rigor").id).toBe("audit-rigor");
    expect(buscarAuditor("no-existe")).toBeNull();
  });

  it("--juegos corre cada auditor de juegos una vez por juego pedido", () => {
    const plan = planDe({ solo: ["audit-game", "audit-rigor"], juegos: ["trompo", "oruro"] });
    expect(ids(plan).sort()).toEqual(["audit-game:oruro", "audit-game:trompo", "audit-rigor:oruro", "audit-rigor:trompo"]);
    expect(plan.find((t) => t.id === "audit-rigor:oruro").args.slice(0, 1)).toEqual(["oruro"]);
  });

  it("cada corrida pide --json al final, el juego primero y la base donde corresponde", () => {
    const plan = planDe({ base: "http://localhost:4180" });
    for (const t of plan) expect(t.args.at(-1)).toBe("--json");
    expect(plan.find((t) => t.id === "audit-game:race").args).toEqual(["race", "--base", "http://localhost:4180", "--json"]);
    expect(plan.find((t) => t.id === "smoke").args[0]).toBe("http://localhost:4180/?demo=wheel&instant=1&lead=3");
    expect(plan.find((t) => t.id === "check-lore").args).toEqual(["--json"]);
    expect(plan.find((t) => t.id === "audit-flujo").args).toEqual(["--base", "http://localhost:4180", "--temas", "dark", "--json"]);
    expect(planDe({ noche: true, base: "http://x" }).find((t) => t.id === "audit-flujo").args).toContain("dark,light");
  });

  it("el catálogo no repite ids ni scripts", () => {
    expect(new Set(AUDITORES.map((a) => a.id)).size).toBe(AUDITORES.length);
    expect(new Set(AUDITORES.map((a) => a.script)).size).toBe(AUDITORES.length);
  });

  it("primero lo que no abre Chrome, después lo más largo, al final lo exclusivo", () => {
    const o = ordenar([
      { id: "sonido", chrome: true, exclusivo: true, estimado: 500 },
      { id: "corto", chrome: true, exclusivo: false, estimado: 10 },
      { id: "texto", chrome: false, exclusivo: false, estimado: 2 },
      { id: "largo", chrome: true, exclusivo: false, estimado: 900 },
    ]);
    expect(o.map((t) => t.id)).toEqual(["texto", "largo", "corto", "sonido"]);
  });

  it("cuenta corridas y Chromes, y estima el tiempo con dos a la vez", () => {
    const plan = planDe();
    const c = contar(plan);
    expect(c.corridas).toBe(plan.length);
    expect(c.chromes).toBe(plan.filter((t) => t.chrome).length);
    expect(estimarSegundos(plan, 2)).toBeLessThan(estimarSegundos(plan, 1));
    expect(estimarSegundos(plan, 1)).toBeLessThanOrEqual(c.segundos + 1);
  });
});

describe("el pool", () => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  it("nunca corre más de `paralelo` a la vez y entrega las dos ranuras", async () => {
    let ahora = 0;
    let maximo = 0;
    const ranuras = new Set();
    const tareas = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, exclusivo: false }));
    const res = await correrEnPool(tareas, 2, async (t, ranura) => {
      ahora++;
      maximo = Math.max(maximo, ahora);
      ranuras.add(ranura);
      await espera(15);
      ahora--;
      return t.id;
    });
    expect(res.sort()).toEqual(tareas.map((t) => t.id).sort());
    expect(maximo).toBe(2);
    expect([...ranuras].sort()).toEqual([0, 1]);
  });

  it("una tarea exclusiva corre sola: nadie antes sigue corriendo y nadie arranca durante", async () => {
    const eventos = [];
    let ahora = 0;
    const tareas = [
      { id: "a", exclusivo: false },
      { id: "b", exclusivo: false },
      { id: "x", exclusivo: true },
      { id: "c", exclusivo: false },
    ];
    await correrEnPool(tareas, 2, async (t) => {
      ahora++;
      eventos.push(`${t.id}:inicio:${ahora}`);
      await espera(t.exclusivo ? 20 : 10);
      eventos.push(`${t.id}:fin`);
      ahora--;
    });
    expect(eventos).toContain("x:inicio:1");
    const ini = eventos.indexOf("x:inicio:1");
    const fin = eventos.indexOf("x:fin");
    expect(eventos.slice(ini, fin + 1).filter((e) => !e.startsWith("x:"))).toEqual([]);
  });

  it("si una tarea tira un error, el pool sigue y lo anota como una corrida sin resumen", async () => {
    const res = await correrEnPool([{ id: "mala" }, { id: "buena" }], 2, async (t) => {
      if (t.id === "mala") throw new Error("explotó");
      return { tarea: t, codigo: 0 };
    });
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.tarea.id === "mala")).toMatchObject({ resumen: null, error: "explotó" });
  });
});

const corrida = (auditor, objetivo, aprobadas, total, fallas = [], extra = {}) => ({
  tarea: { auditor, objetivo, id: `${auditor}:${objetivo}` },
  codigo: fallas.length ? 1 : 0,
  segundos: 60,
  resumen: { auditor, objetivo, aprobadas, total, fallas, segundos: 60 },
  ...extra,
});

describe("juntar los resultados", () => {
  it("suma las corridas de un mismo auditor y pone las fallas con su objetivo", () => {
    const g = agrupar([
      corrida("audit-game", "race", 20, 20),
      corrida("audit-game", "sapo", 19, 20, [{ nombre: "ganador", detalle: "difiere" }]),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ id: "audit-game", estado: "falla", aprobadas: 39, total: 40, segundos: 120 });
    expect(g[0].corridas[1].fallas).toEqual([{ nombre: "ganador", detalle: "difiere" }]);
  });

  it("los datos que dejó el auditor (el zoom por juego) pasan a la corrida del informe", () => {
    const r = corrida("audit-emocion", "todos", 3, 3);
    r.resumen.datos = { zoom: { race: { min: 1.9 } } };
    expect(agrupar([r])[0].corridas[0].datos).toEqual({ zoom: { race: { min: 1.9 } } });
    expect(agrupar([corrida("audit-ui", "sitio", 1, 1)])[0].corridas[0]).not.toHaveProperty("datos");
  });

  it("un auditor que se cae sin dejar resumen cuenta como falla, no como silencio", () => {
    const g = agrupar([{ tarea: { auditor: "smoke", objetivo: "sitio", id: "smoke" }, codigo: 1, segundos: 5, resumen: null, error: null, cola: ["Error: no encontré Chrome"] }]);
    expect(g[0].estado).toBe("error");
    expect(g[0]).toMatchObject({ aprobadas: 0, total: 1 });
    expect(g[0].corridas[0].fallas[0].nombre).toBe("no dejó resumen");
    expect(g[0].corridas[0].fallas[0].detalle).toContain("no encontré Chrome");
  });

  it("salir con código distinto de cero sin ninguna comprobación fallada también es una falla", () => {
    const r = corrida("audit-x", "sitio", 3, 3);
    r.codigo = 1;
    expect(agrupar([r])[0].estado).toBe("falla");
  });

  it("el informe suma todo y la línea de la batería tiene la forma de cualquier auditor", () => {
    const informe = informeDe({
      auditores: agrupar([corrida("a", "o", 2, 2), corrida("b", "o", 1, 3, [{ nombre: "x", detalle: "y" }, { nombre: "z", detalle: "" }])]),
      segundos: 100.2,
      inicio: "2026-10-25T23:00:00.000Z",
      base: "http://localhost:4180",
      paralelo: 2,
      opciones: {},
    });
    expect(informe).toMatchObject({ aprobadas: 3, total: 5, segundos: 100 });
    expect(informe.fallas).toHaveLength(2);
    const l = resumenDeBateria(informe);
    expect(l).toMatchObject({ auditor: "audit-todo", objetivo: "bateria", aprobadas: 3, total: 5 });
    expect(l.fallas[0].nombre).toBe("b o: x");
  });
});

describe("el resumen para leer", () => {
  const informeCon = (n, malos, fallasCada) => {
    const rs = [];
    for (let i = 0; i < n; i++) {
      const falla = i < malos;
      rs.push(
        corrida(
          `audit-${i}`,
          "todos",
          falla ? 10 : 20,
          20,
          falla ? Array.from({ length: fallasCada }, (_, k) => ({ nombre: `comprobación ${k} con un nombre bastante largo para ocupar el ancho`, detalle: "detalle ".repeat(30) })) : [],
        ),
      );
    }
    return informeDe({ auditores: agrupar(rs), segundos: 3720, inicio: "x", base: "b", paralelo: 2, opciones: {} });
  };

  it("todo bien: una línea de cabecera, una por auditor y el pie", () => {
    const l = formatearResumen(informeCon(5, 0, 0), { archivo: "a.json" });
    expect(l).toHaveLength(7);
    expect(l[0]).toContain("5 auditores");
    expect(l[0]).toContain("1 h 02 min");
    expect(l.at(-1)).toContain("detalle en a.json");
  });

  it("con dieciocho auditores y cinco con muchas fallas no pasa de 20 líneas ni esconde a ninguno de los que fallaron", () => {
    const l = formatearResumen(informeCon(18, 5, 40));
    expect(l.length).toBeLessThanOrEqual(20);
    for (let i = 0; i < 5; i++) expect(l.join("\n")).toContain(`audit-${i}`);
    expect(l.join("\n")).toMatch(/y \d+ más/);
    for (const linea of l) expect(linea.length).toBeLessThanOrEqual(118);
  });

  it("aunque fallen treinta auditores, son 20 líneas y dice cuántos faltan por mostrar", () => {
    const l = formatearResumen(informeCon(30, 30, 3));
    expect(l.length).toBeLessThanOrEqual(20);
    expect(l.join("\n")).toMatch(/auditores más con fallas/);
  });

  it("duraciones legibles", () => {
    expect(duracion(9)).toBe("9 s");
    expect(duracion(125)).toBe("2 min 05 s");
    expect(duracion(3720)).toBe("1 h 02 min");
  });
});
