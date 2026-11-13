import { cabe, type Caja, type Zona } from "./encuadre";

/** Fuente única de la animación existente; sus valores y duración no cambian. */
export const ENTRADA_RELATOR = { duracion: 280, escalas: [.92, 1], curva: [.34, 1.56, .64, 1] } as const;

/** Cota del viaje vertical entre dos lecturas durante el mismo pop (origen CSS central).
 * B'_y(t)=3(1-t)[y1+(2-3y1)t], pues el segundo control Y es 1.
 * Los controles X cambian cuándo ocurre el pico, no su amplitud.
 * altoVisible / escalaMin acota el alto sin transformar, incluso si el compositor avanzó.
 */
export function reservaRelator(altoVisible: number, animando: boolean): number {
  if (!animando) return 0;
  const desde = ENTRADA_RELATOR.escalas[0];
  return altoVisible * (escalaMaxRelator() - desde) / (2 * desde);
}

/** La escala más grande que alcanza la entrada del relator: el pico del rebote de su curva. */
export function escalaMaxRelator(): number {
  const [desde, hasta] = ENTRADA_RELATOR.escalas, y1 = ENTRADA_RELATOR.curva[1];
  const t = y1 / (3 * y1 - 2);
  const pico = 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t + t ** 3;
  return desde + (hasta - desde) * pico;
}

/**
 * Lo que el rebote de la entrada asoma por arriba de la caja final del relator (`alto` es el alto sin transformar). La
 * escala va alrededor del centro, así que arriba asoma la mitad de lo que crece de más. No depende de en qué punto de
 * la entrada está: es la misma reserva en todos los cuadros.
 */
export function sobrepasoRelator(alto: number): number {
  return (alto * Math.max(0, escalaMaxRelator() - 1)) / 2;
}

/**
 * El nombre de la ficha que acompaña al cuerpo que se despeja. Ese cuerpo es el del primer premio, así que la ficha
 * lleva solo ese nombre. Los demás premios llegan con su cartel, cada uno a su hora, y nunca se adelantan acá.
 */
export function nombreDeLaFicha(ganadores: readonly string[]): string {
  return ganadores[0] ?? "";
}

/**
 * Solo reduce si no existe traslación que haga caber el cuerpo entre ambos bordes. Reduce alrededor del centro del
 * cuerpo, como lo aplica el estadio (`despejarGanador`), y después lo corre lo justo para que entre. Hasta el 13 de
 * noviembre de 2026 reducía desde la esquina de arriba a la izquierda de la pantalla: con cinco premios el cartel achica
 * el cuerpo a seis décimos y el caramelo de la piñata se iba 260 px a la izquierda justo cuando entraba el cartel.
 */
export function ajusteGanador(cuerpo: Caja, zona: Zona) {
  const s = Math.min(1, cabe(cuerpo, zona));
  const w = cuerpo.w * s, h = cuerpo.h * s;
  const x = cuerpo.x + (cuerpo.w - w) / 2, y = cuerpo.y + (cuerpo.h - h) / 2;
  const dx = x < zona.x0 ? zona.x0 - x : x + w > zona.x1 ? zona.x1 - (x + w) : 0;
  const dy = y < zona.y0 ? zona.y0 - y : y + h > zona.y1 ? zona.y1 - (y + h) : 0;
  return { s, caja: { x: x + dx, y: y + dy, w, h }, dx, dy };
}

/** Traslación vertical de pantalla: no altera tamaño, zoom ni física. */
export function desplazamientoParaPiso(cuerpo: Pick<Caja, "y" | "h">, piso: number): number {
  return Math.min(0, piso - cuerpo.y - cuerpo.h);
}

/**
 * Holgura extra, en píxeles, que pide el despeje en 3D. La perspectiva no es lineal y el despeje llega a los 4 px desde
 * abajo: en la matriz quedaba entre 3,97 y 3,9998 px del relator en la piñata y la carrera en 3D. En 2D no hace falta.
 */
export const HOLGURA_3D = 1;
