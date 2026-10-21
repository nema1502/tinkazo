import { afterEach, describe, expect, it } from "vitest";
import { T, setPickSeed } from "../../src/i18n.ts";
import {
  GRACIA,
  JUEGOS,
  MARCADORES,
  apuesta,
  cuando,
  grabarPara,
  linea,
  ordenar,
  preparar,
  senalArranque,
  senalCamara,
  senales,
  senalesCarrera,
  senalesConstelacion,
  senalesDuelo,
  senalesQuien,
  senalesRuleta,
  senalesSapo,
  senalesSubtitulos,
  senalesTombola,
} from "./delatores-senales.mjs";

const NOMBRES = ["María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas", "Elena Condori", "Pablo Gutiérrez"];
const W = 1280, H = 720;

/**
 * Una traza armada a mano, con el formato del grabador. `pos(t)` devuelve, para
 * cada momento, `{ i: [x, y] }` con los nombres visibles; los cuadros van cada
 * `paso` segundos hasta `fin`.
 */
function traza({ ganador = 2, nombres = NOMBRES, pos = () => ({}), zoom = () => 1, subs = [], marks = [], revelado = 30, fin = 33, paso = 0.25, nums, trazos } = {}) {
  const frames = [];
  for (let t = 0; t <= fin + 1e-9; t += paso) {
    const f = [t, zoom(t)];
    for (const [i, p] of Object.entries(pos(t))) if (p) f.push(Number(i), p[0], p[1], 20, p[2] ?? 1);
    frames.push(f);
  }
  return {
    t0: 0, W, H, frames, subs, marks, revelado, fin,
    nums: nums ?? frames.map((f) => [f[0]]),
    trazos: trazos ?? [],
    pose: { names: nombres, winners: [ganador] },
  };
}

/** Todos visibles en fila, todo el show. */
const todosEnFila = (t) => Object.fromEntries(NOMBRES.map((_, i) => [i, [100 + i * 120, 360]]));

afterEach(() => setPickSeed(null));

/** Todas las variantes de una clave del diccionario en español, con los argumentos de ejemplo. */
function variantes(clave, args) {
  const v = T.es[clave];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  const out = new Set();
  for (let k = 0; k < 40; k++) {
    setPickSeed(() => k / 40);
    out.add(v(...args));
  }
  return [...out];
}

describe("las líneas del relator que marcan momentos coinciden con src/i18n.ts", () => {
  const conNombre = ["Ana Vargas"];
  const casos = {
    cStart: [], cLast: [], cFoto: [],
    cSapLast: [], cSapNear: conNombre, cSapMissBy: conNombre,
    cWheelOn: conNombre, cWheelFalse: conNombre, cWheelMoved: [], cWheelLast: [],
    cTomDoor: [], cTomFake: ["7"], cTomBack: [], cTomBall: ["7"],
    cTroWobble: conNombre, cTroEdge: conNombre, cTroSpent: conNombre,
    cPinAlmost: conNombre, cPinBreak: [],
    cOruMask: conNombre, cOruArrive: [],
    cChoOut: conNombre, cChoWobble: conNombre, cChoHold: conNombre, cChoBack: conNombre,
    cTelDoor: conNombre, cTelSlip: conNombre, cTelDock: [],
    cPasClose: conNombre, cPasOut: conNombre,
    cConstNear: conNombre, cConstHeading: conNombre, cConstDecoy: [],
  };

  it.each(Object.entries(casos))("%s", (clave, args) => {
    const re = MARCADORES[clave];
    expect(re, `falta el marcador de ${clave}`).toBeInstanceOf(RegExp);
    for (const s of variantes(clave, args)) expect(s).toMatch(re);
  });

  it("las que llevan un número", () => {
    for (const n of [2, 8, 12]) {
      expect(T.es.cSapCount(n)).toMatch(MARCADORES.cSapCount);
      expect(T.es.cTroCount(n)).toMatch(MARCADORES.cTroCount);
      expect(T.es.cOruCount(n)).toMatch(MARCADORES.cOruCount);
      expect(T.es.cChoCount(n)).toMatch(MARCADORES.cChoCount);
    }
  });

  it("el cartel del ganador, con uno y con varios", () => {
    for (const many of [false, true]) for (const s of variantes("cWin", ["Ana Vargas", many])) expect(s).toMatch(MARCADORES.cWin);
  });

  it("las respuestas de ¿Quién es?, con una o varias cartas y sin ninguna", () => {
    for (const l of ["R", "Ñ"]) {
      for (const k of [1, 3]) {
        expect(T.es.cQuiYes(l, k)).toMatch(MARCADORES.cQuiAnswer);
        expect(T.es.cQuiNo(l, k)).toMatch(MARCADORES.cQuiAnswer);
      }
      for (const has of [true, false]) expect(T.es.cQuiNone(l, has)).toMatch(MARCADORES.cQuiAnswer);
    }
  });

  it("no se confunden entre sí donde importa", () => {
    expect("¡Se tambalea!").not.toMatch(MARCADORES.cTroWobble);
    expect("¡María Quispe y Diego Rojas se soltaron!").not.toMatch(MARCADORES.cChoOut);
    expect("¡Tiro!").not.toMatch(MARCADORES.cSapLast);
  });
});

describe("quién sigue en juego", () => {
  it("al que nombran y desaparece en seguida se lo da por afuera desde que lo nombran", () => {
    const tr = traza({
      pos: (t) => ({ ...todosEnFila(t), 0: t < 5.5 ? [100, 360] : null }),
      subs: [[5, "¡Se cayó el de María Quispe!"]],
    });
    const P = preparar(tr, { candidatos: "visibles" });
    expect(P.sigue(0, 5)).toBe(false);
    expect(P.sigue(0, 5.5 - GRACIA - 0.5)).toBe(true);
    expect(P.vivos(5)).not.toContain(0);
    expect(P.vivos(5)).toHaveLength(7);
  });

  it("el que sigue en pantalla al revelado no salió nunca; el que nunca se vio no está", () => {
    const tr = traza({ pos: (t) => ({ 2: [600, 300], 3: t < 10 ? [700, 300] : null }) });
    const P = preparar(tr, { candidatos: "visibles" });
    expect(P.sigue(2, 29.9)).toBe(true);
    expect(P.sigue(3, 5)).toBe(true);
    expect(P.sigue(3, 9)).toBe(false);
    expect(P.sigue(4, 0)).toBe(false);
    expect(preparar(tr, { candidatos: "todos" }).vivos(29)).toHaveLength(8);
  });

  it("en la piñata sigue el que todavía no cayó", () => {
    const tr = traza({ pos: (t) => ({ ...(t >= 6 ? { 0: [100, 600] } : {}), ...(t >= 30 ? { 2: [600, 300] } : {}) }) });
    const P = preparar(tr, { candidatos: "caidos" });
    expect(P.sigue(0, 3)).toBe(true);
    expect(P.sigue(0, 6)).toBe(false);
    expect(P.sigue(2, 28)).toBe(true);
  });

  it("lo que no se ve no cuenta: transparente, chico o fuera de la pantalla", () => {
    const tr = traza({ pos: () => ({ 0: [100, 360, 0.3], 1: [-50, 360], 2: [600, 300] }) });
    const P = preparar(tr);
    expect(P.primera[0]).toBeNull();
    expect(P.primera[1]).toBeNull();
    expect(P.primera[2]).toBe(0);
  });
});

describe("cuándo pasa un momento", () => {
  const tr = traza({
    subs: [[1, "¡ALLÁ VAN!"], [4, "¡Tiro!"], [6, "¡Último tiro!"], [8, "¡Este es el bueno!"], [31, "¡ES PARA Lucía Flores!"]],
    marks: [[0, "arco", "duelo"], [7.5, "mitad", "3"]],
  });
  const P = preparar(tr);

  it("por la línea, la primera o la última, con espera", () => {
    expect(cuando(P, { clave: "cStart" })).toBe(1);
    expect(cuando(P, { clave: "cSapLast" })).toBe(6);
    expect(cuando(P, { clave: "cSapLast", ultima: true })).toBe(8);
    expect(cuando(P, { claves: ["cWheelLast", "cSapLast"], mas: 0.5 })).toBe(6.5);
    expect(cuando(P, { clave: "cFoto" })).toBeNull();
  });

  it("por lo que anota el juego, o por fracción del show", () => {
    expect(cuando(P, { marca: "mitad" })).toBe(7.5);
    expect(cuando(P, { frac: 0.5 })).toBe(15);
    expect(cuando(P, null)).toBeNull();
  });

  it("el corte nunca pasa del revelado, y el arco sale de lo que anota el juego", () => {
    expect(preparar(tr, { corte: { clave: "cSapLast" } }).corte).toBe(6);
    expect(preparar(tr, { corte: { clave: "cFoto" } }).corte).toBe(30);
    expect(P.arco).toBe("duelo");
  });
});

describe("una apuesta", () => {
  it("acierta si el ganador está en el grupo, con el azar del tamaño del grupo", () => {
    expect(apuesta([2], [0, 1, 2, 3], 2)).toEqual({ acierta: true, azar: 0.25 });
    expect(apuesta([1, 3], [0, 1, 2, 3], 2)).toEqual({ acierta: false, azar: 0.5 });
    expect(apuesta([1, 1, 9], [0, 1, 2, 3], 2)).toEqual({ acierta: false, azar: 0.25 });
  });

  it("no informa si el ganador no está entre los que siguen, o si apuesta por nadie o por todos", () => {
    expect(apuesta([2], [0, 1], 2)).toBeNull();
    expect(apuesta([], [0, 1, 2], 2)).toBeNull();
    expect(apuesta([7], [0, 1, 2], 2)).toBeNull();
    expect(apuesta([0, 1, 2], [0, 1, 2], 2)).toBeNull();
  });

  it("ordena por x, por y, o por ángulo desde las doce en el sentido del reloj", () => {
    const labs = new Map([[0, { x: 500, y: 200 }], [1, { x: 700, y: 400 }], [2, { x: 500, y: 600 }], [3, { x: 300, y: 400 }]]);
    expect(ordenar(labs, "x")).toEqual([3, 0, 2, 1]);
    expect(ordenar(labs, "y")).toEqual([0, 1, 3, 2]);
    expect(ordenar(labs, "angulo")).toEqual([0, 1, 2, 3]);
  });
});

describe("lo que dicen los subtítulos", () => {
  const P = preparar(
    traza({
      pos: todosEnFila,
      subs: [
        [2, "¡ALLÁ VAN!"],
        [3, "¡Jorge Mamani se pone primero!"],
        [6, "¡Pelea de llamas: Diego Rojas contra Ana Vargas!"],
        [9, "¡Jorge Mamani los pasa a todos!"],
        [12, "¡Lucía Flores viene de atrás!"],
        [20, "¡Mano a mano Jorge Mamani y Lucía Flores!"],
        [31, "¡GANA Lucía Flores!"],
      ],
    }),
  );
  const s = senalesSubtitulos(P);

  it("el primero, el último que nombran solo y el más nombrado", () => {
    expect(s["nombra-primero"].el).toEqual({ acierta: false, azar: 1 / 8 });
    expect(s["nombra-ultimo"].el).toEqual({ acierta: true, azar: 1 / 8 });
    expect(s["nombra-mas"].el).toEqual({ acierta: false, azar: 1 / 8 });
  });

  it("los nombrados contra los que nunca nombraron", () => {
    // Jorge, Diego, Ana y Lucía, de ocho.
    expect(s.drama.nombrados).toEqual({ acierta: true, azar: 0.5 });
    expect(s.drama.callados).toEqual({ acierta: false, azar: 0.5 });
  });

  it("en la última línea que nombra a dos con el ganador, quién va primero", () => {
    expect(s["orden-dos"]["el-primero"]).toEqual({ acierta: false, azar: 0.5 });
    expect(s["orden-dos"]["el-segundo"]).toEqual({ acierta: true, azar: 0.5 });
  });

  it("lo que se dice después del corte no cuenta", () => {
    const Q = preparar(traza({ pos: todosEnFila, subs: [[3, "¡Ana Vargas pasa adelante!"], [12, "¡Lucía Flores viene de atrás!"]] }), { corte: { frac: 0.2 } });
    expect(senalesSubtitulos(Q)["nombra-ultimo"].el.acierta).toBe(false);
  });
});

describe("la cámara", () => {
  it("en los acercamientos, el nombre del centro: el que más tiempo y el último", () => {
    const P = preparar(
      traza({
        zoom: (t) => (t > 20 && t < 28 ? 2 : 1),
        pos: (t) => ({ ...todosEnFila(t), 2: t > 22 ? [640, 360] : [1000, 100], 5: t <= 22 ? [650, 370] : [100, 100] }),
      }),
    );
    const c = senalCamara(P).camara;
    // Diego estuvo en el centro de 20 a 22, Lucía de 22 a 28.
    expect(c.ultimo).toEqual({ acierta: true, azar: 1 / 8 });
    expect(c["mas-tiempo"]).toEqual({ acierta: true, azar: 1 / 8 });
  });

  it("si empatan en tiempo, apuesta por los dos", () => {
    const P = preparar(
      traza({
        zoom: (t) => (t >= 20 && t < 24 ? 2 : 1),
        pos: (t) => ({ ...todosEnFila(t), 2: t >= 22 ? [640, 360] : [1000, 100], 5: t < 22 ? [650, 370] : [100, 100] }),
      }),
    );
    expect(senalCamara(P).camara["mas-tiempo"].azar).toBeCloseTo(2 / 8, 12);
  });

  it("sin acercamientos no hay señal", () => {
    expect(senalCamara(preparar(traza({ pos: todosEnFila })))).toEqual({});
  });
});

describe("dónde arranca cada uno", () => {
  it("el puesto del ganador en el orden de la pantalla, una regla por puesto", () => {
    const P = preparar(traza({ ganador: 5, pos: (t) => Object.fromEntries(NOMBRES.map((_, i) => [i, [400, 100 + i * 60]])), subs: [[1, "¡ALLÁ VAN!"]] }));
    const a = senalArranque(P, { arranque: { desde: { clave: "cStart" }, orden: "y" } })["arranque-y"];
    expect(Object.keys(a)).toHaveLength(8);
    expect(a["puesto-6"]).toEqual({ acierta: true, azar: 1 / 8 });
    expect(a["puesto-1"]).toEqual({ acierta: false, azar: 1 / 8 });
  });

  it("varias formas de mirar el mismo arranque", () => {
    const P = preparar(traza({ pos: todosEnFila }));
    const a = senalArranque(P, { arranque: [{ orden: "x" }, { orden: "y" }] });
    expect(Object.keys(a)).toEqual(["arranque-x", "arranque-y"]);
  });
});

describe("el mano a mano", () => {
  it("de qué lado está cada uno, y quién salta primero", () => {
    const P = preparar(
      traza({
        pos: (t) => {
          if (t < 10) return todosEnFila(t);
          const salto = t > 14 && t < 14.6 ? 40 : 0;
          return { 2: [400, 400 - salto], 7: [800, 420] };
        },
        subs: [[11, "¡Lucía Flores y Pablo Gutiérrez, cara a cara!"], [20, "¡LLEGÓ AL SOCAVÓN!"]],
      }),
      { corte: { clave: "cOruArrive" } },
    );
    const d = senalesDuelo(P, { salta: true });
    expect(d["lado-x"].izquierda).toEqual({ acierta: true, azar: 0.5 });
    expect(d["lado-y"].arriba).toEqual({ acierta: true, azar: 0.5 });
    expect(d["salta-primero"].el).toEqual({ acierta: true, azar: 0.5 });
  });

  it("sin línea de dos, cuando en pantalla quedan dos", () => {
    const P = preparar(traza({ pos: (t) => (t < 10 ? todosEnFila(t) : { 2: [900, 300], 4: [300, 300] }) }));
    expect(senalesDuelo(P)["lado-x"].derecha).toEqual({ acierta: true, azar: 0.5 });
  });
});

describe("una clase de línea", () => {
  it("la última de esas líneas, por la persona que nombra", () => {
    const P = preparar(traza({ pos: todosEnFila, subs: [[5, "¡Cabecea el de Ana Vargas!"], [9, "¡Lucía Flores se tambalea!"]] }));
    const f = linea("cabecea", ["cTroWobble"]);
    expect(f.name).toBe("linea-cabecea");
    expect(f(P).cabecea["el-nombrado"]).toEqual({ acierta: true, azar: 1 / 8 });
    expect(linea("otra", ["cPinAlmost"])(P)).toEqual({});
  });

  it("hasta el revelado, para lo que pasa después del corte", () => {
    const P = preparar(traza({ pos: todosEnFila, subs: [[20, "¡Sale la 4!"]] }), { candidatos: "todos", numeros: false, corte: { frac: 0.1 } });
    expect(linea("asoma", ["cTomFake"])(P)).toEqual({});
    const Q = preparar(traza({ subs: [[20, "¡Sale la 4!"]] }), { candidatos: "todos", numeros: true, corte: { frac: 0.1 } });
    expect(linea("asoma", ["cTomFake"], { hasta: "revelado" })(Q).asoma["el-nombrado"]).toEqual({ acierta: false, azar: 1 / 8 });
  });
});

describe("las señales de cada juego", () => {
  it("la carrera: el puesto de la ganadora a cada altura, y la recta", () => {
    const marks = [[0, "arco", "duelo"], [0, "clasificatoria", "8/8"], [1, "puesto", "5"], [5, "puesto", "3"], [11, "mitad", "3"], [14, "puesto", "2"], [19, "puesto", "1"]];
    // Largada a los 5, mitad a los 11: la carrera dura 12 s.
    const P = preparar(traza({ pos: todosEnFila, marks, subs: [[5, "¡ALLÁ VAN!"]] }));
    const c = senalesCarrera(P);
    expect(c["puesto-25"]["puesto-3"]).toEqual({ acierta: true, azar: 1 / 8 });
    expect(c["puesto-50"]["puesto-3"].acierta).toBe(true);
    expect(c["puesto-75"]["puesto-2"].acierta).toBe(true);
    // Al 90% (15,8 s) va segunda.
    expect(c.recta).toEqual({ primera: { acierta: false, azar: 0.5 }, segunda: { acierta: true, azar: 0.5 } });
  });

  it("el sapo: el del casi, sus vecinos y el que queda entre dos casi", () => {
    // Ocho agujeros en ronda: desde las doce en el sentido del reloj, 0..7.
    const ronda = Object.fromEntries(NOMBRES.map((_, i) => [i, [640 + 250 * Math.sin((i * Math.PI) / 4), 360 - 250 * Math.cos((i * Math.PI) / 4)]]));
    const P = preparar(
      traza({
        ganador: 3,
        pos: () => ronda,
        subs: [[1, "¡8 agujeros, uno por nombre!"], [8, "¡Casi cae en el de Lucía Flores!"], [12, "¡Bailó en el borde de Ana Vargas!"], [15, "¡Último tiro!"]],
      }),
      { corte: { clave: "cSapLast" } },
    );
    const s = senalesSapo(P);
    expect(s.casi["el-del-casi"]).toEqual({ acierta: false, azar: 1 / 8 });
    expect(s.casi["sus-vecinos"]).toEqual({ acierta: true, azar: 2 / 8 });
    expect(s["entre-casis"].medio).toEqual({ acierta: true, azar: 1 / 8 });
  });

  it("la ruleta: el gajo que sigue al último nombrado", () => {
    const P = preparar(traza({ subs: [[20, "¡Ahora Jorge Mamani!"], [22, "¿Se queda en Jorge Mamani?"], [24, "¡NO ERA! ¡UN GAJO MÁS!"]] }), JUEGOS.wheel);
    const g = senalesRuleta(P).gajo;
    expect(g["el-siguiente"]).toEqual({ acierta: true, azar: 1 / 8 });
    expect(g["el-nombrado"].acierta).toBe(false);
    expect(linea("amague", ["cWheelFalse"])(P).amague["el-nombrado"].acierta).toBe(false);
  });

  it("la tómbola: la bola que espera en la boca cuando se abre la puerta", () => {
    const nums = [];
    for (let t = 0; t <= 33; t += 0.25) nums.push([t, 2, 650, 370, 30, 1, 5, 400, 200, 30, 1, 6, 900, 600, 30, 1]);
    const P = preparar(traza({ nums, subs: [[24, "¡SE ABRE LA PUERTA!"], [27, "¡Es la 3!"]] }), JUEGOS.tombola);
    expect(P.corte).toBe(24);
    expect(senalesTombola(P).compuerta["la-de-la-boca"]).toEqual({ acierta: true, azar: 1 / 8 });
  });

  it("¿Quién es?: la carta donde frena el foco antes de la última respuesta", () => {
    const trazos = [[18, 0, 300, 300, 130, 170], [19.5, 0, 700, 300, 130, 170]];
    const P = preparar(
      traza({ pos: () => ({ 2: [700, 280], 4: [300, 280], 6: [500, 280] }), trazos, subs: [[20, "¡No tiene Z! Se da vuelta una."]] }),
      JUEGOS.quien,
    );
    expect(senalesQuien(P).foco["la-del-foco"]).toEqual({ acierta: true, azar: 1 / 3 });
  });

  it("la constelación: la vecina del amague", () => {
    const cielo = { 0: [100, 100], 1: [300, 120], 2: [520, 400], 3: [900, 200], 4: [480, 430], 5: [1100, 600], 6: [200, 600], 7: [700, 650] };
    const P = preparar(
      traza({ pos: (t) => (t < 5 ? cielo : {}), subs: [[25, "¿Se queda en Ana Vargas…?"], [26, "¡NOOO, SIGUE DE LARGO!"]] }),
      JUEGOS.stellar,
    );
    const a = senalesConstelacion(P).amague;
    expect(a["la-del-amague"]).toEqual({ acierta: false, azar: 1 / 8 });
    expect(a["su-vecina"]).toEqual({ acierta: true, azar: 1 / 8 });
  });
});

describe("los juegos", () => {
  const SELECTOR = ["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien"];

  it("los doce del selector tienen cómo mirarse, con marcadores que existen", () => {
    for (const j of SELECTOR) {
      const cfg = JUEGOS[j];
      expect(cfg, j).toBeDefined();
      for (const m of [cfg.corte, ...[cfg.arranque ?? []].flat().map((a) => a.desde)].filter(Boolean)) {
        for (const k of m.claves ?? (m.clave ? [m.clave] : [])) expect(MARCADORES[k], `${j}: ${k}`).toBeInstanceOf(RegExp);
      }
    }
  });

  it("qué graba la página para cada uno", () => {
    expect(grabarPara("tombola")).toEqual({ numeros: true, trazos: [] });
    expect(grabarPara("quien").trazos).toHaveLength(1);
    expect(grabarPara("race")).toEqual({ numeros: false, trazos: [] });
    expect(grabarPara("otro")).toEqual({ numeros: false, trazos: [] });
  });

  it("todas las señales de una semilla, con el arco y el corte", () => {
    const r = senales(traza({ pos: todosEnFila, marks: [[0, "arco", "susto"]], subs: [[3, "¡Lucía Flores se escapa!"]] }), "race");
    expect(r.arco).toBe("susto");
    expect(r.corte).toBe(30);
    expect(r.senales["nombra-primero"].el.acierta).toBe(true);
  });
});
