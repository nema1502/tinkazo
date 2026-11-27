/**
 * Lo que Ganaste suma en una campaña de personas con el premio en dólares, en español y en inglés: a quién pasarle la dirección
 * donde se reciben, y qué hacer si no se tiene dónde.
 *
 * Es un diccionario propio y no va con los de la página: se baja con lo de Ganaste (`premio.ts`), durante la espera, y la entrada
 * de la página no lo carga. No pasa por el armado del sitio, que mete en el HTML solo las claves que nombran los archivos de la
 * página: se lee desde acá, con `TEXTOS_GANASTE_DOLARES[idioma][clave]`.
 */

export const TEXTOS_GANASTE_DOLARES: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    gdDireccion: "Y pasale la dirección donde recibís dólares digitales.",
    gdSinDonde: "No tengo dónde recibirlos",
    gdPaso1: "Entrá a Tinkazo con Google y dejá tu cuenta lista.",
    gdPaso2: "Tocá tu cuenta, abrí Tus dólares digitales y tocá Preparar mi cuenta.",
    gdPaso3: "En tu cuenta, tocá Copiar y pasale esa dirección a quien organiza.",
    gdAbrir: "Abrir Tinkazo",
  },
  en: {
    gdDireccion: "And give them the address where you receive digital dollars.",
    gdSinDonde: "I have nowhere to receive them",
    gdPaso1: "Sign in to Tinkazo with Google and get your account ready.",
    gdPaso2: "Tap your account, open Your digital dollars and tap Get my account ready.",
    gdPaso3: "In your account, tap Copy and give that address to the organizer.",
    gdAbrir: "Open Tinkazo",
  },
};
