import "./cupon-franja.css";
import { onLangChange, t } from "../i18n";
import { type AlmacenDeCupon, cuponDelFragmento, cuponGuardado, direccionSinCupon, enlaceConCupon, guardarCupon, olvidarCupon } from "../stellar/cupon-guardado";

/**
 * El cupón que llega en el enlace y lo que se ve mientras tanto (diseño del cobro por uso, sección 3.2). Solo vive con el
 * acceso por cupón a la vista (`VITE_ALTA`); con la bandera apagada, en Prueba o con otra red, `#cupon=` no se mira, no se
 * guarda y la dirección queda como llegó.
 *
 * - El código del fragmento se normaliza (`stellar/cupon-codigo.ts`) y se guarda en la pestaña. Uno mal formado no se guarda.
 * - En el navegador de una app (Instagram, Facebook y parecidos) la dirección no se toca y se pide abrir el enlace
 *   afuera, con un botón que lo copia: ahí Google no deja entrar.
 * - En cualquier otro, el código sale de la dirección (`replaceState`) recién cuando hay sesión, para que no quede en el
 *   historial ni en lo que se comparta. Si el cupón no se pudo guardar, la dirección se queda como está.
 * - Sin sesión, una franja arriba invita a entrar. Con una billetera propia, otra dice que no hace falta cupón.
 * - Cerrar la sesión lo olvida. Canjearlo también (lo hace quien lo canjea: `olvidarCupon`).
 *
 * Todo entra por `EntornoDelCupon`, así se prueba sin la página; `cupon-enlace-entorno.ts` arma el de verdad.
 */

export interface EntornoDelCupon {
  /** El acceso por cupón está a la vista en este build y esta red. */
  activo: boolean;
  /** El navegador de una app, donde Google no deja entrar. */
  enApp: boolean;
  almacen: AlmacenDeCupon | null;
  direccion(): { origen: string; ruta: string; busqueda: string; fragmento: string };
  reemplazar(url: string): void;
  /** La cuenta abierta: si es de Google o de correo (`pollar`) o una billetera propia. `null` si no hay. */
  sesion(): { pollar: boolean } | null;
  /** La cuenta se está retomando o conectando: todavía no se sabe si hay sesión. */
  ocupada(): boolean;
  entrar(): void;
  /** Lo que dice el botón de entrar. */
  claveDeEntrar(): string;
  copiar(texto: string): Promise<boolean>;
  insertar(el: HTMLElement): void;
}

type Modo = "entrar" | "afuera" | "propia";

export interface ControlDelCupon {
  /** Vuelve a mirar la sesión y la dirección (lo llaman los eventos de la página; las pruebas, a mano). */
  actualizar(): void;
  /** Deja de escuchar y saca la franja (las pruebas; la página no lo usa). */
  detener(): void;
}

const SIN_CONTROL: ControlDelCupon = { actualizar: () => undefined, detener: () => undefined };

/** Cuánto dura "Copiado" en el botón. */
const AVISO_DE_COPIA_MS = 2_500;

export function iniciarCuponDelEnlace(env: EntornoDelCupon): ControlDelCupon {
  if (!env.activo) return SIN_CONTROL;

  const llegada = cuponDelFragmento(env.direccion().fragmento);
  if (llegada.codigo) guardarCupon(llegada.codigo, env.almacen);

  let franja: HTMLElement | null = null;
  let modoActual: Modo | null = null;
  let vioSesion = false;
  let copiado = false;
  let cerrada = false;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  let detenido = false;

  /** La página sabe qué franja se ve (`cupon-franja.css`): en una app, el botón rosa de entrar se esconde. */
  const marcarLaPagina = (modo: Modo | null): void => {
    if (typeof document === "undefined") return;
    if (modo) document.body.dataset.cuponFranja = modo;
    else delete document.body.dataset.cuponFranja;
  };

  const sacar = (): void => {
    franja?.remove();
    franja = null;
    marcarLaPagina(null);
    modoActual = null;
  };

  const boton = (clase: string, texto: string, alTocar: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = clase;
    b.textContent = texto;
    b.addEventListener("click", alTocar);
    return b;
  };

  const dibujar = (modo: Modo, cupon: string): void => {
    if (!franja) {
      franja = document.createElement("aside");
      franja.id = "cupon-franja";
      franja.className = "cupon-franja";
      franja.setAttribute("role", "status");
      env.insertar(franja);
    }
    franja.dataset.modo = modo;
    modoActual = modo;
    marcarLaPagina(modo);
    franja.replaceChildren();
    const texto = document.createElement("p");
    texto.className = "cupon-franja-t";
    texto.textContent = t(modo === "entrar" ? "altaFranja" : modo === "afuera" ? "altaAbrirAfuera" : "altaConBilleteraPropia");
    franja.appendChild(texto);
    if (modo === "entrar") {
      franja.appendChild(boton("cupon-franja-b", t(env.claveDeEntrar()), () => env.entrar()));
    } else if (modo === "afuera") {
      const copiar = boton("cupon-franja-b", t(copiado ? "errCopiado" : "altaCopiarEnlace"), () => {
        const d = env.direccion();
        void env.copiar(enlaceConCupon(d.origen, d.ruta, d.busqueda, cupon)).then((ok) => {
          if (!ok) return;
          copiado = true;
          clearTimeout(reloj);
          reloj = setTimeout(() => {
            copiado = false;
            pintar();
          }, AVISO_DE_COPIA_MS);
          pintar();
        });
      });
      franja.appendChild(copiar);
    } else {
      const cerrar = boton("cupon-franja-b cupon-franja-x", t("acctClose"), () => {
        cerrada = true;
        pintar();
      });
      franja.appendChild(cerrar);
    }
  };

  function pintar(): void {
    if (detenido) return;
    const cupon = cuponGuardado(env.almacen);
    const s = env.sesion();
    let modo: Modo | null = null;
    if (cupon) {
      if (s) modo = s.pollar || cerrada ? null : "propia";
      else if (env.enApp) modo = "afuera";
      else if (!env.ocupada()) modo = "entrar";
    }
    if (!modo || !cupon) {
      sacar();
      return;
    }
    dibujar(modo, cupon);
  }

  function actualizar(): void {
    if (detenido) return;
    const s = env.sesion();
    if (s) vioSesion = true;
    else if (vioSesion && !env.ocupada()) {
      // La sesión se cerró en esta página: el cupón no sigue a la cuenta que se fue.
      vioSesion = false;
      cerrada = false;
      olvidarCupon(env.almacen);
    }
    // La dirección limpia, recién con sesión y fuera del navegador de una app.
    if (s && !env.enApp) {
      const d = env.direccion();
      const hay = cuponDelFragmento(d.fragmento);
      if (hay.hay && (hay.codigo === null || cuponGuardado(env.almacen) === hay.codigo)) env.reemplazar(direccionSinCupon(d.ruta, d.busqueda, d.fragmento));
    }
    pintar();
  }

  document.addEventListener("tinkazo:sesion", actualizar);
  document.addEventListener("tinkazo:cuenta", actualizar);
  onLangChange(pintar);
  actualizar();
  return {
    actualizar,
    detener: () => {
      detenido = true;
      clearTimeout(reloj);
      document.removeEventListener("tinkazo:sesion", actualizar);
      document.removeEventListener("tinkazo:cuenta", actualizar);
      sacar();
    },
  };
}
