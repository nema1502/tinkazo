/**
 * La geometría de "nada atraviesa nada", sin nada de ningún juego: cuerpos que se mueven y sólidos que no se atraviesan, todos en un
 * mismo plano (x el avance, y el fondo) con una altura (de `z0` a `z1`).
 *
 * - Un **cuerpo** es una caja en el piso: de `x - atras` a `x + adelante` y de `y - medio` a `y + medio`, con altura de `z0` a `z1`.
 * - Un **sólido** es una elipse (rocas, matas, piedritas), un círculo o una caja (postes, vallas, cercas), también con su altura.
 * - El **encimado** es el área común en el piso dividida por el área del más chico de los dos, y solo cuenta si las alturas se cruzan.
 *   Por el más chico: un poste fino que pasa por el medio de un cuerpo da cerca del 100 %, no un 2 %.
 *
 * Cualquier juego que vuelque sus cuerpos y sus sólidos en este plano entra al auditor (`scripts/audit-solidos.mjs`) sin tocar este
 * archivo: basta con que diga dónde está cada cosa en cada cuadro.
 */

/** El área de una elipse de semiejes `a` y `b`. */
export const areaElipse = (a, b) => Math.PI * Math.abs(a * b);
/** El área de una caja en el piso. */
export const areaCaja = (x0, x1, y0, y1) => Math.abs((x1 - x0) * (y1 - y0));

/** Si dos alturas se cruzan: `[z0, z1]` contra `[z0, z1]`, con los bordes sin tocar. */
export function alturasSeCruzan(a0, a1, b0, b1) {
  return Math.min(a1, b1) > Math.max(a0, b0);
}

/** La caja en el piso de un cuerpo (`x`, `y` son su origen: los pies, en el centro). */
export function cajaDeCuerpo(c) {
  return { x0: c.x - c.atras, x1: c.x + c.adelante, y0: c.y - c.medio, y1: c.y + c.medio };
}

/** El área en el piso de un sólido: la elipse, el círculo o la caja. */
export function areaSolido(s) {
  if (s.forma === "caja") return areaCaja(s.x0, s.x1, s.y0, s.y1);
  if (s.forma === "circulo") return areaElipse(s.r, s.r);
  return areaElipse(s.a, s.b);
}

/** El área común de dos cajas en el piso. */
function areaCajaCaja(a, b) {
  const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

/** El área común de una caja y una elipse, por rebanadas: en el sistema de la elipse, la caja es un polígono convexo y cada rebanada es un tramo. */
function areaCajaElipse(caja, e) {
  const cos = Math.cos(e.giro ?? 0), sin = Math.sin(e.giro ?? 0);
  // Las esquinas de la caja en el sistema de la elipse (u a lo largo del semieje a, v a lo largo del b).
  const esquinas = [
    [caja.x0, caja.y0], [caja.x1, caja.y0], [caja.x1, caja.y1], [caja.x0, caja.y1],
  ].map(([x, y]) => {
    const dx = x - e.x, dy = y - e.y;
    return [cos * dx + sin * dy, -sin * dx + cos * dy];
  });
  const us = esquinas.map(([u]) => u);
  const uMin = Math.max(-e.a, Math.min(...us)), uMax = Math.min(e.a, Math.max(...us));
  if (!(uMax > uMin)) return 0;
  // En cada `u`, el tramo de `v` que queda dentro del polígono: las intersecciones con sus cuatro lados.
  const tramoEn = (u) => {
    const vs = [];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = esquinas[i], [x1, y1] = esquinas[(i + 1) % 4];
      if (Math.abs(x1 - x0) < 1e-12) {
        if (Math.abs(u - x0) < 1e-9) vs.push(y0, y1);
        continue;
      }
      const f = (u - x0) / (x1 - x0);
      if (f >= 0 && f <= 1) vs.push(y0 + f * (y1 - y0));
    }
    if (vs.length < 2) return 0;
    const semi = e.b * Math.sqrt(Math.max(0, 1 - (u / e.a) ** 2));
    const dentro = Math.min(Math.max(...vs), semi) - Math.max(Math.min(...vs), -semi);
    return Math.max(0, dentro);
  };
  // Simpson con rebanadas finas: la función es suave salvo en los bordes de la elipse, y con 240 rebanadas el error queda muy por debajo del umbral.
  const N = 240, h = (uMax - uMin) / N;
  let suma = tramoEn(uMin) + tramoEn(uMax);
  for (let i = 1; i < N; i++) suma += tramoEn(uMin + i * h) * (i % 2 ? 4 : 2);
  return (suma * h) / 3;
}

/** El área común en el piso entre la caja de un cuerpo y un sólido (elipse, círculo o caja). */
export function areaComun(cuerpo, solido) {
  const caja = cuerpo.x0 !== undefined ? cuerpo : cajaDeCuerpo(cuerpo);
  if (solido.forma === "caja") return areaCajaCaja(caja, solido);
  const e = solido.forma === "circulo" ? { x: solido.x, y: solido.y, a: solido.r, b: solido.r, giro: 0 } : solido;
  if (!(e.a > 0 && e.b > 0)) return 0;
  return areaCajaElipse(caja, e);
}

/**
 * Cuánto se enciman un cuerpo y un sólido: el área común en el piso sobre el área del más chico de los dos, de 0 a 1. Si las alturas
 * no se cruzan (el cuerpo salta por encima, o el sólido queda por debajo de sus patas), es cero.
 */
export function encimado(cuerpo, solido) {
  const c = { ...cajaDeCuerpo(cuerpo), z0: cuerpo.z0 ?? 0, z1: cuerpo.z1 ?? Infinity };
  if (!alturasSeCruzan(c.z0, c.z1, solido.z0 ?? 0, solido.z1 ?? Infinity)) return 0;
  const comun = areaComun(c, solido);
  if (!(comun > 0)) return 0;
  const menor = Math.min(areaCaja(c.x0, c.x1, c.y0, c.y1), areaSolido(solido));
  return menor > 0 ? comun / menor : 0;
}

/** Cuánto se enciman dos cuerpos (las dos cajas, con sus alturas). */
export function encimadoCuerpos(a, b) {
  if (!alturasSeCruzan(a.z0 ?? 0, a.z1 ?? Infinity, b.z0 ?? 0, b.z1 ?? Infinity)) return 0;
  const ca = cajaDeCuerpo(a), cb = cajaDeCuerpo(b);
  const comun = areaCajaCaja(ca, cb);
  if (!(comun > 0)) return 0;
  const menor = Math.min(areaCaja(ca.x0, ca.x1, ca.y0, ca.y1), areaCaja(cb.x0, cb.x1, cb.y0, cb.y1));
  return menor > 0 ? comun / menor : 0;
}

/** Los umbrales de siempre: cuerpo contra sólido, 5 %; cuerpo contra cuerpo, 10 % (la regla M8 de la dirección). */
export const UMBRALES = { solido: 0.05, cuerpo: 0.1, choque: 0.35 };

/**
 * Cuenta los cruces entre dos instantes: pares cuyo orden de lado (la coordenada y) en `antes` es el contrario del de `despues`.
 * Recibe las posiciones de lado de los mismos cuerpos, en el mismo orden, en los dos instantes. Si dos quedan a la misma altura
 * en alguno de los dos, el par no cuenta: no hay un orden que se haya dado vuelta.
 */
export function contarCruces(antes, despues) {
  let cruces = 0;
  for (let i = 0; i < antes.length; i++) {
    for (let j = i + 1; j < antes.length; j++) {
      if (Math.sign(antes[j] - antes[i]) * Math.sign(despues[j] - despues[i]) < 0) cruces++;
    }
  }
  return cruces;
}

/**
 * Mide un volcado con la forma de la sección del auditor (cuerpos y sólidos fijos y móviles por cuadro, con permisos) y devuelve, por
 * cada clase de par, cuántos cuadros se pasan del umbral y el peor caso. Los permisos dicen qué pares pueden tocarse, cuánto y cuándo:
 * un `salto` no puede encimarse nada durante su ventana; un `choque` puede llegar hasta su `max`.
 */
export function medirVolcado(v, { umbralSolido = UMBRALES.solido, umbralCuerpo = UMBRALES.cuerpo } = {}) {
  const filas = new Map();
  const anotar = (clave, valor, t, cuerpo, solido) => {
    let f = filas.get(clave);
    if (!f) filas.set(clave, (f = { cuadros: 0, peor: 0, t: 0, cuerpo: null, solido: null }));
    if (valor > 0) f.cuadros++;
    if (valor > f.peor) Object.assign(f, { peor: valor, t, cuerpo, solido });
  };
  const permisoDe = (cuerpo, solido, t) => (v.permitidos ?? []).find((p) => p.cuerpo === cuerpo && p.solido === solido && t >= p.desde && t <= p.hasta);
  let violacionesPermiso = 0, peorPermiso = 0;
  const fijos = new Map((v.fijos ?? []).map((s) => [s.id, s]));
  for (const cuadro of v.cuadros ?? []) {
    const t = cuadro.t;
    const moviles = new Map((cuadro.moviles ?? []).map((m) => [m[0], { forma: m[1], x: m[2], y: m[3], a: m[4], b: m[5], giro: m[6], z0: m[7], z1: m[8] }]));
    const cuerpos = (cuadro.cuerpos ?? []).map(([id, x, y, atras, adelante, medio, z0, z1, postura]) => ({ id, x, y, atras, adelante, medio, z0, z1, postura }));
    for (const c of cuerpos) {
      for (const s of [...fijos.values(), ...moviles.values()]) {
        const valor = encimado(c, s);
        const permiso = permisoDe(c.id, s.id, t);
        if (permiso) {
          const limite = permiso.tipo === "salto" ? 0 : (permiso.max ?? UMBRALES.choque);
          if (valor > limite + 1e-9) {
            violacionesPermiso++;
            peorPermiso = Math.max(peorPermiso, valor);
          }
          continue;
        }
        if (valor > umbralSolido) anotar(`cuerpo-${s.tipo ?? s.forma}`, valor, t, c.id, s.id);
        else if (valor > 0) anotar(`cuerpo-${s.tipo ?? s.forma} (bajo el umbral)`, valor, t, c.id, s.id);
      }
    }
    for (let i = 0; i < cuerpos.length; i++) {
      for (let j = i + 1; j < cuerpos.length; j++) {
        const valor = encimadoCuerpos(cuerpos[i], cuerpos[j]);
        if (valor > umbralCuerpo) anotar("cuerpo-cuerpo", valor, t, cuerpos[i].id, cuerpos[j].id);
      }
    }
  }
  return { filas, violacionesPermiso, peorPermiso };
}
