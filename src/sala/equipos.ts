import type { ConfigEquipos, EstadoEquipo } from "../equipos/modelo";
import { esEstado } from "../equipos/modelo";
import type { Dependencias, Sala } from "./cliente";

/**
 * Los equipos, vistos desde los dos lados de la sala (`workers/sala`):
 *  - la pantalla de quien organiza (con el token de la sala): configura el registro, cambia el punto en que está cada
 *    equipo y quita los que sobran;
 *  - el celular del encargado de cada equipo (sin token): ve cómo es el registro, anota su equipo y pregunta en qué
 *    punto está.
 *
 * Los datos del equipo (nombre e integrantes) van cifrados con la clave del QR (`equipos/datos.ts`); la cuenta va
 * en claro porque es pública.
 */

const auth = (s: Pick<Sala, "token">): HeadersInit => ({ Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" });
const aJson = (x: unknown): string => JSON.stringify(x);

/** Quien organiza arma (o rearma) el registro. `true` si la sala lo guardó. */
export async function configurarRegistro(s: Sala, config: ConfigEquipos, dep: Dependencias = {}): Promise<boolean> {
  try {
    const r = await (dep.fetch ?? fetch)(`${s.servicio}/v1/sala/${s.id}/config`, { method: "PUT", headers: auth(s), body: aJson(config) });
    return r.status === 204;
  } catch {
    return false;
  }
}

/** Quien organiza cambia el punto en que está un equipo. `true` si la sala lo guardó. */
export async function cambiarEstadoEnSala(s: Sala, n: number, estado: EstadoEquipo, dep: Dependencias = {}): Promise<boolean> {
  try {
    const r = await (dep.fetch ?? fetch)(`${s.servicio}/v1/sala/${s.id}/equipos/${n}`, { method: "PUT", headers: auth(s), body: aJson({ estado }) });
    return r.status === 204;
  } catch {
    return false;
  }
}

/** Saca un equipo de la sala. `true` si quedó afuera (o ya no estaba). */
export async function quitarEquipoEnSala(s: Sala, n: number, dep: Dependencias = {}): Promise<boolean> {
  try {
    const r = await (dep.fetch ?? fetch)(`${s.servicio}/v1/sala/${s.id}/equipos/${n}`, { method: "DELETE", headers: auth(s) });
    return r.status === 204 || r.status === 404;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- el celular del equipo */

export type PublicoDeSala = { ok: true; config: ConfigEquipos | null; equipos: number } | { ok: false; motivo: "cerrada" | "red" };

/** Cómo es el registro de esta sala, para mostrar lo que corresponde antes de pedir nada. */
export async function leerPublico(servicio: string, id: string, dep: Dependencias = {}): Promise<PublicoDeSala> {
  try {
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/sala/${id}/publico`);
    if (r.status === 404) return { ok: false, motivo: "cerrada" };
    if (!r.ok) return { ok: false, motivo: "red" };
    const x = (await r.json()) as { config?: ConfigEquipos | null; equipos?: number };
    return { ok: true, config: x.config ?? null, equipos: Number(x.equipos ?? 0) };
  } catch {
    return { ok: false, motivo: "red" };
  }
}

export type MotivoDeAlta = "cerrada" | "sin-registro" | "llena" | "rapido" | "forma" | "origen" | "red";

/** El encargado anota su equipo. Con la misma cuenta otra vez, la sala cambia los datos y conserva el número y el estado. */
export async function anotarEquipoEnSala(
  servicio: string,
  id: string,
  cuenta: string,
  cifrado: string,
  dep: Dependencias = {},
): Promise<{ ok: true; n: number; estado: EstadoEquipo } | { ok: false; motivo: MotivoDeAlta }> {
  try {
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/sala/${id}/equipos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: aJson({ cuenta, d: cifrado }) });
    if (r.status === 201) {
      const x = (await r.json()) as { n?: number; estado?: string };
      if (typeof x.n === "number" && esEstado(x.estado)) return { ok: true, n: x.n, estado: x.estado };
      return { ok: false, motivo: "forma" };
    }
    if (r.status === 404) return { ok: false, motivo: "cerrada" };
    if (r.status === 409) return { ok: false, motivo: "sin-registro" };
    if (r.status === 403) return { ok: false, motivo: "origen" };
    if (r.status === 429) return { ok: false, motivo: ((await r.json().catch(() => ({}))) as { error?: string }).error === "llena" ? "llena" : "rapido" };
    return { ok: false, motivo: "forma" };
  } catch {
    return { ok: false, motivo: "red" };
  }
}

/** En qué punto está el equipo de esta cuenta: `null` si la sala no lo conoce, `"red"` si no se pudo preguntar. */
export async function leerEstadoDeEquipo(servicio: string, id: string, cuenta: string, dep: Dependencias = {}): Promise<{ n: number; estado: EstadoEquipo } | null | "red"> {
  try {
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/sala/${id}/equipos/${cuenta}`);
    if (r.status === 404) return null;
    if (!r.ok) return "red";
    const x = (await r.json()) as { n?: number; estado?: string };
    return typeof x.n === "number" && esEstado(x.estado) ? { n: x.n, estado: x.estado } : "red";
  } catch {
    return "red";
  }
}
