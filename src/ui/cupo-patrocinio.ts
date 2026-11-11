import { sinGrabar } from "../ensayo-modo";
import { getLang, onLangChange, t } from "../i18n";
import { app } from "../state";
import { altaPagoActivo } from "../stellar/alta-config";
import { cobroPorUso } from "../stellar/cobro-oficial";
import { lineaDeSiguientePremio, lineaDelCupoOficial, notaDeUsoOficial } from "../stellar/cupo-oficial";
import { type EstadoDelPatrocinio, estadoDelPatrocinio, textoDelCupo, urlDelPortero } from "../stellar/patrocinador";
import { currentSession } from "./wallet-ui";

/**
 * Lo que le queda a la cuenta, a la vista junto a "Sellar la lista": "Te quedan 18 sorteos gratis este mes."
 *
 * Solo cuando paga el portero del patrocinio (`patrocinador.ts`) y hay una cuenta que no paga la suya (Google o
 * correo). Sin el portero configurado, con Freighter, en el ensayo, en la demo y en el stand no hay línea. Se
 * actualiza al entrar, después de cada sello (el portero dice cuántos quedan) y al cambiar de idioma. Con el
 * cupo agotado dice cuándo vuelve, y se calla si el panel de la red ya lo está diciendo.
 *
 * Con el cobro por uso del modo Oficial (`cobro-oficial.ts`) la línea habla de sorteos oficiales, no de sellos del mes
 * (`stellar/cupo-oficial.ts`): cuántos quedan y el próximo vencimiento. Suma dos líneas más: antes de sellar, cuánto gasta
 * cada premio (uno por sello; más de 50 ganadores, dos) y, con la lista sellada, cuántos quedan junto a «Siguiente premio».
 * Como el portero no dice cuántos sorteos oficiales gasta un sello, al sellar se vuelve a preguntar.
 */

const ID = "cupo-linea";
const ID_USO = "cupo-uso";
const ID_SIGUIENTE = "cupo-siguiente";

/**
 * Una línea chica como la del cupo, después del elemento `ancla`: se crea la primera vez que hay algo que decir, así con el
 * cobro por uso apagado la página queda como siempre. Con `null` la esconde (si existe).
 */
function mostrar(id: string, ancla: string, texto: string | null): void {
  let el = document.getElementById(id);
  if (!el) {
    const junto = document.getElementById(ancla);
    if (texto === null || !junto) return;
    el = document.createElement("p");
    el.id = id;
    el.className = "note cupo-linea";
    junto.after(el);
  }
  el.textContent = texto ?? "";
  el.style.display = texto === null ? "none" : "";
}

/** El portero dice que la cuenta tiene acceso y ya no le quedan sorteos oficiales. */
const sinSorteosOficiales = (e: EstadoDelPatrocinio | null): boolean => !!e && e.rige !== "cerrado" && !!e.oficial?.acceso && !!e.oficial.sorteos && e.oficial.sorteos.quedan <= 0;

/** Cuántos ganan, como está en el campo. */
const ganadores = (): number => {
  const v = Number((document.getElementById("nw") as HTMLInputElement | null)?.value);
  return Number.isFinite(v) && v >= 1 ? v : 1;
};

export function iniciarCupo(): void {
  if (!urlDelPortero()) return;
  const linea = document.getElementById(ID);
  if (!linea) return;
  let ultimo: EstadoDelPatrocinio | null = null;
  let de = "";
  let estabaSellada = false;

  const esDePollar = (): boolean => {
    const s = currentSession();
    return !!s && s.kind === "external" && !s.aMano;
  };

  const pintar = (): void => {
    const pollar = esDePollar() && !sinGrabar();
    const oficial = pollar && cobroPorUso();
    const caja = document.getElementById("red-estado")?.dataset.caso === "sin-patrocinio";
    const sellada = !!app.frozen;
    // Un sello gasta sorteos oficiales y el portero no dice cuántos quedan: lo de antes del sello ya no vale.
    if (oficial && sellada && !estabaSellada) {
      ultimo = null;
      void actualizar(true);
    }
    estabaSellada = sellada;
    const texto = !pollar || sellada || caja ? null : oficial ? lineaDelCupoOficial(ultimo, getLang(), t, { pago: altaPagoActivo() }) : textoDelCupo(ultimo, getLang(), t);
    if (texto === null) {
      linea.style.display = "none";
      linea.textContent = "";
    } else {
      linea.textContent = texto;
      linea.style.display = "";
    }
    // Sin sorteos oficiales es lo más importante de la pantalla: pesa como un aviso, no como una nota gris.
    linea.classList.toggle("cupo-linea--cero", oficial && texto !== null && sinSorteosOficiales(ultimo));
    mostrar(ID_USO, ID, oficial && !sellada && !caja ? notaDeUsoOficial(ultimo, ganadores(), t) : null);
    mostrar(ID_SIGUIENTE, "again-acciones", oficial && sellada ? lineaDeSiguientePremio(ultimo, t) : null);
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
  // Cuántos ganan cambia cuánto gasta el sello (más de 50 ganadores, dos sorteos).
  const campoGanadores = document.getElementById("nw");
  campoGanadores?.addEventListener("input", pintar);
  campoGanadores?.addEventListener("change", pintar);
  // La lista se cierra y se abre (sellar, "Siguiente premio") y el panel de la red cambia: la línea acompaña.
  const miraAlPanel = document.getElementById("red-estado");
  if (miraAlPanel) new MutationObserver(pintar).observe(miraAlPanel, { attributes: true, attributeFilter: ["data-caso", "style"] });
  const names = document.getElementById("names");
  if (names) new MutationObserver(pintar).observe(names, { childList: true });
  void actualizar(false);
}
