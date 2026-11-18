/** Dependencias locales para recorrer todas las pantallas sin red, sin Google y sin guardar recuerdos. */

import type {
  DepsDelCelular,
  EstadoPropio,
  Fase,
  ResultadoDelAlta,
  SesionDelCelular,
} from "./celular";
import type { Campana } from "./modelo";

type BaseDeDemostracion = Pick<
  DepsDelCelular,
  "tx" | "idioma" | "enApp" | "ahora" | "cada" | "visible" | "alVolver" | "vibrar" | "movimientoReducido"
>;

const CUENTA = `G${"A".repeat(55)}`;
const OTRA_CUENTA = `G${"B".repeat(55)}`;

/** Cada estado pedido por la dirección prepara únicamente las respuestas que esa pantalla necesita. */
export function depsDeDemostracion(
  base: BaseDeDemostracion,
  campana: Campana,
  estado: string | null,
): DepsDelCelular {
  let total = campana.anotadas;
  const conSesion = estado === "hola" || estado === "adentro" || estado === "sellada"
    || estado === "ganaste" || estado === "avisado" || estado === "otra" || estado === "quitada";
  const sesion = conSesion ? { cuenta: CUENTA, nombre: "Ana P." } : null;
  const fase: Fase = estado === "lista"
    ? "lista"
    : estado === "cerrada"
      ? "cerrada"
      : estado === "sellada"
        ? "sellada"
        : estado === "ganaste" || estado === "avisado" || estado === "otra" || estado === "quitada"
          ? "sorteada"
          : "abierta";
  const propio = (): EstadoPropio => ({
    fase,
    total,
    cierraMs: campana.cierraMs,
    anotada: estado !== "hola",
    quitada: estado === "quitada" ? "evento" : undefined,
    gano: estado === "ganaste" || estado === "avisado",
    avisado: estado === "avisado",
  });
  return {
    ...base,
    enApp: base.enApp || estado === "app",
    campana,
    publico: async () => {
      if (estado === "sin-red") return "red";
      if (estado === "termino") return "terminada";
      const respuesta = {
        fase,
        total,
        cierraMs: campana.cierraMs,
        pase: estado === "pase" ? "vencido" as const : "vale" as const,
      };
      total += 1;
      return respuesta;
    },
    sesion: async () => sesion,
    entrar: () => new Promise<SesionDelCelular>((resolve) => {
      window.setTimeout(() => resolve({ cuenta: CUENTA, nombre: "Ana P." }), 500);
    }),
    anotar: () => new Promise<ResultadoDelAlta>((resolve) => {
      window.setTimeout(() => resolve({ ok: true, ya: false }), 1000);
    }),
    yo: async () => propio(),
    resultado: async () => ({
      ganadoras: [estado === "otra" ? OTRA_CUENTA : CUENTA],
      comprobante: "/verificar.html?demo=1",
    }),
    recibir: () => undefined,
    salir: async () => undefined,
    costoDelRetiro: () => base.idioma() === "es" ? "0,50" : "0.50",
    enlace: () => "https://tinkazo.app/participar.html?demo=campana",
    memoria: null,
    sala: campana.evento,
  };
}
