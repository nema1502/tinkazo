import { sinGrabar } from "../ensayo-modo";
import { getLang, onLangChange, t } from "../i18n";
import { app } from "../state";
import { type EstadoDelPatrocinio, estadoDelPatrocinio, textoDelCupo, urlDelPortero } from "../stellar/patrocinador";
import { currentSession } from "./wallet-ui";

/**
 * Lo que le queda a la cuenta, a la vista junto a "Sellar la lista": "Te quedan 18 sorteos gratis este mes."
 *
 * Solo cuando paga el portero del patrocinio (`patrocinador.ts`) y hay una cuenta que no paga la suya (Google o
 * correo). Sin el portero configurado, con Freighter, en el ensayo, en la demo y en el stand no hay línea. Se
 * actualiza al entrar, después de cada sello (el portero dice cuántos quedan) y al cambiar de idioma. Con el
 * cupo agotado dice cuándo vuelve, y se calla si el panel de la red ya lo está diciendo.
 */

const ID = "cupo-linea";

export function iniciarCupo(): void {
  if (!urlDelPortero()) return;
  const linea = document.getElementById(ID);
  if (!linea) return;
  let ultimo: EstadoDelPatrocinio | null = null;
  let de = "";

  const esDePollar = (): boolean => {
    const s = currentSession();
    return !!s && s.kind === "external" && !s.aMano;
  };

  const pintar = (): void => {
    const texto = !esDePollar() || sinGrabar() || app.frozen || document.getElementById("red-estado")?.dataset.caso === "sin-patrocinio" ? null : textoDelCupo(ultimo, getLang(), t);
    if (texto === null) {
      linea.style.display = "none";
      linea.textContent = "";
      return;
    }
    linea.textContent = texto;
    linea.style.display = "";
  };

  const actualizar = async (forzar: boolean): Promise<void> => {
    const s = currentSession();
    if (!s || !esDePollar() || sinGrabar()) {
      ultimo = null;
      de = "";
      pintar();
      return;
    }
    de = s.address;
    const para = s.address;
    const estado = await estadoDelPatrocinio(para, { forzar });
    if (currentSession()?.address !== para) return;
    ultimo = estado;
    pintar();
  };

  document.addEventListener("tinkazo:sesion", () => void actualizar(true));
  // El portero dice cuánto queda después de cada sello (y cada vez que se le pregunta): sin otra consulta.
  document.addEventListener("tinkazo:patrocinio", (e) => {
    const d = (e as CustomEvent<{ cuenta: string; estado: EstadoDelPatrocinio }>).detail;
    if (d.cuenta !== de) return;
    ultimo = d.estado;
    pintar();
  });
  onLangChange(pintar);
  // La lista se cierra y se abre (sellar, "Siguiente premio") y el panel de la red cambia: la línea acompaña.
  const miraAlPanel = document.getElementById("red-estado");
  if (miraAlPanel) new MutationObserver(pintar).observe(miraAlPanel, { attributes: true, attributeFilter: ["data-caso", "style"] });
  const names = document.getElementById("names");
  if (names) new MutationObserver(pintar).observe(names, { childList: true });
  void actualizar(false);
}
