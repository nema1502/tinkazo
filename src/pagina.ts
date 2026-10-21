import "./styles.css";
import { chooseLang, initialLang, onLangChange, setLang, textosDeLaPagina } from "./idioma";
import { network } from "./stellar/config";
import { loadSessionKind } from "./stellar/session-store";
import { initMenuMas } from "./ui/menu";

/**
 * Las páginas de lectura: precios, juegos, historia y seguridad.
 *
 * Viven aparte de la herramienta a propósito. Quien entra a sortear no tiene
 * que pasar por una página de presentación antes de poder pegar su lista, y
 * quien quiere entender el proyecto no tiene que aprender a usarlo primero.
 *
 * Todas cargan lo mismo: el idioma y los dos botones de la cabecera. No hay
 * nada de red acá. Los textos vienen en el HTML de cada página, solo los que
 * esa página usa (ver `idioma.ts`): el diccionario entero es de la herramienta.
 */
textosDeLaPagina();
// `?theme=light|dark` fuerza el tema, igual que en la página principal: sirve
// para las capturas y para mirar las dos versiones sin tocar el sistema. Se
// lee acá y no de `state`, que es de la herramienta y arrastra a los juegos.
const tema = new URLSearchParams(location.search).get("theme");
if (tema === "light" || tema === "dark") {
  document.documentElement.dataset.theme = tema;
  // Las imágenes con versión clara la eligen por el tema del sistema: con
  // el tema forzado, la versión del tema del sitio.
  document.querySelectorAll<HTMLSourceElement>('picture source[media*="prefers-color-scheme"]').forEach((s) => {
    s.media = tema === "light" ? "all" : "not all";
  });
}

// La cuenta también se ve acá, si hay una sesión guardada en esta red: "Mi
// cuenta" lleva a sus sorteos. Sin sesión no hay nada que mostrar: "Entrar" no
// va en la cabecera, la portada y la puerta del sorteo ya lo dicen. Sin cargar
// ninguna billetera: solo se lee qué tipo de sesión había.
if (loadSessionKind(network.name)) {
  const a = document.createElement("a");
  a.className = "mini pg-auth";
  a.href = "/#mis-sorteos";
  a.dataset.i = "navCuenta";
  document.querySelector("header .bar")?.appendChild(a);
}
initMenuMas();
setLang(initialLang());
// El contador va aparte y después: no frena la página y queda en su propio
// archivo, chico, en vez de darle su nombre al código común.
void import("./analytics").then((m) => m.countVisits());
// Las tablas que se apilan en el celular llevan el rótulo de su columna en cada celda.
const rotular = (): void => {
  document.querySelectorAll<HTMLElement>("[data-label-i]").forEach((el) => {
    const src = document.querySelector<HTMLElement>(`th[data-i="${el.dataset.labelI}"]`);
    if (src) el.dataset.label = src.textContent ?? "";
  });
};
rotular();
onLangChange(rotular);
document.getElementById("l-es")?.addEventListener("click", () => chooseLang("es"));
document.getElementById("l-en")?.addEventListener("click", () => chooseLang("en"));
