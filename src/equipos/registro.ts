import { anotarEquipoEnSala, leerEstadoDeEquipo, leerPublico } from "../sala/equipos";
import { revisarNombre } from "../sala/filtro";
import type { NetworkName } from "../stellar/config";
import { guardarEquipoLocal, leerEquipoLocal, llaveDelCelular, prepararPrimerSorteo, sorteoPropioLocal } from "./celular";
import { cifrarEquipo } from "./datos";
import type { SalaDeRegistro } from "./enlace";
import { type ConfigEquipos, type DatosDeEquipo, type EstadoEquipo, ES_CUENTA, MAX_INTEGRANTES, cuentaCorta, esCuenta, limpiarEquipo } from "./modelo";

/**
 * La página de registro del celular (`equipos.html`): el encargado de un equipo lo anota con su cuenta.
 *
 * Los pasos, uno por pantalla y con una sola acción principal:
 *  1. Tu cuenta: la que recibe el cupón y cobra el premio. Si en ese celular ya hay una sesión abierta (Google,
 *     Freighter o la cuenta de prueba) se usa esa y este paso no aparece (`sesion.ts`); si no, se entra con Google (la
 *     cuenta se crea sola) o se pega la dirección de una cuenta de Stellar que ya se tiene.
 *  2. El equipo: su nombre y hasta cinco integrantes. Viajan cifrados con la clave del QR (el fragmento del enlace,
 *     que ningún navegador manda a un servidor); la cuenta viaja en claro, porque es pública.
 *  3. En qué punto está: según cómo armó el registro quien organiza.
 *       - de reserva («cupon»): «Tu equipo quedó anotado. Tu cupón llega a tu cuenta cuando quien organiza los reparta».
 *       - con sorteo propio («sorteo»): «Pedimos participar» hasta que lo aceptan; después «Hacé tu primer sorteo con
 *         Tinkazo» (con un botón que lleva a la herramienta con la lista y el premio sugeridos), y al volver «Listo:
 *         tu equipo ya sorteó», con el enlace a su comprobante.
 *
 * Todas las dependencias entran por `DepsDelRegistro`, para probarla con un DOM de mentira y respuestas simuladas.
 */

export interface DepsDelRegistro {
  tx: (clave: string) => string;
  /** La sala que dice el enlace, o `null` si el enlace está incompleto. */
  sala: SalaDeRegistro | null;
  /** La bandera `VITE_EQUIPOS`. */
  activo: boolean;
  red: NetworkName;
  /** Hay entrada con Google en este sitio. */
  hayGoogle: boolean;
  /** Hay entrada con Google en el sitio, pero se abrió dentro del navegador de una app (Instagram, Facebook…): Google no deja entrar desde ahí y el aviso manda al navegador del teléfono. */
  enApp: boolean;
  /** La cuenta de la sesión abierta en este navegador, sea cual sea la vía (`cuentaDeLaSesion` en `sesion.ts`). */
  cuentaRecordada: () => Promise<string | null>;
  /** Abre Google y devuelve la cuenta. Falla con el motivo de la entrada (`popup-blocked`, `popup-closed`…). */
  entrarConGoogle: () => Promise<string>;
  leerPublico: typeof leerPublico;
  anotar: typeof anotarEquipoEnSala;
  leerEstado: typeof leerEstadoDeEquipo;
  cifrar: (clave: string, e: DatosDeEquipo) => Promise<string>;
  local: Storage;
  sesion: Storage;
  /** Lleva a la herramienta, con la sesión y el borrador de esta pestaña. */
  irAlSorteo: () => void;
  /** Cada cuánto preguntar en qué punto está el equipo. Devuelve cómo parar. */
  cada: (f: () => void, ms: number) => () => void;
  /** La página está a la vista (no en segundo plano): en segundo plano no se pregunta. */
  visible: () => boolean;
}

/** Cada cuánto el celular pregunta en qué punto está su equipo. Una sala de cien equipos son unos seis pedidos por minuto cada uno. */
export const PREGUNTAR_CADA_MS = 15_000;

type Vista = "cargando" | "error" | "cuenta" | "datos" | "estado";

export function montarRegistro(raiz: HTMLElement, deps: DepsDelRegistro): { detener: () => void; pintar: () => void; alVolver: () => void } {
  const tx = deps.tx;
  const q = <T extends HTMLElement>(id: string): T => raiz.querySelector<T>(`#${id}`) as T;
  let config: ConfigEquipos | null = null;
  let cuenta: string | null = null;
  let estado: EstadoEquipo | null = null;
  let equipo: DatosDeEquipo | null = null;
  let vista: Vista = "cargando";
  let claveError = "";
  let pararReloj: (() => void) | null = null;
  let enviando = false;
  /** Si ya hay una lectura de la sala en curso: «Probar de nuevo» no lanza otra encima de esa. */
  let cargando = false;
  /** Cuál es la última lectura que entró, para que una respuesta vieja no pise a una nueva. */
  let cargaActual = 0;
  /** La llave de este celular para la sala: prueba ante la sala que los cambios del equipo vienen del mismo celular. */
  let llave: string | null = null;

  const ver = (v: Vista): void => {
    vista = v;
    q("eqp-cuenta").hidden = v !== "cuenta";
    q("eqp-datos").hidden = v !== "datos";
    q("eqp-estado").hidden = v !== "estado";
    pintar();
  };
  function mensaje(clave: string, mal = true): void {
    claveError = clave;
    const m = q("eqp-msg");
    m.textContent = clave ? tx(clave) : "";
    m.classList.toggle("mal", mal && !!clave);
  }

  /* ------------------------------------------------------------------- pintar */

  /** Los textos que dependen de qué punto del registro está la persona. */
  function pintar(): void {
    if (claveError) q("eqp-msg").textContent = tx(claveError);
    q("eqp-tu-cuenta").textContent = cuenta ? tx("eqpTuCuenta").replace("{c}", cuentaCorta(cuenta)) : "";
    q("eqp-enviar").textContent = tx(config?.modo === "sorteo" ? "eqpPedir" : "eqpAnotar");
    q<HTMLInputElement>("eqp-nombre").placeholder = "";
    for (let i = 0; i < MAX_INTEGRANTES; i++) q<HTMLInputElement>(`eqp-i${i}`).placeholder = tx("eqpIntegrante").replace("{n}", String(i + 1));
    q("eqp-google").hidden = !deps.hayGoogle;
    const avisoApp = q("eqp-en-app");
    avisoApp.hidden = !deps.enApp;
    if (deps.enApp) avisoApp.textContent = tx("eqpEnApp");
    if (vista === "estado") pintarEstado();
    // El título acompaña el punto del equipo: anotado, aceptado o con cupón. Sin estado a la vista, el de siempre.
    const h1 = raiz.querySelector("h1");
    if (h1) h1.textContent = vista === "estado" ? q("eqp-estado-t").textContent : tx("eqpTitulo");
    // Si la sala no contestó, se puede probar de nuevo sin recargar la página.
    reintentar.textContent = tx("eqpReintentar");
    reintentar.hidden = vista !== "error";
    reintentar.disabled = cargando;
  }

  function pintarEstado(): void {
    const t = q("eqp-estado-t");
    const b = q("eqp-estado-b");
    const hacer = q<HTMLButtonElement>("eqp-sorteo");
    const hacerB = q("eqp-sorteo-b");
    const comprobante = q<HTMLAnchorElement>("eqp-comprobante");
    hacer.hidden = hacerB.hidden = comprobante.hidden = true;
    let punto: EstadoEquipo = estado ?? "aceptado";
    // El sorteo que este navegador recuerda se ve enseguida; el que cuenta para el cupón lo confirma quien organiza, leyendo la red.
    const propio = cuenta && config?.modo === "sorteo" ? sorteoPropioLocal(cuenta, deps.red, deps.local) : null;
    if (config?.modo === "sorteo" && punto === "aceptado" && propio) punto = "sorteo";
    if (punto === "cupon") {
      t.textContent = tx("eqpCuponT");
      b.textContent = tx("eqpCuponB");
    } else if (config?.modo !== "sorteo") {
      t.textContent = tx("eqpListo");
      b.textContent = tx("eqpListoB");
    } else if (punto === "solicitud") {
      t.textContent = tx("eqpSolicitud");
      b.textContent = tx("eqpSolicitudB");
    } else if (punto === "aceptado") {
      t.textContent = tx("eqpAceptadoT");
      b.textContent = tx("eqpAceptadoB");
      hacer.hidden = hacerB.hidden = false;
      hacer.textContent = tx("eqpHacerSorteo");
      hacerB.textContent = tx("eqpHacerSorteoB");
    } else {
      t.textContent = tx("eqpSorteoT");
      b.textContent = tx("eqpSorteoB");
      comprobante.hidden = false;
      comprobante.textContent = tx("eqpVerComprobante");
      comprobante.href = propio?.proof ?? "/#mis-sorteos";
    }
  }

  /* ------------------------------------------------------------------- pasos */

  /** Pregunta en qué punto está el equipo de esta cuenta. */
  async function preguntar(): Promise<void> {
    if (!deps.sala || !cuenta) return;
    const r = await deps.leerEstado(deps.sala.servicio, deps.sala.id, cuenta);
    if (r === "red") return;
    if (r === null) {
      // La sala no conoce a este equipo: no se anotó nunca, o quien organiza lo quitó.
      if (vista === "estado") {
        pararReloj?.();
        pararReloj = null;
        mensaje("eqpQuitado");
        ver("datos");
      }
      return;
    }
    estado = r.estado;
    if (vista === "estado") pintar();
    if (r.estado === "cupon") {
      pararReloj?.();
      pararReloj = null;
    }
  }

  function arrancarReloj(): void {
    pararReloj?.();
    pararReloj = deps.cada(() => {
      if (deps.visible()) void preguntar();
    }, PREGUNTAR_CADA_MS);
  }

  async function conCuenta(c: string): Promise<void> {
    cuenta = c;
    mensaje("", false);
    const sala = deps.sala;
    if (!sala) return;
    const mio = leerEquipoLocal(sala.id, deps.local);
    equipo = mio && mio.cuenta === c ? { nombre: mio.nombre, integrantes: mio.integrantes } : null;
    const r = await deps.leerEstado(sala.servicio, sala.id, c);
    if (r === "red") {
      mensaje("eqpRed");
      return ver("datos");
    }
    if (r) {
      estado = r.estado;
      ver("estado");
      arrancarReloj();
      return;
    }
    rellenar();
    ver("datos");
  }

  function rellenar(): void {
    q<HTMLInputElement>("eqp-nombre").value = equipo?.nombre ?? "";
    for (let i = 0; i < MAX_INTEGRANTES; i++) q<HTMLInputElement>(`eqp-i${i}`).value = equipo?.integrantes[i] ?? "";
  }

  async function enviar(): Promise<void> {
    const sala = deps.sala;
    if (!sala || !cuenta || enviando) return;
    const hecho = limpiarEquipo({
      nombre: q<HTMLInputElement>("eqp-nombre").value,
      integrantes: Array.from({ length: MAX_INTEGRANTES }, (_, i) => q<HTMLInputElement>(`eqp-i${i}`).value),
    });
    if (!hecho.ok) return mensaje(hecho.motivo === "nombre" ? "eqpErrNombre" : hecho.motivo === "pocos" ? "eqpErrPocos" : "eqpErrLargo");
    // Un enlace no se muestra en la pantalla: se avisa acá y no después, cuando ya no se puede arreglar.
    const conEnlace = [hecho.equipo.nombre, ...hecho.equipo.integrantes].some((s) => {
      const v = revisarNombre(s);
      return v.estado === "descartar";
    });
    if (conEnlace) return mensaje("eqpErrEnlace");
    enviando = true;
    q<HTMLButtonElement>("eqp-enviar").disabled = true;
    mensaje("", false);
    try {
      llave ??= llaveDelCelular(sala.id, deps.local);
      const r = await deps.anotar(sala.servicio, sala.id, cuenta, await deps.cifrar(sala.clave, hecho.equipo), llave);
      if (!r.ok) {
        if (r.motivo === "ajena") return mensaje("eqpErrAjena");
        if (r.motivo === "cupo-conexion") return mensaje("eqpErrCupoConexion");
        return mensaje(r.motivo === "cerrada" ? "eqpCerrada" : r.motivo === "sin-registro" ? "eqpSinRegistro" : r.motivo === "llena" ? "eqpErrLlena" : r.motivo === "rapido" ? "eqpErrRapido" : r.motivo === "red" ? "eqpRed" : "eqpErrOtro");
      }
      equipo = hecho.equipo;
      estado = r.estado;
      guardarEquipoLocal({ ...hecho.equipo, cuenta, sala: sala.id }, deps.local);
      ver("estado");
      arrancarReloj();
    } finally {
      enviando = false;
      q<HTMLButtonElement>("eqp-enviar").disabled = false;
    }
  }

  async function google(): Promise<void> {
    const b = q<HTMLButtonElement>("eqp-google");
    b.disabled = true;
    b.textContent = tx("eqpEntrando");
    mensaje("", false);
    try {
      await conCuenta(await deps.entrarConGoogle());
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      mensaje(m === "popup-blocked" ? "eqpErrVentana" : m === "popup-closed" ? "eqpErrCerroVentana" : "eqpErrGoogle");
    } finally {
      b.disabled = false;
      b.textContent = tx("eqpGoogle");
    }
  }

  /* --------------------------------------------------------------- eventos */

  // Sin conexión con la sala, el error no es un callejón: se prueba de nuevo desde acá.
  const reintentar = document.createElement("button");
  reintentar.type = "button";
  reintentar.id = "eqp-reintentar";
  reintentar.className = "ghost eqp-btn";
  reintentar.hidden = true;
  reintentar.addEventListener("click", () => void cargar());
  raiz.querySelector(".eqp-tarjeta")?.append(reintentar);

  q("eqp-google").addEventListener("click", () => void google());
  q("eqp-otra").addEventListener("click", () => {
    q("eqp-form-cuenta").hidden = false;
    q("eqp-otra").hidden = true;
    q("eqp-g").focus();
  });
  q("eqp-form-cuenta").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = q<HTMLInputElement>("eqp-g").value.trim();
    if (!esCuenta(c)) return mensaje(ES_CUENTA.test(c) ? "eqpErrCuentaCopiada" : "eqpErrCuenta");
    void conCuenta(c);
  });
  q("eqp-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void enviar();
  });
  q("eqp-otra-cuenta").addEventListener("click", () => {
    pararReloj?.();
    cuenta = null;
    estado = null;
    mensaje("", false);
    ver("cuenta");
  });
  q("eqp-cambiar").addEventListener("click", () => {
    pararReloj?.();
    // Lo que este celular ya guardó manda: si la página se recargó, en memoria no hay nada pero sigue guardado.
    if (!equipo && cuenta && deps.sala) {
      const mio = leerEquipoLocal(deps.sala.id, deps.local);
      if (mio && mio.cuenta === cuenta) equipo = { nombre: mio.nombre, integrantes: mio.integrantes };
    }
    rellenar();
    mensaje("", false);
    ver("datos");
  });
  q("eqp-sorteo").addEventListener("click", () => {
    // Guarda la lista y el premio sugeridos en esta pestaña y abre la herramienta, que repone el borrador.
    prepararPrimerSorteo(equipo ?? { nombre: "", integrantes: [] }, tx("eqpPremio"), deps.sesion);
    deps.irAlSorteo();
  });

  /* ---------------------------------------------------------------- arranque */

  /** Lee la sala y lleva a la cuenta o al equipo. Se llama al abrir y al tocar «Probar de nuevo». */
  async function cargar(): Promise<void> {
    if (cargando) return;
    cargando = true;
    const miCarga = ++cargaActual;
    reintentar.disabled = true;
    try {
      if (!deps.sala) {
        mensaje("eqpIncompleto");
        return ver("error");
      }
      if (!deps.activo) {
        mensaje("eqpSinRegistro");
        return ver("error");
      }
      mensaje("eqpCargando", false);
      const p = await deps.leerPublico(deps.sala.servicio, deps.sala.id);
      // Entró una lectura más nueva mientras esta esperaba: la vieja no pisa lo que se ve.
      if (miCarga !== cargaActual) return;
      if (!p.ok) {
        mensaje(p.motivo === "cerrada" ? "eqpCerrada" : "eqpRed");
        return ver("error");
      }
      if (!p.config) {
        mensaje("eqpSinRegistro");
        return ver("error");
      }
      config = p.config;
      mensaje("", false);
      const conocida = (await deps.cuentaRecordada().catch(() => null)) ?? leerEquipoLocal(deps.sala.id, deps.local)?.cuenta ?? null;
      if (miCarga !== cargaActual) return;
      if (conocida && esCuenta(conocida)) return await conCuenta(conocida);
      ver("cuenta");
    } finally {
      if (miCarga === cargaActual) {
        cargando = false;
        reintentar.disabled = false;
      }
    }
  }

  void cargar();

  return {
    detener: () => pararReloj?.(),
    pintar,
    alVolver: () => void preguntar(),
  };
}
