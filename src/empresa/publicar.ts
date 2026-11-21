/**
 * Publicar lo que la empresa armó: la campaña sale en la forma v1 que la
 * pantalla previa y el servicio de campañas saben leer (`leerCampana` de
 * `src/campana/modelo.ts`), con el lugar, la hora de cierre en la zona del
 * evento y los pasos tal como quedaron en las tarjetas. Si algo no cierra, se
 * dice qué falta y no se publica nada.
 *
 * Tests-first: esta pieza es pura y sin DOM, igual que el resto del panel.
 */

import type { Campana } from "../campana/modelo";
import { leerCampana } from "../campana/modelo";
import { DOLAR } from "../campana/comision";
import { instanteDe } from "../campana/crear/horas";
import { stripInvisibles } from "../invisibles";
import type { EventoDeEmpresa } from "./eventos";
import { lugarTexto } from "./eventos";
import type { PasoDeEmpresa } from "./pasos";
import type { PremiosDelPanel } from "./premios";
import { costosDeLaCampana } from "./premios";
import type { NetworkName } from "../stellar/config";

/** Cuatro letras o números que distinguen el evento de dos marcas parecidas, como en `src/campana/crear/estado.ts`. */
export function sufijoNuevo(): string {
  const letras = "abcdefghijklmnopqrstuvwxyz0123456789";
  const valores = new Uint32Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(valores);
  else for (let i = 0; i < 4; i += 1) valores[i] = Math.floor(Math.random() * 4_294_967_296);
  return [...valores].map((v) => letras.charAt(v % letras.length)).join("");
}

/** El id del evento: el nombre del arancel de la empresa convertido y el sufijo al final, y nada más largo de lo que cabe. */
export function slugDeEvento(nombre: string, sufijo: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const corto = limpio.slice(0, 40 - sufijo.length - 1).replace(/-+$/gu, "");
  return corto === "" ? `campana-${sufijo}` : `${corto}-${sufijo}`;
}

export interface PedidoDeLaEmpresa {
  nombre: string;
  eventos: readonly EventoDeEmpresa[];
  premios: PremiosDelPanel;
  pasos: readonly PasoDeEmpresa[];
  sufijo: string;
}

export type Publicacion =
  | { ok: true; texto: string; campana: Campana; evento: string; clave: string }
  | { ok: false; motivo: "nombre" | "premios" | "eventos" | "horas" };

/** Una clave de 22 letras, números, guiones o bajos, de la parte segura del navegador si la hay. */
function claveNueva(): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const valores = new Uint32Array(22);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(valores);
  else for (let i = 0; i < 22; i += 1) valores[i] = Math.floor(Math.random() * 4_294_967_296);
  return [...valores].map((v) => alfabeto.charAt(v % alfabeto.length)).join("");
}

const LARGO_DE_NOMBRE = 40;

/** Lo que se queda del nombre escrito: sin caracteres que no se ven y within del largo que la campaña permite. */
export function nombreDeLaEmpresa(v: string): string {
  const limpio = stripInvisibles(v).replace(/\s+/gu, " ").trim();
  return limpio.length > LARGO_DE_NOMBRE ? limpio.slice(0, LARGO_DE_NOMBRE).trim() : limpio;
}

/**
 * Arma, arma bien y devuelve la campaña publicada. La hora de cierre es la del
 * primer evento que ya tiene día; los premios, los del panel; los pasos, las
 * tarjetas. El resto viene con los valores de siempre de una campaña nueva:
 * entra con Google, abre en cuanto se activa y las bases son las de siempre.
 */
export function publicarLaCampana(
  pedido: PedidoDeLaEmpresa,
  red: NetworkName,
  zona: string,
  ahora: number,
): Publicacion {
  const nombre = nombreDeLaEmpresa(pedido.nombre);
  if (nombre === "") return { ok: false, motivo: "nombre" };
  if (costosDeLaCampana({ monto: pedido.premios.monto ?? 0, ganan: pedido.premios.ganan }, null) === null) {
    return { ok: false, motivo: "premios" };
  }
  const primerEvento = pedido.eventos.find((e) => e.dia !== null);
  if (!primerEvento?.dia) return { ok: false, motivo: "horas" };
  const cierraMs = instanteDe(primerEvento.dia, primerEvento.cierre, zona);
  if (cierraMs === null || cierraMs <= ahora) return { ok: false, motivo: "horas" };
  const evento = slugDeEvento(nombre, pedido.sufijo);
  const lugar = lugarTexto(primerEvento);
  const config = { pb: 200n, minimo: DOLAR };
  const total = costosDeLaCampana({ monto: pedido.premios.monto ?? 0, ganan: pedido.premios.ganan }, config);
  if (!total) return { ok: false, motivo: "premios" };
  return crearLaCampana(
    {
      evento,
      nombre,
      lugar,
      zona,
      premios: Array.from({ length: pedido.premios.ganan }, () => `${BigInt(pedido.premios.monto ?? 0) * DOLAR}`),
      abreMs: ahora,
      cierraMs,
      sorteoMs: cierraMs + 10 * 60_000,
      recibirHastaMs: cierraMs + 10 * 60_000 + 7 * 86_400_000,
      pasos: pedido.pasos
        .filter((p) => p.url !== "")
        .map((p) => ({ tipo: p.tipo, url: p.url, texto: p.texto })),
    },
    red,
  );
}

interface PiezasDeCampana {
  evento: string;
  nombre: string;
  lugar: string;
  zona: string;
  premios: string[];
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  recibirHastaMs: number;
  pasos: { tipo: string; url: string; texto: { es: string; en: string } }[];
}

/** Lo mismo que hizo el guion de siempre, pero dentro de esta pieza: arma el JSON y lo valora con `leerCampana`. */
function crearLaCampana(p: PiezasDeCampana, red: NetworkName): Publicacion {
  const crudo = {
    v: 1,
    evento: p.evento,
    red,
    estado: "borrador",
    empresa: { nombre: p.nombre, logo: null, color: null },
    lugar: { es: p.lugar, en: p.lugar },
    zona: p.zona,
    premios: p.premios,
    abre_ms: p.abreMs,
    cierra_ms: p.cierraMs,
    sorteo_ms: p.sorteoMs,
    recibir_hasta_ms: p.recibirHastaMs,
    entrada: "google",
    pasos: p.pasos.map((s) => ({ tipo: s.tipo, url: s.url, texto: s.texto })),
    bases: {
      es: "El sorteo es verificable y gratuito. Se juega con una sola anotación por persona y el premio llega a la cuenta que anotaste. Al participar aceptas que tu nombre aparezca en la lista del evento.",
      en: "The draw is verifiable and free. You enter once per person and the prize arrives at the account you entered with. By joining you accept that your name shows on the event list.",
    },
    anotadas: 0,
    contrato: null,
    promo: null,
    comprobante: null,
  };
  const leida = leerCampana(crudo);
  if (!leida.ok) return { ok: false, motivo: nombreDeFalta(leida.campo) };
  const clave = claveNueva();
  return { ok: true, texto: JSON.stringify(crudo), campana: leida.campana, evento: p.evento, clave };
}

function nombreDeFalta(campo: string): "nombre" | "premios" | "eventos" | "horas" {
  if (campo === "empresa.nombre" || campo === "evento") return "nombre";
  if (campo === "premios") return "premios";
  return "horas";
}
