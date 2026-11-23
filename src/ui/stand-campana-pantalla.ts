import { MOTIVOS, type MotivoDeSalida } from "../sala/campana-org";
import "./stand-campana.css";
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
