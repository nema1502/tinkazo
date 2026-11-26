/**
 * El mundo de mentira de las pruebas de lo que la herramienta le cuenta a la sala de una campaña: una sala que contesta lo
 * que se le diga, un reloj que solo se mueve cuando la prueba lo mueve, la pantalla del sorteo y la memoria de la campaña.
 * Sin red ni reloj de verdad.
 */
import type { EstadoDeAltaPremio, SorteoDeCampana } from "../campana/en-curso";
import { esLineaDePersona } from "../campana/forma-persona";
import { type PasoDelPuente, alCambiarElPuente, pasoDelPuente, reiniciarElPuente } from "../campana/puente";
import { roundTime } from "../protocol/quicknet";
import type {
  EstadoDeSala,
  FallaDeCodigos,
  FallaDeSala,
  FaseDeSala,
  RespuestaDeAviso,
  RespuestaDeResultado,
  RespuestaDeSellada,
  ResultadoDeSala,
  SalaDeCampana,
} from "../sala/campana-org";
import { type DepsDelResultado, reiniciarElResultado } from "./campana-resultado";

export const RONDA = 30_000_000;
/** La hora (ms) en que sale la ronda de drand del sello de estas pruebas. */
export const SALE_LA_RONDA = roundTime(RONDA) * 1000;
export const HUELLA = "GA,GB";
export const TOKEN_DE_LA_SALA = "TOKEN-DE-LA-SALA-22";
export const CLAVE_DE_LA_SALA = "CLAVE-DE-LOS-NOMBRES";

export const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN_DE_LA_SALA,
  clave: CLAVE_DE_LA_SALA,
  vence: SALE_LA_RONDA + 86_400_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

export const suelta = async (veces = 6): Promise<void> => {
  for (let i = 0; i < veces; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

type PedidoDeSello = () => Promise<{ r: RespuestaDeSellada; horaSala: number | null }>;
export type RespuestaAlSello = RespuestaDeSellada | PedidoDeSello;
export type RespuestaAlEstado = EstadoDeSala | FallaDeSala | (() => Promise<EstadoDeSala | FallaDeSala>);

export interface Mundo {
  d: DepsDelResultado;
  ahora: number;
  sala: SalaDeCampana | null;
  fase: FaseDeSala | null;
  fases: string[];
  entrada: SorteoDeCampana | null;
  guardadas: SorteoDeCampana[];
  sellado: { raffleId: bigint | undefined; names: readonly string[]; sinSello: boolean; round: number } | null;
  sorteado: { guardado: boolean; ganadoras: string[] | null } | null;
  sinGrabar: boolean;
  puedeSoltar: boolean;
  soltadas: number;
  pedidos: { sorteo: string; plazo: number; en: number }[];
  respuestasAlSello: RespuestaAlSello[];
  estados: number;
  /** Cuándo (ms) se preguntó el estado. */
  preguntas: number[];
  respuestasAlEstado: RespuestaAlEstado[];
  /** Lo que contesta el estado cuando ya no quedan respuestas puestas. */
  estadoPorDefecto: EstadoDeSala | FallaDeSala;
  resultados: { sorteo: string; comprobante: string; en: number }[];
  respuestasAlResultado: RespuestaDeResultado[];
  leidoDeLaSala: ResultadoDeSala | "sin-resultado" | "no-existe" | "red" | "mezclada";
  /** Los nombres que la pestaña conoce de quienes ganaron, por cuenta o por línea. Sin nombre, una línea de persona es Ganadora y su puesto. */
  nombres: Record<string, string>;
  avisos: string[];
  respuestaAlAviso: RespuestaDeAviso;
  /** Lo que contesta cada pedido de códigos de entrega, en orden. Una función es un pedido que tarda lo que la prueba quiera. */
  respuestasALosCodigos: (string[] | FallaDeCodigos | (() => Promise<string[] | FallaDeCodigos>))[];
  /** Cuándo (ms) se pidieron los códigos y cuántos pasos había pintado el puente en ese momento. */
  pedidosDeCodigos: { en: number; pasosYaPintados: number }[];
  altas: { sorteo: string; ganadoras: string[] }[];
  altasDe: Record<string, EstadoDeAltaPremio>;
  otraBilletera: boolean;
  /** Los pasos que fue pintando el puente, en orden. */
  pasos: PasoDelPuente["paso"][];
  esperas: number[];
  /** Mueve el reloj `ms` y corre, en orden, lo que venza. */
  avanzar: (ms: number) => Promise<void>;
  detener: () => void;
}

/** Un aviso con el que nada falla: la sala acepta todo y el sello es el de la pantalla. */
export function mundo(): Mundo {
  reiniciarElPuente();
  reiniciarElResultado();
  const timers: { cuando: number; f: () => void }[] = [];
  const m: Mundo = {
    d: undefined as never,
    ahora: SALE_LA_RONDA - 90_000,
    sala: SALA,
    fase: "cerrada",
    fases: [],
    entrada: {
      evento: "evento-uno",
      red: "testnet",
      contrato: "CCONTRATO",
      huella: HUELLA,
      premios: 2,
      organizadora: null,
      pasadaEn: SALE_LA_RONDA - 120_000,
    },
    guardadas: [],
    sellado: { raffleId: 777n, names: ["GA", "GB"], sinSello: false, round: RONDA },
    sorteado: null,
    sinGrabar: false,
    puedeSoltar: true,
    soltadas: 0,
    pedidos: [],
    respuestasAlSello: [],
    estados: 0,
    preguntas: [],
    respuestasAlEstado: [],
    estadoPorDefecto: { fase: "cerrada", total: 2, cierraMs: 0 },
    resultados: [],
    respuestasAlResultado: [],
    leidoDeLaSala: { sorteo: "777", ganadoras: ["GB", "GA"], comprobante: "/verificar.html" },
    nombres: {},
    avisos: [],
    respuestaAlAviso: "ok",
    respuestasALosCodigos: [],
    pedidosDeCodigos: [],
    altas: [],
    altasDe: {},
    otraBilletera: false,
    pasos: [],
    esperas: [],
    avanzar: async (ms) => {
      // Lo que quedó esperando en el turno anterior registra su reloj antes de mover la hora.
      await suelta(3);
      const meta = m.ahora + ms;
      for (;;) {
        const vencidos = timers.filter((x) => x.cuando <= meta).sort((a, b) => a.cuando - b.cuando);
        const siguiente = vencidos[0];
        if (!siguiente) break;
        timers.splice(timers.indexOf(siguiente), 1);
        m.ahora = Math.max(m.ahora, siguiente.cuando);
        siguiente.f();
        await suelta(3);
      }
      m.ahora = meta;
      await suelta(3);
    },
    detener: () => undefined,
  };
  m.d = {
    sala: () => m.sala,
    faseDeLaSala: () => m.fase,
    fijarFase: (fase) => {
      m.fases.push(fase);
      m.fase = fase;
    },
    entrada: () => m.entrada,
    guardar: (e) => {
      m.entrada = e;
      m.guardadas.push(e);
    },
    sellado: () => m.sellado,
    sorteado: () => m.sorteado,
    sinGrabar: () => m.sinGrabar,
    contrato: () => "CCONTRATO",
    ahora: () => m.ahora,
    anotarHoraDeLaSala: () => undefined,
    huella: (names) => names.join(","),
    ponerSellada: (_s, sorteo, plazo) => {
      m.pedidos.push({ sorteo, plazo, en: m.ahora });
      const r = m.respuestasAlSello.shift() ?? "red";
      return typeof r === "function" ? r() : Promise.resolve({ r, horaSala: null });
    },
    estado: async () => {
      m.estados++;
      m.preguntas.push(m.ahora);
      const r = m.respuestasAlEstado.shift();
      if (r === undefined) return m.estadoPorDefecto;
      return typeof r === "function" ? r() : r;
    },
    guardarResultado: async (_s, sorteo, comprobante) => {
      m.resultados.push({ sorteo, comprobante, en: m.ahora });
      return m.respuestasAlResultado.shift() ?? "ok";
    },
    resultado: async () => m.leidoDeLaSala,
    avisar: async (_s, cuenta) => {
      m.avisos.push(cuenta);
      return m.respuestaAlAviso;
    },
    codigos: async () => {
      m.pedidosDeCodigos.push({ en: m.ahora, pasosYaPintados: m.pasos.length });
      const r = m.respuestasALosCodigos.shift();
      if (r === undefined) return "red";
      return typeof r === "function" ? r() : r;
    },
    sePuedeSoltar: () => m.puedeSoltar,
    soltarElSello: async () => void m.soltadas++,
    nombreDe: (cuenta, puesto) =>
      m.nombres[cuenta] ?? (cuenta === "GA" ? "Ana" : cuenta === "GB" ? "Beto" : esLineaDePersona(cuenta) ? `Ganadora ${puesto + 1}` : cuenta),
    otraBilletera: () => m.otraBilletera,
    iniciarAltas: (sorteo, ganadoras) => void m.altas.push({ sorteo, ganadoras }),
    altasDe: () => m.altasDe,
    esperar: (ms) => {
      m.esperas.push(ms);
      return new Promise<void>((resuelve) => void timers.push({ cuando: m.ahora + ms, f: resuelve }));
    },
  };
  const dejarElPuente = alCambiarElPuente(() => void m.pasos.push(pasoDelPuente().paso));
  m.detener = () => {
    dejarElPuente();
    reiniciarElPuente();
    reiniciarElResultado();
  };
  return m;
}

/** Un `Promise` que la prueba resuelve cuando quiere. */
export function diferida<T>(): { promesa: Promise<T>; resolver: (x: T) => void } {
  let resolver: (x: T) => void = () => undefined;
  const promesa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

export const ultimoPaso = (m: Mundo): string | undefined => m.pasos[m.pasos.length - 1];
