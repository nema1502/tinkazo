import { cuentaDeTexto, type VistaDeCuenta } from "../../workers/cuenta/src/reglas";
import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { idDeCanje, leerCuenta, pedirCanje } from "../stellar/cuenta-api";
import { urlDeCuenta } from "../stellar/cuenta-config";
import { botonPrincipal, abrirDialogo, lineaDeEstado } from "./dialogo";
import { escanear, puedeEscanear } from "./escaner";
import { con } from "./monedas-vista";

/**
 * "Canjear": la pantalla de quien atiende el stand. Se pega o se escanea la cuenta del equipo, se ve su saldo, se
 * elige qué se lleva y se marca el canje. Una sola acción principal: el botón de abajo.
 *
 * Solo canjea quien organiza: manda su código de organización en la cabecera y el Worker lo compara con la huella
 * que tiene guardada (`workers/cuenta`). El navegador de quien participa no lo tiene. Ese código se escribe una vez
 * y se recuerda solo en esta pestaña.
 *
 * Cada intento lleva un identificador. Si la red falla y se vuelve a tocar, el identificador es el mismo y el Worker
 * no descuenta dos veces. Con un canje hecho, el identificador se renueva.
 */

const GUARDA = "tinkazo.canje.token";

const leerToken = (): string => {
  try {
    return sessionStorage.getItem(GUARDA) ?? "";
  } catch {
    return "";
  }
};
const guardarToken = (v: string): void => {
  try {
    sessionStorage.setItem(GUARDA, v);
  } catch {
    /* sin almacenamiento, se vuelve a escribir */
  }
};

export function abrirCanje(): void {
  const base = urlDeCuenta();
  if (!base) return;
  const es = getLang() === "es";
  let parar: (() => void) | null = null;
  const d = abrirDialogo({ titulo: t("canjeTitle"), onCerrar: () => parar?.() });
  const camara = puedeEscanear();

  d.cuerpo.innerHTML =
    `<p class="saldo-lead">${esc(t("canjeLead"))}</p>` +
    `<section class="acct-sec"><label class="kicker" for="canje-token">${esc(t("canjeToken"))}</label>` +
    `<input id="canje-token" class="saldo-bs" type="password" autocomplete="off" spellcheck="false" value="${esc(leerToken())}">` +
    `<p class="note">${esc(t("canjeTokenAyuda"))}</p></section>` +
    `<section class="acct-sec"><label class="kicker" for="canje-cuenta">${esc(t("canjeCuenta"))}</label>` +
    `<input id="canje-cuenta" class="saldo-bs" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t("canjeCuentaPh"))}">` +
    (camara ? `<div class="acct-more"><button type="button" class="mini" data-canje="escanear">${esc(t("canjeEscanear"))}</button></div><video class="canje-video" data-canje="video" muted hidden></video>` : "") +
    `<p class="canje-saldo" data-canje="saldo" role="status" aria-live="polite"></p></section>` +
    `<section class="acct-sec" data-canje="items" hidden><h3 class="kicker">${esc(t("canjeElegir"))}</h3><div class="canje-items" role="radiogroup"></div></section>`;

  const token = d.cuerpo.querySelector<HTMLInputElement>("#canje-token") as HTMLInputElement;
  const campo = d.cuerpo.querySelector<HTMLInputElement>("#canje-cuenta") as HTMLInputElement;
  const saldoEl = d.cuerpo.querySelector<HTMLElement>('[data-canje="saldo"]') as HTMLElement;
  const itemsSec = d.cuerpo.querySelector<HTMLElement>('[data-canje="items"]') as HTMLElement;
  const items = itemsSec.querySelector<HTMLElement>(".canje-items") as HTMLElement;
  const video = d.cuerpo.querySelector<HTMLVideoElement>('[data-canje="video"]');

  const estado = lineaDeEstado();
  const boton = botonPrincipal(t("canjeBotonVacio"));
  boton.disabled = true;
  d.pie.append(estado, boton);

  let cuenta: string | null = null;
  let vista: VistaDeCuenta | null = null;
  let elegido: string | null = null;
  /** El identificador del intento en curso: se repite si hay que reintentar, y se renueva con un canje hecho. */
  let intento: { codigo: string; id: string } | null = null;
  let hecho = false;
  let pedido = 0;

  const nombreDe = (c: { es: string; en: string }): string => (es ? c.es : c.en);

  const actualizarBoton = (): void => {
    const item = vista?.catalogo.find((c) => c.codigo === elegido);
    boton.textContent = hecho ? t("canjeNuevo") : item ? con(t("canjeBoton"), { nombre: nombreDe(item) }) : t("canjeBotonVacio");
    boton.disabled = hecho ? false : !(item && vista && vista.saldo >= item.costo && token.value.trim().length > 0);
  };

  const pintarItems = (): void => {
    items.replaceChildren();
    if (!vista) {
      itemsSec.hidden = true;
      return;
    }
    const saldo = vista.saldo;
    for (const c of vista.catalogo) {
      const alcanza = saldo >= c.costo;
      const etiqueta = document.createElement("label");
      etiqueta.className = `canje-item${alcanza ? "" : " no-alcanza"}`;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "canje-item";
      radio.value = c.codigo;
      radio.checked = c.codigo === elegido;
      radio.disabled = !alcanza;
      radio.addEventListener("change", () => {
        elegido = c.codigo;
        estado.textContent = "";
        actualizarBoton();
      });
      const texto = document.createElement("span");
      texto.textContent = con(t("tiendaItem"), { nombre: nombreDe(c), costo: c.costo });
      etiqueta.append(radio, texto);
      items.appendChild(etiqueta);
    }
    itemsSec.hidden = false;
  };

  const leer = (valor: string): void => {
    const nueva = cuentaDeTexto(valor);
    const mio = ++pedido;
    hecho = false;
    estado.textContent = "";
    estado.classList.remove("ok");
    if (!nueva) {
      cuenta = null;
      vista = null;
      saldoEl.textContent = valor.trim() ? t("canjeSinCuenta") : "";
      pintarItems();
      actualizarBoton();
      return;
    }
    if (nueva !== cuenta) intento = null;
    cuenta = nueva;
    saldoEl.textContent = t("canjeMirando");
    void leerCuenta(base, nueva).then((v) => {
      if (mio !== pedido) return;
      vista = v;
      if (!v) {
        saldoEl.textContent = t("canjeError");
        pintarItems();
        actualizarBoton();
        return;
      }
      saldoEl.textContent = con(t("canjeSaldo"), { n: v.saldo });
      // Lo primero que le alcanza, para que el caso común sea un solo toque.
      if (!v.catalogo.some((c) => c.codigo === elegido && v.saldo >= c.costo)) elegido = v.catalogo.find((c) => v.saldo >= c.costo)?.codigo ?? null;
      pintarItems();
      actualizarBoton();
    });
  };

  campo.addEventListener("input", () => leer(campo.value));
  token.addEventListener("input", actualizarBoton);

  const botonEscanear = d.cuerpo.querySelector<HTMLButtonElement>('[data-canje="escanear"]');
  botonEscanear?.addEventListener("click", () => {
    if (!video) return;
    parar?.();
    video.hidden = false;
    void escanear(
      video,
      (texto) => {
        video.hidden = true;
        campo.value = cuentaDeTexto(texto) ?? texto;
        leer(campo.value);
      },
      () => {
        video.hidden = true;
        estado.textContent = t("canjeCamara");
      },
    ).then((p) => (parar = p));
  });

  boton.addEventListener("click", () => {
    if (hecho) {
      // Otro canje: se limpia la cuenta y se empieza de nuevo.
      hecho = false;
      campo.value = "";
      cuenta = null;
      vista = null;
      elegido = null;
      estado.textContent = "";
      estado.classList.remove("ok");
      leer("");
      campo.focus();
      return;
    }
    const item = vista?.catalogo.find((c) => c.codigo === elegido);
    if (!cuenta || !item) return;
    const codigo = item.codigo;
    if (!intento || intento.codigo !== codigo) intento = { codigo, id: idDeCanje() };
    boton.disabled = true;
    estado.classList.remove("ok");
    void pedirCanje(base, cuenta, token.value.trim(), codigo, intento.id).then((r) => {
      if (r.estado === "ok") {
        guardarToken(token.value.trim());
        intento = null;
        hecho = true;
        estado.classList.add("ok");
        estado.textContent = r.repetido ? t("canjeRepetido") : con(t("canjeHecho"), { nombre: nombreDe(item), n: r.saldo });
        saldoEl.textContent = con(t("canjeSaldo"), { n: r.saldo });
        if (vista) vista = { ...vista, saldo: r.saldo };
        actualizarBoton();
        return;
      }
      if (r.estado === "saldo") {
        // Alguien más canjeó antes: se actualiza el saldo y se dice cuánto falta. El intento se renueva.
        intento = null;
        estado.textContent = con(t("canjeFalta"), { n: r.falta });
        if (vista) vista = { ...vista, saldo: r.saldo };
        saldoEl.textContent = con(t("canjeSaldo"), { n: r.saldo });
        pintarItems();
      } else estado.textContent = t(r.estado === "token" ? "canjeTokenMal" : r.estado === "apagado" ? "canjeApagado" : "canjeError");
      actualizarBoton();
    });
  });

  actualizarBoton();
  campo.focus();
}
