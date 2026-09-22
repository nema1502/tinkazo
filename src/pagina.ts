import "./styles.css";
import { setLang } from "./i18n";
import { params } from "./state";

/**
 * Las páginas de lectura: precios, juegos, historia y seguridad.
 *
 * Viven aparte de la herramienta a propósito. Quien entra a sortear no tiene
 * que pasar por una página de presentación antes de poder pegar su lista, y
 * quien quiere entender el proyecto no tiene que aprender a usarlo primero.
 *
 * Todas cargan lo mismo: el idioma y los dos botones de la cabecera. No hay
 * nada de red acá.
 */
// `?theme=light|dark` fuerza el tema, igual que en la página principal: sirve
// para las capturas y para mirar las dos versiones sin tocar el sistema.
const tema = params.get("theme");
if (tema === "light" || tema === "dark") document.documentElement.dataset.theme = tema;

setLang(params.get("lang") === "en" || navigator.language.startsWith("en") ? "en" : "es");
document.getElementById("l-es")?.addEventListener("click", () => setLang("es"));
document.getElementById("l-en")?.addEventListener("click", () => setLang("en"));
