/**
 * El mundo de mentira de las pruebas del panel de campaña: una sala que contesta lo que se le diga, un reloj que se mueve
 * solo cuando la prueba lo mueve, un almacén, un QR que anota lo que le piden y un canal entre pestañas. Sin red.
 */
import { expect, vi } from "vitest";
import { campanaDeEjemplo } from "../campana/ejemplo";
import { leerCampana } from "../campana/modelo";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { cifrarEquipo, descifrarEquipo } from "../equipos/datos";
import { generarClave } from "../sala/cifra";
import type { EquipoDeSala, Escucha } from "../sala/cliente";
import type { EstadoDeSala, FallaDeSala, FaseDeSala, MotivoDeSalida, SalaDeCampana } from "../sala/campana-org";
import { validarCampanaParaFirmar } from "../sala/validar-campana";
import { t } from "../i18n";
import { type CanalDeCampana, type DepsDelPanelDeCampana, type FilaDeCampana, crearPanelDeCampana } from "./campana-sala";

/** El sábado de la campaña a las 14:00 de La Paz: 18:00 UTC, un múltiplo exacto de la ventana del pase. */
export const AHORA = Date.UTC(2026, 10, 21, 18, 0);
export const CLAVE = generarClave();
export const TOKEN = "T".repeat(22);
const VENTANA = 120_000;

export const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN,
  clave: CLAVE,
  vence: AHORA + 86_400_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

export const almacenFalso = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

/** Las pestañas del mismo navegador: lo que una anuncia lo oyen las demás, nunca ella. */
export function bus(): { canal: () => CanalDeCampana } {
  const oyentes = new Set<{ id: number; f: (s: string) => void }>();
  let contador = 0;
  return {
    canal: () => {
      const id = ++contador;
      const propio = { id, f: (_s: string): void => undefined };
      return {
        enviar: (sala) => {
          for (const o of oyentes) if (o.id !== id) o.f(sala);
        },
        alRecibir: (f) => {
          propio.f = f;
          oyentes.add(propio);
        },
        cerrar: () => void oyentes.delete(propio),
      };
    },
  };
}

/** El archivo firmado de mentira: la firma no se verifica en el navegador, la verifica la sala. */
export function campanaDeArchivo(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  const c = campanaDeEjemplo(AHORA);
  return {
    ...c,
    evento: "evento-uno",
    premios: c.premios.map((p) => p.toString()),
    abre_ms: c.abreMs,
    cierra_ms: c.cierraMs,
    sorteo_ms: c.sorteoMs,
    recibir_hasta_ms: c.recibirHastaMs,
    ...cambios,
  };
}

export const archivoDe = (cambios: Record<string, unknown> = {}): string =>
  JSON.stringify({ texto: JSON.stringify(campanaDeArchivo(cambios)), firma: "F".repeat(86) });

/** Lo que la sala sabe: la fase, quiénes están anotadas y la hora de cierre. */
export interface EstadoDeLaSalaFalsa {
  fase: FaseDeSala;
  cierraMs: number;
  enSala: Set<number>;
  /** El token de la sala viva que ya tiene el evento: otra creación da `ya-existe`. */
  viva: boolean;
  /** El intento con que se creó la sala viva: repetir ese mismo intento devuelve la misma sala, como la sala de verdad. */
  intento: string | null;
}

type Pendiente = { f: () => void; cuando: number; activo: boolean };
type Resultado<T> = T | FallaDeSala;

export interface Mundo {
  deps: DepsDelPanelDeCampana;
  ahora: number;
  red: "mainnet" | "testnet";
  idioma: "es" | "en";
  enStand: boolean;
  enEnsayo: boolean;
  conDemo: boolean;
  cuenta: string | null;
  contenido: string;
  sala: EstadoDeLaSalaFalsa;
  almacen: Storage;
  creadas: {
    archivo: { texto: string; firma: string };
    de: { evento: string; red: string; anterior: string | null; intento: string };
  }[];
  /** Lo que contesta `crear` la próxima vez, en orden. Sin nada, crea la sala. */
  respuestasAlCrear: ("firma" | "ya-existe" | "vencida" | "cupo-campanas" | "forma" | "origen" | "red" | "perdida")[];
  fases: [string, number | null][];
  /** Lo que contesta `fase` la próxima vez: `llega` es que la sala aplicó el cambio aunque la respuesta se perdió. */
  respuestasAFase: { falla: FallaDeSala; llega: boolean }[];
  quitadas: [number, MotivoDeSalida][];
  /** Lo que contesta `quitar` la próxima vez: `llega` es que la sala la sacó aunque la respuesta se perdió. */
  respuestasAQuitar: { falla: FallaDeSala; llega: boolean }[];
  pases: number;
  respuestasAlPase: Resultado<{ p: string; hasta: number }>[];
  /** Si no es null, el pase se contesta con este `hasta` en lugar del que cae después de la hora de la sala. */
  hastaDelPase: number | null;
  /** Cuánto va adelantada la hora de esta compu respecto de la de la sala: la sala fija el `hasta` con su hora, no con la de acá. */
  adelanto: number;
  estados: number;
  respuestaAlEstado: Resultado<EstadoDeSala>[];
  borradas: number;
  cerradas: { sala: SalaDeCampana; filas: readonly FilaDeCampana[] }[];
  qrs: { texto: string; ancho: number; fijo?: boolean }[];
  /** Las páginas que entrega cada `consultar`, en orden. */
  paginas: EquipoDeSala[][];
  consultas: number;
  escuchas: number;
  paradas: number;
  escucha: () => Escucha;
  temporizadores: Pendiente[];
  /** Mueve el reloj `ms` y corre, en orden, lo que venza. */
  correr: (ms: number) => Promise<void>;
  /** Las esperas que quedan sin disparar, por la hora en que vencen. */
  esperasEn: () => number[];
}

const sueltaTodo = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Deja correr las promesas que ya se pueden resolver (las del reloj de mentira no esperan nada real). */
export async function suelta(veces = 6): Promise<void> {
  for (let i = 0; i < veces; i++) await sueltaTodo();
}

export function mundo(opciones: { canal?: () => CanalDeCampana | null; almacen?: Storage } = {}): Mundo {
  let escucha: Escucha | null = null;
  const m: Mundo = {
    deps: undefined as never,
    ahora: AHORA,
    red: "testnet",
    idioma: "es",
    enStand: false,
    enEnsayo: false,
    conDemo: false,
    cuenta: null,
    contenido: "",
    sala: { fase: "lista", cierraMs: AHORA + 3 * 3_600_000, enSala: new Set(), viva: false, intento: null },
    almacen: opciones.almacen ?? almacenFalso(),
    creadas: [],
    respuestasAlCrear: [],
    fases: [],
    respuestasAFase: [],
    quitadas: [],
    respuestasAQuitar: [],
    pases: 0,
    respuestasAlPase: [],
    hastaDelPase: null,
    adelanto: 0,
    estados: 0,
    respuestaAlEstado: [],
    borradas: 0,
    cerradas: [],
    qrs: [],
    paginas: [],
    consultas: 0,
    escuchas: 0,
    paradas: 0,
    escucha: () => escucha as Escucha,
    temporizadores: [],
    correr: async (ms) => {
      const meta = m.ahora + ms;
      for (;;) {
        const vencidos = m.temporizadores.filter((x) => x.activo && x.cuando <= meta).sort((a, b) => a.cuando - b.cuando);
        const siguiente = vencidos[0];
        if (!siguiente) break;
        siguiente.activo = false;
        m.ahora = Math.max(m.ahora, siguiente.cuando);
        siguiente.f();
        await suelta(3);
      }
      m.ahora = meta;
      await suelta(2);
    },
    esperasEn: () => m.temporizadores.filter((x) => x.activo).map((x) => x.cuando).sort((a, b) => a - b),
  };
  const aplicar = (fase: string, cierra: number | null): void => {
    if (fase === "abierta" || fase === "cerrada") m.sala.fase = fase;
    if (cierra !== null) m.sala.cierraMs = cierra;
  };
  m.deps = {
    tx: (clave) => TEXTOS_SALA_CAMPANA[m.idioma][clave] ?? t(clave),
    idioma: () => m.idioma,
    red: () => m.red,
    enStand: () => m.enStand,
    enEnsayo: () => m.enEnsayo,
    conDemo: () => m.conDemo,
    ahora: () => m.ahora,
    leerArchivo: async () => m.contenido,
    validar: async (texto, ahora) => validarCampanaParaFirmar(texto, ahora),
    cuenta: () => m.cuenta,
    crear: async (archivo, de) => {
      m.creadas.push({ archivo, de });
      const falla = m.respuestasAlCrear.shift();
      const sala = { ...SALA, evento: de.evento, red: de.red };
      if (m.sala.viva && m.sala.intento === de.intento) return { ok: true, sala };
      if (falla === "perdida") {
        // La sala se creó y la respuesta no llegó.
        m.sala.viva = true;
        m.sala.intento = de.intento;
        return { ok: false, motivo: "red" };
      }
      if (falla) return { ok: false, motivo: falla };
      if (m.sala.viva) return { ok: false, motivo: "ya-existe" };
      m.sala.viva = true;
      m.sala.intento = de.intento;
      return { ok: true, sala };
    },
    pase: async () => {
      m.pases++;
      const dada = m.respuestasAlPase.shift();
      if (dada !== undefined) return dada;
      const hasta = m.hastaDelPase ?? (Math.floor((m.ahora - m.adelanto) / VENTANA) + 1) * VENTANA;
      return { p: `PASE${String(m.pases).padStart(8, "0")}`, hasta };
    },
    fase: async (_s, fase, cierraMs) => {
      m.fases.push([fase, cierraMs]);
      const r = m.respuestasAFase.shift();
      if (r) {
        if (r.llega) aplicar(fase, cierraMs);
        return r.falla;
      }
      aplicar(fase, cierraMs);
      return true;
    },
    quitar: async (_s, n, motivo) => {
      m.quitadas.push([n, motivo]);
      const r = m.respuestasAQuitar.shift();
      if (r) {
        if (r.llega) m.sala.enSala.delete(n);
        return r.falla;
      }
      m.sala.enSala.delete(n);
      return true;
    },
    estado: async () => {
      m.estados++;
      const dado = m.respuestaAlEstado.shift();
      if (dado !== undefined) return dado;
      return { fase: m.sala.fase, total: m.sala.enSala.size, cierraMs: m.sala.cierraMs };
    },
    campanaDeSala: async () => {
      const lectura = JSON.parse(JSON.stringify(campanaDeArchivo())) as Record<string, unknown>;
      const r = leerCampana(lectura);
      return r.ok ? r.campana : "rechazo";
    },
    borrarVacia: async () => {
      m.borradas++;
      m.sala.viva = false;
      return true;
    },
    escuchar: (_s, e) => {
      m.escuchas++;
      escucha = e;
      return {
        parar: () => void m.paradas++,
        consultar: async () => {
          m.consultas++;
          const pagina = m.paginas.shift();
          for (const x of pagina ?? []) e.alEquipo?.(x);
        },
      };
    },
    descifrar: descifrarEquipo,
    qr: async (_img, texto, ancho, fijo) => {
      m.qrs.push({ texto, ancho, fijo });
      return true;
    },
    almacen: m.almacen,
    esperar: (f, ms) => {
      const x: Pendiente = { f, cuando: m.ahora + ms, activo: true };
      m.temporizadores.push(x);
      return () => {
        x.activo = false;
      };
    },
    pantallaCompleta: async () => undefined,
    ventana: () => ({ ancho: 1366, alto: 768 }),
    origen: () => "https://tinkazo.app",
    canal: opciones.canal ?? (() => null),
    alCerrar: (sala, filas) => void m.cerradas.push({ sala, filas }),
  };
  return m;
}

/* ------------------------------------------------------------ lo que se hace con el panel */

export type Panel = ReturnType<typeof crearPanelDeCampana>;

const abiertos: Panel[] = [];

export function nuevoPanel(m: Mundo): Panel {
  const p = crearPanelDeCampana(m.deps);
  document.body.append(p.raiz);
  abiertos.push(p);
  return p;
}

/** Cierra los paneles que armó la prueba: sus oyentes de la ventana no pueden pasar a la prueba que sigue. */
export function cerrarTodos(): void {
  for (const p of abiertos.splice(0)) p.detener();
}

export const $ = <T extends HTMLElement>(p: Panel, selector: string): T => p.raiz.querySelector<T>(selector) as T;
export const texto = (p: Panel, selector: string): string => (p.raiz.querySelector(selector)?.textContent ?? "").trim();
export const vistaDe = (p: Panel): string => p.raiz.dataset.vista ?? "";
export const principales = (p: Panel): HTMLButtonElement[] => [...p.raiz.querySelectorAll<HTMLButtonElement>("button.primary")];
export const botones = (p: Panel): HTMLButtonElement[] => [...p.raiz.querySelectorAll<HTMLButtonElement>("button")];

/** El botón que dice eso, y falla si no está: la prueba lee lo que lee la persona. */
export function boton(p: Panel, rotulo: string): HTMLButtonElement {
  const b = botones(p).find((x) => (x.textContent ?? "").trim() === rotulo && !x.hidden);
  if (!b) throw new Error(`no hay un botón "${rotulo}": ${botones(p).map((x) => x.textContent).join(" | ")}`);
  return b;
}

/** Elige un archivo como lo haría el selector del navegador. */
export async function elegirArchivo(m: Mundo, p: Panel, contenido: string): Promise<void> {
  m.contenido = contenido;
  const input = $<HTMLInputElement>(p, "#cpo-archivo");
  Object.defineProperty(input, "files", { value: [new File(["x"], "campana.json")], configurable: true });
  input.dispatchEvent(new Event("change"));
  await suelta(4);
}

/** Del archivo bueno a la inscripción abierta, con su QR a la vista. */
export async function abrirInscripcion(m: Mundo, p: Panel): Promise<void> {
  await elegirArchivo(m, p, archivoDe());
  expect(vistaDe(p)).toBe("previa");
  boton(p, "Abrir la inscripción").click();
  await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  await suelta(3);
}

/** Una alta que llega por el socket, cifrada como la cifra el celular. */
export async function alta(m: Mundo, n: number, nombre: string, v = n): Promise<void> {
  const d = await cifrarEquipo(CLAVE, { nombre, integrantes: [] });
  m.sala.enSala.add(n);
  m.escucha().alEquipo?.({ n, cuenta: `CUENTA${n}`, d, estado: "aceptado", v });
}

/** Un alta tal como la entrega la sala, para los casos en que llega por `consultar` y no por el socket. */
export async function equipoDe(m: Mundo, n: number, nombre: string): Promise<EquipoDeSala> {
  const d = await cifrarEquipo(CLAVE, { nombre, integrantes: [] });
  m.sala.enSala.add(n);
  return { n, cuenta: `CUENTA${n}`, d, estado: "aceptado", v: n };
}

/** Lo que dice cada fila de la lista, de arriba abajo. */
export const filasDe = (p: Panel): string[] =>
  [...p.raiz.querySelectorAll<HTMLElement>("#cpo-ul > li")].map((li) => (li.querySelector(".cpo-nombre, .cpo-salio")?.textContent ?? "").trim());

export const filaDe = (p: Panel, n: number): HTMLElement => p.raiz.querySelector<HTMLElement>(`#cpo-ul > li[data-n="${n}"]`) as HTMLElement;

/** Un botón de una fila, por lo que dice. */
export function botonDeFila(p: Panel, n: number, rotulo: string): HTMLButtonElement {
  const b = [...filaDe(p, n).querySelectorAll<HTMLButtonElement>("button")].find((x) => (x.textContent ?? "").trim() === rotulo);
  if (!b) throw new Error(`la fila ${n} no tiene "${rotulo}"`);
  return b;
}

/** Confirma el cierre con el segundo toque ya fuera de la guarda del doble toque. */
export async function confirmarCierre(m: Mundo, p: Panel, rotulo: string): Promise<void> {
  await m.correr(700);
  boton(p, rotulo).click();
}
