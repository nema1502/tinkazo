/**
 * La tarjeta Confirmar mi correo, en la espera de quien ya se anotó. Se baja con `import()` solo cuando la cuenta de este
 * navegador lo necesita: la mayoría de las personas nunca la ve, y el celular no carga nada de esto.
 *
 * Decide la máquina de `confirmar-estado.ts`. Acá solo se arma la pantalla una vez (el campo del código no se vuelve a
 * crear, así que lo escrito y el foco sobreviven a cualquier repintado de la página), se pinta lo que dice `vistaDe` y se
 * hacen las llamadas a la sesión. El código va siempre al correo de la sesión: acá no se escribe ningún correo.
 */

import type { Lang } from "../idioma";
import type { LecturaDelCelular, OrigenDelAviso } from "../stellar/wallet-pollar";
import { cancelo, conTope, noPermitido } from "../ui/proteger-cuenta";
import type { AccionesDeLaCuenta } from "./celular";
import {
  clasificarFallaAlConfirmar,
  clasificarFallaAlMandar,
  clasificarFallaDelDesbloqueo,
  enCurso,
  HECHO_VISIBLE_MS,
  iniciar,
  LARGO_MINIMO_DEL_CODIGO,
  limpiarElCodigo,
  MARCA_DEL_CODIGO,
  marcaVigente,
  siguiente,
  vistaDe,
  type Evento,
  type Tarjeta,
  type Vista,
} from "./confirmar-estado";
import { marcaDeTilde } from "./piezas";
import { sustituir } from "./sustituir";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";

/** Una lectura que dice que la cuenta quedó lista se vuelve a pedir a los 10 segundos si la billetera todavía no nacía. */
export const RELEER_SI_NACIENDO_MS = 10_000;
/** Si confirmar dice que todavía no quedó, se vuelve a leer a los 5 segundos. */
export const RELEER_SI_NO_QUEDO_MS = 5_000;

export interface DepsDeLaTarjeta {
  /** Los textos de la página, para las frases que ya tiene (Sin conexión). */
  txPagina: (clave: string) => string;
  idioma: () => Lang;
  ahora: () => number;
  cada: (f: () => void, ms: number) => () => void;
  visible: () => boolean;
  enLinea: () => boolean;
  /** Dónde se anota que hay un código mandado (solo la hora). Sin esto, una recarga no se nota. */
  marca: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  acciones: AccionesDeLaCuenta;
  /** La tarjeta se va: la cuenta quedó lista, no hace falta o no se puede en esta carga. */
  alIrse: (motivo: "hecho" | "naciendo" | "no-hace-falta") => void;
  /** Se confirmó el correo (o ya estaba): la cuenta es esta. */
  alConfirmar: (lectura: LecturaDelCelular) => void;
  /** Pide leer de nuevo la cuenta a los `ms` (sin respuesta inmediata). */
  releerEn: (ms: number) => void;
  /** Pide leer de nuevo la cuenta ahora. Con el origen de un aviso de cambio, quien lee puede espaciarlas. */
  releer: (origen?: OrigenDelAviso) => void;
  /** Avisa cuando la confirmación pasa a estar en curso o deja de estarlo: con la lista sellada cambia qué pantalla manda. */
  alCambiarElCurso?: () => void;
}

export interface TarjetaMontada {
  /** Vuelve a escribir los textos (cambió el idioma) y el estado. */
  pintar: () => void;
  /** La persona ya empezó a confirmar (ver `enCurso` de la máquina). */
  enCurso: () => boolean;
  /** La cuenta se leyó de nuevo. */
  alLeer: (lectura: LecturaDelCelular) => void;
  /** La pestaña volvió a verse. */
  alVolver: () => void;
  /** Saca la tarjeta. Con `olvidar`, también la marca del código (se cerró la sesión). */
  destruir: (olvidar: boolean) => void;
}

function elemento<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta);
  e.className = clase;
  return e;
}

/** Escribe un texto solo si cambió: repetir el mismo no debe hacer que un lector de pantalla lo diga de nuevo. */
function poner(e: HTMLElement, texto: string): void {
  if (e.textContent !== texto) e.textContent = texto;
}

export function montarTarjeta(
  seccion: HTMLElement,
  pagina: HTMLElement,
  lecturaInicial: LecturaDelCelular,
  deps: DepsDeLaTarjeta,
): TarjetaMontada {
  let lectura = lecturaInicial;
  let destruida = false;
  let relojDeListo: number | null = null;
  /** El celular ofrece el desbloqueo (se sabe de forma asíncrona). */
  let desbloqueoPosible = false;

  const leerMarca = (): string | null => {
    try {
      return deps.marca?.getItem(MARCA_DEL_CODIGO) ?? null;
    } catch {
      return null;
    }
  };
  const ponerMarca = (): void => {
    try {
      deps.marca?.setItem(MARCA_DEL_CODIGO, String(deps.ahora()));
    } catch {
      /* sin almacenamiento, una recarga no se nota y la tarjeta abre como nueva */
    }
  };
  const quitarMarca = (): void => {
    try {
      deps.marca?.removeItem(MARCA_DEL_CODIGO);
    } catch {
      /* nada que olvidar */
    }
  };

  // Una marca de más de 5 minutos no sirve: se borra. Con una vigente, la página se recargó con un código en camino.
  const recargado = marcaVigente(leerMarca(), deps.ahora());
  if (!recargado) quitarMarca();
  let t: Tarjeta = iniciar(deps.ahora(), { ofreceDesbloqueo: false, recargado });

  /* ------------------------------------------------ la pantalla, armada una sola vez */

  seccion.replaceChildren();
  seccion.hidden = false;
  const cuerpo = elemento("div", "cmp-cuenta-cuerpo");
  const tilde = marcaDeTilde();
  tilde.classList.add("cmp-tilde");
  const titulo = elemento("h2", "cmp-cuenta-t");
  const linea = elemento("p", "cmp-apoyo cmp-cuenta-linea");
  linea.setAttribute("aria-live", "polite");
  const nota = elemento("p", "cmp-error cmp-cuenta-nota");
  nota.setAttribute("role", "status");
  const ultimo = elemento("p", "cmp-suave cmp-cuenta-aparte");
  const spam = elemento("p", "cmp-suave cmp-cuenta-aparte");
  const cuenta = elemento("p", "cmp-suave cmp-cuenta-aparte");
  const secundaria = elemento("button", "cmp-suave cmp-cuenta-otra");
  secundaria.type = "button";
  cuerpo.append(tilde, titulo, linea, nota, ultimo, spam, cuenta, secundaria);
  const barra = elemento("div", "cmp-accion");
  const campo = elemento("input", "cmp-cuenta-campo");
  campo.type = "text";
  campo.setAttribute("inputmode", "text");
  campo.setAttribute("autocapitalize", "characters");
  campo.setAttribute("autocorrect", "off");
  campo.setAttribute("spellcheck", "false");
  campo.autocomplete = "one-time-code";
  campo.maxLength = 24;
  const principal = elemento("button", "primary");
  principal.type = "button";
  barra.append(campo, principal);
  seccion.append(cuerpo, barra);

  const tx = (clave: string, valores?: Record<string, string>): string => {
    const propio = TEXTOS_CONFIRMAR[deps.idioma()][clave];
    const base = propio ?? deps.txPagina(clave);
    return valores ? sustituir(base, valores) : base;
  };

  let vista: Vista = vistaDe(t, deps.ahora());
  /** Lo último que se le dijo a la página sobre si hay una confirmación en curso. */
  let enCursoAntes = false;

  function pintar(): void {
    if (destruida) return;
    const ahora = deps.ahora();
    vista = vistaDe(t, ahora, limpiarElCodigo(campo.value).length);
    seccion.hidden = !vista.visible;
    pagina.classList.toggle("cmp-con-codigo", vista.visible && vista.conCodigo);
    // Con una nota (se recargó, venció, falló) la espera también se achica: sin eso la acción de texto queda bajo la barra.
    pagina.classList.toggle("cmp-con-nota", vista.visible && vista.nota !== null);
    tilde.hidden = !vista.tilde;
    titulo.hidden = !vista.conCodigo;
    poner(titulo, vista.conCodigo ? tx("ccCodigoT") : "");
    poner(linea, vista.linea ? tx(vista.linea, { mail: lectura.correoTapado ?? "" }) : "");
    nota.hidden = vista.nota === null;
    poner(nota, vista.nota === null ? "" : tx(vista.nota));
    ultimo.hidden = !vista.usaElUltimo;
    poner(ultimo, vista.usaElUltimo ? tx("ccUsaElUltimo") : "");
    spam.hidden = !vista.spam;
    poner(spam, vista.spam ? tx("ccSpam") : "");
    cuenta.hidden = vista.cuentaAtras === null;
    poner(cuenta, vista.cuentaAtras === null ? "" : tx("ccOtroCodigoEn", { s: String(vista.cuentaAtras) }));
    secundaria.hidden = vista.secundaria === null;
    poner(secundaria, vista.secundaria ? tx(vista.secundaria.clave) : "");
    secundaria.title = vista.secundaria?.accion === "desbloquear" ? tx("ccDesbloqueoAyuda") : "";
    campo.hidden = !vista.conCodigo;
    campo.disabled = vista.campoApagado;
    campo.placeholder = tx("ccCodigoCampo");
    campo.setAttribute("aria-label", tx("ccCodigoCampo"));
    // Sin campo ni botón (Listo) la barra no queda vacía.
    barra.hidden = vista.principal === null && !vista.conCodigo;
    principal.hidden = vista.principal === null;
    if (vista.principal) {
      poner(principal, tx(vista.principal.clave));
      principal.disabled = vista.principal.apagada;
      if (vista.principal.ocupada) principal.setAttribute("aria-busy", "true");
      else principal.removeAttribute("aria-busy");
    }
    // Quien manda en la pantalla (la tarjeta o la cuenta regresiva) depende de esto: se avisa solo cuando cambia.
    const curso = enCurso(t);
    if (curso !== enCursoAntes) {
      enCursoAntes = curso;
      deps.alCambiarElCurso?.();
    }
  }

  /** El estado de ahora: después de un evento ya no es el que se miró antes. */
  const estadoActual = (): Tarjeta["estado"] => t.estado;

  /** Aplica un evento a la máquina y repinta. */
  function pasa(ev: Evento): void {
    if (destruida) return;
    t = siguiente(t, ev, deps.ahora());
    pintar();
  }

  /* ------------------------------------------------ lo que se hace con la sesión */

  const sinConexion = (): boolean => !deps.enLinea();

  async function pedirCodigo(): Promise<void> {
    pasa({ tipo: "pedir-codigo" });
    if (t.estado !== "mandando") return;
    if (sinConexion()) {
      pasa({ tipo: "fallo-al-mandar", falla: "red" });
      return;
    }
    // El código salió: se anota la hora (para una recarga) y el campo queda limpio.
    const salio = (): void => {
      pasa({ tipo: "codigo-mandado" });
      ponerMarca();
      campo.value = "";
      pintar();
    };
    try {
      await conTope(deps.acciones.mandarCodigo(), () => salio());
    } catch (e) {
      if (destruida) return;
      const falla = clasificarFallaAlMandar(e, deps.enLinea());
      pasa({ tipo: "fallo-al-mandar", falla });
      if (falla === "naciendo") {
        deps.alIrse("naciendo");
        deps.releerEn(RELEER_SI_NACIENDO_MS);
      } else if (falla === "sin-servicio" || falla === "sin-sesion") deps.alIrse("no-hace-falta");
      return;
    }
    if (destruida) return;
    salio();
    campo.focus({ preventScroll: true });
  }

  /** Lo que dice la cuenta después de confirmar: confirmó, o todavía no. También cuando la respuesta llega pasado el tope. */
  function despuesDeConfirmar(nueva: LecturaDelCelular): void {
    lectura = nueva;
    const quedo = nueva.correoDeLaSesionConfirmado;
    if (quedo) quitarMarca();
    else deps.releerEn(RELEER_SI_NO_QUEDO_MS);
    pasa({ tipo: "confirmado", quedo });
    if (!quedo) return;
    deps.alConfirmar(nueva);
    // Listo se ve unos segundos y la tarjeta se va.
    if (!destruida) {
      relojDeListo = window.setTimeout(() => {
        relojDeListo = null;
        if (destruida || estadoActual() !== "hecho") return;
        pasa({ tipo: "terminar" });
        deps.alIrse("hecho");
      }, HECHO_VISIBLE_MS);
    }
  }

  async function confirmar(): Promise<void> {
    const codigo = limpiarElCodigo(campo.value);
    if (codigo.length < LARGO_MINIMO_DEL_CODIGO) return;
    pasa({ tipo: "confirmar" });
    if (t.estado !== "confirmando") return;
    if (sinConexion()) {
      pasa({ tipo: "fallo-al-confirmar", falla: "red" });
      return;
    }
    try {
      despuesDeConfirmar(await conTope(deps.acciones.confirmarCodigo(codigo), (tarde) => despuesDeConfirmar(tarde)));
    } catch (e) {
      if (destruida) return;
      const falla = clasificarFallaAlConfirmar(e, deps.enLinea());
      pasa({ tipo: "fallo-al-confirmar", falla });
      if (falla === "naciendo") {
        deps.alIrse("naciendo");
        deps.releerEn(RELEER_SI_NACIENDO_MS);
      } else if (falla === "sin-servicio" || falla === "sin-sesion") deps.alIrse("no-hace-falta");
      else if (falla === "codigo-malo" && estadoActual() === "codigo") campo.select();
      else if (estadoActual() === "invita") campo.value = "";
      pintar();
    }
  }

  async function desbloquear(): Promise<void> {
    pasa({ tipo: "pedir-desbloqueo" });
    if (t.estado !== "desbloqueo") return;
    try {
      const quedo = await conTope(deps.acciones.usarDesbloqueo(), (tarde) => {
        if (tarde) deps.releer();
      });
      if (destruida) return;
      if (!quedo) {
        pasa({ tipo: "fallo-del-desbloqueo", falla: "falla" });
        return;
      }
      pasa({ tipo: "desbloqueado" });
      deps.releer();
    } catch (e) {
      if (destruida) return;
      // Cerrar el cuadro y que el navegador no deje abrirlo son lo mismo para quien lo ve: se sigue con el correo.
      if (noPermitido(e)) pasa({ tipo: "desbloqueo-no-permitido" });
      else if (cancelo(e)) pasa({ tipo: "desbloqueo-cancelado" });
      else {
        const falla = clasificarFallaDelDesbloqueo(e);
        pasa({ tipo: "fallo-del-desbloqueo", falla });
        if (falla === "sin-sesion") deps.alIrse("no-hace-falta");
      }
    }
  }

  function alTocarElPrincipal(): void {
    const accion = vista.principal?.accion;
    if (vista.principal?.apagada) return;
    if (accion === "pedir") void pedirCodigo();
    else if (accion === "confirmar") void confirmar();
    else if (accion === "desbloquear") void desbloquear();
  }
  principal.addEventListener("click", alTocarElPrincipal);
  secundaria.addEventListener("click", () => {
    const accion = vista.secundaria?.accion;
    if (accion === "pedir") void pedirCodigo();
    else if (accion === "desbloquear") void desbloquear();
  });
  campo.addEventListener("input", pintar);
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (vista.principal?.accion === "confirmar") void confirmar();
    }
  });
  // Con el teclado abierto la página pliega lo de arriba y deja el título, la línea, el campo y Confirmar.
  campo.addEventListener("focus", () => pagina.classList.add("cmp-teclado"));
  campo.addEventListener("blur", () => pagina.classList.remove("cmp-teclado"));

  // El reloj de la tarjeta: la cuenta atrás de Otro código, el aviso de Spam y la espera del desbloqueo. Con la pestaña
  // escondida no pinta nada: al volver, el primer segundo la pone al día.
  const soltarElReloj = deps.cada(() => {
    if (deps.visible()) pintar();
  }, 1_000);

  // El celular puede ofrecer el desbloqueo: se pregunta una vez, y no se ofrece si la cuenta ya está protegida.
  void deps.acciones.puedeDesbloqueo().then(
    (puede) => {
      desbloqueoPosible = puede;
      pasa({ tipo: "lectura", ofreceDesbloqueo: puede && !lectura.protegida });
    },
    () => undefined,
  );
  // Otra pestaña o la vuelta a esta pueden haber cambiado la cuenta: se pide leerla de nuevo.
  const soltarElAviso = deps.acciones.alCambiar((origen) => deps.releer(origen));

  pintar();

  return {
    pintar,
    enCurso: () => enCurso(t),
    alLeer: (nueva) => {
      if (destruida) return;
      lectura = nueva;
      // Con la cuenta lista, otra forma de entrar o sin forma, ya no hace falta. Con una duda (se está creando o no se sabe) se queda.
      if (t.estado === "hecho" || t.estado === "oculta") return;
      if (nueva.estado === "lista" || nueva.estado === "otro-con-correo" || nueva.estado === "otro-con-desbloqueo" || nueva.estado === "sin-forma") {
        pasa({ tipo: "ocultar" });
        deps.alIrse("no-hace-falta");
        return;
      }
      if (nueva.estado === "falta" && !nueva.puedeMandar) {
        pasa({ tipo: "ocultar" });
        deps.alIrse("no-hace-falta");
        return;
      }
      pasa({ tipo: "lectura", ofreceDesbloqueo: desbloqueoPosible && !nueva.protegida });
    },
    alVolver: () => {
      if (t.estado === "codigo" && !campo.disabled) campo.focus({ preventScroll: true });
      pintar();
    },
    destruir: (olvidar) => {
      if (destruida) return;
      destruida = true;
      soltarElReloj();
      if (relojDeListo !== null) window.clearTimeout(relojDeListo);
      soltarElAviso();
      if (olvidar) quitarMarca();
      pagina.classList.remove("cmp-con-codigo", "cmp-con-nota", "cmp-teclado");
      seccion.replaceChildren();
      seccion.hidden = true;
    },
  };
}
