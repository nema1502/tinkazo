/**
 * Las piezas del recorrido automático de la prueba de la llave (`scripts/recorrido-llave.mjs`) que se pueden probar sin
 * navegador: el toque con un evento de confianza, la espera de una pantalla, el código de salida y el archivo de medidas.
 */

/**
 * Toca el centro de un elemento con eventos del ratón de confianza (con `button`, `buttons` y `clickCount`), que dan
 * activación de usuario: sin eso el navegador no deja pedir el desbloqueo de la llave. Antes anota si la página tiene foco.
 * @param {{ send: (m: string, p?: object) => Promise<unknown>, eval: (e: string) => Promise<unknown> }} cdp
 * @param {string} selector
 */
export async function tocar(cdp, selector) {
  const r = await cdp.eval(
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.hidden) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, foco: document.hasFocus() }; })()`,
  );
  if (!r) throw new Error(`no hay ${selector} a la vista`);
  const { x, y, foco } = r;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  return { foco };
}

/** Las pantallas donde la prueba se rindió. */
export const ESTADOS_DE_FALLA = ["falla", "no-se-armo", "no-se-sello", "sin-fondos", "cuenta-sin-armar", "lento", "no-aparece", "sorteo-trabado", "no-es-aca", "sin-llaves", "en-app", "sin-bloqueo"];

/**
 * Espera a que la página llegue a una de las pantallas. Devuelve `{ estado, ok }`: `ok` es verdadero solo si llegó a una de
 * las pedidas, y falso si llegó a una de falla o se acabó el tiempo.
 */
export async function esperarEstado(cdp, pedidos, ms, { fallas = ESTADOS_DE_FALLA } = {}) {
  const todas = [...pedidos, ...fallas.filter((f) => !pedidos.includes(f))];
  const lista = JSON.stringify(todas);
  const r = await cdp.waitFor(`${lista}.includes(window.__pruebaLlave?.estado)`, ms);
  const estado = await cdp.eval("window.__pruebaLlave?.estado ?? null").catch(() => null);
  return { estado, ok: r.ok && pedidos.includes(estado) };
}

/** Lo que tiene que haber dado bien para que la prueba cuente como buena. Si un check no se emitió, es que no se llegó. */
export const CHECKS_PRINCIPALES = ["previo", "carga", "crear", "sellar", "sortear", "coincide", "verificacion-ok"];

/** Las fallas que no son de la prueba: el grifo o el servicio de azar público no contestaron. */
const FALLA_AJENA = /^(grifo|ronda)/;

/**
 * El código de salida: 0 si lo principal dio bien, 1 si la prueba falló, 2 si no se pudo medir (la red cambió o el grifo,
 * la red o el servicio de azar no contestaron). El paso de otro aparato nunca lo cambia.
 * Un check principal que nunca se emitió (la página no cargó, se acabó el tiempo) cuenta como falla, y el check `tope` en
 * falso también.
 * @param {{ checks: Array<{ nombre: string, ok: boolean }>, fallas: Array<{ motivo: string }>, previo?: { salida: number } }} o
 */
export function codigoDeSalida(o) {
  if (o.previo && o.previo.salida === 2) return 2;
  const vistos = new Map(o.checks.map((c) => [c.nombre, c.ok]));
  const faltan = CHECKS_PRINCIPALES.some((n) => vistos.get(n) !== true);
  const sinTope = vistos.get("tope") === false;
  if (!faltan && !sinTope) return 0;
  const ajena = o.fallas.length > 0 && o.fallas.every((f) => FALLA_AJENA.test(f.motivo));
  return ajena && !sinTope ? 2 : 1;
}

/**
 * Qué decir del paso de otro aparato cuando no se pudo entrar. `indice-atrasado` solo si el kit dijo que el índice estaba
 * atrasado y el atraso de ahora, en segundos de ledger (unos 5 cada uno), supera lo que se esperó. Cualquier otra cosa es
 * `fallo`, con el texto del error para que se pueda leer.
 * @param {{ estado: string | null, error: string, atrasoAhora: number | null, segundos: number }} o
 */
export function clasificarOtroAparato(o) {
  const dijoAtrasado = /indexer is stale/i.test(o.error ?? "");
  const supera = typeof o.atrasoAhora === "number" && o.atrasoAhora * 5 > o.segundos;
  const resultado = o.estado === "no-aparece" && dijoAtrasado && supera ? "indice-atrasado" : "fallo";
  return { resultado, estado: o.estado, error: o.error ?? "", atrasoAlFinal: o.atrasoAhora };
}

/** El archivo de medidas, con la forma de la sección de la prueba. */
export function armarDatos({ medidas, previo, navegador, virtual, segundos, otroAparato, segundoSello, verificacion }) {
  return {
    version: 1,
    red: "testnet",
    contrato: medidas?.contrato ?? null,
    kit: medidas?.kit ?? null,
    codigoCuenta: medidas?.codigoCuenta ?? null,
    navegador,
    virtual,
    inicio: medidas?.inicio ?? null,
    segundos: Math.round(segundos),
    aviso: "Cifras de la red de prueba. No se proyectan a la red principal.",
    ttlMinimoPersistente: medidas?.ttlMinimoPersistente ?? 120960,
    inclusionFijada: medidas?.inclusionFijada ?? 100,
    previo: previo ?? null,
    pagador: medidas?.pagador ?? null,
    cuenta: medidas?.cuenta ?? null,
    sello: medidas?.sello ?? null,
    sorteo: medidas?.sorteo ?? null,
    verificacion: verificacion ?? null,
    otroAparato: otroAparato ? { ...otroAparato, segundoSello: segundoSello ?? null } : null,
    fallas: medidas?.fallas ?? [],
  };
}
