import "../campana/campana-sala.css";
import { borrarBorrador, leerBorrador } from "../campana/borrador";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { getLang, onLangChange } from "../i18n";

/**
 * La campaña por activar, vista desde el modo Prueba: quien la armó vuelve mañana a tinkazo.app sin nada en la dirección y
 * la pestaña nueva abre en Prueba, donde una campaña no se activa. Un aviso arriba de todo la nombra y un toque la lleva a
 * su campaña en el modo oficial. Se baja solo con un borrador guardado (`campana-arranque.ts`): sin él no existe.
 */

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DepsDelAviso {
  almacen: Almacen | null;
  tx: (clave: string) => string;
  /** Lleva a la campaña en el modo oficial. */
  ir: (direccion: string) => void;
}

/** La dirección del panel de quien organiza en el modo oficial: la misma a la que lleva crear-campana.html al activar. */
export const DIRECCION_DE_LA_CAMPANA = "/?campana&red=oficial";

/** El nombre de la empresa que dice el borrador, o `null` si no se lee. */
export function empresaDelBorrador(crudo: string): string | null {
  try {
    const x: unknown = JSON.parse(crudo);
    if (typeof x !== "object" || x === null) return null;
    const empresa = (x as { empresa?: unknown }).empresa;
    const nombre = typeof empresa === "object" && empresa !== null ? (empresa as { nombre?: unknown }).nombre : null;
    return typeof nombre === "string" && nombre.trim() !== "" ? nombre.trim().slice(0, 80) : null;
  } catch {
    return null;
  }
}

/**
 * Pinta el aviso como primer bloque de la página y esconde la portada de arriba, que competía con su botón: un título, una
 * línea y un botón, y Dejar esta campaña chico debajo, que borra el borrador. Devuelve el aviso, o `null` sin borrador.
 */
export function pintarAvisoEnPrueba(doc: Document, d: DepsDelAviso): { raiz: HTMLElement; pintar: () => void } | null {
  const crudo = leerBorrador(d.almacen);
  if (crudo === null || doc.getElementById("cpo-pendiente")) return null;
  // Un borrador que no se lee como campaña no es de nadie: no se avisa nada.
  const empresa = empresaDelBorrador(crudo);
  if (empresa === null) return null;
  const raiz = doc.createElement("section");
  raiz.id = "cpo-pendiente";
  // Solo en la portada: una demostración, Sortear o Mis sorteos no lo llevan encima.
  raiz.className = "cpo-panel cpo-pendiente portada-only";
  const titulo = doc.createElement("h2");
  const linea = doc.createElement("p");
  linea.className = "cpo-linea";
  const acciones = doc.createElement("div");
  acciones.className = "cpo-acciones";
  const ir = doc.createElement("button");
  ir.type = "button";
  ir.className = "primary";
  ir.addEventListener("click", () => d.ir(DIRECCION_DE_LA_CAMPANA));
  const dejar = doc.createElement("button");
  dejar.type = "button";
  dejar.className = "enlace";
  const portada = doc.querySelector<HTMLElement>(".hero-portada");
  dejar.addEventListener("click", () => {
    borrarBorrador(d.almacen);
    raiz.remove();
    if (portada) portada.style.display = "";
  });
  acciones.append(ir, dejar);
  raiz.append(titulo, linea, acciones);
  const pintar = (): void => {
    titulo.textContent = d.tx("cpoBorradorT").replace("{empresa}", empresa);
    linea.textContent = d.tx("cpoAcRedPrincipalL");
    ir.textContent = d.tx("cpoIrACampana");
    dejar.textContent = d.tx("cpoDejar");
  };
  pintar();
  const main = doc.querySelector("main");
  if (main) main.prepend(raiz);
  else doc.body.prepend(raiz);
  if (portada) portada.style.display = "none";
  return { raiz, pintar };
}

/** El aviso en la página de verdad, con el idioma vigente y que cambia con él. */
export function avisarEnPrueba(): void {
  let almacen: Almacen | null = null;
  try {
    almacen = localStorage;
  } catch {
    almacen = null;
  }
  const aviso = pintarAvisoEnPrueba(document, {
    almacen,
    tx: (clave) => TEXTOS_SALA_CAMPANA[getLang()][clave] ?? clave,
    ir: (direccion) => location.assign(direccion),
  });
  if (aviso) onLangChange(() => aviso.pintar());
}
