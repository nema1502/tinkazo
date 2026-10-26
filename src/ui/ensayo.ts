import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app, currentPace, forzarRitmo, params } from "../state";
import { ENSAYO_ESPERA_S, LISTA_ENSAYO, enEnsayo, marcarEnsayo } from "../ensayo-modo";
import { guardarBorrador, renderNames, setList } from "./participants";
import { MARCA_INGRESAR, currentSession, refrescarPuerta } from "./wallet-ui";
import { actualizarPaso } from "./siguiente";

/**
 * El ensayo, en la página: probar Tinkazo con una lista de ejemplo, haciendo y
 * no mirando, sin que nada se grabe (`ensayo-modo.ts` decide eso).
 *
 * Es la herramienta de verdad: la persona toca "Sellar la lista" y "Lanzar el
 * sorteo" en sus lugares. Lo distinto:
 * - la lista es de la fauna de Bolivia, no se edita y no pisa la que se estaba
 *   armando (el borrador queda guardado y vuelve al salir);
 * - una banda arriba dice que es un ensayo, con "Salir del ensayo", y en el
 *   estadio, donde va el número público, "ENSAYO · no se graba";
 * - una línea debajo de los pasos guía, sin bloquear nada;
 * - el número sale en 15 s (en un sorteo de verdad son unos 45) y el show va en
 *   el ritmo rápido, sin cambiar el que eligió la persona;
 * - al final no hay QR, ni compartir, ni siguiente premio, ni en grande: "Así se
 *   sortea", con "Sortear con mi lista".
 *
 * Se entra por botón (la portada, la oferta de primera vez, el pie del
 * tutorial y el enlace de debajo del cuadro vacío) y nunca con un sorteo
 * sellado esperando. Salir recarga la página: es la forma segura de soltar el
 * sello, la cuenta regresiva y el juego del ensayo, y de reponer la lista de
 * antes. La demo (`?demo=`) sigue aparte: se mira sola, y los auditores
 * dependen de ella.
 */

/**
 * El alto de la cabecera, para que la banda quede debajo cuando la cabecera es
 * fija (más de 1100 px), y el de la banda, para que lo que la página lleva a la
 * vista (la lista sellada, el resultado) no quede debajo de ella.
 */
function medirCabecera(): void {
  const raiz = document.documentElement.style;
  const cab = document.querySelector("body > header");
  if (cab) raiz.setProperty("--cab-alto", `${Math.ceil(cab.getBoundingClientRect().height)}px`);
  const banda = document.getElementById("ensayo-banda");
  if (banda) raiz.setProperty("--banda-alto", `${Math.ceil(banda.getBoundingClientRect().height)}px`);
}

/** Monta el ensayo en la herramienta. */
function montar(): void {
  document.body.dataset.ensayo = "1";
  medirCabecera();
  addEventListener("resize", medirCabecera, { passive: true });
  forzarRitmo("rapido");
  const ritmo = document.getElementById("pace");
  if (ritmo instanceof HTMLSelectElement) ritmo.value = currentPace();
  setList(LISTA_ENSAYO.join("\n"));
  // La lista es de ejemplo y no se toca: ni a mano ni con los orígenes.
  $<HTMLTextAreaElement>("ta").readOnly = true;
  for (const id of ["btn-pegar", "csv", "csv-luma", "btn-recuperar"]) {
    const el = document.getElementById(id);
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = true;
  }
  // Sin cuenta también se sella: no se graba nada.
  refrescarPuerta();
  renderNames();
  rotular();
  guiar();
  actualizarPaso();
}

/** Lo que dice el estadio donde va el número público, y la línea que guía, en el idioma de ahora. */
function rotular(): void {
  $("st-round").dataset.ens = t("ensEstadio");
}

/**
 * La línea que guía, debajo del indicador de pasos. Cambia con el paso
 * (`tinkazo:paso`, de siguiente.ts) y nunca bloquea: es un `role="status"`
 * cortés, y no se escribe con cada segundo de la cuenta.
 */
let claveDelPaso = "";
function guiar(clave = claveDelPaso): void {
  // Sin clave (al cambiar de idioma), la del último paso: la espera sigue siendo la espera.
  claveDelPaso = clave;
  const el = document.getElementById("ensayo-guia");
  if (!el) return;
  let texto = "";
  if (enEnsayo() && !app.drawn) {
    if (!app.frozen) texto = t("ensGuia1");
    else if (clave === "sigEspera") texto = t("ensGuia2").replace("{s}", String(ENSAYO_ESPERA_S));
    else texto = t("ensGuia3");
  }
  if (el.textContent !== texto) el.textContent = texto;
  el.hidden = !texto;
}

/** Entra al ensayo. Nunca con un sorteo sellado esperando, ni en la demo. */
export function entrarAlEnsayo(): void {
  if (app.frozen || enEnsayo() || params.has("demo")) return;
  // Lo que se estaba armando queda guardado tal cual: vuelve al salir.
  guardarBorrador();
  marcarEnsayo(true);
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
  dispatchEvent(new HashChangeEvent("hashchange"));
  montar();
  // Arriba de la herramienta: la banda, los pasos, la línea que guía y la lista. El foco en lo que toca.
  scrollTo(0, 0);
  medirCabecera();
  $("btn-freeze").focus({ preventScroll: true });
}

/**
 * Sale del ensayo. Con `conMiLista`, "Sortear con mi lista": sin cuenta, la
 * página nueva abre la entrada, como el botón de la portada (`ingresarSiLoPidio`
 * en main.ts). Con `aTutorial`, abre "¿Cómo se usa?".
 */
export function salirDelEnsayo(o: { conMiLista?: boolean; aTutorial?: boolean } = {}): void {
  marcarEnsayo(false);
  forzarRitmo(null);
  if (o.conMiLista && !currentSession()) {
    try {
      sessionStorage.setItem(MARCA_INGRESAR, "1");
    } catch {
      /* sin almacenamiento, la línea de la cuenta tiene su botón */
    }
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${o.aTutorial ? "#como-se-usa-fin" : "#sortear"}`);
  location.reload();
}

/** Se llama una vez, con la herramienta y la cuenta ya armadas. */
export function initEnsayo(): void {
  for (const b of document.querySelectorAll<HTMLElement>("[data-entrar-ensayo]")) {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      entrarAlEnsayo();
    });
  }
  document.getElementById("ens-mio")?.addEventListener("click", () => salirDelEnsayo({ conMiLista: true }));
  for (const id of ["ens-salir", "ens-salir-banda"]) document.getElementById(id)?.addEventListener("click", () => salirDelEnsayo());
  document.getElementById("ens-como")?.addEventListener("click", () => salirDelEnsayo({ aTutorial: true }));
  document.addEventListener("tinkazo:paso", (e) => guiar((e as CustomEvent<{ clave: string }>).detail.clave));
  // El ensayo llegó al ganador: la línea que guía se va. (El contador lo cuenta en main.ts, `contarPractica`.)
  document.addEventListener("tinkazo:ensayo-fin", () => guiar());
  onLangChange(() => {
    if (!enEnsayo()) return;
    rotular();
    guiar();
  });
  // Al cargar: si se recargó en la herramienta durante el ensayo, sigue; si no
  // (se volvió a la portada, a Mis sorteos o llegó la demo), se termina.
  if (!enEnsayo()) return;
  if (location.hash === "#sortear" && !params.has("demo") && !app.frozen) montar();
  else marcarEnsayo(false);
}
