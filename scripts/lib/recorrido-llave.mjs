/**
 * Las piezas del recorrido automático de la prueba de la llave (`scripts/recorrido-llave.mjs`) que se pueden probar sin
 * navegador: el toque con un evento de confianza, la espera de una pantalla, el código de salida y el archivo de medidas.
 */
import { CHECKS_DE_PREMIO } from "./premio-llave.mjs";

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
export const ESTADOS_DE_FALLA = [
  "falla",
  "no-se-armo",
  "no-se-sello",
  "sin-fondos",
  "cuenta-sin-armar",
  "lento",
  "no-aparece",
  "sin-cuenta",
  "vencida",
  "no-se-comprobo",
  "sorteo-trabado",
  "no-es-aca",
  "sin-llaves",
  "en-app",
  "sin-bloqueo",
  "no-recibe",
  "no-se-envio",
  "no-llego-premio",
  "saldo-sin-leer",
  "enlace-mal",
];

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

/** Los pasos de entrar desde otro aparato. */
export const CHECKS_DE_OTRO_APARATO = ["otro-aparato", "misma-cuenta", "un-desbloqueo-al-entrar", "segundo-sello", "dos-fuentes", "sin-cuenta", "sin-indice"];

/**
 * Los pasos de entrar desde otro aparato y de recibir y mandar monedas de prueba. Durante las primeras corridas buenas solo se
 * registran y se muestran: no cambian el código de salida. Después de tres corridas buenas pasan a `CHECKS_PRINCIPALES`.
 */
export const CHECKS_INFORMATIVOS = [...CHECKS_DE_OTRO_APARATO, ...CHECKS_DE_PREMIO];

/**
 * Las fallas que no son de la prueba: el grifo o el servicio de azar público no contestaron, la red no se pudo leer al entrar,
 * o una lectura propia del recorrido (un saldo, la cuenta de destino) falló por la red.
 */
const FALLA_AJENA = /^(grifo|ronda|rpc-ajeno)/;
const esFallaAjena = (f) => FALLA_AJENA.test(f.motivo) || (f.paso === "entrar" && f.motivo === "red");

/**
 * El código de salida: 0 si lo principal dio bien, 1 si la prueba falló, 2 si no se pudo medir (la red cambió o el grifo,
 * la red o el servicio de azar no contestaron). Los pasos de otro aparato no lo cambian mientras sean informativos.
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
  const ajena = o.fallas.length > 0 && o.fallas.every(esFallaAjena);
  return ajena && !sinTope ? 2 : 1;
}

/**
 * Los checks de entrar desde otro aparato con la misma llave, a partir de lo que se midió en cada navegador.
 * @param {{
 *   a?: { contractId?: string, selloId?: string, ledger?: number },
 *   historial?: { estado?: string | null, contractId?: string, entrada?: { fuente?: string, ledgerDeNacimiento?: number | null, desbloqueos?: number | null } | null, sello?: { id?: string, desbloqueos?: number } | null },
 *   rpc?: { estado?: string | null, contractId?: string, entrada?: { fuente?: string, ledgerDeNacimiento?: number | null, desbloqueos?: number | null } | null },
 *   sinCuenta?: { estado?: string | null },
 *   anfitriones?: string[],
 * }} d
 */
export function checksDeOtroAparato(d) {
  const { a, historial, rpc, sinCuenta, anfitriones = [] } = d;
  const eh = historial?.entrada ?? null;
  const er = rpc?.entrada ?? null;
  const mismaCuenta = !!a?.contractId && historial?.contractId === a.contractId && rpc?.contractId === a.contractId;
  const ledgers = [eh?.ledgerDeNacimiento, er?.ledgerDeNacimiento];
  return [
    { nombre: "otro-aparato", ok: historial?.estado === "cuenta-lista", detalle: historial?.estado ?? "sin estado" },
    { nombre: "misma-cuenta", ok: mismaCuenta, detalle: `${historial?.contractId ?? "sin cuenta"} / ${rpc?.contractId ?? "sin cuenta"}` },
    { nombre: "un-desbloqueo-al-entrar", ok: eh?.desbloqueos === 1 && er?.desbloqueos === 1, detalle: `${eh?.desbloqueos ?? "sin dato"} y ${er?.desbloqueos ?? "sin dato"}` },
    {
      nombre: "segundo-sello",
      ok: !!historial?.sello?.id && historial.sello.id !== a?.selloId && historial.sello.desbloqueos === 1,
      detalle: historial?.sello ? `sello ${historial.sello.id}, ${historial.sello.desbloqueos} desbloqueos` : "sin sello",
    },
    {
      nombre: "dos-fuentes",
      ok: eh?.fuente === "historial" && er?.fuente === "rpc" && typeof a?.ledger === "number" && ledgers.every((l) => l === a.ledger),
      detalle: `${eh?.fuente ?? "sin fuente"} ${eh?.ledgerDeNacimiento ?? "-"}, ${er?.fuente ?? "sin fuente"} ${er?.ledgerDeNacimiento ?? "-"}`,
    },
    { nombre: "sin-cuenta", ok: sinCuenta?.estado === "sin-cuenta", detalle: sinCuenta?.estado ?? "sin estado" },
    { nombre: "sin-indice", ok: anfitriones.length > 0 && !anfitriones.some((h) => /mercury/i.test(h)), detalle: `${anfitriones.length} anfitriones` },
  ];
}

/** El archivo de medidas, con la forma de la sección de la prueba. */
export function armarDatos({ medidas, previo, navegador, virtual, segundos, otroAparato, segundoSello, verificacion, premio }) {
  return {
    version: 2,
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
    premio: premio ?? null,
    fallas: medidas?.fallas ?? [],
  };
}
