import type { Fase } from "./celular";

/**
 * Lo que el celular guarda en lugar de la cuenta en una campaña de personas: quien se anota sin billetera no tiene cuenta que
 * recordar. Es solo una marca, no dice nada de nadie. La sala reconoce a la persona por la llave de este celular.
 */
export const SIN_CUENTA = "persona";

/** Lo que el celular recuerda de una campaña. Nunca el correo, el token ni el nombre. */
export interface MemoriaDeCampana {
  /** La cuenta de Stellar de quien se anotó, o `SIN_CUENTA` en una campaña de personas. */
  cuenta: string;
  fase: Fase;
  resultado: "gano" | "otra" | null;
  comprobante: string | null;
  guardado: number;
}

export const VIDA_MEMORIA_MS = 7 * 24 * 3_600_000;
/** En una campaña de personas el celular recuerda lo que vive la sala, que se borra a las 24 horas, y no más. */
export const VIDA_MEMORIA_PERSONA_MS = 24 * 3_600_000;
export const claveDeMemoria = (sala: string): string => `tinkazo.campana.${sala}`;

const FASES: readonly Fase[] = ["lista", "abierta", "cerrada", "sellada", "sorteada"];

function esMemoria(valor: unknown): valor is MemoriaDeCampana {
  if (typeof valor !== "object" || valor === null) return false;
  const m = valor as Record<string, unknown>;
  return typeof m.cuenta === "string"
    && (/^G[A-Z2-7]{55}$/u.test(m.cuenta) || m.cuenta === SIN_CUENTA)
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
    if (ahora - valor.guardado > (valor.cuenta === SIN_CUENTA ? VIDA_MEMORIA_PERSONA_MS : VIDA_MEMORIA_MS)) {
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
