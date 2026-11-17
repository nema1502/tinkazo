import "./styles.css";
import "./muestra-llama.css";
import { esc } from "./dom";
import { getLang, setLang } from "./i18n";
import { abrirDialogo } from "./ui/dialogo";
import { acompanar, enPantalla, type Acompanamiento, type PantallaDeCompra } from "./ui/llama-guia";
import { POSES, svgDeLlama, type PoseDeLlama } from "./ui/llama-poses";

/**
 * La página de muestra de la llama que acompaña (`muestras/llama.html`). Solo para desarrollo: el build del sitio no la
 * incluye. Recorre todos los estados del componente con textos de ejemplo de la compra y de la carga, en los dos idiomas
 * y los dos temas, para mirarlos y sacarles fotos.
 *
 *   vista=estados (por defecto)  las ventanas de ejemplo, una por estado
 *   vista=poses                  las cinco poses, a su tamaño y en grande
 *   vista=ventana&pantalla=CQ-ID la ventana de verdad, abierta en esa pantalla: Seguir recorre la compra
 */

interface Bil {
  es: string;
  en: string;
}
const tx = (b: Bil): string => b[getLang()];

interface Pantalla {
  ventana: "compra" | "carga";
  titulo: Bil;
  linea: Bil;
  boton: Bil;
  dato?: [Bil, string];
}

const VENTANA: Record<Pantalla["ventana"], Bil> = {
  compra: { es: "Tu compra", en: "Your purchase" },
  carga: { es: "Cargar con bolivianos", en: "Top up with bolivianos" },
};

const PAGAS: Bil = { es: "Pagás", en: "You pay" };

const PANTALLAS: Record<string, Pantalla> = {
  "CL-OFERTA": { ventana: "compra", titulo: { es: "Activar tu cuenta", en: "Activate your account" }, linea: { es: "Tres sorteos oficiales por 5 dólares.", en: "Three official draws for 5 dollars." }, boton: { es: "Empezar", en: "Start" } },
  "CQ-VERIF": { ventana: "compra", titulo: { es: "Verificá tu identidad", en: "Verify your identity" }, linea: { es: "Tené a mano tu carnet.", en: "Have your ID card ready." }, boton: { es: "Seguir", en: "Continue" } },
  "CQ-ID": { ventana: "compra", titulo: { es: "Tu carnet y tu cara", en: "Your ID card and face" }, linea: { es: "Se abre otra pestaña. Cuando termines, volvé a esta.", en: "Another tab opens. When you finish, come back to this one." }, boton: { es: "Abrir la verificación", en: "Open the verification" } },
  "CQ-ID-ESPERA": { ventana: "compra", titulo: { es: "Tu carnet y tu cara", en: "Your ID card and face" }, linea: { es: "Esperando que termines en la otra pestaña.", en: "Waiting for you to finish in the other tab." }, boton: { es: "Ya terminé", en: "I'm done" } },
  "CQ-PRECIO": { ventana: "compra", titulo: { es: "Pagás Bs 65", en: "You pay Bs 65" }, linea: { es: "Con el QR de tu banco. Después aprobás 3 pasos acá.", en: "With your bank's QR. Then you approve 3 steps here." }, boton: { es: "Ver el QR", en: "See the QR" } },
  "CQ-QR": { ventana: "compra", titulo: { es: "Pagá con el QR de tu banco", en: "Pay with your bank's QR" }, linea: { es: "Escanealo con la app de tu banco y pagalo una sola vez.", en: "Scan it with your bank's app and pay it only once." }, boton: { es: "Ya pagué", en: "I paid" }, dato: [PAGAS, "Bs 65"] },
  "CQ-ESPERA-PAGO": { ventana: "compra", titulo: { es: "Esperando tu pago", en: "Waiting for your payment" }, linea: { es: "Te mostramos acá cuando tu banco lo confirme. No pagues de nuevo.", en: "We'll show it here when your bank confirms it. Don't pay again." }, boton: { es: "Volver a mirar", en: "Check again" }, dato: [PAGAS, "Bs 65"] },
  "CQ-CAMINO": { ventana: "compra", titulo: { es: "Tu dinero está en camino", en: "Your money is on its way" }, linea: { es: "Faltan unos 3 minutos.", en: "About 3 minutes left." }, boton: { es: "Seguir", en: "Continue" } },
  "CQ-LLEGO": { ventana: "compra", titulo: { es: "Llegó tu dinero", en: "Your money arrived" }, linea: { es: "Un toque más y tu compra queda lista.", en: "One more tap and your purchase is done." }, boton: { es: "Terminar", en: "Finish" } },
  "CQ-LISTO": { ventana: "compra", titulo: { es: "Ya podés organizar tus sorteos", en: "You can run your draws now" }, linea: { es: "Recibimos tu pago. Te quedan 3 sorteos oficiales.", en: "We got your payment. You have 3 official draws left." }, boton: { es: "Listo", en: "Done" } },
  "CQ-FRENADA": { ventana: "compra", titulo: { es: "Tu compra está frenada", en: "Your purchase is on hold" }, linea: { es: "Tu dinero está a salvo. Probá de nuevo en unos minutos.", en: "Your money is safe. Try again in a few minutes." }, boton: { es: "Probar de nuevo", en: "Try again" }, dato: [{ es: "Número de compra", en: "Purchase number" }, "K7M29QXA"] },
  C1: { ventana: "carga", titulo: { es: "Tus dólares digitales", en: "Your digital dollars" }, linea: { es: "Cargá con el QR de tu banco, en bolivianos.", en: "Top up with your bank's QR, in bolivianos." }, boton: { es: "Cargar con bolivianos", en: "Top up with bolivianos" } },
  M2: { ventana: "carga", titulo: { es: "El precio", en: "The price" }, linea: { es: "Mirá cuánto te llega antes de pagar.", en: "See how much you get before you pay." }, boton: { es: "Seguir al pago", en: "Go to payment" }, dato: [PAGAS, "Bs 300"] },
};

/** Cada estado de la galería: la pantalla, su recorrido y, para una falla, dónde estaba antes. */
interface Estado {
  pantalla: string;
  acompanamiento: () => Omit<Acompanamiento, "linea">;
  antes?: () => Omit<Acompanamiento, "linea">;
}
const compra = (p: PantallaDeCompra, avance?: number) => () => enPantalla("compra", p, avance === undefined ? undefined : { avance });
const ESTADOS: Estado[] = [
  { pantalla: "C1", acompanamiento: () => enPantalla("carga", "C1") },
  { pantalla: "CL-OFERTA", acompanamiento: compra("CL-OFERTA") },
  { pantalla: "CQ-ID", acompanamiento: compra("CQ-ID") },
  { pantalla: "CQ-ID-ESPERA", acompanamiento: compra("CQ-ID-ESPERA") },
  { pantalla: "CQ-ESPERA-PAGO", acompanamiento: compra("CQ-ESPERA-PAGO") },
  { pantalla: "CQ-FRENADA", acompanamiento: compra("CQ-FRENADA"), antes: compra("CQ-CAMINO", 0.25) },
  { pantalla: "CQ-LISTO", acompanamiento: compra("CQ-LISTO") },
  { pantalla: "CQ-QR", acompanamiento: () => enPantalla("compraSiguiente", "CQ-QR") },
  { pantalla: "M2", acompanamiento: () => enPantalla("cargaVerificada", "M2") },
];

/** El recorrido de la ventana de verdad: Seguir pasa a la pantalla que sigue. */
const RECORRIDO: PantallaDeCompra[] = ["CL-OFERTA", "CQ-VERIF", "CQ-ID", "CQ-ID-ESPERA", "CQ-PRECIO", "CQ-QR", "CQ-ESPERA-PAGO", "CQ-CAMINO", "CQ-LLEGO", "CQ-LISTO"];

const TEXTOS = {
  titulo: { es: "La llama que acompaña", en: "The llama that walks with you" },
  estados: { es: "Estados", en: "States" },
  poses: { es: "Poses", en: "Poses" },
  recorrer: { es: "Recorrer la compra", en: "Walk through the purchase" },
  falla: { es: "Simular una falla", en: "Simulate a problem" },
  nombres: {
    saluda: { es: "Saluda", en: "Waves" },
    anima: { es: "Anima", en: "Cheers on" },
    espera: { es: "Espera", en: "Waits" },
    festeja: { es: "Festeja", en: "Celebrates" },
    preocupa: { es: "Se preocupa", en: "Worries" },
  } satisfies Record<PoseDeLlama, Bil>,
};

const params = new URLSearchParams(location.search);
const tema = params.get("theme");
if (tema === "light" || tema === "dark") document.documentElement.dataset.theme = tema;
setLang(params.get("lang") === "en" ? "en" : "es");
const vista = params.get("vista") ?? "estados";

const raiz = document.getElementById("muestra") as HTMLElement;
const enlace = (v: string, b: Bil): string => {
  const q = new URLSearchParams(params);
  q.set("vista", v);
  q.delete("pantalla");
  return `<a href="?${esc(q.toString())}"${v === vista ? ' aria-current="page"' : ""}>${esc(tx(b))}</a>`;
};
raiz.innerHTML =
  `<header class="muestra-cab"><h1>${esc(tx(TEXTOS.titulo))}</h1><nav>${enlace("estados", TEXTOS.estados)}${enlace("poses", TEXTOS.poses)}${enlace("ventana", TEXTOS.recorrer)}</nav></header>` +
  '<div class="muestra-cuerpo"></div>';
const cuerpo = raiz.querySelector(".muestra-cuerpo") as HTMLElement;

/** Una ventana de ejemplo, quieta en la página: el mismo marco que las ventanas de la cuenta. */
function ventanaQuieta(p: Pantalla): { cuerpo: HTMLElement; el: HTMLElement } {
  const el = document.createElement("section");
  el.className = "modal-card acct-card dlg-card muestra-ventana";
  el.innerHTML =
    `<div class="acct-head"><h2 class="dlg-h">${esc(tx(VENTANA[p.ventana]))}</h2></div>` +
    `<div class="acct-body dlg-cuerpo"><h3 class="muestra-h">${esc(tx(p.titulo))}</h3>${datoHtml(p)}</div>` +
    `<div class="dlg-pie"><button type="button" class="dlg-main">${esc(tx(p.boton))}</button></div>`;
  return { el, cuerpo: el.querySelector(".dlg-cuerpo") as HTMLElement };
}
const datoHtml = (p: Pantalla): string => (p.dato ? `<p class="muestra-dato"><span>${esc(tx(p.dato[0]))}</span><b>${esc(p.dato[1])}</b></p>` : "");

if (vista === "poses") {
  cuerpo.innerHTML =
    '<div class="muestra-poses">' +
    POSES.map((p) => `<figure class="muestra-pose"><div class="muestra-chica">${svgDeLlama(p)}</div><div class="muestra-grande">${svgDeLlama(p)}</div><figcaption>${esc(tx(TEXTOS.nombres[p]))}</figcaption></figure>`).join("") +
    "</div>";
} else if (vista === "ventana") {
  let i = Math.max(0, RECORRIDO.indexOf((params.get("pantalla") ?? "CL-OFERTA") as PantallaDeCompra));
  const falla = params.get("pantalla") === "CQ-FRENADA";
  const d = abrirDialogo({ titulo: tx(VENTANA.compra) });
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "dlg-main";
  const fallar = document.createElement("button");
  fallar.type = "button";
  fallar.className = "muestra-texto";
  fallar.textContent = tx(TEXTOS.falla);
  d.pie.append(boton, fallar);
  const pintar = (id: PantallaDeCompra, opciones?: { avance?: number }): void => {
    const p = PANTALLAS[id] as Pantalla;
    // La ventana rehace su cuerpo en cada pantalla, como lo haría la compra: la llama vuelve arriba sola.
    d.cuerpo.innerHTML = `<h3 class="muestra-h">${esc(tx(p.titulo))}</h3>${datoHtml(p)}`;
    acompanar(d.cuerpo, { ...enPantalla("compra", id, opciones), linea: tx(p.linea) });
    boton.textContent = tx(p.boton);
    d.card.dataset.pantalla = id;
  };
  if (falla) {
    i = RECORRIDO.indexOf("CQ-CAMINO");
    pintar("CQ-CAMINO", { avance: 0.25 });
    pintar("CQ-FRENADA");
  } else pintar(RECORRIDO[i] as PantallaDeCompra, RECORRIDO[i] === "CQ-CAMINO" ? { avance: 0.25 } : undefined);
  boton.addEventListener("click", () => {
    i = (i + 1) % RECORRIDO.length;
    if (i === 0) acompanar(d.cuerpo, null);
    pintar(RECORRIDO[i] as PantallaDeCompra, RECORRIDO[i] === "CQ-CAMINO" ? { avance: 0.25 } : undefined);
  });
  fallar.addEventListener("click", () => pintar("CQ-FRENADA"));
} else {
  const grilla = document.createElement("div");
  grilla.className = "muestra-grilla";
  cuerpo.appendChild(grilla);
  for (const e of ESTADOS) {
    const p = PANTALLAS[e.pantalla] as Pantalla;
    const v = ventanaQuieta(p);
    v.el.dataset.pantalla = e.pantalla;
    grilla.appendChild(v.el);
    if (e.antes) acompanar(v.cuerpo, { ...e.antes(), linea: "" });
    acompanar(v.cuerpo, { ...e.acompanamiento(), linea: tx(p.linea) });
  }
}
