import type { Fase } from "./celular";

/** Lo que el celular recuerda de una campaña. Nunca el correo, el token ni el nombre. */
export interface MemoriaDeCampana {
  cuenta: string;
  fase: Fase;
  resultado: "gano" | "otra" | null;
  comprobante: string | null;
  guardado: number;
}

export const VIDA_MEMORIA_MS = 7 * 24 * 3_600_000;
export const claveDeMemoria = (sala: string): string => `tinkazo.campana.${sala}`;

const FASES: readonly Fase[] = ["lista", "abierta", "cerrada", "sellada", "sorteada"];

function esMemoria(valor: unknown): valor is MemoriaDeCampana {
  if (typeof valor !== "object" || valor === null) return false;
  const m = valor as Record<string, unknown>;
  return typeof m.cuenta === "string"
    && /^G[A-Z2-7]{55}$/u.test(m.cuenta)
    && typeof m.fase === "string"
    && FASES.includes(m.fase as Fase)
    && (m.resultado === "gano" || m.resultado === "otra" || m.resultado === null)
    && (typeof m.comprobante === "string" || m.comprobante === null)
    && typeof m.guardado === "number"
    && Number.isFinite(m.guardado);
}

/** Lee solo recuerdos íntegros y vigentes. Un recuerdo vencido se borra para no revivir una sala vieja. */
export function leerMemoria(almacen: Storage | null, sala: string, ahora: number): MemoriaDeCampana | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(claveDeMemoria(sala));
    if (crudo === null) return null;
    let valor: unknown;
    try {
      valor = JSON.parse(crudo);
    } catch {
      return null;
    }
    if (!esMemoria(valor)) return null;
    if (ahora - valor.guardado > VIDA_MEMORIA_MS) {
      almacen.removeItem(claveDeMemoria(sala));
      return null;
    }
    return {
      cuenta: valor.cuenta,
      fase: valor.fase,
      resultado: valor.resultado,
      comprobante: valor.comprobante,
      guardado: valor.guardado,
    };
  } catch {
    return null;
  }
}

/** Guarda una copia con los cinco campos permitidos, aunque quien llama tenga un objeto más amplio. */
export function guardarMemoria(almacen: Storage | null, sala: string, m: MemoriaDeCampana): void {
  if (!almacen) return;
  const recuerdo: MemoriaDeCampana = {
    cuenta: m.cuenta,
    fase: m.fase,
    resultado: m.resultado,
    comprobante: m.comprobante,
    guardado: m.guardado,
  };
  try {
    almacen.setItem(claveDeMemoria(sala), JSON.stringify(recuerdo));
  } catch {
    /* La pantalla sigue funcionando aunque el navegador bloquee el almacenamiento. */
  }
}

/** Olvida la campaña al cambiar de cuenta o al salir de Google. */
export function borrarMemoria(almacen: Storage | null, sala: string): void {
  if (!almacen) return;
  try {
    almacen.removeItem(claveDeMemoria(sala));
  } catch {
    /* No hay nada más que hacer si el navegador bloquea el almacenamiento. */
  }
}
