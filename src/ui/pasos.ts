/**
 * Los pasos del sorteo, sin tocar la página.
 *
 * Son cuatro (1 Lista, 2 Sellar, 3 Sortear, 4 Compartir) y de acá salen el
 * indicador de arriba y la línea de la barra de "lo que sigue" (`siguiente.ts`).
 * Está aparte, sin DOM ni estado, para poder probarlo: es la regla de qué toca,
 * y si se equivoca la pantalla le dice a la gente un paso que no es.
 */

export type Paso = 1 | 2 | 3 | 4;

/**
 * En qué paso está el sorteo.
 *
 * El 4 empieza cuando el resultado **ya se ve**, no cuando se sabe: mientras
 * corre el juego el ganador ya está decidido, pero la sala todavía no lo vio y
 * lo que toca sigue siendo el 3. Con la lista sellada ya no se vuelve atrás: el
 * siguiente premio arma otra lista y empieza de nuevo en el 2.
 */
export function pasoDe(e: { nombres: number; sellada: boolean; revelado: boolean }): Paso {
  if (e.revelado) return 4;
  if (e.sellada) return 3;
  return e.nombres >= 2 ? 2 : 1;
}

/**
 * De qué se trata el paso, como clave del diccionario. Cambia con lo que pasa
 * y no con el reloj: es lo que se anuncia al lector de pantalla, y no puede
 * cambiar cada segundo de la cuenta.
 *
 * `apagado` es el botón de verdad: apagado con la lista lista es que se está
 * sellando, y apagado con la ronda ya nacida es que ya se está sorteando.
 * `noCabe` es un orden de turnos más largo de lo que admite la red: el botón
 * está apagado porque no se puede sellar, no porque se esté sellando.
 */
export function claveDelPaso(paso: Paso, e: { segundos: number; apagado: boolean; ganadores: number; turnos?: boolean; noCabe?: boolean }): string {
  switch (paso) {
    case 1:
      // Desde el 22 de octubre de 2026 la barra también ofrece "Pegar lista" (siguiente.ts): su línea dice qué falta.
      return "sigPegar";
    case 2:
      if (e.noCabe) return "sigTope";
      return e.apagado ? "sigSellando" : "sigLista";
    case 3:
      return e.segundos > 0 ? "sigEspera" : e.apagado ? "sigSorteando" : "sigRonda";
    case 4:
      // Un orden de turnos no tiene ganadores: la línea dice que el orden ya salió.
      return e.turnos ? "sigTurnos" : e.ganadores > 1 ? "sigGanaron" : "sigGano";
  }
}

/**
 * El detalle del paso 2 dice también qué se sortea: "12 personas, Termo", o
 * "12 personas, sin premio". El premio queda fijado al sellar (va al
 * contrato), y desde la barra se sellaba sin ver el campo: el cartel, Mis
 * sorteos y el mensaje quedaban con "Sorteo" a secas (buscador de detalles,
 * D19). Informa, no obliga: el premio sigue siendo opcional. Un premio largo
 * (hasta 60 letras) se acorta con `acortarPremio`, que corta entre palabras y
 * nunca deja una a medias: con `max` en 18 la barra entra en un renglón aun
 * en un celular de 320 px. La barra de verdad (`siguiente.ts`) no usa ese
 * tope fijo: mide la pantalla y se queda con lo que entra (`premioQueEntra`).
 * Si ni la primera palabra entra, queda solo la lista: callar el premio no es
 * decir que no hay. Con `sinPremio` en `null` (el ensayo, donde nada se sella
 * de verdad) no se nombra lo que falta: solo la lista, o la lista y el premio
 * si lo hay.
 */
export function detalleDeLista(lista: string, premio: string, sinPremio: string | null, max = 18): string {
  const limpio = premioLimpio(premio);
  return unirDetalle(lista, limpio ? acortarPremio(limpio, max) : sinPremio);
}

/** "12 personas, Termo": el premio (o lo que lo reemplaza) detrás de la lista. Sin nada que agregar, solo la lista. */
export const unirDetalle = (lista: string, resto: string | null): string => (resto ? `${lista}, ${resto}` : lista);

/** El premio con los espacios de más fuera: lo que se mide y lo que se muestra. */
export const premioLimpio = (premio: string): string => premio.trim().replace(/\s+/g, " ");

/** Cuántas veces, como mucho, se mide la pantalla para decidir hasta dónde llega un premio. */
const VUELTAS = 12;

/**
 * La versión más larga del premio que `entra`: entero si entra, y si no cortado
 * entre palabras con puntos suspensivos. Vacío si ni la primera palabra entra
 * (o si no hay premio): una palabra a medias no se entiende, y es mejor callar.
 *
 * `entra` es lo que mide la pantalla de verdad (`siguiente.ts`) o, sin pantalla,
 * un tope de letras (`acortarPremio`): acá solo se decide qué texto probar. Se
 * busca por mitades cuántas palabras dejar, porque cada prueba obliga al
 * navegador a medir: son el entero y unas seis más para un premio de 60 letras,
 * y nunca más de `VUELTAS` por largo que sea el texto. Sirve porque un texto con
 * más palabras nunca ocupa menos lugar.
 */
export function premioQueEntra(premio: string, entra: (premio: string) => boolean): string {
  const limpio = premioLimpio(premio);
  if (!limpio || entra(limpio)) return limpio;
  const palabras = limpio.split(" ");
  // Las primeras `k` palabras, sin una coma, un punto o un guion colgando antes de los puntos suspensivos.
  const corteEn = (k: number): string => {
    const base = palabras.slice(0, k).join(" ").replace(/[\s,.;:\-–—]+$/u, "");
    return base ? `${base}…` : "";
  };
  let mejor = "";
  let desde = 1;
  let hasta = palabras.length - 1;
  for (let vuelta = 0; desde <= hasta && vuelta < VUELTAS; vuelta++) {
    const k = (desde + hasta) >> 1;
    const corte = corteEn(k);
    if (corte && entra(corte)) {
      mejor = corte;
      desde = k + 1;
    } else hasta = k - 1;
  }
  return mejor;
}

/** El premio cortado entre palabras para que no pase de `max` letras (los puntos suspensivos cuentan). Vacío si ni la primera entra. */
export const acortarPremio = (premio: string, max: number): string => premioQueEntra(premio, (texto) => Array.from(texto).length <= max);

/** "0:25", "1:05": la cuenta regresiva tal como la escribe el botón de sortear. */
export const relojDe = (segundos: number): string => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

/**
 * La línea de la barra, como una frase: "Paso 3 de 4: esperando el número, 0:25".
 * `pasoTexto` ya viene traducido ("Paso 3 de 4"); el detalle sigue a los dos
 * puntos, así que empieza en minúscula (los números y los premios quedan como
 * están); el reloj va solo mientras corre.
 */
export const lineaDelPaso = (pasoTexto: string, detalle: string, reloj = ""): string => `${pasoTexto}: ${detalle.replace(/^\p{Lu}/u, (c) => c.toLowerCase())}${reloj ? `, ${reloj}` : ""}`;
