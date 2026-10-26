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
 */
export function claveDelPaso(paso: Paso, e: { segundos: number; apagado: boolean; ganadores: number }): string {
  switch (paso) {
    case 1:
      // Desde el 22 de octubre de 2026 la barra también ofrece "Pegar lista" (siguiente.ts): su línea dice qué falta.
      return "sigPegar";
    case 2:
      return e.apagado ? "sigSellando" : "sigLista";
    case 3:
      return e.segundos > 0 ? "sigEspera" : e.apagado ? "sigSorteando" : "sigRonda";
    case 4:
      return e.ganadores > 1 ? "sigGanaron" : "sigGano";
  }
}

/**
 * El detalle del paso 2 dice también qué se sortea: "12 personas · Termo", o
 * "12 personas · sin premio". El premio queda fijado al sellar (va al
 * contrato), y desde la barra se sellaba sin ver el campo: el cartel, Mis
 * sorteos y el mensaje quedaban con "Sorteo" a secas (buscador de detalles,
 * D19). Informa, no obliga: el premio sigue siendo opcional. Un premio largo
 * (hasta 60 letras) se corta con puntos suspensivos, para que la barra entre
 * en un renglón también en un celular de 320 px.
 */
export function detalleDeLista(lista: string, premio: string, sinPremio: string, max = 18): string {
  const letras = Array.from(premio.trim().replace(/\s+/g, " "));
  const corto = letras.length > max ? `${letras.slice(0, max - 1).join("").trimEnd()}…` : letras.join("");
  return `${lista} · ${corto || sinPremio}`;
}

/** "0:25", "1:05": la cuenta regresiva tal como la escribe el botón de sortear. */
export const relojDe = (segundos: number): string => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

/**
 * La línea de la barra: "Paso 3 de 4 · Esperando la ronda · 0:25". `pasoTexto`
 * ya viene traducido ("Paso 3 de 4"); el reloj va solo mientras corre.
 */
export const lineaDelPaso = (pasoTexto: string, detalle: string, reloj = ""): string => `${pasoTexto} · ${detalle}${reloj ? ` · ${reloj}` : ""}`;
