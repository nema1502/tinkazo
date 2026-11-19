/**
 * Lo que lee la ruta pública `GET /`, guardado 60 segundos en la memoria del Worker.
 *
 * La ruta es pública: cualquiera puede pedirla muchas veces. Sin esto, cada pedido leería el KV. Con esto, una lluvia
 * de pedidos casi nunca llega a él: lee una vez por minuto, y los pedidos que llegan a la vez mientras se lee comparten
 * esa lectura. Es una variable del módulo, de cada instancia del Worker, que se pierde sola cuando la instancia se va.
 *
 * Una vuelta nueva la olvida (`olvidarMemoriaDeLaRuta`) para que se vea enseguida. La vuelta no usa esto: ella siempre
 * lee el KV de verdad.
 */
import type { Memoria } from "./vuelta";

/** Cuánto vale lo leído: un minuto. La vuelta es cada diez, así que la demora no se nota. */
export const CACHE_RUTA_MS = 60_000;

let guardada: { hasta: number; memoria: Memoria } | null = null;
let leyendo: Promise<Memoria> | null = null;

/** Borra lo guardado. La vuelta lo llama al escribir, y las pruebas al armar su mundo. */
export function olvidarMemoriaDeLaRuta(): void {
  guardada = null;
  leyendo = null;
}

/** La memoria para la ruta: la guardada si no venció, y si no, la que trae `leer`, que se guarda. `ahora` en milisegundos. */
export function memoriaDeLaRuta(leer: () => Promise<Memoria>, ahora: number): Promise<Memoria> {
  if (guardada && ahora < guardada.hasta) return Promise.resolve(guardada.memoria);
  if (leyendo) return leyendo;
  const lectura = leer().then(
    (memoria) => {
      if (leyendo === lectura) {
        guardada = { hasta: ahora + CACHE_RUTA_MS, memoria };
        leyendo = null;
      }
      return memoria;
    },
    (error: unknown) => {
      if (leyendo === lectura) leyendo = null;
      throw error;
    },
  );
  leyendo = lectura;
  return lectura;
}
