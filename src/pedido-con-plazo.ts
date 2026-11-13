/**
 * Cuánto se espera a un relay de la fuente del número antes de pasar al siguiente, en el primer pedido a cada
 * dirección. Una ronda que ya nació contesta en menos de un segundo. Un relay que acepta la conexión y no contesta
 * dejaba el sorteo en Esperando el número hasta que cortara el navegador, porque `fetchRound` no rotaba mientras ese
 * pedido seguía abierto.
 */
export const PLAZO_DEL_RELAY_MS = 4_000;

/**
 * Cuántas vueltas por las fuentes crece el plazo. En la primera vuelta cada pedido espera `ms`, en la segunda el doble
 * y en la tercera el triple. De ahí en adelante se queda en el triple, así que una fuente colgada nunca deja el
 * sorteo esperando para siempre.
 */
export const VUELTAS_DEL_PLAZO = 3;

/**
 * Un `fetch` que corta cada pedido a los `ms` milisegundos, y a cada dirección le da más tiempo en cada vuelta:
 * `ms`, `2 * ms` y `3 * ms`. Así una fuente colgada se descarta rápido, pero una red lenta con las fuentes sanas
 * (el wifi de un salón lleno) sigue sacando el número en vez de cortar los doce intentos a los 4 s.
 *
 * Con `AbortController` y `setTimeout`, no con `AbortSignal.timeout`, que los Safari viejos no traen. El corte llega
 * como un error del pedido: para `fetchRound` es un relay que falló, y pasa al siguiente. Si el que llama trae su
 * propia señal, esa sigue cortando.
 *
 * La cuenta es por dirección y vive en el `fetch` que devuelve: se arma uno nuevo en cada pedido de una ronda.
 */
export function conPlazo(base: typeof fetch, ms: number, vueltas = VUELTAS_DEL_PLAZO): typeof fetch {
  const pedidos = new Map<string, number>();
  return (entrada, init) => {
    const direccion = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const veces = (pedidos.get(direccion) ?? 0) + 1;
    pedidos.set(direccion, veces);
    const plazo = ms * Math.min(veces, vueltas);
    const corte = new AbortController();
    const deAfuera = init?.signal;
    if (deAfuera) {
      if (deAfuera.aborted) corte.abort(deAfuera.reason);
      else deAfuera.addEventListener("abort", () => corte.abort(deAfuera.reason), { once: true });
    }
    // El reloj no se apaga cuando llegan los encabezados: el plazo cubre también leer la respuesta.
    setTimeout(() => corte.abort(new Error("el relay no contestó a tiempo")), plazo);
    return base(entrada, { ...init, signal: corte.signal });
  };
}
