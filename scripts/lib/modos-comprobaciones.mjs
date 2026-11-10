/**
 * Comprobaciones del auditor de los modos (`scripts/audit-modos.mjs`) que no necesitan navegador: se pueden probar solas.
 */

/** El sufijo con que el reparto marca cada participacion en la lista sellada: «Ana Quispe (2/3)». */
const SUFIJO = /\s*\(\d+\/\d+\)\s*$/;

/** El aviso de que alguien salio mas de una vez, en los dos idiomas. La app escribe «salió», con tilde. */
const AVISO = (nombre) => new RegExp(`${escapar(nombre)}\\s+(?:sali[oó]|came out)\\s+(\\d+)\\s+(?:veces|times)`, "i");
const AVISO_CUALQUIERA = /sali[oó]\s+\d+\s+veces|came out\s+\d+\s+times/i;

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** La persona de cada renglon del resultado: el nombre sin el sufijo de la participacion. */
export const personasDeLosRenglones = (nombres) => nombres.map((n) => n.replace(SUFIJO, "").trim());

/**
 * ¿El resultado avisa bien de quien salio mas de una vez? Los renglones traen la linea sellada con su sufijo, que es
 * siempre distinta: se cuenta por persona. Si alguien repite, la caja tiene que decir de quien y cuantas veces; si
 * nadie repite, no puede haber ningun aviso.
 */
export function evaluarRepetidos(nombres, caja) {
  const personas = personasDeLosRenglones(nombres);
  const veces = new Map();
  for (const p of personas) veces.set(p, (veces.get(p) ?? 0) + 1);
  const repetidos = [...veces].filter(([, n]) => n > 1);
  if (repetidos.length === 0) {
    return { ok: !AVISO_CUALQUIERA.test(caja), hayRepetidos: false, detalle: personas.join(" / ") };
  }
  const faltan = repetidos.filter(([nombre, n]) => {
    const m = AVISO(nombre).exec(caja);
    return !m || Number(m[1]) !== n;
  });
  return {
    ok: faltan.length === 0,
    hayRepetidos: true,
    detalle: faltan.length
      ? `falta el aviso de ${faltan.map(([nombre, n]) => `${nombre} (${n} veces)`).join(", ")}`
      : repetidos.map(([nombre, n]) => `${nombre} (${n} veces)`).join(", "),
  };
}

/**
 * Lo que tiene que decir la verificacion del caso C cuando se le quita `?modo=` a la direccion. En la construccion de
 * siempre la lista sale linea por linea (siete participantes); en una construccion con la bandera (`VITE_MODOS=1`) los
 * modos estan a la vista aunque la direccion no los traiga, y sale agrupada por persona (cuatro personas, siete
 * participaciones, cuatro renglones).
 */
export function esperadoSinElParametro(conBandera) {
  return conBandera
    ? { cuenta: /4\s*personas/i, cuentaDetalle: "4 personas y 7 participaciones", renglones: 4 }
    : { cuenta: /7\s*participantes|7\s*entries/i, cuentaDetalle: "7 participantes", renglones: 7 };
}
