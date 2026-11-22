import { MOTIVOS, type MotivoDeSalida } from "../sala/campana-org";
import type { AvisoDelStand, DatosDelProyector } from "./stand-campana";

/**
 * La pantalla del stand de una campaña, para el proyector del evento: el QR del celular en grande, el logo,
 * el premio, la hora de cierre y cuántas personas van a un lado; la lista descifrada y su «Para revisar»,
 * con Quitar pidiendo el motivo con botones, al otro. Cierra la inscripción con confirmación.
 *
 * Una pieza de solo mirar: no se toca nada más que Quitar y Cerrar la inscripción. Todo entra por
 * `DepsDePantallaDeCampana`, para probarla con un DOM de mentira. El modelo (`stand-campana.ts`) manda el
 * aviso con los datos ya compuestos; acá solo se pintan y se atienden los botones.
 */

export interface DepsDePantallaDeCampana {
  tx: (clave: string) => string;
  idioma: () => "es" | "en";
  /** Pinta el QR en un `img`; solo se la llama cuando el código cambió (patrón `src/ui/qr.ts`). */
  qr: (img: HTMLImageElement, enlace: string, lado: number) => Promise<void>;
  /** La persona a quitar ya vino con su motivo elegido por botones. */
  alQuitar: (n: number, motivo: MotivoDeSalida) => void;
  /** La inscripción se cierra: ya pasó la confirmación. */
  alCerrar: () => void;
}

export interface PantallaDeCampana {
  raiz: HTMLElement;
  /** Pinta lo que el modelo avisa: comprobando, su fallo, o los datos del proyector. */
  pintar: (aviso: AvisoDelStand) => void;
}

const ESTILO = `
  .scp { position: fixed; inset: 0; z-index: 3000; background: #fff; color: #111;
    display: grid; grid-template-columns: 1fr 1.2fr; font: 16px/1.4 system-ui, sans-serif; overflow: auto; }
  .scp-izq { padding: 4vmin; display: flex; flex-direction: column; align-items: flex-start; gap: 1.2vmin; }
  .scp-marca { display: flex; align-items: center; gap: .6vmin; font-size: 2.6vmin; color: #003a70; }
  .scp-marca svg { width: 3vmin; height: 3.6vmin; fill: #003a70; }
  .scp-marca b { color: #f5a800; }
  .scp-titulo { font-size: 5vmin; margin: 0; }
  .scp-logo { max-height: 14vmin; max-width: 60%; object-fit: contain; }
  .scp-premio, .scp-cierre, .scp-van { margin: 0; font-size: 3vmin; }
  .scp-van { font-size: 4.4vmin; font-weight: 700; }
  .scp-qr { margin-top: auto; display: flex; flex-direction: column; align-items: flex-start; gap: .8vmin; }
  .scp-qr-img { width: 30vmin; height: 30vmin; image-rendering: pixelated; }
  .scp-ayuda-qr { margin: 0; font-size: 1.9vmin; color: #555; }
  .scp-der { padding: 4vmin; border-left: 1px solid #ddd; display: flex; flex-direction: column; gap: 1.4vmin; min-width: 0; }
  .scp-datos { margin: 0; font-size: 2.7vmin; color: #b00; }
  .scp-lista, .scp-revisar { margin: 0; padding: 0; list-style: none; overflow: auto; font-size: 3vmin; }
  .scp-bloque-r { margin-top: 1.4vmin; }
  .scp-revisar-t { margin: 0 0 .6vmin; font-size: 2.2vmin; font-weight: 700; color: #a27000; }
  .scp-linea { display: flex; align-items: center; gap: 1vmin; padding: .4vmin 0; border-bottom: 1px solid #eee; min-width: 0; }
  .scp-nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scp-linea button { font-size: 1.9vmin; padding: .3vmin 1vmin; cursor: pointer; }
  .scp-quitar { background: none; border: 1px solid #b00; color: #b00; border-radius: .5vmin; }
  .scp-ghost { background: none; border: 1px solid #999; color: #333; border-radius: .5vmin; }
  .scp-motivos { display: flex; flex-wrap: wrap; gap: .6vmin; align-items: center; font-size: 1.9vmin; }
  .scp-motivos p { margin: 0; width: 100%; }
  .scp-vacia { margin: 0; color: #777; font-size: 2.4vmin; }
  .scp-aviso { margin: 0; color: #b00; font-size: 2.2vmin; }
  .scp-cerrar-zona { margin-top: auto; }
  .scp-cerrar-b { font-size: 2.2vmin; padding: .6vmin 2vmin; background: none; border: 1px solid #333; color: #111; border-radius: .6vmin; cursor: pointer; }
  .scp-confirmar { border: 1px solid #b00; border-radius: .8vmin; padding: 1.4vmin; margin-top: 1vmin; display: flex; flex-direction: column; gap: .8vmin; }
  .scp-cerrar-titulo { margin: 0; font-size: 2.6vmin; font-weight: 700; }
  .scp-cerrar-linea { margin: 0; font-size: 2vmin; }
  .scp-confirmar-opciones { display: flex; gap: 1vmin; }
  .scp-fallo { margin: auto; padding: 6vmin; font-size: 4vmin; text-align: center; max-width: 60ch; }

  @media (prefers-reduced-motion: no-preference) { .scp { animation: scp-sale .25s ease-out; } }
  @keyframes scp-sale { from { opacity: 0; } to { opacity: 1; } }
`;

const LLAMA =
  '<svg viewBox="-1 -3 24 28" aria-hidden="true"><rect x="2" y="11" width="16" height="7"/><rect x="15" y="3" width="4" height="10"/><rect x="14" y="0" width="8" height="4"/><rect x="20" y="-2" width="2" height="3"/><rect x="3" y="18" width="2.5" height="6"/><rect x="8" y="18" width="2.5" height="6"/><rect x="12.5" y="18" width="2.5" height="6"/><rect x="16" y="18" width="2.5" height="6"/><rect x="0" y="9" width="3" height="4"/></svg>';

export function crearPantallaDeCampana(deps: DepsDePantallaDeCampana): PantallaDeCampana {
  const raiz = document.createElement("div");
  raiz.className = "scp";
  raiz.id = "stand-campana";
  raiz.setAttribute("role", "dialog");
  raiz.setAttribute("aria-modal", "true");
  raiz.setAttribute("aria-labelledby", "scp-t");
  raiz.innerHTML =
    document.getElementById("scp-estilos") === null
      ? `<style id="scp-estilos">${ESTILO}</style>`
      : "";
  raiz.innerHTML +=
    `<div class="scp-izq" hidden>` +
    `<span class="scp-marca" aria-hidden="true">${LLAMA}<span>Tinka<b>zo</b></span></span>` +
    `<h2 class="scp-titulo" id="scp-t"></h2>` +
    `<img class="scp-logo" alt="" hidden />` +
    `<p class="scp-premio"></p>` +
    `<p class="scp-cierre" hidden></p>` +
    `<p class="scp-van" aria-live="polite"></p>` +
    `<div class="scp-qr"><img class="scp-qr-img" alt="" /><p class="scp-ayuda-qr"></p></div>` +
    `</div>` +
    `<div class="scp-der" hidden>` +
    `<p class="scp-datos" hidden></p>` +
    `<ol class="scp-lista"></ol>` +
    `<p class="scp-vacia" hidden></p>` +
    `<div class="scp-bloque-r" hidden><p class="scp-revisar-t"></p><ol class="scp-revisar"></ol></div>` +
    `<p class="scp-aviso" hidden></p>` +
    `<div class="scp-cerrar-zona">` +
    `<div class="scp-confirmar" hidden></div>` +
    `<button class="scp-cerrar-b" type="button"></button>` +
    `</div>` +
    `</div>` +
    `<p class="scp-fallo" hidden></p>`;

  const q = <T extends HTMLElement>(sel: string): T => raiz.querySelector<T>(sel) as T;
  const qOpcional = <T extends HTMLElement>(sel: string): T | null => raiz.querySelector<T>(sel);
  const izq = q(".scp-izq");
  const der = q(".scp-der");
  const titulo = q(".scp-titulo");
  const logo = qOpcional<HTMLImageElement>(".scp-logo") as HTMLImageElement;
  const premio = q(".scp-premio");
  const cierre = q(".scp-cierre");
  const van = q(".scp-van");
  const zonaQr = q(".scp-qr");
  const fallo = q(".scp-fallo");
  const avisoEl = q(".scp-aviso");
  const listaEl = q(".scp-lista");
  const vaciaEl = q(".scp-vacia");
  const bloqueR = q(".scp-bloque-r");
  const revisarEl = q(".scp-revisar");
  const zonaCierre = q(".scp-cerrar-zona");
  const confirmarEl = q(".scp-confirmar");
  const cerrarBtn = q<HTMLButtonElement>(".scp-cerrar-b");
  cerrarBtn.dataset.acc = "cerrar";

  /** El enlace que ya está dibujado: el QR se vuelve a pintar solo cuando el código cambia. */
  let enlaceDibujado: string | null = null;
  /** La fila donde se abrió la pregunta por el motivo, y si ya se pidió confirmar el cierre. */
  let preguntando = new Set<number>();
  let confirmandoCierre = false;

  function filaVista(f: DatosDelProyector["filas"][number], zona: "lista" | "revisar"): HTMLElement {
    const li = document.createElement("li");
    li.className = "scp-linea";
    li.dataset.n = String(f.n);
    const nombre = document.createElement("span");
    nombre.className = "scp-nombre";
    nombre.textContent = f.nombre === "" ? deps.tx("sdcPersona").replace("{n}", String(f.n)) : f.nombre;
    li.append(nombre);
    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "scp-quitar";
    quitar.textContent = deps.tx("sdcQuitar");
    quitar.dataset.acc = "quitar";
    quitar.dataset.n = String(f.n);
    li.append(quitar);
    if (zona === "lista" && !preguntando.has(f.n)) return li;
    if (!preguntando.has(f.n)) return li;
    const motivos = document.createElement("div");
    motivos.className = "scp-motivos";
    const p = document.createElement("p");
    p.textContent = deps.tx("sdcPorQue");
    motivos.append(p);
    const nombresDe = {
      repetida: "sdcMotRepetida",
      evento: "sdcMotEvento",
      pidio: "sdcMotPidio",
      otro: "sdcMotOtro",
    } as const;
    for (const m of MOTIVOS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scp-ghost";
      b.textContent = deps.tx(nombresDe[m]);
      b.dataset.acc = "motivo";
      b.dataset.n = String(f.n);
      b.dataset.motivo = m;
      motivos.append(b);
    }
    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "scp-ghost";
    cancelar.textContent = deps.tx("sdcCancelar");
    cancelar.dataset.acc = "cancelar";
    cancelar.dataset.n = String(f.n);
    motivos.append(cancelar);
    li.append(motivos);
    return li;
  }

  function pintarFilas(datos: DatosDelProyector): void {
    listaEl.replaceChildren(...datos.filas.map((f) => filaVista(f, "lista")));
    revisarEl.replaceChildren(...datos.revisar.map((f) => filaVista(f, "revisar")));
    vaciaEl.textContent = deps.tx("sdcNadie");
    vaciaEl.hidden = !(datos.filas.length === 0 && datos.revisar.length === 0);
    bloqueR.hidden = datos.revisar.length === 0;
    bloqueR.querySelector(".scp-revisar-t")!.textContent = deps.tx("sdcParaRevisar");
  }

  function pintarCierre(): void {
    cerrarBtn.textContent = deps.tx("sdcCerrar");
    if (!confirmandoCierre) {
      // Sin pregunta, el cuadro de confirmación no existe: nadie lo ve y nadie lo toca.
      confirmarEl.remove();
      return;
    }
    // El cuadro se saca cuando nadie la confirma: al volver, se reengancha arriba del botón.
    zonaCierre.prepend(confirmarEl);
    confirmarEl.hidden = false;
    const titulo = document.createElement("p");
    titulo.className = "scp-cerrar-titulo";
    titulo.textContent = deps.tx("sdcCerrarTitulo");
    const linea = document.createElement("p");
    linea.className = "scp-cerrar-linea";
    linea.textContent = deps.tx("sdcCerrarLinea");
    const opciones = document.createElement("div");
    opciones.className = "scp-confirmar-opciones";
    const si = document.createElement("button");
    si.type = "button";
    si.className = "scp-quitar";
    si.textContent = deps.tx("sdcCerrarSi");
    si.dataset.acc = "cerrar-si";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "scp-ghost";
    no.textContent = deps.tx("sdcCerrarNo");
    no.dataset.acc = "cerrar-no";
    opciones.append(si, no);
    confirmarEl.replaceChildren(titulo, linea, opciones);
  }

  function pintarAbierta(datos: DatosDelProyector): void {
    ultimo = datos;
    izq.hidden = false;
    der.hidden = false;
    fallo.hidden = true;
    titulo.textContent = datos.titulo;
    if (datos.logo === null) logo.hidden = true;
    else {
      logo.hidden = false;
      logo.src = `data:${datos.logo.tipo};base64,${datos.logo.datos}`;
      logo.alt = datos.titulo;
    }
    premio.textContent = datos.premio;
    if (datos.cierre === null) cierre.hidden = true;
    else {
      cierre.hidden = false;
      cierre.textContent = datos.cierre;
    }
    van.textContent = datos.van;
    // El QR: se pinta una sola vez por código; cambia cuando cambia el código.
    if (datos.enlace === enlaceDibujado && datos.enlace !== null) {
      // Igual que antes: no se toca.
    } else if (datos.enlace === null) {
      zonaQr.replaceChildren();
      enlaceDibujado = null;
    } else {
      enlaceDibujado = datos.enlace;
      const img = document.createElement("img");
      img.className = "scp-qr-img";
      img.alt = "";
      void deps.qr(img, datos.enlace, 340);
      zonaQr.replaceChildren(img);
      const ayuda = document.createElement("p");
      ayuda.className = "scp-ayuda-qr";
      ayuda.textContent = deps.tx("sdcAyudaQr");
      zonaQr.append(ayuda);
    }
    pintarFilas(datos);
    if (datos.aviso === null && !datos.cerrado) avisoEl.hidden = true;
    else {
      avisoEl.hidden = false;
      avisoEl.textContent = datos.cerrado ? deps.tx("sdcCerrado") : (datos.aviso ?? "");
    }
    pintarCierre();
  }

  function pintarChequeando(texto: string): void {
    izq.hidden = true;
    der.hidden = true;
    fallo.hidden = false;
    fallo.textContent = texto;
    enlaceDibujado = null;
  }

  function pintar(aviso: AvisoDelStand): void {
    if (aviso.vista === "chequeando") return pintarChequeando(deps.tx("sdcMirando"));
    if (aviso.vista === "fallo") return pintarChequeando(aviso.texto);
    pintarAbierta(aviso.datos);
  }

  raiz.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-acc]");
    if (!b) return;
    const accion = b.dataset.acc ?? "";
    if (accion === "quitar") {
      const n = Number(b.dataset.n);
      preguntando = new Set([n]);
      const datos = ultimo;
      if (datos !== null) pintarAbierta(datos);
    } else if (accion === "cancelar") {
      preguntando.delete(Number(b.dataset.n));
      const datos = ultimo;
      if (datos !== null) pintarAbierta(datos);
    } else if (accion === "motivo") {
      const n = Number(b.dataset.n);
      const motivo = MOTIVOS.find((m) => m === b.dataset.motivo);
      if (!motivo) return;
      preguntando.delete(n);
      deps.alQuitar(n, motivo);
      // La pregunta se cierra sin esperar al modelo: la fila queda como estaba hasta que él avise.
      if (ultimo !== null) pintarAbierta(ultimo);
      return;
    } else if (accion === "cerrar") {
      confirmandoCierre = true;
      const datos = ultimo;
      if (datos !== null) pintarAbierta(datos);
    } else if (accion === "cerrar-si") {
      confirmandoCierre = false;
      deps.alCerrar();
      // La confirmación se va de la vista mientras el modelo contesta.
      pintarCierre();
    } else if (accion === "cerrar-no") {
      confirmandoCierre = false;
      const datos = ultimo;
      if (datos !== null) pintarAbierta(datos);
    }
  });

  /** Los últimos datos abiertos, para repintar las preguntas sin pedirle nada al modelo. */
  let ultimo: DatosDelProyector | null = null;

  pintar({ vista: "chequeando" });
  return { raiz, pintar };
}
