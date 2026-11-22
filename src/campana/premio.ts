/**
 * Lo que dice y ofrece Ganaste según cómo está la cuenta de este navegador. Se baja con `import()` recién cuando alguien
 * llega a Ganaste y la cuenta es de las que cambian algo: la mayoría ve la línea de siempre y nunca descarga esto.
 *
 * La principal sigue siendo Recibir mi premio, salvo con una cuenta que se usó en otro navegador y no tiene forma de entrar
 * desde acá: ahí lo que ayuda es llevar el enlace al otro navegador, y Recibir queda de texto, debajo.
 */

import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import type { DepsDelCelular } from "./celular";
import { TEXTOS_PREMIO } from "./textos-premio";

/** Lo de la lectura de la cuenta que Ganaste necesita para decidir su línea. */
export type CuentaParaGanar = Pick<LecturaDelCelular, "estado" | "protegida">;

export interface VarianteDeGanaste {
  /** La línea de apoyo, ya en el idioma de la persona. */
  linea: string;
  /** Con una cuenta que se usó en otro navegador: lo que hace la principal (llevar el enlace) y su texto. */
  llevar: { texto: string; alHacer: (barra: HTMLElement) => void } | null;
}

/**
 * Si la sesión de este navegador es de otra persona que la de `cuenta` (un celular compartido, donde alguien entró con su
 * cuenta en el mismo navegador). Quien recargó ya anotada no retomó la sesión: se compara al ir a recibir, que es cuando hace
 * falta. Sin respuesta o con una falla, no: Recibir sigue y el sitio lo resuelve con la cuenta que tenga.
 */
export async function laSesionEsDeOtra(deps: DepsDelCelular, cuenta: string): Promise<boolean> {
  try {
    return (await deps.cuenta?.laSesionEs?.(cuenta)) === "otra";
  } catch {
    return false;
  }
}

/**
 * La variante que corresponde, o null si la línea de siempre (cpParaRecibir) es la que va: la cuenta se está creando, no se
 * sabe, o falta confirmar el correo y todavía no tiene ninguna protección.
 */
export function varianteDeGanaste(deps: DepsDelCelular, cuenta: CuentaParaGanar | null): VarianteDeGanaste | null {
  const tx = (clave: string): string => TEXTOS_PREMIO[deps.idioma()][clave] ?? "";
  switch (cuenta?.estado) {
    case "lista":
      return { linea: tx("cgListo"), llevar: null };
    case "falta":
      return cuenta.protegida ? { linea: tx("cgListo"), llevar: null } : null;
    case "otro-con-correo":
      return { linea: tx("cgOtro"), llevar: null };
    case "otro-con-desbloqueo":
      return { linea: tx("cgDesbloqueo"), llevar: null };
    case "sin-forma": {
      // Sin dirección de la página (la vista previa) no hay enlace que llevar: la línea sola no engaña, y Recibir sigue.
      if (!deps.enlaceDelPremio) return { linea: tx("cgAlla"), llevar: null };
      return {
        linea: tx("cgAlla"),
        llevar: {
          texto: deps.compartir ? tx("cgMandarme") : deps.tx("cpCopiar"),
          alHacer: (barra) => void llevarElEnlace(deps, barra),
        },
      };
    }
    default:
      return null;
  }
}

/** Una línea que se anuncia sola, arriba del botón: lo que pasó con el enlace. */
function lineaDeEstado(barra: HTMLElement): HTMLElement {
  const previa = barra.querySelector<HTMLElement>("[data-cmp-copia]");
  if (previa) return previa;
  const linea = document.createElement("p");
  linea.className = "cmp-apoyo";
  linea.dataset.cmpCopia = "";
  linea.setAttribute("role", "status");
  barra.querySelector(".primary")?.before(linea);
  return linea;
}

/**
 * Abre el menú de compartir con el enlace del premio. Si la persona lo cierra, no pasa nada. Donde no hay menú, o no deja,
 * lo copia, y sin portapapeles lo deja a la vista en un campo ya elegido, para copiarlo con la mano.
 */
async function llevarElEnlace(deps: DepsDelCelular, barra: HTMLElement): Promise<void> {
  const enlace = deps.enlaceDelPremio?.();
  if (!enlace) return;
  if (deps.compartir) {
    try {
      await deps.compartir(enlace);
      return;
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") return;
    }
  }
  try {
    if (!navigator.clipboard) throw new Error("sin-portapapeles");
    await navigator.clipboard.writeText(enlace);
    lineaDeEstado(barra).textContent = deps.tx("cpCopiado");
  } catch {
    let campo = barra.querySelector<HTMLInputElement>("input[data-cmp-copiar]");
    if (!campo) {
      campo = document.createElement("input");
      campo.type = "text";
      campo.readOnly = true;
      campo.dataset.cmpCopiar = "";
      campo.setAttribute("aria-label", deps.tx("cpCopiar"));
      barra.append(campo);
    }
    campo.value = enlace;
    campo.focus();
    campo.select();
  }
}
