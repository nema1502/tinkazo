/**
 * El auditor de sólidos con navegador, para la carrera: mide lo que la escena dibujó de verdad (`?auditar=solidos`, `window.__solidos`) con
 * la misma geometría del auditor sin navegador (`solidos.mjs`).
 *
 * El volcado trae, cada pocos cuadros de juego, cada llama que se ve (dónde pisa, cuánto se levanta, su tamaño y su postura) y las piedras
 * que se mueven (las del cerro y la piedrita del tropiezo) tal como las dibuja el motor; y una vez, los sólidos fijos: los que calculó la
 * escena (`fijosCalculados`, la lista de rocas, matas y piedritas) y los que dibujó (`fijosDibujados`: en el 3D, leídos de las instancias de
 * three.js; en el 2D, las piedritas, que son lo único del suelo con alto dibujado).
 *
 * Dos cosas: que lo dibujado sea lo calculado (a medio píxel en el piso, y el alto), y que nada atraviese nada en lo dibujado.
 */
import { encimado, UMBRALES } from "./solidos.mjs";

/** Lo que mide cada fila de un volcado: cuadros que pasan el umbral, el peor y cuándo, y quién. */
const vacia = () => ({ cuadros: 0, peor: 0, t: 0, quien: null });
const anotar = (f, valor, t, quien) => {
  f.cuadros++;
  if (valor > f.peor) Object.assign(f, { peor: valor, t, quien });
};

/** La huella de una llama de tamaño `esc` en cada motor (la misma de `huellaDe` en `solidos-carrera.mjs`). */
function huella(M, motor, esc) {
  if (motor !== "3d") return { atras: 26 * esc, adelante: 40 * esc, medio: 13 * esc, alto: 92 * esc };
  return { atras: 36 * esc * M.TAM3D, adelante: 38 * esc * M.TAM3D, medio: (13 * esc * M.TAM3D) / M.ZC, alto: 100 * esc * M.TAM3D };
}

/**
 * Compara los fijos dibujados con los calculados, emparejados por tipo y por lugar (el más cercano del mismo tipo): la diferencia más grande en
 * el piso (centro y semiejes, en píxeles) y en el alto (el alto dibujado sobre el calculado).
 */
export function compararFijos(calculados, dibujados) {
  const porTipo = new Map();
  for (const s of dibujados) {
    if (!porTipo.has(s.tipo)) porTipo.set(s.tipo, []);
    porTipo.get(s.tipo).push(s);
  }
  let piso = 0, altoMin = Infinity, altoMax = 0, sinPareja = 0;
  for (const c of calculados) {
    const lista = porTipo.get(c.tipo) ?? [];
    let mejor = null, dist = Infinity;
    for (const s of lista) {
      const dd = Math.hypot(s.x - c.x, s.y - c.y);
      if (dd < dist) [mejor, dist] = [s, dd];
    }
    if (!mejor || dist > 2) {
      sinPareja++;
      continue;
    }
    piso = Math.max(piso, Math.abs(mejor.x - c.x), Math.abs(mejor.y - c.y), Math.abs(mejor.a - c.a), Math.abs(mejor.b - c.b));
    const r = mejor.z1 / c.z1;
    altoMin = Math.min(altoMin, r);
    altoMax = Math.max(altoMax, r);
  }
  return { calculados: calculados.length, dibujados: dibujados.length, sinPareja, piso, altoMin: Number.isFinite(altoMin) ? altoMin : 1, altoMax: altoMax || 1 };
}

/**
 * Mide un volcado de la carrera: llama-roca y llama-mata (5 %), llama-piedrita (las patas, sin ningún roce, salvo el golpe de la víctima del
 * tropiezo hasta el 35 %), llama-piedra del cerro (5 %) y, aparte y a mirar, llama-llama (10 %), que es de otro plan.
 */
export function medirVolcadoCarrera(M, v) {
  const filas = { "llama-roca": vacia(), "llama-mata": vacia(), "llama-piedrita": vacia(), "llama-piedra del cerro": vacia(), "choques que pasan su máximo": vacia(), "llama-llama (a mirar)": vacia() };
  const fijos = v.fijosDibujados ?? [];
  const tz = v.tropiezo ?? null;
  for (const cuadro of v.cuadros ?? []) {
    const t = cuadro.t;
    const cuerpos = cuadro.llamas.map(([id, x, y, alza, esc, postura]) => {
      const h = huella(M, v.motor, esc);
      return { id, x, y, esc, postura, atras: h.atras, adelante: h.adelante, medio: h.medio, z0: alza, z1: alza + h.alto };
    });
    for (const c of cuerpos) {
      for (const s of fijos) {
        if (Math.abs(s.x - c.x) > s.a + c.atras + c.adelante + 4) continue;
        if (s.tipo === "piedrita") continue;
        const valor = encimado(c, { forma: "elipse", x: s.x, y: s.y, a: s.a, b: s.b, giro: s.giro ?? 0, z0: s.z0, z1: s.z1 });
        if (valor > UMBRALES.solido) anotar(filas[s.tipo === "mata" ? "llama-mata" : "llama-roca"], valor, t, c.id);
      }
      // Las piedritas, fijas y la del tropiezo: las patas a la altura del brinco, sin ningún roce.
      const piedritas = [...fijos.filter((s) => s.tipo === "piedrita"), ...(cuadro.moviles ?? []).filter((s) => s.tipo === "piedrita")];
      for (const s of piedritas) {
        if (Math.abs(s.x - c.x) > s.a + 120 * c.esc || c.z0 >= s.z1) continue;
        const k = M.cajaDePatas(c.x, c.y, c.esc);
        const valor = encimado({ x: c.x, y: c.y, atras: c.x - k.x0, adelante: k.x1 - c.x, medio: c.y - k.y0, z0: c.z0, z1: c.z0 + 1e6 }, { forma: "elipse", x: s.x, y: s.y, a: s.a, b: s.b, giro: 0, z0: 0, z1: s.z1 });
        if (!(valor > 0)) continue;
        if (tz && c.id === tz.quien && s.movil && t > tz.t - 0.2 && t < tz.t + M.TROPIEZO_CABEZA) {
          if (valor > UMBRALES.choque) anotar(filas["choques que pasan su máximo"], valor, t, c.id);
          continue;
        }
        anotar(filas["llama-piedrita"], valor, t, c.id);
      }
      for (const s of (cuadro.moviles ?? []).filter((m) => m.tipo === "piedra")) {
        const valor = encimado(c, { forma: "elipse", x: s.x, y: s.y, a: s.a, b: s.b, giro: 0, z0: s.z0, z1: s.z1 });
        if (valor > UMBRALES.solido) anotar(filas["llama-piedra del cerro"], valor, t, c.id);
      }
    }
    const corren = cuerpos.filter((c) => c.postura !== "echada").sort((a, b) => a.x - b.x);
    for (let a = 0; a < corren.length; a++) {
      for (let b = a + 1; b < corren.length; b++) {
        const p = corren[a], q = corren[b];
        if (q.x - q.atras > p.x + p.adelante) break;
        const valor = encimado(p, { forma: "caja", x0: q.x - q.atras, x1: q.x + q.adelante, y0: q.y - q.medio, y1: q.y + q.medio, z0: q.z0, z1: q.z1 });
        if (valor > UMBRALES.cuerpo) anotar(filas["llama-llama (a mirar)"], valor, t, p.id);
      }
    }
  }
  return { filas, fijos: compararFijos(v.fijosCalculados ?? [], fijos) };
}
