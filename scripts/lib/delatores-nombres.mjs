/**
 * Reconocer nombres, para el auditor de delatores: en las etiquetas de la
 * escena ("María Q.", "Valeria Torr…") y en los subtítulos del relator ("¡Se
 * plantó Jorge Mamani!").
 *
 * `crearReconocedor` corre también adentro de la página: el grabador la
 * inyecta con `toString()`, así que no puede usar nada de afuera de su cuerpo.
 */

/**
 * Devuelve una función que, dado el texto de una etiqueta, dice de quién es:
 * su índice en `nombres`, o -1 si no es de nadie o se confunde con más de uno.
 *
 * La misma regla que `identidadDe` en src/games/pixi/stage.ts: el nombre
 * entero, o un corte por palabras donde la última puede estar empezada ("María
 * Q.", "Valeria Torr…", "María"). Además pide al menos tres letras, para que
 * una letra suelta en pantalla (la del "¿Quién es?") no cuente como alguien.
 */
export function crearReconocedor(nombres) {
  const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const ns = nombres.map(norm);
  const exactos = new Map();
  ns.forEach((nm, i) => exactos.set(nm, [...(exactos.get(nm) || []), i]));
  const memo = new Map();
  return (texto) => {
    const s = norm(texto);
    const hecho = memo.get(s);
    if (hecho !== undefined) return hecho;
    let hit = -1;
    const ex = exactos.get(s);
    if (ex) hit = ex.length === 1 ? ex[0] : -1;
    else {
      const ts = s.split(" ").map((x) => x.replace(/[.…]+$/u, "")).filter(Boolean);
      const letras = ts.join("").length;
      for (let i = 0; ts.length && letras >= 3 && i < ns.length; i++) {
        const partes = ns[i].split(" ");
        if (ts.length > partes.length) continue;
        const ok = ts.every((a, j) => (j < ts.length - 1 ? a === partes[j] : (partes[j] || "").startsWith(a)));
        if (!ok) continue;
        if (hit >= 0) {
          hit = -1;
          break;
        }
        hit = i;
      }
    }
    memo.set(s, hit);
    return hit;
  };
}

const norm = (s) => String(s).normalize("NFC").toLowerCase();
const LETRA = /[\p{L}\p{N}]/u;

/**
 * A quién nombra un subtítulo, en el orden en que aparecen: índices de
 * `nombres`, con repeticiones. Busca los nombres enteros, sin distinguir
 * mayúsculas ("¡GANA MARÍA QUISPE!"), con borde de palabra, y el más largo
 * primero: "María Quispe 2" no se lee también como "María Quispe".
 */
export function nombresEn(texto, nombres) {
  const s = norm(texto);
  const tomado = new Uint8Array(s.length);
  const hallados = [];
  const orden = nombres
    .map((nm, i) => ({ i, nm: norm(nm).replace(/\s+/g, " ").trim() }))
    .filter((x) => x.nm.length >= 2)
    .sort((a, b) => b.nm.length - a.nm.length);
  for (const { i, nm } of orden) {
    for (let desde = 0; ; ) {
      const at = s.indexOf(nm, desde);
      if (at < 0) break;
      desde = at + 1;
      const fin = at + nm.length;
      if ((at > 0 && LETRA.test(s[at - 1])) || (fin < s.length && LETRA.test(s[fin]))) continue;
      let libre = true;
      for (let k = at; k < fin; k++) if (tomado[k]) libre = false;
      if (!libre) continue;
      tomado.fill(1, at, fin);
      hallados.push({ i, at });
    }
  }
  return hallados.sort((a, b) => a.at - b.at).map((h) => h.i);
}

/**
 * Los números de bola que nombra un subtítulo de la tómbola ("¡Salió la 7!",
 * "¿La 12?", "¡La número 3!"): el puesto en la lista sellada, contando desde
 * uno, pasado a índice.
 */
export function bolasEn(texto, n) {
  const out = [];
  for (const m of String(texto).matchAll(/\b(?:la|número|n\.?º)\s+(\d{1,4})\b/giu)) {
    const k = Number(m[1]) - 1;
    if (k >= 0 && k < n) out.push(k);
  }
  return out;
}
