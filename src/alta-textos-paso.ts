/**
 * El título de Dejá tu cuenta lista para cuando lo único que le falta a la cuenta es el acceso al modo Oficial, que
 * la sección 8 del diseño del cobro por uso no trae. Va aparte para que `alta-textos.ts` siga siendo la sección 8 tal
 * cual, con las mismas reglas de escritura (las comprueba `alta-textos-paso.test.ts`). Decir Activá tu cuenta
 * contradiría que la cuenta ya está activada.
 */
export const TEXTOS_ALTA_PASO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaTituloSorteos: "Tus sorteos oficiales",
  },
  en: {
    altaTituloSorteos: "Your Live draws",
  },
};
