/**
 * El título de Dejá tu cuenta lista para cuando lo único que le falta a la cuenta es el acceso al modo Oficial, que
 * la sección 8 del diseño del cobro por uso no trae. Va aparte para que `alta-textos.ts` siga siendo la sección 8 tal
 * cual, con las mismas reglas de escritura (las comprueba `alta-textos-paso.test.ts`). Decir Activá tu cuenta
 * contradiría que la cuenta ya está activada.
 *
 * Y los del regalo de quien entra con su cuenta (`POST /v1/alta/gratis`), con el número que manda el servidor en `{n}`:
 * - `altaBienvenida` y `altaBienvenidaLlena`: la línea del paso cuando el regalo se puede recibir, o cuando hoy no se da;
 *   con `llena`, `altaBienvenidaMasTarde` sigue en la misma línea: la cuenta se activa igual y el regalo llega después;
 * - `altaSinActivarAhora`: el pedido del regalo no pudo ni activar la cuenta (el servicio sin margen o en pausa);
 * - `altaRegaloEspera` y `altaRegaloEspera1`: un tope de intentos pasajero, con los minutos en `{min}` (o uno solo). Los
 *   de siempre (`altaErrIntentos`) hablan de cupones, y quien pide el regalo no usó ninguno;
 * - `cupoOfRegaloListo` y `cupoOfRecibir`: la línea del cupo y su botón, con la cuenta activa y el regalo sin recibir;
 * - `cupoOfRegaloError`: «Recibirlos» no se supo cómo salió (sin red, el servicio), en la línea y en Se te acabaron;
 * - `modeOfficialBodyRegalo`: lo que dice de Oficial la hoja de cambio de modo cuando el servidor da el regalo.
 * No llevan el prefijo `cl`: esas claves las fija en cantidad `cuenta-lista-textos.test.ts`.
 */
export const TEXTOS_ALTA_PASO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaTituloSorteos: "Tus sorteos oficiales",
    altaBienvenida: "Organizá {n} sorteos oficiales gratis.",
    altaBienvenidaLlena: "Hoy ya se entregaron los sorteos gratis.",
    altaBienvenidaMasTarde: "Podés recibirlos más tarde.",
    altaSinActivarAhora: "Ahora no se pueden activar cuentas nuevas. Probá más tarde.",
    altaRegaloEspera: "No se pudo activar tu cuenta ahora, probá de nuevo en {min} minutos.",
    altaRegaloEspera1: "No se pudo activar tu cuenta ahora, probá de nuevo en 1 minuto.",
    cupoOfRegaloListo: "Ya podés recibir tus {n} sorteos gratis.",
    cupoOfRecibir: "Recibirlos",
    cupoOfRegaloError: "No se pudieron recibir tus sorteos gratis, probá de nuevo.",
    modeOfficialBodyRegalo: "Para los sorteos que cuentan. Organizás {n} gratis.",
  },
  en: {
    altaTituloSorteos: "Your Live draws",
    altaBienvenida: "Run {n} Live draws for free.",
    altaBienvenidaLlena: "Today's free draws are all given out.",
    altaBienvenidaMasTarde: "You can get them later.",
    altaSinActivarAhora: "New accounts can't be activated right now. Try again later.",
    altaRegaloEspera: "We couldn't activate your account right now, try again in {min} minutes.",
    altaRegaloEspera1: "We couldn't activate your account right now, try again in 1 minute.",
    cupoOfRegaloListo: "Your {n} free Live draws are ready.",
    cupoOfRecibir: "Get them",
    cupoOfRegaloError: "We couldn't get your free Live draws, try again.",
    modeOfficialBodyRegalo: "For the draws that count. Run {n} for free.",
  },
};
