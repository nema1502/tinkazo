/**
 * La máquina de la tarjeta Confirmar mi correo, sin pantalla ni reloj propio: recibe la hora en cada llamada.
 *
 * La tarjeta aparece en la espera cuando este navegador es de la cuenta y su correo nunca se confirmó. Confirmarlo es lo
 * que deja entrar desde cualquier otro celular o compu con un código. Acá viven los estados, lo que se ve en cada uno
 * (una sola acción principal), los topes de pedir códigos y cómo se entiende cada falla del servicio de cuentas. La pantalla
 * (`confirmar.ts`) solo pinta lo que dice `vistaDe` y avisa lo que pasó con `siguiente`.
 *
 * El código se manda siempre al correo de la sesión, nunca a uno que se escriba (la sesión lo decide, no esta máquina).
 */

import { esDeRed } from "../stellar/errores";
import { codigoMalo, SIN_RESPUESTA } from "../ui/proteger-cuenta";

/** A los 20 segundos de mandado el código se suma el aviso de que puede estar en Spam. */
export const SPAM_A_LOS_MS = 20_000;
/** Otro código se puede pedir recién a los 60 segundos del envío (cada envío anula al anterior). */
export const OTRO_CODIGO_A_LOS_MS = 60_000;
/** Un código vence a los 5 minutos: pasado ese tiempo, un rechazo se dice como vencido. */
export const CODIGO_VENCE_A_LOS_MS = 300_000;
/** Tope de esta página: 5 códigos en 15 minutos, y el sexto pedido espera 5 minutos. */
export const ENVIOS_PERMITIDOS = 5;
export const VENTANA_DE_ENVIOS_MS = 900_000;
export const PAUSA_POR_MUCHOS_MS = 300_000;
/** El desbloqueo del celular tarda: a los 8 segundos sin respuesta se dice que se espera la huella. */
export const DESBLOQUEO_TARDA_MS = 8_000;
/** Cuánto se ve Listo antes de que la tarjeta se vaya. */
export const HECHO_VISIBLE_MS = 4_000;
/** Menos de esto no es un código: el botón queda apagado. */
export const LARGO_MINIMO_DEL_CODIGO = 4;
/**
 * Lo que dice el error cuando la sesión del proveedor ya no es la de la cuenta de la tarjeta, o se cerró (el kit la cierra si
 * el servicio frena su renovación). Ninguna repetición lo arregla: la tarjeta se va y queda la línea de siempre.
 */
export const SIN_SESION = "sin-sesion";
/** La marca de `sessionStorage` de un código mandado: solo la hora, nada de la cuenta ni del correo. */
export const MARCA_DEL_CODIGO = "tinkazo.cmp.codigo";
/**
 * Si la tarjeta promete que la cuenta entra desde cualquier celular o compu: en la línea que invita a confirmar, en la que
 * sigue al desbloqueo y en el Listo del final. Esa promesa no se hizo todavía con dos navegadores de verdad: queda apagada
 * hasta que la prueba pase, y mientras tanto la tarjeta dice solo lo que se sabe. Se prende acá, en un solo lugar.
 */
export const PROMESA_VERIFICADA = false;

/** La línea que invita a confirmar el correo, con o sin la promesa de entrar desde otro aparato. */
const claveDeLaLinea = (): string => (PROMESA_VERIFICADA ? "ccLinea" : "ccLineaSolo");
/** La línea que sigue al desbloqueo del celular, con o sin la promesa. */
const claveDelDesbloqueoListo = (): string => (PROMESA_VERIFICADA ? "ccDesbloqueoListo" : "ccDesbloqueoListoSolo");

export type NombreDeEstado =
  | "invita"
  | "mandando"
  | "codigo"
  | "confirmando"
  | "desbloqueo"
  | "desbloqueado"
  | "hecho"
  | "oculta";

export interface Tarjeta {
  estado: NombreDeEstado;
  /** Desde cuándo está en este estado. */
  desde: number;
  /** La clave del texto de una nota o de una falla, o null. */
  nota: string | null;
  /** Cuándo salió el último código que puede servir, o null. */
  mandadoEn: number | null;
  /** Cuándo salieron los códigos de esta página, para el tope. */
  envios: readonly number[];
  /** No se pueden pedir códigos hasta esta hora. */
  bloqueadoHasta: number | null;
  /** Ya hubo otro código antes: el que sirve es el del correo más nuevo. */
  reenviado: boolean;
  /** Pedir otro código no espera el minuto (el código dio viejo, vencido, recargado o equivocado). */
  sinEspera: boolean;
  /** A dónde vuelve si lo que está corriendo falla. */
  volverA: "invita" | "codigo" | "desbloqueado";
  /** La tarjeta se abrió después de recargar la página con un código mandado hace poco. */
  recargado: boolean;
  /** El celular ofrece el desbloqueo y la cuenta todavía no está protegida. */
  ofreceDesbloqueo: boolean;
  /** El navegador no dejó abrir el desbloqueo: no se vuelve a ofrecer en esta carga. */
  desbloqueoNoDeja: boolean;
}

export type FallaAlMandar = "naciendo" | "sin-servicio" | "sin-sesion" | "muchos" | "red" | "tarda" | "falla";
export type FallaAlConfirmar = FallaAlMandar | "codigo-malo" | "sin-codigo";
export type FallaDelDesbloqueo = "red" | "tarda" | "falla" | "sin-sesion";

export type Evento =
  | { tipo: "pedir-codigo" }
  | { tipo: "codigo-mandado" }
  | { tipo: "fallo-al-mandar"; falla: FallaAlMandar }
  | { tipo: "confirmar" }
  | { tipo: "confirmado"; quedo: boolean }
  | { tipo: "fallo-al-confirmar"; falla: FallaAlConfirmar }
  | { tipo: "pedir-desbloqueo" }
  | { tipo: "desbloqueado" }
  | { tipo: "desbloqueo-cancelado" }
  | { tipo: "desbloqueo-no-permitido" }
  | { tipo: "fallo-del-desbloqueo"; falla: FallaDelDesbloqueo }
  | { tipo: "lectura"; ofreceDesbloqueo: boolean }
  | { tipo: "terminar" }
  | { tipo: "ocultar" };

/** La tarjeta recién abierta. Con la página recargada y un código mandado hace poco, abre pidiendo otro. */
export function iniciar(ahora: number, o: { ofreceDesbloqueo: boolean; recargado: boolean }): Tarjeta {
  return {
    estado: "invita",
    desde: ahora,
    nota: o.recargado ? "ccCodigoRecargado" : null,
    mandadoEn: null,
    envios: [],
    bloqueadoHasta: null,
    reenviado: false,
    sinEspera: o.recargado,
    volverA: "invita",
    recargado: o.recargado,
    ofreceDesbloqueo: o.ofreceDesbloqueo,
    desbloqueoNoDeja: false,
  };
}

const estaBloqueada = (t: Tarjeta, ahora: number): boolean => t.bloqueadoHasta !== null && ahora < t.bloqueadoHasta;

/** Si ahora se puede pedir un código: hay un lugar desde donde pedirlo, no hay pausa y pasó el minuto del último envío. */
export function puedePedir(t: Tarjeta, ahora: number): boolean {
  // Con el desbloqueo en curso el correo es la salida cuando el cuadro del sistema no aparece: recién pasados esos 8 segundos.
  const desbloqueoTarda = t.estado === "desbloqueo" && ahora - t.desde >= DESBLOQUEO_TARDA_MS;
  if (t.estado !== "invita" && t.estado !== "codigo" && t.estado !== "desbloqueado" && !desbloqueoTarda) return false;
  if (estaBloqueada(t, ahora)) return false;
  return !(t.estado === "codigo" && !t.sinEspera && t.mandadoEn !== null && ahora - t.mandadoEn < OTRO_CODIGO_A_LOS_MS);
}

const NOTA_DE_LA_FALLA: Record<"red" | "tarda" | "falla" | "muchos", string> = {
  red: "cpErrRed",
  tarda: "ccTarda",
  falla: "ccFalla",
  muchos: "ccMuchos",
};

/** Lo que pasa con la tarjeta ante un evento. No guarda nada afuera: devuelve la tarjeta nueva. */
export function siguiente(t: Tarjeta, ev: Evento, ahora: number): Tarjeta {
  switch (ev.tipo) {
    case "pedir-codigo": {
      if (!puedePedir(t, ahora)) return t;
      const recientes = t.envios.filter((e) => ahora - e < VENTANA_DE_ENVIOS_MS);
      // El sexto pedido no sale: se dice y la acción queda apagada un rato.
      if (recientes.length >= ENVIOS_PERMITIDOS) {
        return { ...t, nota: "ccMuchos", bloqueadoHasta: ahora + PAUSA_POR_MUCHOS_MS, envios: recientes };
      }
      // Si el pedido sale del desbloqueo que no responde, una falla vuelve a la invitación: el desbloqueo ya no cuenta.
      return { ...t, estado: "mandando", desde: ahora, nota: null, volverA: t.estado === "desbloqueo" ? "invita" : (t.estado as Tarjeta["volverA"]) };
    }
    case "codigo-mandado": {
      // También cuenta el código que sale después del tope de espera: el correo llegó aunque la página ya dijo que tardaba.
      const tarde = t.nota === "ccTarda" && (t.estado === "invita" || t.estado === "codigo" || t.estado === "desbloqueado");
      if (t.estado !== "mandando" && !tarde) return t;
      const recientes = t.envios.filter((e) => ahora - e < VENTANA_DE_ENVIOS_MS);
      return {
        ...t,
        estado: "codigo",
        desde: ahora,
        nota: null,
        mandadoEn: ahora,
        envios: [...recientes, ahora],
        reenviado: t.envios.length > 0 || t.recargado,
        sinEspera: false,
        volverA: "codigo",
        recargado: false,
      };
    }
    case "fallo-al-mandar": {
      if (t.estado !== "mandando") return t;
      if (ev.falla === "naciendo" || ev.falla === "sin-servicio" || ev.falla === "sin-sesion") return { ...t, estado: "oculta", desde: ahora };
      return alvolver(t, ev.falla, ahora);
    }
    case "confirmar":
      return t.estado === "codigo" ? { ...t, estado: "confirmando", desde: ahora, nota: null } : t;
    case "confirmado": {
      // Una respuesta que llega tarde, pasado el tope, cuenta igual: la cuenta quedó confirmada.
      if (t.estado === "hecho" || t.estado === "oculta") return t;
      if (ev.quedo) return { ...t, estado: "hecho", desde: ahora, nota: null };
      return { ...t, estado: "codigo", desde: ahora, nota: "ccNoQuedo" };
    }
    case "fallo-al-confirmar": {
      if (t.estado !== "confirmando" && t.estado !== "codigo") return t;
      if (ev.falla === "naciendo" || ev.falla === "sin-servicio" || ev.falla === "sin-sesion") return { ...t, estado: "oculta", desde: ahora };
      if (ev.falla === "codigo-malo") {
        // Pasados 5 minutos desde el envío, un código que no sirve es un código vencido: ya no hay nada que revisar.
        if (t.mandadoEn !== null && ahora - t.mandadoEn > CODIGO_VENCE_A_LOS_MS) {
          return { ...t, estado: "invita", desde: ahora, nota: "ccCodigoVencido", mandadoEn: null, sinEspera: true, volverA: "invita" };
        }
        return { ...t, estado: "codigo", desde: ahora, nota: "ccCodigoMalo", sinEspera: true };
      }
      if (ev.falla === "sin-codigo") {
        const nota = t.recargado ? "ccCodigoRecargado" : "ccCodigoViejo";
        return { ...t, estado: "invita", desde: ahora, nota, mandadoEn: null, sinEspera: true, volverA: "invita" };
      }
      return { ...alvolver({ ...t, volverA: "codigo" }, ev.falla, ahora), estado: "codigo" };
    }
    case "pedir-desbloqueo":
      return t.estado === "invita" ? { ...t, estado: "desbloqueo", desde: ahora, nota: null, volverA: "invita" } : t;
    case "desbloqueado":
      return t.estado === "desbloqueo"
        ? { ...t, estado: "desbloqueado", desde: ahora, nota: null, ofreceDesbloqueo: false, volverA: "desbloqueado" }
        : t;
    case "desbloqueo-cancelado":
      return t.estado === "desbloqueo" ? { ...t, estado: "invita", desde: ahora, nota: null } : t;
    case "desbloqueo-no-permitido":
      return t.estado === "desbloqueo"
        ? { ...t, estado: "invita", desde: ahora, nota: "ccDesbloqueoBloqueado", desbloqueoNoDeja: true }
        : t;
    case "fallo-del-desbloqueo":
      if (t.estado !== "desbloqueo") return t;
      if (ev.falla === "sin-sesion") return { ...t, estado: "oculta", desde: ahora };
      return { ...t, estado: "invita", desde: ahora, nota: NOTA_DE_LA_FALLA[ev.falla] };
    case "lectura":
      return t.ofreceDesbloqueo === ev.ofreceDesbloqueo ? t : { ...t, ofreceDesbloqueo: ev.ofreceDesbloqueo };
    case "terminar":
      return t.estado === "hecho" ? { ...t, estado: "oculta", desde: ahora } : t;
    case "ocultar":
      return t.estado === "oculta" ? t : { ...t, estado: "oculta", desde: ahora };
  }
}

/** Vuelve al lugar de donde salió el pedido, con la nota de lo que falló. Con "muchos" también apaga la acción un rato. */
function alvolver(t: Tarjeta, falla: "muchos" | "red" | "tarda" | "falla", ahora: number): Tarjeta {
  const base: Tarjeta = { ...t, estado: t.volverA, desde: ahora, nota: NOTA_DE_LA_FALLA[falla] };
  return falla === "muchos" ? { ...base, bloqueadoHasta: ahora + PAUSA_POR_MUCHOS_MS } : base;
}

/**
 * Si hay una confirmación en curso: la persona ya empezó (mandó el código, lo está escribiendo, confirma, usa el desbloqueo o
 * ve Listo), o la página se recargó con un código mandado hace menos de 5 minutos. Con la lista sellada, una confirmación en
 * curso le gana a la cuenta regresiva: confirmar lleva un minuto con el correo y no se puede perder a medias.
 */
export function enCurso(t: Tarjeta): boolean {
  switch (t.estado) {
    case "mandando":
    case "codigo":
    case "confirmando":
    case "desbloqueo":
    case "hecho":
      return true;
    case "invita":
      return t.recargado;
    default:
      return false;
  }
}

/** Una acción: lo que dice el botón y qué hace al tocarlo. */
export interface AccionVisible {
  clave: string;
  accion: "pedir" | "confirmar" | "desbloquear";
  apagada: boolean;
  /** Algo está corriendo: el botón lleva la ruedita. */
  ocupada: boolean;
}

/** Lo que se ve de la tarjeta en un estado. Una sola acción principal, y a lo sumo una secundaria. */
export interface Vista {
  /** Si la tarjeta está a la vista. */
  visible: boolean;
  /** Hay un código en juego: título Mirá tu correo, el campo, y la espera de arriba se achica. */
  conCodigo: boolean;
  campoApagado: boolean;
  linea: string | null;
  nota: string | null;
  usaElUltimo: boolean;
  spam: boolean;
  tilde: boolean;
  principal: AccionVisible | null;
  /** La acción de texto de abajo: usar el desbloqueo o mandar otro código. */
  secundaria: { clave: string; accion: "pedir" | "desbloquear" } | null;
  /** Segundos que faltan para poder mandar otro código, mientras no se puede. */
  cuentaAtras: number | null;
}

const VISTA_VACIA: Vista = {
  visible: false,
  conCodigo: false,
  campoApagado: false,
  linea: null,
  nota: null,
  usaElUltimo: false,
  spam: false,
  tilde: false,
  principal: null,
  secundaria: null,
  cuentaAtras: null,
};

/** `largoDelCampo`: cuántos caracteres hay escritos, para apagar Confirmar con menos de cuatro. */
export function vistaDe(t: Tarjeta, ahora: number, largoDelCampo = 0): Vista {
  if (t.estado === "oculta") return VISTA_VACIA;
  const bloqueada = estaBloqueada(t, ahora);
  const nota = t.nota === "ccMuchos" && !bloqueada ? null : t.nota;
  const base: Vista = { ...VISTA_VACIA, visible: true, nota };
  const ofrece = t.ofreceDesbloqueo && !t.desbloqueoNoDeja;
  switch (t.estado) {
    case "invita":
      return {
        ...base,
        linea: claveDeLaLinea(),
        principal: { clave: t.sinEspera ? "ccOtroCodigo" : "ccConfirmar", accion: "pedir", apagada: bloqueada, ocupada: false },
        secundaria: ofrece ? { clave: "ccDesbloqueo", accion: "desbloquear" } : null,
      };
    case "desbloqueado":
      return {
        ...base,
        linea: claveDelDesbloqueoListo(),
        principal: { clave: "ccConfirmar", accion: "pedir", apagada: bloqueada, ocupada: false },
      };
    case "desbloqueo":
      return {
        ...base,
        linea: ahora - t.desde >= DESBLOQUEO_TARDA_MS ? "ccEsperandoDesbloqueo" : claveDeLaLinea(),
        principal: { clave: "ccDesbloqueo", accion: "desbloquear", apagada: true, ocupada: true },
        // La línea manda a probar con el correo: desde ese momento hay con qué probar, sin esperar el tope del minuto.
        secundaria: ahora - t.desde >= DESBLOQUEO_TARDA_MS ? { clave: "ccConfirmar", accion: "pedir" } : null,
      };
    case "mandando": {
      const conCodigo = t.volverA === "codigo";
      return {
        ...base,
        conCodigo,
        linea: conCodigo ? "ccCodigoLinea" : t.volverA === "desbloqueado" ? claveDelDesbloqueoListo() : claveDeLaLinea(),
        usaElUltimo: conCodigo && t.reenviado,
        principal: { clave: "ccMandando", accion: "pedir", apagada: true, ocupada: true },
      };
    }
    case "codigo":
    case "confirmando": {
      const confirmando = t.estado === "confirmando";
      const pasado = t.mandadoEn === null ? 0 : ahora - t.mandadoEn;
      const puedeOtro = !confirmando && !bloqueada && (t.sinEspera || pasado >= OTRO_CODIGO_A_LOS_MS);
      return {
        ...base,
        conCodigo: true,
        campoApagado: confirmando,
        linea: "ccCodigoLinea",
        usaElUltimo: t.reenviado,
        spam: t.mandadoEn !== null && pasado >= SPAM_A_LOS_MS,
        principal: confirmando
          ? { clave: "ccConfirmando", accion: "confirmar", apagada: true, ocupada: true }
          : { clave: "ccCodigoConfirmar", accion: "confirmar", apagada: largoDelCampo < LARGO_MINIMO_DEL_CODIGO, ocupada: false },
        secundaria: puedeOtro ? { clave: "ccOtroCodigo", accion: "pedir" } : null,
        cuentaAtras: !confirmando && !bloqueada && !puedeOtro ? Math.max(1, Math.ceil((OTRO_CODIGO_A_LOS_MS - pasado) / 1000)) : null,
      };
    }
    case "hecho":
      return { ...base, tilde: true, linea: PROMESA_VERIFICADA ? "ccConfirmado" : "ccConfirmadoSolo" };
  }
}

/* ------------------------------------------------ cómo se entiende lo que contesta el servicio de cuentas */

interface ErrorDelKit {
  code?: unknown;
  message?: unknown;
  body?: { reason?: unknown; message?: unknown; turnkeyStatus?: unknown; status?: unknown } | null;
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");

/** El código del error del kit: viaja en `code` y, si no, en su mensaje. */
function codigoDe(e: unknown): string {
  const k = (e ?? {}) as ErrorDelKit;
  return texto(k.code) || texto(k.message);
}

/** El detalle que el kit deja en el cuerpo del error (la razón o lo que contestó el servicio). */
function detalleDe(e: unknown): string {
  const k = (e ?? {}) as ErrorDelKit;
  return `${texto(k.body?.reason)} ${texto(k.body?.message)}`;
}

function estadoDe(e: unknown): number | null {
  const k = (e ?? {}) as ErrorDelKit;
  for (const n of [k.body?.turnkeyStatus, k.body?.status]) if (typeof n === "number") return n;
  return null;
}

/** Cómo se entiende una falla al mandar el código (o al confirmar, sin mirar el código en sí). */
function fallaGeneral(e: unknown): FallaAlMandar {
  if (e === SIN_RESPUESTA) return "tarda";
  const codigo = codigoDe(e);
  const detalle = detalleDe(e);
  // La sesión se cerró o es de otra cuenta: no es un error de red ni de quien escribe, y repetir no lo arregla.
  if (codigo === SIN_SESION) return "sin-sesion";
  // La cuenta todavía no tiene su billetera: no es un error de quien escribe y no se dice nada. Se vuelve a leer.
  if (codigo === "SDK_COSIGN_REQUEST_NOT_FOUND" && /no turnkey wallet/i.test(detalle)) return "naciendo";
  if (codigo === "SDK_COSIGN_NOT_CONFIGURED" || codigo === "SDK_CREDITS_INSUFFICIENT" || estadoDe(e) === 402) return "sin-servicio";
  if (estadoDe(e) === 429 || /RATE_LIMITED|too many requests/i.test(`${codigo} ${detalle}`)) return "muchos";
  if (esDeRed(e)) return "red";
  return "falla";
}

/** Una falla al mandar el código. Sin conexión no se llama a nadie: `enLinea` falso ya es una falla de red. */
export function clasificarFallaAlMandar(e: unknown, enLinea = true): FallaAlMandar {
  if (!enLinea) return "red";
  return fallaGeneral(e);
}

/** Una falla al confirmar: el código del correo puede estar mal, vencido, o la página perdió el que mandó. */
export function clasificarFallaAlConfirmar(e: unknown, enLinea = true): FallaAlConfirmar {
  if (!enLinea) return "red";
  if (e !== SIN_RESPUESTA && codigoDe(e) === "SDK_COSIGN_REQUEST_NOT_FOUND" && /no code was sent/i.test(detalleDe(e))) return "sin-codigo";
  const general = fallaGeneral(e);
  // Un rechazo por límite no es un código malo, aunque diga algo de un código.
  if (general === "naciendo" || general === "sin-servicio" || general === "sin-sesion" || general === "muchos" || general === "tarda") return general;
  return codigoMalo(e) ? "codigo-malo" : general;
}

/** Cómo se entiende una falla del desbloqueo, sin las dos que no son fallas: cerrar el cuadro y que no se deje abrir. */
export function clasificarFallaDelDesbloqueo(e: unknown): FallaDelDesbloqueo {
  if (e === SIN_RESPUESTA) return "tarda";
  if (codigoDe(e) === SIN_SESION) return "sin-sesion";
  return esDeRed(e) ? "red" : "falla";
}

/** Si la marca de un código mandado sirve todavía: tiene menos de 5 minutos. La marca es solo la hora, en milisegundos. */
export function marcaVigente(valor: string | null, ahora: number): boolean {
  if (valor === null) return false;
  const cuando = Number(valor);
  return Number.isFinite(cuando) && cuando > 0 && cuando <= ahora && ahora - cuando < CODIGO_VENCE_A_LOS_MS;
}

/** El código como se escribió, sin espacios (el que lo pega puede traer alguno de más). */
export const limpiarElCodigo = (valor: string): string => valor.replace(/\s+/gu, "");
