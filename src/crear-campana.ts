/** Entrada de crear-campana.html: la página donde quien organiza arma la campaña de su empresa por pasos. */

import "./pagina";
import "./version-nueva";
import "./campana/campana.css";
import "./campana/crear.css";
import { getLang, initialLang, onLangChange, setLang, texto, textos } from "./idioma";
import { campanasActivo } from "./campana/bandera";
import { escalaDelCelular, montarCreador, type DepsDelCreador } from "./campana/crear/panel";
import { achicarLogo, depsDelNavegador } from "./campana/crear/logo";
import { zonaDelNavegador } from "./campana/crear/horas";
import { sufijoNuevo } from "./campana/crear/estado";
import { costoDelRetiroTexto } from "./costo-del-retiro";
import { guardarBorrador } from "./campana/borrador";
import { direccionDelPanel } from "./campana/direccion-del-panel";
import { comisionDelBuild } from "./stellar/comision-config";
import { comisionDelArmado } from "./campana/crear/costo";
import { entornoDelBuild } from "./stellar/venta-piloto";
import { anotarseSinBilleteraActivo } from "./campana/persona-bandera";

const raiz = document.querySelector<HTMLElement>("#ccp");
const aviso = document.querySelector<HTMLElement>("#ccp-aviso");
const parametros = new URLSearchParams(location.search);
const demo = parametros.get("demo") === "1";
/** Lo más pesado que se abre como campaña: una de verdad pesa menos de 100 KB. */
const MAXIMO_DEL_ARCHIVO_A_ABRIR = 400_000;
setLang(initialLang());

/** El almacenamiento local, o null si el navegador lo bloquea. */
function almacenLocal(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Baja un texto como archivo: un enlace con descarga que se suelta enseguida. */
function bajarTexto(nombre: string, contenido: string): void {
  const tipo = nombre.endsWith(".txt") ? "text/plain" : "application/json";
  const direccion = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = direccion;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(direccion), 10_000);
}

/** Compartir con la hoja del sistema, solo si el navegador sabe compartir archivos. */
function compartirConElSistema(): DepsDelCreador["compartir"] {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  return {
    puede: (archivo) => navigator.canShare({ files: [archivo] }),
    enviar: async (archivo) => {
      await navigator.share({ files: [archivo] });
      return true;
    },
  };
}

/**
 * Deja la campaña como borrador (solo el JSON, nada personal) y lleva al panel de la portada en el modo oficial, que cobra,
 * activa y abre la inscripción. Si el navegador no deja guardar, no se va: la persona se queda y se le dice.
 */
function activarEnElPanel(texto: string): boolean {
  if (!guardarBorrador(almacenLocal(), texto)) return false;
  // El idioma y el tema de esta dirección viajan al panel: sin ellos abría con los de la memoria y el sistema.
  location.assign(direccionDelPanel(location.search));
  return true;
}

function depsReales(): DepsDelCreador {
  // Lo que cobra Tinkazo, el mismo cobro que después pide el panel de la portada.
  const cobro = comisionDelBuild(entornoDelBuild());
  // Una campaña de personas no lleva cobro, comisión ni activación: la firma Tinkazo y se baja como archivo. Lo decide el panel
  // según la campaña que arma o abre, así que acá el cobro va siempre y no depende de la dirección.
  const persona = anotarseSinBilleteraActivo() && parametros.get("identidad") === "persona";
  return {
    tx: texto,
    dic: (idioma, clave) => String(textos(idioma)[clave] ?? clave),
    idioma: getLang,
    ahora: () => Date.now(),
    zona: zonaDelNavegador(),
    almacen: almacenLocal(),
    demo,
    sufijo: sufijoNuevo,
    achicar: (archivo, opciones) => achicarLogo(archivo, depsDelNavegador(), opciones),
    leerArchivo: async (archivo) => {
      if (archivo.size > MAXIMO_DEL_ARCHIVO_A_ABRIR) throw new Error("grande");
      return archivo.text();
    },
    // El validador arrastra los dos lectores de la campaña: se baja recién cuando hay algo que bajar.
    validar: (campana, ahora) => import("./sala/validar-campana").then((m) => m.validarCampanaParaElFirmador(campana, ahora)),
    descargar: bajarTexto,
    compartir: compartirConElSistema(),
    costo: costoDelRetiroTexto,
    // Activar solo se ofrece con lo que cobra Tinkazo configurado: es el mismo cobro que después pide el panel. Sin eso, la
    // página es la de siempre y solo baja la campaña.
    activar: cobro === null ? undefined : activarEnElPanel,
    // Tus campañas se ofrece solo si la sala de afuera la tiene: se le pregunta una vez, sin gastar nada. La demostración no la ofrece.
    tusDisponible: demo ? () => Promise.resolve(false) : () => import("./sala/campana-org").then((m) => m.salaTieneTusCampanas()),
    // El enlace a Tus campañas lleva el idioma y el tema de esta dirección, como Activar mi campaña.
    consulta: location.search,
    // El resumen dice el servicio y el total a poner antes de pedir nada, calculados para esta campaña.
    comision: comisionDelArmado(cobro),
    origen: location.origin,
    tema: parametros.get("theme"),
    // Anotarse sin billetera: solo con el interruptor del sitio y el parámetro en la dirección. Sin los dos, la campaña de siempre.
    ...(persona ? { identidad: "persona" as const } : {}),
    cuadro: (f) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => f());
      else window.setTimeout(f, 16);
    },
    esperar: (f, ms) => {
      const temporizador = window.setTimeout(f, ms);
      return () => window.clearTimeout(temporizador);
    },
    // La escala sale del alto de la caja y de un 40 % del ancho de la ventana: el ancho de la caja sale de la escala.
    escala: (caja, alCambiar) => {
      const medir = (): void => alCambiar(escalaDelCelular(window.innerWidth * 0.4, caja.clientHeight));
      medir();
      if (typeof ResizeObserver !== "function") return () => undefined;
      const mirador = new ResizeObserver(medir);
      mirador.observe(caja);
      window.addEventListener("resize", medir);
      return () => {
        mirador.disconnect();
        window.removeEventListener("resize", medir);
      };
    },
  };
}

function abrir(): void {
  if (!raiz) return;
  // Sin la bandera de las campañas la página dice que todavía no están abiertas, salvo con la demostración.
  if (!campanasActivo() && !demo) {
    const decir = (): void => {
      if (aviso) aviso.textContent = texto("cpNoAbierta");
    };
    decir();
    onLangChange(decir);
    return;
  }
  if (demo) {
    const etiqueta = document.querySelector<HTMLElement>("#cmp-ejemplo");
    if (etiqueta) etiqueta.hidden = false;
  }
  const creador = montarCreador(raiz, depsReales());
  onLangChange(() => creador.pintar());
}

abrir();
