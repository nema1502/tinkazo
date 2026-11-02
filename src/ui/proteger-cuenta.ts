import { t } from "../i18n";

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
 * marcha no hay salida: si se cerrara y después se completara, la cuenta quedaría protegida y el sello no seguiría.
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

/**
 * La persona cerró el cuadro del navegador (o dijo que no): no es una falla. El navegador lo llama `NotAllowedError`
 * y `AbortError`; el SDK puede envolverlo, así que se mira también la causa.
 */
export function cancelo(e: unknown): boolean {
  const mira = (x: unknown): boolean => {
    if (!x || typeof x !== "object") return typeof x === "string" && /NotAllowed|Abort|cancel/i.test(x);
    const { name, message, cause } = x as { name?: unknown; message?: unknown; cause?: unknown };
    return /NotAllowed|Abort|cancel/i.test(`${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`) || (cause !== undefined && cause !== x && mira(cause));
  };
  return mira(e);
}

/** El motivo por el que Pollar no aceptó un código, si lo dice con su código de error. */
const codigoMalo = (e: unknown): boolean => /OTP|CODE|INVALID|EXPIRED/i.test(e instanceof Error ? e.message : String(e));

/**
 * Abre la ventana y espera. Devuelve `true` si la cuenta quedó protegida, `false` si la persona la cerró.
 * Nunca lanza.
 */
export function protegerCuenta(cuenta: Proteccion, volverA: Element | null = document.activeElement): Promise<boolean> {
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
     * termina siempre (el navegador y la red tienen su propio límite) y se vuelve a poder salir.
     */
    let ocupada = false;
    const ocupar = (si: boolean): void => {
      ocupada = si;
      for (const b of tarjeta.querySelectorAll<HTMLButtonElement>("[data-salida]")) b.disabled = si;
    };
    const cerrar = (protegida: boolean): void => {
      if (cerrada) return;
      if (!protegida && ocupada) return;
      cerrada = true;
      document.removeEventListener("keydown", alTeclear, true);
      fondo.remove();
      if (volverA instanceof HTMLElement && volverA.isConnected) volverA.focus();
      resolver(protegida);
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
        pk.addEventListener("click", () => {
          pk.disabled = true;
          pk.textContent = t("protHaciendo");
          err.hidden = true;
          ocupar(true);
          cuenta.protegerConPasskey().then(
            (lista) => {
              if (lista) {
                ocupar(false);
                return cerrar(true);
              }
              sinTerminar(pk, "no-quedo");
            },
            // Cerrar el cuadro del navegador no es fallar: se vuelve al paso, sin aviso rojo.
            (e: unknown) => sinTerminar(pk, cancelo(e) ? "cancelo" : "fallo"),
          );
        });
        const sinTerminar = (b: HTMLButtonElement, que: "no-quedo" | "cancelo" | "fallo"): void => {
          ocupar(false);
          b.disabled = false;
          b.textContent = t("protPasskey");
          if (que === "cancelo") return b.focus({ preventScroll: true });
          decir(err, t(que === "fallo" ? "protPasskeyFalla" : "protNoQuedo"));
        };
        const o = document.createElement("p");
        o.className = "login-or";
        o.textContent = t("protO");
        cuerpo.append(pk, ayuda, o);
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
        cuenta.confirmarCodigoDeProteccion(limpio()).then(
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
            decir(err, t(codigoMalo(e) ? "protBadCode" : "protFalla"));
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
