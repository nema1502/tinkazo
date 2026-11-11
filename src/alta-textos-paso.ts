/**
 * Dos textos de «Dejá tu cuenta lista» para cuando lo único que le falta a la cuenta es el acceso al modo Oficial, que
 * la sección 8 del diseño del cobro por uso no trae. Van aparte para que `alta-textos.ts` siga siendo la sección 8 tal
 * cual, con las mismas reglas de escritura (las comprueba `alta-textos-paso.test.ts`).
 *
 * - `altaTituloSorteos`: el título de la parte 1 cuando la cuenta ya está activada y le falta el acceso. Decir ahí
 *   «Activar tu cuenta» contradice lo que dice la caja («Tu cuenta ya está activada»).
 * - `altaBajadaUnPaso`: la bajada cuando la cuenta ya está activada y protegida. «Faltan dos pasos» no sería cierto.
 */
export const TEXTOS_ALTA_PASO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaTituloSorteos: "Tus sorteos oficiales",
    altaBajadaUnPaso: "Para sortear en modo Oficial te falta un solo paso.",
  },
  en: {
    altaTituloSorteos: "Your Live draws",
    altaBajadaUnPaso: "One more step before you draw in Live mode.",
  },
};
