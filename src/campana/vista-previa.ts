/**
 * El lado de adentro de la vista en vivo: participar.html dentro del marco de la página para armar campañas. Escucha lo que
 * manda la de afuera, lo valida con el mismo lector del sitio y monta el celular de verdad con la demostración, sin sala,
 * sin Google y sin guardar nada. Solo se carga con `?vista=previa` y dentro de un marco (ver participar.ts).
 */

import { costoDelRetiroTexto } from "../costo-del-retiro";
import type { Lang } from "../idioma";
import type { BaseDelCelular } from "./conectar";
import { montarCelular, type BotonDeGoogle, type DepsDelCelular, type VistaDelCelular } from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { SIN_CUENTA } from "./memoria";
import { leerCampana } from "./modelo";
import {
  ESTADO_DE_PANTALLA,
  VISTA_LISTA,
  leerMensajeDeVista,
  type MensajeDeVista,
  type MuestrasDeVista,
} from "./vista-protocolo";
import "./vista-previa.css";

export interface OpcionesDeLaVista {
  raiz: HTMLElement;
  base: BaseDelCelular;
  /** Se suscribe a los mensajes que llegan y devuelve cómo dejar de escuchar. */
  escuchar: (f: (e: MessageEvent) => void) => () => void;
  origen: string;
  padre: unknown;
  /** Le avisa a la página de afuera que la vista está lista para recibir la campaña. */
  avisarLista: () => void;
  /** Cambia el idioma de esta página sin escribir la preferencia: el idioma de la persona no se toca. */
  cambiarIdioma: (idioma: Lang) => void;
  /** Se suscribe al cambio de idioma de esta página (el texto del celular se pinta de nuevo). */
  alCambiarIdioma: (f: () => void) => void;
  /** El costo de retirar que dice la vista: por defecto el que cobra el sitio, y si no cobra nada no se dice nada. */
  costoDelRetiro?: (idioma: Lang) => string | null;
  red: "mainnet" | "testnet";
  /** Se llama la primera vez que hay una vista montada: la carga que decía Cargando ya no se repinta. */
  alMontar: () => void;
}

/** Las clases del cuerpo que apagan lo que es de muestra. */
const CLASES_DE_MUESTRA: Record<keyof MuestrasDeVista, string> = {
  nombre: "cmp-muestra-nombre",
  premio: "cmp-muestra-premio",
  lugar: "cmp-muestra-lugar",
  horas: "cmp-muestra-horas",
};

/** Pone o saca las clases de lo que es de muestra. */
export function marcarMuestras(muestras: MuestrasDeVista): void {
  for (const clave of Object.keys(CLASES_DE_MUESTRA) as Array<keyof MuestrasDeVista>) {
    document.body.classList.toggle(CLASES_DE_MUESTRA[clave], muestras[clave]);
  }
}

/** El nombre y el código de muestra de la vista de una campaña de personas: nadie entra a Google y nada se guarda. */
const NOMBRE_DE_MUESTRA = "Ana P.";
const CODIGO_DE_MUESTRA = "4821";

/**
 * La demostración de una campaña de personas: el botón de Google es de mentira (un botón común que entrega un nombre de muestra),
 * quien gana ve su código de muestra y no hay cuenta ni retiro que decir. Es el mismo celular que ve la gente.
 */
function deLaPersona(demostracion: DepsDelCelular): DepsDelCelular {
  const boton: BotonDeGoogle = {
    montar: (contenedor, alEntrar) => {
      const entrar = document.createElement("button");
      entrar.type = "button";
      entrar.className = "primary";
      entrar.textContent = demostracion.tx("cpEntrar");
      entrar.addEventListener("click", () => alEntrar({ cuenta: SIN_CUENTA, nombre: NOMBRE_DE_MUESTRA }));
      contenedor.append(entrar);
      return () => contenedor.replaceChildren();
    },
  };
  return {
    ...demostracion,
    persona: { google: boton },
    yo: async () => {
      const propio = await demostracion.yo();
      return propio !== "red" && propio !== "terminada" && propio.gano === true ? { ...propio, codigo: CODIGO_DE_MUESTRA } : propio;
    },
    costoDelRetiro: () => null,
  };
}

/** Monta la escucha. Devuelve cómo dejar de escuchar y soltar la vista. */
export function montarVistaPrevia(o: OpcionesDeLaVista): () => void {
  let vista: VistaDelCelular | null = null;
  let ultimo: MensajeDeVista | null = null;
  document.body.classList.add("cmp-vista");

  /** Las reglas se pintan después de montar (la demostración responde con promesas): cada plegado nuevo sale como pide la pestaña. */
  const abrirLasReglas = (): void => {
    for (const reglas of o.raiz.querySelectorAll<HTMLDetailsElement>("details.cmp-reglas:not([data-vista])")) {
      reglas.dataset.vista = "1";
      if (ultimo?.reglasAbiertas) reglas.setAttribute("open", "");
    }
  };
  const mirador = new MutationObserver(abrirLasReglas);
  mirador.observe(o.raiz, { childList: true, subtree: true });
  const mostrarLaEtiqueta = (): void => {
    const etiqueta = document.querySelector<HTMLElement>("#cmp-ejemplo");
    if (etiqueta) etiqueta.hidden = false;
  };

  const montar = (m: MensajeDeVista): void => {
    const lectura = leerCampana({ ...m.campana, red: o.red });
    // Una campaña que el lector rechaza deja la vista anterior: nunca se ve una rota.
    if (!lectura.ok) return;
    ultimo = m;
    o.cambiarIdioma(m.idioma);
    marcarMuestras(m.muestras);
    vista?.desmontar();
    const base: BaseDelCelular = {
      ...o.base,
      // Aunque se abra desde un navegador dentro de una app, la vista muestra la campaña y no el aviso de abrir en otro.
      enApp: false,
      vibrar: () => undefined,
      // Con festejar en falso el festejo grande solo pone la tilde: escribir en la pestaña Ganó no tira papel picado.
      movimientoReducido: () => !m.festejar || o.base.movimientoReducido(),
    };
    const demostracion = depsDeDemostracion(base, lectura.campana, ESTADO_DE_PANTALLA[m.pantalla]);
    vista = montarCelular(
      o.raiz,
      lectura.campana.identidad === "persona"
        ? deLaPersona(demostracion)
        : {
            ...demostracion,
            costoDelRetiro: () => (o.costoDelRetiro ?? ((l: Lang) => costoDelRetiroTexto(l)))(o.base.idioma()),
          },
    );
    mostrarLaEtiqueta();
    abrirLasReglas();
    o.alMontar();
  };

  const alRecibir = (e: MessageEvent): void => {
    const m = leerMensajeDeVista(e, { origen: o.origen, padre: o.padre });
    if (m) montar(m);
  };
  const dejarDeEscuchar = o.escuchar(alRecibir);

  // Los botones de idioma de la cabecera no sirven acá y los enlaces de adentro no navegan: el marco no se puede ir.
  const alTocar = (e: Event): void => {
    const blanco = e.target instanceof Element ? e.target : null;
    if (blanco?.closest("#l-es, #l-en")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const enlace = blanco?.closest("a");
    if (enlace && enlace.target !== "_blank") e.preventDefault();
  };
  document.addEventListener("click", alTocar, true);

  o.alCambiarIdioma(() => {
    vista?.pintar();
    abrirLasReglas();
  });
  mostrarLaEtiqueta();
  o.avisarLista();

  return () => {
    dejarDeEscuchar();
    mirador.disconnect();
    document.removeEventListener("click", alTocar, true);
    vista?.desmontar();
    vista = null;
  };
}

/** Lo que manda la vista a la página de afuera cuando está lista, con el mismo origen. */
export function avisarListaAlPadre(padre: Window | null, origen: string): void {
  padre?.postMessage({ t: VISTA_LISTA }, origen);
}
