/**
 * La vista de espectador (`ui/espectador.ts`): el show se mira entero y no se salta. Saltar la tarjeta o el juego le
 * mostraría al celular quién gana antes que a la sala. Lo leen el Saltar del estadio (`games/overlay.ts`) y el de la
 * tarjeta de cómo se juega (`ui/gamecard.ts`).
 *
 * Vive aparte y sin dependencias: la tarjeta se prueba sin el estado de la página (`state.ts` lee la dirección al
 * cargarse).
 */
let soloMirar = false;

export function setSoloMirar(on: boolean): void {
  soloMirar = on;
}

export const esSoloMirar = (): boolean => soloMirar;
