import { t } from "../i18n";
import { esDeRed } from "../stellar/errores";

/**
 * "Protegé tu cuenta": el paso que falta antes del primer sello en mainnet.
 *
 * Desde Pollar 0.12 la cuenta de mainnet es de Turnkey, y hasta que tenga una forma de recuperarla sin este aparato no
 * firma nada: el sello devuelve `SDK_WALLET_RECOVERY_REQUIRED`. `freeze.ts` abre esta ventana cuando eso pasa, y si la
 * persona protege la cuenta, vuelve solo al sello (la lista sigue ahí, nada se perdió).
 *
 * Dos formas, las que da el SDK sin interfaz de Pollar: el desbloqueo del aparato (huella, rostro o PIN; si el navegador
 * lo permite) o un código por correo. La tercera, otro aparato, pide tener uno ya enlazado: no es para quien sella por
 * primera vez. Sin tecnicismos: la ventana no dice llave, passkey, Turnkey ni custodia.
 *
 * Una sola acción principal por paso (`docs/ux.md`): el desbloqueo del aparato si el navegador lo tiene, y si no, el
 * código por correo. En los dos pasos hay "Ahora no". Mientras un desbloqueo o una confirmación de código están en
 * marcha no hay salida: si se cerrara y después se completara, la cuenta quedaría protegida y el sello no seguiría. Esa
 * espera tiene tope (`TOPE_DE_ESPERA_MS`): si Pollar o el navegador no contestan, la ventana lo dice, vuelve a dar la salida
 * y deja reintentar.
 *
 * Si el navegador no deja abrir el desbloqueo (el que se abre dentro de TikTok, Instagram, Facebook o WhatsApp, o una página
 * dentro de otra), el botón antes no hacía nada ni decía nada: ahora aparece un aviso con las dos salidas, el código por
 * correo o abrir el enlace en Chrome o Safari. Para el navegador, cerrar el cuadro es lo mismo (`NotAllowedError`), así que
 * el aviso sale también entonces: es una nota que no acusa a nadie, no una falla en rojo.
 *
 * Al cerrar, el foco vuelve a donde estaba la persona (`volverA`), o a la línea de estado de lo que sigue (`estadoId`).
 *
 * En testnet, con la custodia de Pollar, no se dispara: no hay nada que recuperar. La ventana se probó con un cliente
 * simulado (`proteger-cuenta.test.ts`), no contra Turnkey.
 */

/** Lo que esta ventana le pide a la cuenta. Es `pollarWallet`, y en las pruebas un reemplazo. */
export interface Proteccion {
  puedeUsarPasskey: boolean;
  protegerConPasskey(): Promise<boolean>;
  mandarCodigoDeProteccion(mail: string): Promise<void>;
  confirmarCodigoDeProteccion(code: string): Promise<boolean>;
}

const mailOk = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

type Visto = { name?: unknown; message?: unknown; cause?: unknown };

/** Mira el error y sus causas (el SDK envuelve lo del navegador), hasta cuatro niveles: una causa que se apunta a sí misma no cuelga nada. */
function algunoDe(e: unknown, mira: (x: Visto | string) => boolean): boolean {
  let x: unknown = e;
  for (let nivel = 0; nivel < 4; nivel++) {
    if (typeof x === "string") return mira(x);
    if (!x || typeof x !== "object") return false;
    if (mira(x as Visto)) return true;
    x = (x as Visto).cause;
  }
  return false;
}

/**
 * El navegador no siguió con el desbloqueo: la persona cerró el cuadro, se acabó el tiempo o no se permite abrirlo acá
 * (un navegador que va dentro de otra aplicación, una página dentro de otra). Para WebAuthn las tres son lo mismo, un
 * `NotAllowedError`: no se puede saber cuál fue.
 */
export function noPermitido(e: unknown): boolean {
  return algunoDe(e, (x) => typeof x !== "string" && x.name === "NotAllowedError");
}

/**
 * La persona dijo que no al desbloqueo: no es una falla. Es un `NotAllowedError` del navegador, o el aviso de la ceremonia
 * propia cuando el navegador no devolvió nada (`passkey-cancelada`). El SDK puede envolverlo, así que se mira también la causa.
 *
 * No entra cualquier "abort" ni "cancel": Pollar cuenta así un pedido de la red cortado a mitad ("Aborted") y Safari dice
 * "cancelled" cuando el navegador corta uno, y eso no es la persona. Un `AbortError` vale solo si lo lanzó el navegador y su
 * texto no es el de un corte de la red (`esDeRed`, sin mirar el nombre, que ya diría "abort"): ahí se dice que falló.
 */
export function cancelo(e: unknown): boolean {
  return algunoDe(e, (x) => {
    if (typeof x === "string") return x === "passkey-cancelada";
    if (x.name === "NotAllowedError" || x.message === "passkey-cancelada") return true;
    return x.name === "AbortError" && typeof DOMException !== "undefined" && x instanceof DOMException && !esDeRed(new Error(typeof x.message === "string" ? x.message : ""));
  });
}

/** El motivo por el que Pollar no aceptó un código, si lo dice con su código de error. */
const codigoMalo = (e: unknown): boolean => /OTP|CODE|INVALID|EXPIRED/i.test(e instanceof Error ? e.message : String(e));

/** Cuánto se espera a Pollar o al navegador: pasado esto la ventana avisa, vuelve a dar la salida y deja reintentar. */
export const TOPE_DE_ESPERA_MS = 60_000;
/** Al cerrar, cuántas veces y cada cuánto se mira si ya hay a dónde devolver el foco (un segundo y medio en total). */
const VECES_QUE_MIRA = 15;
const CADA_CUANTO_MIRA_MS = 100;
const SIN_RESPUESTA = new Error("proteccion-sin-respuesta");

/**
 * Espera una llamada que puede no contestar nunca (Pollar sin red a mitad de camino, un cuadro del navegador que no
 * aparece). Pasado el tope rechaza con `SIN_RESPUESTA`. Si la llamada contesta después, `tarde` recibe lo que dijo: una
 * cuenta que quedó protegida cuenta, con tope o sin él.
 */
function conTope<T>(llamada: Promise<T>, tarde: (valor: T) => void): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    let vencio = false;
    const reloj = setTimeout(() => {
      vencio = true;
      rechazar(SIN_RESPUESTA);
    }, TOPE_DE_ESPERA_MS);
    llamada.then(
      (valor) => {
        clearTimeout(reloj);
        if (vencio) tarde(valor);
        else resolver(valor);
      },
      (e: unknown) => {
        clearTimeout(reloj);
        if (!vencio) rechazar(e);
      },
    );
  });
}

/**
 * Abre la ventana y espera. Devuelve `true` si la cuenta quedó protegida, `false` si la persona la cerró.
 * Nunca lanza.
 *
 * `volverA` es el botón desde donde se abrió (el que sella o sortea: ya está apagado, así que el foco ya cayó en la página y
 * `document.activeElement` no sirve); `estadoId`, la línea de estado de ese paso. Al cerrar, el foco vuelve al botón en
 * cuanto el flujo lo prende, y si sigue apagado porque el sello o el sorteo continúan, va a la línea de estado.
 */
export function protegerCuenta(cuenta: Proteccion, volverA: Element | null = document.activeElement, estadoId?: string): Promise<boolean> {
  return new Promise<boolean>((resolver) => {
    const fondo = document.createElement("div");
    fondo.className = "modal-back";
    const tarjeta = document.createElement("div");
    tarjeta.className = "modal-card login";
    tarjeta.setAttribute("role", "dialog");
    tarjeta.setAttribute("aria-modal", "true");
    tarjeta.setAttribute("aria-label", t("protTitulo"));
    tarjeta.tabIndex = -1;
    const cuerpo = document.createElement("div");
    cuerpo.className = "login-body";
    tarjeta.append(cuerpo);
    fondo.append(tarjeta);

    let cerrada = false;
    /**
     * Hay un desbloqueo o una confirmación de código en marcha: si se cerrara ahora y después se completara, la cuenta
     * quedaría protegida con la ventana ya resuelta en "no" y el sello no seguiría. Mientras dura, no hay salida;
     * termina siempre, porque la espera tiene tope (`TOPE_DE_ESPERA_MS`), y se vuelve a poder salir.
     */
    let ocupada = false;
    const ocupar = (si: boolean): void => {
      ocupada = si;
      for (const b of tarjeta.querySelectorAll<HTMLButtonElement>("[data-salida]")) b.disabled = si;
    };
    /**
     * Devuelve el foco cuando quien esperaba la ventana ya siguió: el sello prende de nuevo su botón (si la persona no
     * protegió la cuenta) o vuelve a empezar y muestra su línea de estado (si la protegió). Eso pasa en el mismo instante
     * o un momento después (cargar un módulo puede costar un turno), así que se mira unas pocas veces, y se deja de mirar
     * apenas el foco ya está en algo: la persona o el flujo lo pusieron, y no se lo quita.
     */
    const devolverElFoco = (vez = 0): void => {
      if (typeof document === "undefined") return;
      const en = document.activeElement;
      if (en && en !== document.body && en !== document.documentElement) return;
      const boton = volverA instanceof HTMLElement && volverA !== document.body && volverA !== document.documentElement && volverA.isConnected ? volverA : null;
      if (boton && !(boton as { disabled?: boolean }).disabled) return boton.focus({ preventScroll: true });
      const estado = estadoId ? document.getElementById(estadoId) : null;
      if (estado && !estado.hidden && getComputedStyle(estado).display !== "none") {
        if (!estado.hasAttribute("tabindex")) estado.setAttribute("tabindex", "-1");
        return estado.focus({ preventScroll: true });
      }
      if (vez < VECES_QUE_MIRA) setTimeout(() => devolverElFoco(vez + 1), CADA_CUANTO_MIRA_MS);
    };
    const cerrar = (protegida: boolean): void => {
      if (cerrada) return;
      if (!protegida && ocupada) return;
      cerrada = true;
      document.removeEventListener("keydown", alTeclear, true);
      fondo.remove();
      resolver(protegida);
      if (volverA instanceof HTMLElement || estadoId) setTimeout(devolverElFoco, 0);
    };

    const encabezado = (titulo: string, ...texto: (string | Node)[]): void => {
      const cab = document.createElement("div");
      cab.className = "login-head";
      const h = document.createElement("h3");
      h.textContent = titulo;
      const p = document.createElement("p");
      p.append(...texto);
      cab.append(h, p);
      cuerpo.append(cab);
    };

    const decir = (donde: HTMLElement, texto: string, bien = false): void => {
      donde.textContent = texto;
      donde.classList.toggle("ok", bien);
      donde.hidden = false;
    };

    const ahoraNo = (): HTMLElement => {
      const fila = document.createElement("div");
      fila.className = "login-links";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "login-link";
      b.textContent = t("protAhoraNo");
      b.dataset.salida = "1";
      b.disabled = ocupada;
      b.addEventListener("click", () => cerrar(false));
      fila.append(b);
      return fila;
    };

    /** El primer paso: el desbloqueo del aparato y, abajo, el correo. */
    const elegir = (mail = ""): void => {
      cuerpo.replaceChildren();
      encabezado(t("protTitulo"), t("protLead"));
      const err = document.createElement("p");
      err.className = "login-err";
      err.setAttribute("role", "alert");
      err.hidden = true;

      if (cuenta.puedeUsarPasskey) {
        const pk = document.createElement("button");
        pk.type = "button";
        pk.className = "login-go";
        pk.textContent = t("protPasskey");
        const ayuda = document.createElement("p");
        ayuda.className = "login-note";
        ayuda.textContent = t("protPasskeyAyuda");
        // Si el navegador no deja abrir el desbloqueo (cerrar el cuadro llega igual), esta nota dice qué hacer. No es una
        // falla en rojo. Se escribe al mostrarla: una región de estado que cambia de texto es la que anuncian los lectores
        // de pantalla.
        const bloqueado = document.createElement("p");
        bloqueado.className = "login-note login-aviso";
        bloqueado.setAttribute("role", "status");
        bloqueado.hidden = true;
        pk.addEventListener("click", () => {
          pk.disabled = true;
          pk.textContent = t("protHaciendo");
          err.hidden = true;
          bloqueado.hidden = true;
          bloqueado.textContent = "";
          ayuda.hidden = false;
          ocupar(true);
          conTope(cuenta.protegerConPasskey(), (lista) => {
            if (lista) cerrar(true);
          }).then(
            (lista) => {
              if (lista) {
                ocupar(false);
                return cerrar(true);
              }
              sinTerminar(pk, "no-quedo");
            },
            // Cerrar el cuadro del navegador no es fallar: se vuelve al paso, sin aviso rojo. Si el navegador no lo deja
            // abrir, se dice qué hacer. Un corte de la red de Pollar o el tope de espera sí se dicen como falla.
            (e: unknown) => sinTerminar(pk, e === SIN_RESPUESTA ? "tarda" : noPermitido(e) ? "no-permitido" : cancelo(e) ? "cancelo" : "fallo"),
          );
        });
        const sinTerminar = (b: HTMLButtonElement, que: "no-quedo" | "cancelo" | "no-permitido" | "tarda" | "fallo"): void => {
          ocupar(false);
          b.disabled = false;
          b.textContent = t("protPasskey");
          if (que === "no-permitido") {
            // El texto de ayuda explica un desbloqueo que acá no se abre: mientras la nota está, sobra (y ocupa lugar en un celular chico).
            ayuda.hidden = true;
            bloqueado.textContent = t("protPasskeyBloqueada");
            bloqueado.hidden = false;
          }
          if (que === "cancelo" || que === "no-permitido") return b.focus({ preventScroll: true });
          decir(err, t(que === "fallo" ? "protPasskeyFalla" : que === "tarda" ? "protTarda" : "protNoQuedo"));
        };
        const o = document.createElement("p");
        o.className = "login-or";
        o.textContent = t("protO");
        cuerpo.append(pk, ayuda, bloqueado, o);
      }

      const form = document.createElement("form");
      form.className = "login-form";
      form.noValidate = true;
      form.innerHTML = `<label class="sr-only" for="prot-mail"></label><input id="prot-mail" type="email" inputmode="email" autocomplete="email" spellcheck="false"><button class="${cuenta.puedeUsarPasskey ? "login-opt" : "login-go"}" type="submit"></button>`;
      const etiqueta = form.querySelector("label") as HTMLLabelElement;
      const campo = form.querySelector("input") as HTMLInputElement;
      const ir = form.querySelector("button") as HTMLButtonElement;
      etiqueta.textContent = t("protMailLabel");
      campo.placeholder = t("protMailLabel");
      campo.value = mail;
      ir.textContent = t("protMailGo");
      ir.disabled = !mailOk(mail);
      campo.addEventListener("input", () => {
        ir.disabled = !mailOk(campo.value);
        err.hidden = true;
      });
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const direccion = campo.value.trim();
        if (!mailOk(direccion)) return decir(err, t("protBadMail"));
        ir.disabled = true;
        ir.textContent = t("protEnviando");
        cuenta.mandarCodigoDeProteccion(direccion).then(
          () => codigo(direccion),
          () => {
            ir.disabled = false;
            ir.textContent = t("protMailGo");
            decir(err, t("protFalla"));
          },
        );
      });
      cuerpo.append(form, err, ahoraNo());
      // Una sola acción principal por paso: el desbloqueo del aparato si el navegador lo tiene, y si no, el correo.
      (cuenta.puedeUsarPasskey ? (cuerpo.querySelector(".login-go") as HTMLElement | null) : campo)?.focus({ preventScroll: true });
    };

    /** El segundo paso: el código que llegó al correo. */
    const codigo = (mail: string): void => {
      cuerpo.replaceChildren();
      const [antes, despues] = t("protCodeLead").split("{mail}");
      const negrita = document.createElement("b");
      negrita.textContent = mail;
      encabezado(t("protCodeTitulo"), antes ?? "", negrita, despues ?? "");
      const form = document.createElement("form");
      form.className = "login-form";
      form.noValidate = true;
      form.innerHTML = `<label class="sr-only" for="prot-code"></label><input id="prot-code" class="login-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="••••••"><button class="login-go" type="submit" disabled></button>`;
      (form.querySelector("label") as HTMLLabelElement).textContent = t("protCodeLabel");
      const campo = form.querySelector("input") as HTMLInputElement;
      const ir = form.querySelector("button") as HTMLButtonElement;
      ir.textContent = t("protCodeGo");
      const err = document.createElement("p");
      err.className = "login-err";
      err.setAttribute("role", "alert");
      err.hidden = true;
      const limpio = (): string => campo.value.replace(/\s+/g, "");
      campo.addEventListener("input", () => {
        ir.disabled = limpio().length < 4;
        err.hidden = true;
      });
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (limpio().length < 4) return;
        ir.disabled = true;
        ir.textContent = t("protHaciendo");
        ocupar(true);
        conTope(cuenta.confirmarCodigoDeProteccion(limpio()), (lista) => {
          if (lista) cerrar(true);
        }).then(
          (lista) => {
            if (lista) {
              ocupar(false);
              return cerrar(true);
            }
            ocupar(false);
            ir.disabled = false;
            ir.textContent = t("protCodeGo");
            decir(err, t("protNoQuedo"));
          },
          (e: unknown) => {
            ocupar(false);
            ir.disabled = false;
            ir.textContent = t("protCodeGo");
            decir(err, t(e === SIN_RESPUESTA ? "protTarda" : codigoMalo(e) ? "protBadCode" : "protFalla"));
            campo.select();
          },
        );
      });

      const enlaces = document.createElement("div");
      enlaces.className = "login-links";
      const otro = document.createElement("button");
      otro.type = "button";
      otro.className = "login-link";
      otro.textContent = t("protOtroCodigo");
      otro.addEventListener("click", () => {
        otro.disabled = true;
        cuenta.mandarCodigoDeProteccion(mail).then(
          () => decir(err, t("protReenviado"), true),
          () => decir(err, t("protFalla")),
        ).finally(() => (otro.disabled = false));
      });
      const otroCorreo = document.createElement("button");
      otroCorreo.type = "button";
      otroCorreo.className = "login-link";
      otroCorreo.textContent = t("protOtroCorreo");
      otroCorreo.dataset.salida = "1";
      otroCorreo.addEventListener("click", () => elegir(mail));
      enlaces.append(otro, otroCorreo);
      cuerpo.append(form, err, enlaces, ahoraNo());
      campo.focus({ preventScroll: true });
    };

    const alTeclear = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cerrar(false);
        return;
      }
      if (ev.key !== "Tab") return;
      const enfocables = [...tarjeta.querySelectorAll<HTMLElement>("button:not([disabled]), input, summary, a[href]")];
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;
      if (ev.shiftKey && document.activeElement === primero) {
        ev.preventDefault();
        ultimo.focus();
      } else if (!ev.shiftKey && document.activeElement === ultimo) {
        ev.preventDefault();
        primero.focus();
      }
    };

    fondo.addEventListener("click", (ev) => {
      if (ev.target === fondo) cerrar(false);
    });
    elegir();
    document.addEventListener("keydown", alTeclear, true);
    document.body.append(fondo);
    if (!tarjeta.contains(document.activeElement)) tarjeta.focus({ preventScroll: true });
  });
}
