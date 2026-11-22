/**
 * Si la página mira el resultado cada pocos segundos (la ventana rápida) cuando la lista está sellada y la sala dice la ronda.
 * Sin imports.
 *
 * Cada celular pregunta cada 8 segundos durante dos minutos y medio: con 300 celulares son unos 37 pedidos por segundo al objeto
 * de la sala. El diseño pide, ANTES de prenderla, la caché de borde de 2 segundos en la sala y la medida de lo que el objeto
 * aguanta con 300 celulares simulados. Esa condición no puede vivir solo en el orden en que se publican el servidor y el sitio:
 * queda escrita acá, en un interruptor.
 *
 * Está APAGADA a propósito. Se prende a mano, con este valor en `true`, recién cuando el servidor ya publica la caché y la
 * medida dio bien. Apagada, la cuenta regresiva funciona igual (usa la ronda y la hora de la sala), pero la página sigue con la
 * consulta propia de siempre, cada 24 a 36 segundos, y se entera del resultado con ella.
 */
export const VENTANA_RAPIDA_ENCENDIDA: boolean = false;
