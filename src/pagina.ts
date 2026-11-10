import "./styles.css";
import { cargaOpcional } from "./version-nueva";
import { chooseLang, initialLang, onLangChange, setLang, texto, textosDeLaPagina } from "./idioma";
import { contractUrl, network } from "./stellar/config";
import { enlazarContrato } from "./enlace-contrato";
import { leerMarcaPollar } from "./stellar/pollar-config";
import { loadSessionKind } from "./stellar/session-store";
import { crearChip } from "./ui/cuenta-chip";
import { MARCA_INGRESAR, viaDeLaSesionGuardada } from "./ui/cuenta-estado";
import { iniciarFeedback } from "./feedback";
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

/**
 * Fija el tema y deja cada captura pidiendo la versión del tema.
 *
 * Con `?theme=light|dark` (igual que en la página principal: sirve para mirar
 * las dos versiones sin tocar el sistema) este código corre con el HTML ya
 * abierto, así que el navegador puede haber pedido ya la versión del tema del
 * sistema. Solo cambiar el `media` del `<source>` no siempre vuelve a pedir:
 * quedaban capturas sin cargar en juegos.html (sapo, trompo, chovena). Por eso
 * al hacer el tema no se negocia: el `<picture>` queda con una sola fuente, la
 * del tema, escrita en el `img`.
 */
export function fijarElTema(forzado: string | null): void {
  if (forzado !== "light" && forzado !== "dark") return;
  document.documentElement.dataset.theme = forzado;
  document.querySelectorAll<HTMLPictureElement>("picture").forEach((picture) => {
    const source = picture.querySelector<HTMLSourceElement>('source[media*="prefers-color-scheme"]');
    const img = picture.querySelector("img");
    if (!source || !img) return;
    // Las capturas por hoy solo traen versión clara: la clara vive en el
    // `<source>` y la oscura es el `img` de base.
    const pedida = forzado === "light" ? (source.srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? "") : (img.getAttribute("src") ?? "");
    if (!pedida) return;
    source.remove();
    img.src = pedida;
  });
}
fijarElTema(tema);

/**
 * La cuenta, siempre a la vista también acá (26 de octubre de 2026): "Entrar" si no hay cuenta (un enlace a la
 * herramienta, que al abrirse pide entrar) y, si hay una sesión guardada en esta red, "Mi cuenta · Google" (o la vía
 * que sea), que lleva a sus sorteos. Sin cargar ninguna billetera: solo se lee qué tipo de sesión había, así que no hay
 * nombre ni foto (el perfil vive solo en memoria, en la herramienta) y, con una marca vieja, puede decir "Mi cuenta"
 * hasta que se abra la herramienta, que la limpia.
 */
function montarLaCuenta(): void {
  const cabecera = document.querySelector("header .bar");
  if (!cabecera) return;
  cabecera.querySelector(".pg-auth")?.remove();
  // "es / en" y la cuenta, juntos a la derecha, como en la herramienta: sueltos, con la cabecera de dos filas (de 761 a
  // 1100 px) "es / en" quedaba flotando en el medio, entre el logo y el chip.
  let lado = cabecera.querySelector<HTMLElement>(".pg-lado");
  if (!lado) {
    lado = document.createElement("div");
    lado.className = "pg-lado";
    const idiomas = cabecera.querySelector(".langs");
    if (idiomas) {
      idiomas.before(lado);
      lado.appendChild(idiomas);
    } else cabecera.appendChild(lado);
  }
  let marcaPollar: string | null = null;
  try {
    marcaPollar = leerMarcaPollar(localStorage, network.name);
  } catch {
    /* sin almacenamiento no hay marca */
  }
  const via = viaDeLaSesionGuardada(loadSessionKind(network.name), marcaPollar);
  const chip = via
    ? crearChip({ estado: "dentro", via, nombre: "", inicial: "", foto: "", direccion: "" }, { tx: texto, enlace: "/#mis-sorteos", titulo: texto("navCuenta") })
    : crearChip({ estado: "fuera" }, { tx: texto, enlace: "/#sortear" });
  chip.classList.add("pg-auth");
  // "Entrar": la herramienta se abre en otra página y, sin un toque ahí, el navegador bloquearía la ventana de Google; la marca
  // hace que la herramienta deje a la vista un solo botón para entrar, con el foco.
  if (!via) {
    chip.addEventListener("click", () => {
      try {
        sessionStorage.setItem(MARCA_INGRESAR, "1");
      } catch {
        /* sin almacenamiento, la herramienta tiene su propio "Entrar" */
      }
    });
  }
  lado.appendChild(chip);
}
initMenuMas();
iniciarFeedback();
setLang(initialLang());
// El enlace al contrato sigue el modo de la pestaña (`?red=` o lo guardado): en Prueba es el de siempre, el que trae el
// HTML. Nunca se fija a mano al de la red principal: los sorteos de Prueba siguen comprobándose ahí hasta que esa red se
// borre.
enlazarContrato(document, network.contractId ? contractUrl() : null);
montarLaCuenta();
onLangChange(montarLaCuenta);
// El contador va aparte y después: no frena la página y queda en su propio
// archivo, chico, en vez de darle su nombre al código común. Si no baja (un
// bloqueador, el wifi), no pasa nada y no despierta el aviso de versión nueva.
void cargaOpcional(import("./analytics").then((m) => m.countVisits()));
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
