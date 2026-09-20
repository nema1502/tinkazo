import "./styles.css";
import { setLang } from "./i18n";
import { params } from "./state";

/**
 * La página de precios y del "cómo funciona por dentro".
 *
 * Vive aparte para que la página principal sea la herramienta y nada más.
 * Quien entra a sortear no tiene que pasar por una tabla de precios antes de
 * poder pegar su lista.
 */
setLang(params.get("lang") === "en" || navigator.language.startsWith("en") ? "en" : "es");
document.getElementById("l-es")?.addEventListener("click", () => setLang("es"));
document.getElementById("l-en")?.addEventListener("click", () => setLang("en"));
