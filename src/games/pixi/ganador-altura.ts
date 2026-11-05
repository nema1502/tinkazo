import { dentro, enPantalla, type Caja, type Zona } from "./encuadre";

/** Fuente única de la animación existente; sus valores y duración no cambian. */
export const ENTRADA_RELATOR = { duracion: 280, escalas: [.92, 1], curva: [.34, 1.56, .64, 1] } as const;

/** Cota del viaje vertical entre dos lecturas durante el mismo pop (origen CSS central).
 * B'_y(t)=3(1-t)[y1+(2-3y1)t], pues el segundo control Y es 1.
 * Los controles X cambian cuándo ocurre el pico, no su amplitud.
 * altoVisible / escalaMin acota el alto sin transformar, incluso si el compositor avanzó.
 */
export function reservaRelator(altoVisible: number, animando: boolean): number {
  if (!animando) return 0;
  const [desde, hasta] = ENTRADA_RELATOR.escalas, y1 = ENTRADA_RELATOR.curva[1];
  const t = y1 / (3 * y1 - 2);
  const pico = 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t + t ** 3;
  const escalaMax = desde + (hasta - desde) * pico;
  return altoVisible * (escalaMax - desde) / (2 * desde);
}

/** Solo reduce si no existe traslación que haga caber el cuerpo entre ambos bordes. */
export function ajusteGanador(cuerpo: Caja, zona: Zona) {
  const vista = dentro(cuerpo, zona, { x: 0, y: 0, z: 1 }, 0, 0);
  const s = vista.z, caja = enPantalla(cuerpo, vista, 0, 0);
  return { s, caja, dx: caja.x - (cuerpo.x + cuerpo.w * (1 - s) / 2),
    dy: caja.y - (cuerpo.y + cuerpo.h * (1 - s) / 2) };
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
