import { t } from "../i18n";
import type { Texto } from "./cuenta-lista-estado";
import type { PanelDePago } from "./pago-vista";
import { pintarQr } from "./qr";

/**
 * Los datos para pagar un paquete desde otra app, en pantalla: la moneda como dato (la única pantalla que la nombra,
 * porque con otra el dinero se pierde), el monto, la nota y la cuenta corta, cada uno con su rótulo corto y su Copiar
 * (la cuenta se copia entera). Si quien lo muestra ofrece el QR del banco, Estoy en Bolivia va primero, antes de los
 * datos. Plegado en Más detalles, lo que no hace falta para pagar: el QR del enlace de pago (en el celular nadie escanea
 * su propia pantalla) y Abrir en mi app de pagos, entre otras cosas.
 *
 * Todo sale del panel, que sale de la orden del servidor (`pago-vista.ts`, `panelDe`), tal cual: lo que se copia es
 * exactamente lo que mandó el servidor (el monto, con su punto), y el enlace no se toca. Ningún botón nombra una moneda.
 */

/** Lo que mide el QR, en px de CSS: entra en la caja de un celular de 320 px. */
const LADO_QR = 168;
/** Cuánto dice «Copiado» el botón antes de volver a «Copiar». */
const COPIADO_MS = 2_200;

let n = 0;

const poner = (x: Texto): string => Object.entries(x.vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(x.clave));

/** Elige el texto del elemento, para copiarlo a mano cuando el navegador no deja copiar. */
function elegir(el: HTMLElement): void {
  try {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(r);
  } catch {
    /* sin selección posible, queda a la vista igual */
  }
}

function dato(contenedor: HTMLElement, o: { dato: string; etiqueta: string; valor: string; copia: string | null }): void {
  const id = `pago-et-${++n}`;
  const fila = document.createElement("div");
  fila.className = "pago-dato";
  const et = document.createElement("p");
  et.className = "pago-et";
  et.id = id;
  et.textContent = o.etiqueta;
  const valor = document.createElement("code");
  valor.className = "pago-valor";
  valor.dataset.dato = o.dato;
  valor.textContent = o.valor;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cl-secundario pago-copiar";
  b.dataset.copiar = o.dato;
  b.setAttribute("aria-describedby", id);
  b.textContent = t("pagoCopiar");
  const copia = o.copia;
  // Un dato que no se copia (la moneda): rótulo y valor, sin botón.
  if (copia === null) {
    fila.append(et, valor);
    contenedor.append(fila);
    return;
  }
  let reloj: ReturnType<typeof setTimeout> | null = null;
  b.addEventListener("click", () => {
    void (async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(copia);
        ok = true;
      } catch {
        ok = false;
      }
      if (!ok) {
        elegir(valor);
        return;
      }
      b.textContent = t("pagoCopiado");
      if (reloj) clearTimeout(reloj);
      reloj = setTimeout(() => {
        reloj = null;
        if (b.isConnected) b.textContent = t("pagoCopiar");
      }, COPIADO_MS);
    })();
  });
  fila.append(et, valor, b);
  contenedor.append(fila);
}

/**
 * El panel, armado una vez por orden: quien lo muestra lo vuelve a usar mientras la orden no cambie. `alCambiar`: el
 * toque de Estoy en Bolivia, si el panel lo ofrece (sin quien lo atienda, no se pinta).
 */
export function armarPanelDePago(p: PanelDePago, o: { alCambiar?: (e: Event) => void } = {}): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pago-panel";
  el.dataset.pago = "panel";
  const alCambiar = o.alCambiar;
  if (p.cambio && alCambiar) {
    const cambio = document.createElement("button");
    cambio.type = "button";
    cambio.className = "cl-texto pago-cambio";
    cambio.dataset.pago = "cambio";
    cambio.textContent = poner(p.cambio);
    cambio.addEventListener("click", (e) => alCambiar(e));
    el.append(cambio);
  }
  // La moneda, como dato y sin Copiar: «Moneda: USDC en Stellar».
  const moneda = t("compraDatoMoneda");
  const dos = moneda.indexOf(": ");
  dato(el, { dato: "moneda", etiqueta: dos >= 0 ? moneda.slice(0, dos) : moneda, valor: dos >= 0 ? moneda.slice(dos + 2) : "", copia: null });
  dato(el, { dato: "monto", etiqueta: t("pagoMonto"), valor: `${p.monto} USDC`, copia: p.usdc });
  dato(el, { dato: "nota", etiqueta: t("compraNotaRotulo"), valor: p.nota, copia: p.nota });
  dato(el, { dato: "destino", etiqueta: t("pagoCuenta"), valor: p.cuentaCorta, copia: p.destino });

  const caja = document.createElement("div");
  caja.className = "pago-qr-caja";
  const img = document.createElement("img");
  img.className = "pago-qr";
  img.alt = t("pagoQrAlt");
  img.width = LADO_QR;
  img.height = LADO_QR;
  const ayuda = document.createElement("p");
  ayuda.className = "pago-et pago-qr-ayuda";
  ayuda.textContent = t("pagoQrAyuda");
  caja.append(img, ayuda);
  void pintarQr(img, p.enlace, LADO_QR).then(
    (ok) => ok || caja.remove(),
    () => caja.remove(),
  );

  const app = document.createElement("a");
  app.className = "cl-secundario pago-app";
  app.dataset.pago = "app";
  app.setAttribute("href", p.enlace);
  app.textContent = t("pagoAbrirApp");

  // Con saldo en la cuenta que no alcanza, al final de los datos (para que no se lea como lo que hay que mandar): cuánto
  // hay y cuánto falta, como dato y sin nada que copiar.
  if (p.saldo) {
    const fila = document.createElement("div");
    fila.className = "pago-dato pago-dato-saldo";
    fila.dataset.pago = "saldo";
    const et = document.createElement("p");
    et.className = "pago-et";
    et.textContent = t("pagoSaldoEt");
    const valor = document.createElement("p");
    valor.className = "pago-valor pago-valor-saldo";
    valor.textContent = poner(p.saldo);
    fila.append(et, valor);
    el.append(fila);
  }

  // Plegado: lo que no hace falta para pagar, el QR del enlace y Abrir en mi app de pagos.
  const mas = document.createElement("details");
  mas.className = "mas pago-mas";
  mas.dataset.pago = "detalles";
  const resumen = document.createElement("summary");
  resumen.textContent = t("pagoMasDetalles");
  mas.append(resumen);
  for (const x of p.detalles) {
    const parrafo = document.createElement("p");
    parrafo.className = "pago-detalle";
    parrafo.textContent = poner(x);
    mas.append(parrafo);
  }
  mas.append(caja, app);
  el.append(mas);
  return el;
}
