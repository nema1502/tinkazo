/**
 * Lo que esta pestaña recuerda de cómo está la cuenta de quien participa, por sorteo. Sirve para que quien ya está anotada y
 * recarga no tenga que retomar la sesión del proveedor (son varios pedidos por recarga) solo para saber lo que ya se sabía.
 *
 * Se baja con `import()`: solo lo necesita quien recarga ya anotada, y lo que se anota se anota en el momento en que se lee la
 * cuenta. Vive en `sessionStorage` (esta pestaña, nada más) y guarda solo lo que la pantalla necesita: el estado, dos
 * banderas, si se puede mandar el código y el correo ya tapado. Nunca el correo entero, un token ni un nombre.
 */

import type { CuentaDelCelular, LecturaDelCelular } from "../stellar/wallet-pollar";

const clave = (sala: string): string => `tinkazo.cmp.cuenta.${sala}`;

/** Los estados que se recuerdan: los que se saben. Una cuenta que se está creando o que no se supo no se recuerda. */
const ESTADOS: readonly CuentaDelCelular[] = ["lista", "falta", "otro-con-correo", "otro-con-desbloqueo", "sin-forma"];

/** Anota lo que se supo de `cuenta`. Sin saber (o sin cuenta), olvida lo anotado. Un almacenamiento que falla no cambia nada. */
export function recordarLaCuenta(almacen: Storage, sala: string, cuenta: string | null, datos: LecturaDelCelular | null): void {
  try {
    if (cuenta !== null && datos !== null && ESTADOS.includes(datos.estado)) {
      almacen.setItem(clave(sala), JSON.stringify({ c: cuenta, e: datos.estado, p: datos.protegida, k: datos.correoDeLaSesionConfirmado, m: datos.puedeMandar, t: datos.correoTapado }));
    } else almacen.removeItem(clave(sala));
  } catch {
    /* sin almacenamiento se pregunta de nuevo al recargar: no cambia nada más */
  }
}

/** Lo que esta pestaña recordaba de la cuenta, si es de esta cuenta y tiene la forma de lo que se guarda. */
export function cuentaRecordada(almacen: Storage, sala: string, cuenta: string): LecturaDelCelular | null {
  try {
    const crudo = almacen.getItem(clave(sala));
    if (!crudo) return null;
    const v = JSON.parse(crudo) as Record<string, unknown>;
    const estado = ESTADOS.find((e) => e === v.e);
    if (v.c !== cuenta || estado === undefined) return null;
    return {
      estado,
      protegida: v.p === true,
      correoDeLaSesionConfirmado: v.k === true,
      puedeMandar: v.m === true,
      correoTapado: typeof v.t === "string" ? v.t : null,
      limite: false,
    };
  } catch {
    return null;
  }
}
