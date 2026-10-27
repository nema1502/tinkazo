import { decidirPantalla, entornoDeAhora, grandeRechazada, permitirGrande, type PedidoDePantalla } from "./vista-grande";

/**
 * La pantalla completa, pedida donde el navegador la concede.
 *
 * El navegador solo la da dentro de un gesto de la persona: el clic en "Sellar
 * la lista" o en "Lanzar el sorteo". Por eso se pide en el manejador del clic,
 * sincrónica y antes de cualquier `await` (la firma con Pollar o con Freighter
 * abre después, y para entonces el gesto ya no vale). Si el navegador la niega
 * o no la ofrece, no pasa nada: la vista grande es una capa de la propia página
 * y se abre igual (`espera.ts`).
 *
 * La decisión vive aparte, sin DOM, en `vista-grande.ts` (`decidirPantalla`), con
 * sus pruebas.
 */

type ConActivacion = Navigator & { userActivation?: { isActive: boolean } };

/** ¿La persona acaba de tocar algo? Sin la API (navegadores viejos) se supone que sí: el navegador decide. */
const hayGesto = (): boolean => (navigator as ConActivacion).userActivation?.isActive ?? true;

/**
 * Pide la pantalla completa de la página. **Sincrónica**: tiene que correr dentro
 * del manejador del clic. `aMano`: la persona la pidió con su propio toque
 * ("Mostrar la espera en grande"), así que lo que había soltado vuelve a valer.
 */
export function pedirPantallaCompleta(opciones: { aMano?: boolean } = {}): PedidoDePantalla {
  if (opciones.aMano) permitirGrande();
  const raiz = document.documentElement;
  const decision = decidirPantalla({
    hayApi: typeof raiz.requestFullscreen === "function",
    yaEnPantalla: document.fullscreenElement !== null,
    gesto: hayGesto(),
    rechazada: grandeRechazada(entornoDeAhora()),
  });
  if (decision === "pedida") {
    try {
      // Rechaza si el navegador no la concede (sin gesto, dentro de un marco): no es un error, se sigue sin ella.
      void Promise.resolve(raiz.requestFullscreen({ navigationUI: "hide" })).catch(() => undefined);
    } catch {
      /* un navegador que la tira en vez de rechazar: igual */
    }
  }
  return decision;
}

/** Suelta la pantalla completa si la página la tiene. */
export function soltarPantallaCompleta(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
