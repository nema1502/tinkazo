/**
 * El botón de entrar con Google para sitios web, el que usa una campaña de personas. El guion oficial de Google
 * (`accounts.google.com/gsi/client`) se carga solo en ese caso y recién cuando la pantalla necesita el botón: quien ya está
 * anotada o abre una campaña de siempre no baja nada de esto. No se carga el kit del proveedor de cuentas ni se espera
 * ninguna billetera.
 *
 * Google entrega un token de identidad firmado. Lo único que se lee acá es el nombre, para el saludo de la pantalla del stand:
 * el token se lo queda quien lo pidió, viaja solo en el alta y no se guarda ni se escribe en la consola.
 */

import type { Lang } from "../idioma";
import { stripInvisibles } from "../invisibles";
import type { FallaDeEntrada } from "./celular";
import { nombreParaLaPantalla } from "./sesion";

export const URL_DEL_GUION_DE_GOOGLE = "https://accounts.google.com/gsi/client";
/** Cuánto se espera a que el guion baje: pasado, se dice que Google no pudo entrar y se puede volver a probar. */
export const ESPERA_DEL_GUION_MS = 10_000;

interface OpcionesDelBoton {
  type: "standard";
  theme: "outline" | "filled_black";
  size: "large";
  text: "continue_with";
  shape: "pill";
  logo_alignment: "left";
  width: number;
  locale: string;
}

interface RespuestaDeGoogle {
  credential?: unknown;
}

/** Lo que usamos de la API de Google. */
export interface GoogleId {
  initialize: (configuracion: {
    client_id: string;
    callback: (respuesta: RespuestaDeGoogle) => void;
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
  }) => void;
  renderButton: (contenedor: HTMLElement, opciones: OpcionesDelBoton) => void;
}

type VentanaConGoogle = Window & { google?: { accounts?: { id?: GoogleId } } };

let enCurso: Promise<GoogleId> | null = null;

/**
 * Baja el guion de Google una sola vez. Con una falla (sin red, bloqueado) la próxima llamada vuelve a intentar. Nunca copia el
 * error del navegador.
 */
export function cargarElGuionDeGoogle(
  doc: Document = document,
  ventana: VentanaConGoogle = window,
  tope = ESPERA_DEL_GUION_MS,
): Promise<GoogleId> {
  const listo = ventana.google?.accounts?.id;
  if (listo) return Promise.resolve(listo);
  if (enCurso) return enCurso;
  const intento = new Promise<GoogleId>((resolver, rechazar) => {
    const guion = doc.createElement("script");
    const reloj = ventana.setTimeout(() => {
      guion.remove();
      rechazar(new Error("google"));
    }, tope);
    guion.src = URL_DEL_GUION_DE_GOOGLE;
    guion.async = true;
    guion.defer = true;
    guion.addEventListener("load", () => {
      ventana.clearTimeout(reloj);
      const id = ventana.google?.accounts?.id;
      if (id) resolver(id);
      else rechazar(new Error("google"));
    });
    guion.addEventListener("error", () => {
      ventana.clearTimeout(reloj);
      guion.remove();
      rechazar(new Error("google"));
    });
    doc.head.append(guion);
  });
  enCurso = intento;
  // Con una falla se puede volver a probar: la próxima llamada arma otro intento.
  void intento.catch(() => {
    if (enCurso === intento) enCurso = null;
  });
  return intento;
}

/** El nombre corto del perfil que trae el token de identidad, o null. Solo lee el nombre: no comprueba nada, eso lo hace la sala. */
export function nombreDeLaCredencial(credencial: string): string | null {
  try {
    const carga = credencial.split(".")[1];
    if (!carga) return null;
    const base = carga.replace(/-/gu, "+").replace(/_/gu, "/");
    const bytes = Uint8Array.from(atob(base.padEnd(Math.ceil(base.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const datos: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof datos !== "object" || datos === null) return null;
    const { name, given_name: pila } = datos as { name?: unknown; given_name?: unknown };
    const nombre = typeof name === "string" && stripInvisibles(name).trim() !== "" ? name : typeof pila === "string" ? pila : null;
    return nombreParaLaPantalla(nombre);
  } catch {
    return null;
  }
}

export interface BotonDeGoogleDeVerdad {
  /**
   * Pone el botón en `contenedor` (baja el guion si hace falta). Cada vez que la persona entra con Google llama a `alEntrar` con
   * el token de identidad. Si el guion no baja, o Google no entrega nada, llama a `alFallar`. Devuelve cómo sacar el botón.
   */
  montar: (
    contenedor: HTMLElement,
    alEntrar: (credencial: string) => void,
    alFallar: (falla: FallaDeEntrada) => void,
  ) => () => void;
}

export function botonDeGoogle(o: {
  clienteId: string;
  idioma: () => Lang;
  /** Si la página está en tema oscuro: el botón cambia de colores. */
  oscuro?: () => boolean;
  /** Para probar sin el guion de verdad. */
  cargar?: () => Promise<GoogleId>;
}): BotonDeGoogleDeVerdad {
  const cargar = o.cargar ?? (() => cargarElGuionDeGoogle());
  let inicializado = false;
  /** Quien recibe lo que entregue Google: el último botón montado. Google se inicia una sola vez por página. */
  let receptor: ((respuesta: RespuestaDeGoogle) => void) | null = null;
  return {
    montar: (contenedor, alEntrar, alFallar) => {
      let vivo = true;
      const mio = (respuesta: RespuestaDeGoogle): void => {
        if (!vivo) return;
        const credencial = respuesta.credential;
        if (typeof credencial === "string" && credencial !== "") alEntrar(credencial);
        else alFallar("google");
      };
      void cargar().then(
        (google) => {
          if (!vivo) return;
          receptor = mio;
          if (!inicializado) {
            inicializado = true;
            google.initialize({
              client_id: o.clienteId,
              callback: (respuesta) => receptor?.(respuesta),
              auto_select: false,
              cancel_on_tap_outside: true,
            });
          }
          google.renderButton(contenedor, {
            type: "standard",
            theme: o.oscuro?.() ? "filled_black" : "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            logo_alignment: "left",
            // Google acepta de 200 a 400 píxeles.
            width: Math.max(200, Math.min(320, contenedor.clientWidth || 280)),
            locale: o.idioma(),
          });
        },
        () => {
          if (vivo) alFallar("google");
        },
      );
      return () => {
        vivo = false;
        if (receptor === mio) receptor = null;
        contenedor.replaceChildren();
      };
    },
  };
}
