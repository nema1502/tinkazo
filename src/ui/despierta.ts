/**
 * La pantalla no se apaga mientras se sortea.
 *
 * Desde que se sella la lista hasta que se pasa al siguiente premio (la espera
 * del número, el juego y el resultado en el proyector), un celular que se
 * duerme en la mitad corta el show delante de la sala. Se pide el bloqueo de
 * pantalla (Wake Lock) por motivos: mientras haya alguno, se mantiene; cuando
 * se sueltan todos, se libera.
 *
 * El sistema lo suelta solo cuando la pestaña pasa a segundo plano (cambiar de
 * app, bloquear el celular): al volver se pide de nuevo, sin que nadie toque
 * nada. Falla en silencio donde el navegador no lo ofrece, o con la batería baja:
 * no hace falta para sortear.
 */

interface CentinelaLike {
  release(): Promise<void>;
  addEventListener?(tipo: "release", fn: () => void): void;
}
interface WakeLockLike {
  request(tipo: "screen"): Promise<CentinelaLike>;
}
type NavConWakeLock = Navigator & { wakeLock?: WakeLockLike };

const motivos = new Set<string>();
let centinela: CentinelaLike | null = null;
let pidiendo = false;

async function pedir(): Promise<void> {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as NavConWakeLock);
  if (!nav?.wakeLock || centinela || pidiendo || !motivos.size) return;
  if (document.visibilityState !== "visible") return;
  pidiendo = true;
  try {
    const c = await nav.wakeLock.request("screen");
    // Se soltaron todos los motivos mientras se pedía.
    if (!motivos.size) {
      void c.release().catch(() => undefined);
      return;
    }
    centinela = c;
    c.addEventListener?.("release", () => {
      if (centinela === c) centinela = null;
    });
  } catch {
    /* sin permiso o con la batería baja: la pantalla se apagará, y no es fatal */
  } finally {
    pidiendo = false;
  }
}

/** Pide que la pantalla siga encendida por este motivo. Se puede repetir. */
export function mantenerDespierta(motivo: string): void {
  motivos.add(motivo);
  void pedir();
}

/** Suelta este motivo; sin ningún otro, la pantalla vuelve a apagarse sola. */
export function soltarDespierta(motivo: string): void {
  motivos.delete(motivo);
  if (motivos.size || !centinela) return;
  const c = centinela;
  centinela = null;
  void c.release().catch(() => undefined);
}

/** Si algún motivo la mantiene encendida (para las pruebas). */
export const despiertaPedida = (): boolean => motivos.size > 0;

if (typeof document !== "undefined") {
  // Al volver a la página (otra app, el celular desbloqueado), se pide de nuevo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      centinela = null;
      void pedir();
    }
  });
}
