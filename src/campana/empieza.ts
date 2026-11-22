/**
 * La pantalla de El sorteo está por empezar: con la lista sellada, un título, la cuenta regresiva y una línea. No hay nada
 * para tocar. Se baja con `import()` recién cuando la sala dice la ronda: con una sala que no la dice, la espera de siempre.
 *
 * La cuenta usa la hora de la sala (`empieza-ritmo.ts`), no la del celular. Con más de diez minutos por delante, o sin la
 * hora de la sala, dice a qué hora es el sorteo y no muestra ningún número.
 *
 * Si hay un código de la tarjeta Confirmar mi correo en juego, la cuenta baja a un rótulo chico y la tarjeta es lo principal.
 * Con una cuenta usada en otro navegador, debajo de la línea de apoyo va la de siempre para esa cuenta (cpOtroLadoAdentro).
 */

import { mantenerDespierta, soltarDespierta } from "../ui/despierta";
import { seccion, titulo } from "./adentro";
import type { DatosDeLaRonda, DepsDelCelular } from "./celular";
import { type DatosDelRitmo, desfaseDe, horaDeLaRondaMs, type RitmoDeConsulta, ritmoDe, vistaDeLaCuenta } from "./empieza-ritmo";
import { horaTexto, premiosTexto } from "./formato";
import { caja, conDestacado, rotulosChicos } from "./piezas";
import { pintarReglas } from "./previa";
import { sustituir } from "./sustituir";
import { TEXTOS_EMPIEZA } from "./textos-empieza";

export interface DatosDeEmpieza {
  /** Los datos de la ronda, pedidos en cada segundo: la hora de la sala puede llegar o afinarse con una respuesta nueva. */
  ritmo: () => DatosDelRitmo;
  /** La tarjeta Confirmar mi correo tiene un código en juego: la cuenta baja a un rótulo chico arriba. */
  rotulo: boolean;
  /** La tarjeta está a la vista: las reglas del sorteo van en el pie, debajo de ella. */
  conTarjeta: boolean;
  /**
   * La cuenta ya se usó en otro navegador y desde acá no se arregla: justo antes del sorteo la pantalla le recuerda que quizás
   * tenga que recibir el premio allá. Es el último aviso antes de ganar.
   */
  otroLado?: boolean;
}

/**
 * Pinta la pantalla y devuelve cómo apagar su reloj. El número cambia cada segundo en su propio elemento, sin repintar nada
 * y sin anunciarse; la línea de apoyo cambia sola si el sorteo tarda.
 */
export function pintarEmpieza(raizPrincipal: HTMLElement, deps: DepsDelCelular, datos: DatosDeEmpieza): () => void {
  const raiz = seccion(raizPrincipal, "#cmp-adentro", datos.rotulo ? "cmp-adentro cmp-regresiva cmp-regresiva-chica" : "cmp-adentro cmp-regresiva");
  if (!raiz) return () => undefined;
  const idioma = deps.idioma();
  const tx = (clave: string): string => TEXTOS_EMPIEZA[idioma][clave] ?? "";
  const hero = caja("cmp-izq cmp-hero");
  // La cuenta: el único elemento que se escribe cada segundo. Es un reloj, pero no se anuncia a cada cambio.
  const cuenta = document.createElement("p");
  cuenta.className = "cmp-cuenta-regresiva";
  cuenta.setAttribute("role", "timer");
  const linea = document.createElement("p");
  linea.className = "cmp-apoyo";
  linea.setAttribute("aria-live", "polite");
  if (datos.rotulo) {
    hero.append(cuenta);
  } else {
    hero.append(rotulosChicos([sustituir(deps.tx("cpTitulo"), { empresa: deps.campana.empresa.nombre }), premiosTexto(deps.campana.premios, idioma)]));
    titulo(hero, tx("ceTitulo"));
    hero.append(cuenta, linea);
    if (datos.otroLado) {
      const otroLado = document.createElement("p");
      otroLado.className = "cmp-apoyo cmp-otro-lado";
      otroLado.textContent = deps.tx("cpOtroLadoAdentro");
      hero.append(otroLado);
    }
  }
  raiz.append(hero);
  const pie = datos.conTarjeta ? raizPrincipal.querySelector<HTMLElement>("#cmp-pie") : null;
  if (pie) {
    pie.replaceChildren();
    pie.hidden = false;
  }
  pintarReglas(pie ?? raiz, deps);

  /** Qué se mostró la última vez: lo que no cambió no se vuelve a escribir. */
  let mostrado = "";
  let numero: HTMLElement | null = null;
  const poner = (e: HTMLElement, texto: string): void => {
    if (e.textContent !== texto) e.textContent = texto;
  };
  function actualizar(): void {
    const ritmo = datos.ritmo();
    const v = vistaDeLaCuenta(deps.ahora(), ritmo);
    const hora = (): string => horaTexto(ritmo.objetivoMs, deps.campana.zona, deps.idioma());
    if (v.cuenta.tipo === "numero") {
      if (datos.rotulo) poner(cuenta, sustituir(tx("ceEmpiezaEn"), { t: v.cuenta.texto }));
      else if (mostrado !== "numero") {
        conDestacado(cuenta, tx("ceEmpiezaEn"), "t", v.cuenta.texto, "cmp-numero");
        numero = cuenta.querySelector<HTMLElement>(".cmp-numero");
      } else if (numero) poner(numero, v.cuenta.texto);
    } else if (mostrado !== v.cuenta.tipo) {
      numero = null;
      if (v.cuenta.tipo === "hora") {
        if (datos.rotulo) cuenta.textContent = sustituir(deps.tx("cpSorteoA"), { hora: hora() });
        else conDestacado(cuenta, deps.tx("cpSorteoA"), "hora", hora(), "cmp-hora");
      } else {
        // Llegó la hora: no se dice que empieza ni se muestra ningún número. En el rótulo queda el título.
        cuenta.textContent = datos.rotulo ? tx("ceTitulo") : "";
      }
    }
    mostrado = v.cuenta.tipo;
    cuenta.hidden = cuenta.textContent === "";
    poner(linea, tx(v.tardando ? "ceTarda" : "ceMira"));
  }
  actualizar();
  return deps.cada(() => {
    // Con la pestaña escondida nadie la ve: al volver, el primer segundo la pone al día.
    if (deps.visible()) actualizar();
  }, 1_000, "exacta");
}

/** Cómo se reparten la espera la tarjeta de confirmar el correo y la cuenta regresiva. */
export type Regresiva = "no" | "grande" | "rotulo";

/** Lo que el controlador le pregunta a la página: dónde está la persona y si la tarjeta tiene un código en juego. */
export interface GanchosDelSorteo {
  /** La persona está en la espera con la lista sellada. */
  enLaEspera: () => boolean;
  /** La tarjeta Confirmar mi correo tiene un código en juego. */
  hayCodigo: () => boolean;
}

export interface Sorteo {
  /** La sala dijo la ronda en una respuesta que llegó en `recibida` (el reloj de este aparato). */
  anotar: (datos: DatosDeLaRonda, recibida: number) => void;
  /** Si la cuenta regresiva es la pantalla, y de qué tamaño. */
  modo: () => Regresiva;
  /** Pinta la pantalla y devuelve cómo apagar su reloj. */
  pintar: (raiz: HTMLElement, conTarjeta: boolean, otroLado?: boolean) => () => void;
  /** Qué consulta toca ahora y cuándo cambia, o null si no hay cuenta regresiva. */
  consulta: () => RitmoDeConsulta | null;
  /**
   * Mira el resultado cada `ms` con un azar de 20 %, pero el primer pedido sale a un retraso al azar de hasta un período: todos
   * los celulares cambian de tramo en el mismo instante y, sin repartirlos, los primeros pedidos de los 300 caerían juntos en
   * una franja de tres segundos. Devuelve cómo dejar de pedir.
   */
  repartir: (f: () => void, ms: number) => () => void;
  /** Pide o suelta la pantalla encendida según haya o no cuenta regresiva. */
  pantalla: () => void;
  /** Suelta la pantalla encendida: la página se desmonta. */
  soltar: () => void;
}

/** El motivo con que la cuenta regresiva pide que la pantalla siga encendida. */
const MOTIVO_DE_LA_PANTALLA = "sorteo-celular";

/** De cuántas respuestas se saca cuánto adelanta o atrasa el reloj de este aparato. */
const MUESTRAS = 3;

/**
 * Lo que la página sabe de la ronda y de la hora de la sala, y lo que hace con eso: qué pantalla pinta, cuándo consulta y si
 * pide que la pantalla siga encendida. Vive acá, y no en la página, para que quien no llega a la lista sellada no lo baje.
 */
export function crearSorteo(deps: DepsDelCelular, ganchos: GanchosDelSorteo): Sorteo {
  let ronda: number | null = null;
  let muestras: number[] = [];
  let supoEn: number | null = null;
  let pedida = false;

  const ritmo = (): DatosDelRitmo | null =>
    ronda === null || supoEn === null ? null : { objetivoMs: horaDeLaRondaMs(ronda), desfase: desfaseDe(muestras), supoEn };
  const modo = (): Regresiva => (ritmo() === null || !ganchos.enLaEspera() ? "no" : ganchos.hayCodigo() ? "rotulo" : "grande");

  return {
    anotar: (datos, recibida) => {
      if (datos.ronda === undefined) return;
      ronda = datos.ronda;
      if (datos.horaSala !== undefined) muestras = [...muestras, datos.horaSala - recibida].slice(-MUESTRAS);
      supoEn ??= recibida;
    },
    modo,
    pintar: (raiz, conTarjeta, otroLado = false) =>
      pintarEmpieza(raiz, deps, { ritmo: () => ritmo() as DatosDelRitmo, rotulo: modo() === "rotulo", conTarjeta, otroLado }),
    consulta: () => {
      const r = ritmo();
      return r !== null && modo() !== "no" ? ritmoDe(deps.ahora(), r, deps.ventanaRapida === true) : null;
    },
    repartir: (f, ms) => {
      let parar: (() => void) | null = null;
      const reloj = window.setTimeout(() => {
        f();
        parar = deps.cada(f, ms, "azar");
      }, Math.floor((deps.azar ?? Math.random)() * ms));
      return () => {
        window.clearTimeout(reloj);
        parar?.();
      };
    },
    pantalla: () => {
      const quiere = modo() !== "no";
      if (quiere === pedida) return;
      pedida = quiere;
      if (quiere) mantenerDespierta(MOTIVO_DE_LA_PANTALLA);
      else soltarDespierta(MOTIVO_DE_LA_PANTALLA);
    },
    soltar: () => {
      if (!pedida) return;
      pedida = false;
      soltarDespierta(MOTIVO_DE_LA_PANTALLA);
    },
  };
}
