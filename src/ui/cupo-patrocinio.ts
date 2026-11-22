import { sinGrabar } from "../ensayo-modo";
import { getLang, onLangChange, t } from "../i18n";
import { app } from "../state";
import { altaPagoActivo } from "../stellar/alta-config";
import { leerOferta } from "../stellar/alta-oferta";
import { cobroPorUso } from "../stellar/cobro-oficial";
import { POCOS_SORTEOS, avisoDePremiosDeAUno, lineaDeSiguientePremio, lineaDelCupoOficial, notaDeUsoOficial } from "../stellar/cupo-oficial";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import type { ReciboDelRegalo } from "./cuenta-lista-flujo";
import { type EstadoDelPatrocinio, estadoDelPatrocinio, textoDelCupo, urlDelPortero } from "../stellar/patrocinador";
import { sumarConCualquierCupo } from "../stellar/venta-piloto";
import { practicarEnPrueba, puedeCambiarDeModo } from "./modo-ui";
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
 *
 * Con cero sorteos y el regalo de quien entra con su cuenta todavía sin recibir, la línea lo ofrece con «Recibirlos» en
 * lugar de sumar (`cuenta-lista-flujo.ts`, `regaloDisponible` y `recibirRegalo`). Sin el regalo en el servidor, como
 * siempre.
 *
 * Antes de sellar, si los premios que se van a sortear de a uno piden más sorteos oficiales de los que quedan, el aviso
 * «Tu sorteo tiene 5 premios y te quedan 3.» va en lugar de la nota de cuánto gasta cada premio: con la venta abierta,
 * con «Sumar sorteos» al lado; sin ella, con el enlace chico «Sortear en Prueba». Con el regalo a la vista, el aviso se
 * calla: una sola acción junto a la línea, y es «Recibirlos».
 */

const ID = "cupo-linea";
const ID_USO = "cupo-uso";
const ID_SIGUIENTE = "cupo-siguiente";
const ID_SUMAR = "cupo-sumar";
const ID_RECIBIR = "cupo-recibir";
const ID_PREMIOS = "cupo-premios";
const ID_PREMIOS_PRUEBA = "cupo-premios-prueba";

/**
 * Cuántos ganan en cada sello que se va a hacer, si alguien lo anotó (`anotarSellosDeAUno`). Sin dato, el sello de
 * ahora y nada más: cada «Sellar la lista» es un solo sello, con los premios de todos sus lugares adentro, y la página
 * no sabe cuántos premios más se van a sortear después con «Siguiente premio». Con un solo sello el aviso no sale.
 */
let sellosDeAUno: readonly number[] | null = null;
/** Vuelve a pintar las líneas de la página abierta (lo deja `iniciarCupo`). */
let repintar: (() => void) | null = null;

/** Anota cuántos ganan en cada sello que se va a hacer (`null`: solo el de ahora) y vuelve a pintar. */
export function anotarSellosDeAUno(sellos: readonly number[] | null): void {
  sellosDeAUno = sellos === null ? null : [...sellos];
  repintar?.();
}

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
 * «Sumar sorteos», junto a la línea del cupo cuando quedan pocos o ninguno, o junto al aviso de premios con la venta
 * abierta: un botón secundario (la principal de la pantalla sigue siendo «Sellar la lista»). Va después de `ancla`. Abre
 * la ventana de los paquetes; al llegar el pago, la línea se entera sola.
 */
function botonDeSumar(ancla: HTMLElement, ver: boolean): void {
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
  if (ver && ancla.nextElementSibling !== b) ancla.after(b);
}

/**
 * «Sortear en Prueba», el enlace chico del aviso de premios sin la venta: pasa a Prueba y entra solo con la cuenta de
 * prueba, con la lista intacta. Nunca gris: con el cambio de modo cerrado no se muestra.
 */
function enlaceAPrueba(aviso: HTMLElement | null, ver: boolean): void {
  let b = document.getElementById(ID_PREMIOS_PRUEBA) as HTMLButtonElement | null;
  if (!b) {
    if (!ver) return;
    const nuevo = document.createElement("button");
    nuevo.type = "button";
    nuevo.id = ID_PREMIOS_PRUEBA;
    nuevo.className = "login-link cupo-premios-prueba";
    nuevo.dataset.accion = "prueba";
    nuevo.addEventListener("click", () => void practicarEnPrueba());
    b = nuevo;
  }
  b.textContent = t("pagoSortearEnPrueba");
  b.style.display = ver ? "" : "none";
  if (ver && aviso && aviso.nextElementSibling !== b) aviso.after(b);
}

/**
 * «Recibirlos», junto a la línea del cupo cuando la cuenta se quedó sin sorteos y el regalo está disponible: pide el
 * regalo y la línea se entera sola por `tinkazo:patrocinio`. Va en lugar de «Sumar sorteos»: una sola acción al lado.
 */
function botonDeRecibir(linea: HTMLElement, ver: boolean, alTocar: () => void): void {
  let b = document.getElementById(ID_RECIBIR) as HTMLButtonElement | null;
  if (!b) {
    if (!ver) return;
    const nuevo = document.createElement("button");
    nuevo.type = "button";
    nuevo.id = ID_RECIBIR;
    nuevo.className = "mini cupo-sumar";
    nuevo.dataset.accion = "recibir";
    nuevo.addEventListener("click", alTocar);
    b = nuevo;
  }
  b.textContent = t("cupoOfRecibir");
  b.style.display = ver ? "" : "none";
  if (ver && linea.nextElementSibling !== b) linea.after(b);
}

/** Lo que dice el regalo de los textos: «Ya podés recibir tus 3 sorteos gratis.», con el número del servidor. */
const lineaDelRegalo = (n: number): string => t("cupoOfRegaloListo").replace("{n}", String(n));

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
  /**
   * El regalo que esta cuenta puede recibir, como lo dijo el servidor (`n`, o `null` si no o todavía no se sabe). Se
   * pregunta una sola vez por cuenta, y solo cuando le quedan cero sorteos oficiales. `fallo`: el último «Recibirlos» no
   * se supo cómo salió (sin red, el servicio), y la línea lo dice con el botón a la vista para probar de nuevo.
   */
  let regalo: { cuenta: string; n: number | null; fallo: boolean } | null = null;
  let recibiendo = false;

  /** Pregunta el regalo de esta cuenta, una vez: hasta que conteste, la línea es la de siempre. */
  const preguntarElRegalo = async (para: string): Promise<void> => {
    regalo = { cuenta: para, n: null, fallo: false };
    let n: number | null = null;
    try {
      n = await (await import("./cuenta-lista-flujo")).regaloDisponible();
    } catch {
      n = null;
    }
    if (currentSession()?.address !== para || regalo?.cuenta !== para) return;
    regalo = { cuenta: para, n, fallo: false };
    pintar();
  };

  /**
   * «Recibirlos»: pide el regalo y pregunta el cupo otra vez. Si el servidor contestó (o no cargó), no se ofrece de nuevo
   * en esta carga. Si no se supo, el botón queda a la vista y la línea dice que no se pudo, para probar de nuevo.
   */
  const recibir = async (): Promise<void> => {
    if (recibiendo) return;
    recibiendo = true;
    const para = de;
    const antes = regalo?.cuenta === para ? regalo.n : null;
    const b = document.getElementById(ID_RECIBIR) as HTMLButtonElement | null;
    if (b) b.disabled = true;
    let como: ReciboDelRegalo | "no-cargo" = "error";
    try {
      como = await (await import("./cuenta-lista-flujo")).recibirRegalo();
    } catch {
      avisarQueNoCargo();
      como = "no-cargo";
    } finally {
      recibiendo = false;
      if (b) b.disabled = false;
    }
    regalo = como === "error" && antes !== null ? { cuenta: para, n: antes, fallo: true } : { cuenta: para, n: null, fallo: false };
    pintar();
    void actualizar(true);
  };

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
    // (con la marca del piloto de la venta, con cualquier cantidad). La compra se pregunta de nuevo al pintar: si la marca
    // del piloto vence o se saca con la página abierta, lo leído de la oferta no alcanza y la línea es la de siempre.
    const antesDeSellar = oficial && !sellada && !caja;
    const venta = hayPaquete && altaPagoActivo();
    // Sin sorteos y con el regalo sin recibir: la línea lo ofrece con «Recibirlos», en lugar de sumar. Para saberlo se
    // pregunta una sola vez por cuenta (sin el acceso por el servidor en el build, el flujo contesta que no sin preguntar).
    const cero = antesDeSellar && sinSorteosOficiales(ultimo);
    if (cero && de && regalo?.cuenta !== de) void preguntarElRegalo(de);
    const regaloListo = cero && regalo?.cuenta === de && regalo.n !== null && !recibiendo ? regalo.n : null;
    const sumar = regaloListo === null && antesDeSellar && venta && ofrecerSumar(ultimo);
    const deSiempre = (): string | null =>
      oficial ? lineaDelCupoOficial(ultimo, getLang(), t, { pago: sumar }) : textoDelCupo(ultimo, getLang(), t);
    const delRegalo = (n: number): string => (regalo?.fallo ? t("cupoOfRegaloError") : lineaDelRegalo(n));
    const texto = !pollar || sellada || caja ? null : regaloListo !== null ? delRegalo(regaloListo) : deSiempre();
    if (texto === null) {
      linea.style.display = "none";
      linea.textContent = "";
    } else {
      linea.textContent = texto;
      linea.style.display = "";
    }
    // Sin sorteos oficiales es lo más importante de la pantalla: pesa como un aviso, no como una nota gris.
    linea.classList.toggle("cupo-linea--cero", oficial && texto !== null && sinSorteosOficiales(ultimo));
    // Una línea a la vez junto a Sellar: con el aviso de premios, la nota de cuánto gasta cada premio se calla. Con el
    // regalo a la vista se calla el aviso: la acción de la línea es «Recibirlos» y, al llegar, el aviso vuelve si hace falta.
    const aviso = antesDeSellar && regaloListo === null ? avisoDePremiosDeAUno(ultimo, sellosDeAUno ?? [ganadores()], t) : null;
    mostrar(ID_USO, ID, antesDeSellar && aviso === null ? notaDeUsoOficial(ultimo, ganadores(), t) : null);
    mostrar(ID_PREMIOS, ID, aviso);
    mostrar(ID_SIGUIENTE, "again-acciones", oficial && sellada ? lineaDeSiguientePremio(ultimo, t) : null);
    const elAviso = aviso === null ? null : document.getElementById(ID_PREMIOS);
    // Con el aviso a la vista, Sumar sorteos va pegado a él (con la venta) o, sin la venta, Sortear en Prueba.
    botonDeSumar(elAviso && venta ? elAviso : linea, (sumar && texto !== null) || (elAviso !== null && venta));
    enlaceAPrueba(elAviso, elAviso !== null && !venta && puedeCambiarDeModo());
    botonDeRecibir(linea, regaloListo !== null && texto !== null, () => void recibir());
  };
  repintar = pintar;

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
