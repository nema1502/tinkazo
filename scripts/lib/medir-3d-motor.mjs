/**
 * Qué motor dibujó una corrida de `scripts/medir-3d.mjs`, sin navegador.
 *
 * El 3D de un juego (`docs/motores.md`) cae al 2D sin avisar cuando no puede arrancar: sin WebGL, con una conexión que
 * el navegador estima de 3G o menos (`permite3d.ts`), o si la placa de video no da un contexto (`[3d] no arrancó` en la
 * consola, que el sitio traga). Para quien mira el show está bien; para quien mide cuadros por segundo es un número
 * equivocado con cara de bueno: el 2D de la carrera anda a más de 60 cuadros por segundo donde el 3D anda a 40. El 6 de
 * noviembre de 2026 la línea de base de la carrera tuvo cuatro filas de "3D" con `en3D: false` y las dio por aprobadas.
 *
 * La causa de ese día (medida el 6 de noviembre de 2026): Chrome estima la conexión de lo que tardan los pedidos y, con la
 * página ocupada, pasa de "4g" a "3g" desde la segunda página del mismo Chrome; `permite3d.ts` pide 4g para el 3D. Ahora el
 * Chrome de los auditores tiene la conexión fija en 4G (`lib/browser.mjs`), pero la regla queda por si es otra cosa.
 *
 * Regla: una fila vale solo si el motor que se pidió es el que dibujó, al abrir el estadio y al terminar de medir. Si no,
 * no es una medida del motor pedido: se descarta, se explica por qué y se repite en un Chrome nuevo.
 */

/** Los valores de `?motor=` que son el 2D. Todo lo demás (vacío, `3d`) pide el 3D por defecto o a la fuerza. */
const MOTORES_2D = ["pixi", "clasico", "2d"];

/** ¿Lo que se pidió es el 3D? Sin `--motor` se mide el 3D por defecto (la compuerta del 3D por defecto). */
export const pide3D = (motor) => !MOTORES_2D.includes(String(motor ?? ""));

/**
 * ¿La fila es una medida del motor pedido?
 *
 * @param motor      el `--motor` de la corrida (`""`, `3d`, `pixi`...)
 * @param inicio3D   si había lienzo 3D apenas abrió el estadio
 * @param fin3D      si lo había al terminar de medir
 * @returns `{ ok, motivo }`; `motivo` queda vacío si `ok`
 */
export function motorDeLaFila({ motor, inicio3D, fin3D }) {
  if (inicio3D !== fin3D) return { ok: false, motivo: `el 3D ${inicio3D ? "estaba al abrir y ya no estaba al terminar" : "no estaba al abrir y apareció después"}: la medida mezcla dos motores` };
  if (pide3D(motor) && !fin3D) return { ok: false, motivo: "se pidió el 3D y la página dibujó en 2D" };
  if (!pide3D(motor) && fin3D) return { ok: false, motivo: "se pidió el 2D y la página dibujó en 3D" };
  return { ok: true, motivo: "" };
}

/**
 * Por qué pudo caerse al 2D, con lo que anotó la página: la conexión que estimó el navegador (más de 3G, el 3D no arranca),
 * los avisos `[3d]` de la consola y los lienzos que había. Es una pista para quien lee, no una causa probada.
 */
export function diagnosticoDeArranque({ conexiones = [], avisos = [], lienzos = [], webgl = null } = {}) {
  const pistas = [];
  const lenta = conexiones.filter((c) => !/^4g/.test(String(c)));
  if (lenta.length) pistas.push(`el navegador estimó la conexión en ${[...new Set(lenta.map((c) => String(c).split("/")[0]))].join(", ")} (el 3D pide 4g)`);
  if (webgl === false) pistas.push("sin WebGL");
  for (const a of avisos.slice(0, 2)) pistas.push(`consola: ${String(a).slice(0, 160)}`);
  if (!pistas.length) pistas.push(`sin avisos en la consola; lienzos: ${lienzos.join(", ") || "ninguno"}`);
  return pistas.join("; ");
}

/**
 * La fila final de un caso a partir de la mejor corrida válida; si ninguna lo fue, una fila con el error y `pasa: false`.
 *
 * @param intentos  las corridas, cada una `{ fila, valida, motivo }`; `fila` es lo medido (con `fps`, `pasa`...)
 */
export function filaDelCaso(intentos) {
  const validas = intentos.filter((i) => i.valida);
  if (validas.length) {
    const mejor = validas.reduce((a, b) => ((b.fila.fps ?? 0) > (a.fila.fps ?? 0) ? b : a));
    return { ...mejor.fila, intentos: intentos.length, descartadas: intentos.length - validas.length };
  }
  const ultima = intentos[intentos.length - 1];
  // Los cuadros por segundo de otro motor no son una medida de este: no se dejan en la fila.
  const { fps, p95Ms, ...resto } = ultima.fila;
  void fps;
  void p95Ms;
  return { ...resto, pasa: false, error: `no se pudo medir el motor pedido en ${intentos.length} intento(s): ${ultima.motivo}`, intentos: intentos.length, descartadas: intentos.length };
}
