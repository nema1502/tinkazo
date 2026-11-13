import { sinGrabar } from "../ensayo-modo";
import { getLang, onLangChange, t } from "../i18n";
import { app } from "../state";
import { altaPagoActivo } from "../stellar/alta-config";
import { leerOferta } from "../stellar/alta-oferta";
import { cobroPorUso } from "../stellar/cobro-oficial";
import { POCOS_SORTEOS, lineaDeSiguientePremio, lineaDelCupoOficial, notaDeUsoOficial } from "../stellar/cupo-oficial";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import { type EstadoDelPatrocinio, estadoDelPatrocinio, textoDelCupo, urlDelPortero } from "../stellar/patrocinador";
import { sumarConCualquierCupo } from "../stellar/venta-piloto";
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
const ID_SUMAR = "cupo-sumar";

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

/** El portero dice que la cuenta tiene acceso y le quedan pocos sorteos oficiales, o ninguno. */
const pocosOficiales = (e: EstadoDelPatrocinio | null): boolean => !!e && e.rige !== "cerrado" && !!e.oficial?.acceso && !!e.oficial.sorteos && e.oficial.sorteos.quedan <= POCOS_SORTEOS;

/** El portero dice que la cuenta tiene acceso y cuántos sorteos oficiales le quedan, sean los que sean. */
const conSorteosOficiales = (e: EstadoDelPatrocinio | null): boolean => !!e && e.rige !== "cerrado" && !!e.oficial?.acceso && !!e.oficial.sorteos;

/**
 * Si va Sumar sorteos: con pocos o ninguno. Con la marca del piloto de la venta en esta pestaña (`venta-piloto.ts`),
 * con cualquier cantidad: quienes prueban la compra no tienen que gastar sorteos para llegar al botón.
 */
const ofrecerSumar = (e: EstadoDelPatrocinio | null): boolean => pocosOficiales(e) || (conSorteosOficiales(e) && sumarConCualquierCupo());

/**
 * «Sumar sorteos», junto a la línea del cupo cuando quedan pocos o ninguno: un botón secundario (la principal de la
 * pantalla sigue siendo «Sellar la lista»). Abre la ventana de los paquetes; al llegar el pago, la línea se entera sola.
 */
function botonDeSumar(linea: HTMLElement, ver: boolean): void {
  let b = document.getElementById(ID_SUMAR) as HTMLButtonElement | null;
  if (!b) {
    if (!ver) return;
    const nuevo = document.createElement("button");
    nuevo.type = "button";
    nuevo.id = ID_SUMAR;
    nuevo.className = "mini cupo-sumar";
    nuevo.dataset.accion = "comprar";
    nuevo.addEventListener("click", () => void sumarSorteos(nuevo));
    b = nuevo;
  }
  b.textContent = t("cupoOfSumar");
  b.style.display = ver ? "" : "none";
  if (ver && linea.nextElementSibling !== b) linea.after(b);
}

async function sumarSorteos(b: HTMLButtonElement): Promise<void> {
  b.disabled = true;
  try {
    const flujo = await import("./cuenta-lista-flujo");
    await flujo.abrirSumarSorteos();
  } catch {
    avisarQueNoCargo();
  } finally {
    b.disabled = false;
  }
}

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
  /** El servidor vende al menos un paquete para sumar sorteos ahora (`/v1/alta/precios`). Ante la duda, no. */
  let hayPaquete = false;

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
    // Sumar sorteos se ofrece solo con su botón, y el botón solo si el servidor vende un paquete ahora: con pocos o ninguno
    // (con la marca del piloto de la venta, con cualquier cantidad).
    const sumar = oficial && !sellada && !caja && hayPaquete && ofrecerSumar(ultimo);
    const texto = !pollar || sellada || caja ? null : oficial ? lineaDelCupoOficial(ultimo, getLang(), t, { pago: sumar }) : textoDelCupo(ultimo, getLang(), t);
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
    botonDeSumar(linea, sumar && texto !== null);
  };

  /** Lo que se vende, para el botón de sumar: solo con la compra en el build y una cuenta de Google o de correo. */
  const leerLoQueSeVende = async (): Promise<void> => {
    if (!altaPagoActivo() || !esDePollar() || sinGrabar() || !cobroPorUso()) {
      hayPaquete = false;
      return;
    }
    try {
      hayPaquete = (await leerOferta()).paquetes.length > 0;
    } catch {
      hayPaquete = false;
    }
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
    const [estado] = await Promise.all([estadoDelPatrocinio(para, { forzar }), leerLoQueSeVende()]);
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
