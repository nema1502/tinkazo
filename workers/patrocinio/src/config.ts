/**
 * Lo que se configura del portero: los valores por defecto y cómo se leen de las
 * variables del Worker. Sin red ni objetos: lo usan el Worker, el objeto y las pruebas.
 *
 * Los secretos (`CLAVE_PATROCINADOR`, `ADMIN_TOKEN`) no se leen acá: los usa quien
 * los necesita, una sola vez.
 */
import deployments from "../../../src/stellar/deployments.json";

export interface Env {
  /** Un solo objeto por red: el tope de la cuenta y el general se tienen que decidir juntos y de a uno. */
  PATROCINIO: DurableObjectNamespace;
  /** `testnet` (por defecto) o `mainnet`. Mainnet sin contrato en `deployments.json` no patrocina nada. */
  RED?: string;
  /** La llave de la cuenta patrocinadora que firma los fee-bump. Secreto. Pesa 1: solo puede quemar comisiones. */
  CLAVE_PATROCINADOR?: string;
  /** El permiso de Tinkazo para apagar, ajustar y exportar. Secreto, de 32 caracteres o más. */
  ADMIN_TOKEN?: string;
  /** Lista de G… con cupo ampliado (50 sellos por mes). */
  CUENTAS_VERIFICADAS?: string;
  /** Solo para probar en testnet: cuentas de friendbot que se aceptan sin haberlas abierto nuestra app. En mainnet se ignora. */
  CUENTAS_PRUEBA?: string;
  /** Las billeteras de fondos de Pollar: quien patrocina las reservas de una cuenta abierta por nuestra app. */
  PATROCINADORES_APP?: string;
  /** RPC de la red, separados por coma; si el primero se corta se sigue con el siguiente. */
  RPC_URLS?: string;
  MAX_SELLOS_MES?: string;
  MAX_SELLOS_VERIFICADA?: string;
  TOPE_GENERAL_STROOPS?: string;
  TOPE_TX_STROOPS?: string;
  /** Lo que se guarda para el sorteo de cada sello, en stroops: el costo medido de un `draw` más la mitad. */
  RESERVA_SORTEO_STROOPS?: string;
  /** Por debajo de este saldo de la patrocinadora (stroops), `/estado` dice `alerta:true`. */
  SALDO_ALERTA_STROOPS?: string;
  /** La comisión de inclusión por operación que ofrece el fee-bump, y lo más que se acepta que declare la transacción. */
  INCLUSION_BUMP_STROOPS?: string;
  /** Cuánto se permite declarar de recursos por encima de 1,5 veces lo que simula la red. */
  MARGEN_RECURSOS_STROOPS?: string;
  VENTANA_MAX_S?: string;
  /** Pedidos de pago por hora y por dirección, en memoria (una wifi de evento con varios organizadores comparte dirección). */
  POR_IP_POR_HORA?: string;
  /** Con `1` el portero nace apagado, aunque el objeto diga otra cosa. */
  APAGADO?: string;
}

export type NombreRed = "testnet" | "mainnet";

export interface Config {
  red: NombreRed;
  passphrase: string;
  /** El contrato oficial de la red, o null si no hay (mainnet todavía). */
  contractId: string | null;
  rpcUrls: string[];
  maxSellos: number;
  maxSellosVerificada: number;
  /** Los sorteos de un mes por cuenta: el doble de sus sellos. Sortear no se frena por el cupo de sellos. */
  maxSorteos: number;
  maxSorteosVerificada: number;
  verificadas: Set<string>;
  prueba: Set<string>;
  /**
   * Las billeteras de fondos que abren las cuentas de nuestra app. En testnet nace con la de Pollar; en mainnet
   * nace vacía y vacía no deja pasar a nadie: hay que cargar la billetera exclusiva de Tinkazo.
   */
  patrocinadoresApp: Set<string>;
  topeGeneral: number;
  topeTx: number;
  /** Por debajo de este saldo de la patrocinadora, `/estado` avisa con `alerta:true` (el paso diario de la CI lo mira). */
  saldoAlerta: number;
  /** Lo que se guarda para el `draw` de cada `seal`. Fijo: no depende de lo que declare el cliente. */
  reservaSorteo: number;
  /** La oferta de inclusión del fee-bump por operación; también el techo de lo que puede declarar la transacción interna. */
  inclusionBump: number;
  /** Margen fijo sobre 1,5 veces la simulación para los recursos declarados. */
  margenRecursos: number;
  ventanaMaxS: number;
  porIpPorHora: number;
  apagadoPorVariable: boolean;
}

/** El patrocinador que Pollar usa en testnet (medido el 20 de octubre de 2026: `num_sponsored = 2`). */
export const POLLAR_TESTNET = "GAYWGZ4P5NHJU2UL7TGWSP6ZF5BYEBZ4WP7TZDBDZ3FXUN5DHGAMDGKU";

const XLM = 10_000_000;
/** 24 horas, la ventana móvil del tope general. */
export const DIA_MS = 86_400_000;
/**
 * Cuánto vive la parte guardada para el sorteo de un sello. Pasado ese tiempo el sorteo compite
 * con lo demás por el presupuesto del día (o lo paga el navegador con la cuenta de la persona).
 */
export const RESERVA_SORTEO_MS = 6 * 3_600_000;
/**
 * Lo guardado por sello para su sorteo, en stroops: un `draw` costó 54.251 en testnet el 2 de
 * noviembre de 2026 (hash 3d0d4f9f…), más la mitad, redondeado. En mainnet se mide y se carga
 * por `RESERVA_SORTEO_STROOPS`: el alquiler de la red mueve este número.
 */
export const RESERVA_SORTEO_STROOPS = 82_000;
/** Saldo por debajo del cual se avisa: 20 XLM, más que el tope general de un día (15) para llegar a cargar antes de quedarse sin fondo. */
export const SALDO_ALERTA_STROOPS = 20 * 10_000_000;
/** La oferta de inclusión del fee-bump por operación (100 veces la base de la red). */
export const INCLUSION_BUMP_STROOPS = 10_000;
/** Recursos declarados: hasta 1,5 veces la simulación más esto. */
export const MARGEN_RECURSOS_STROOPS = 50_000;

const RPC_POR_DEFECTO: Record<NombreRed, string[]> = {
  testnet: ["https://soroban-testnet.stellar.org", "https://rpc.ankr.com/stellar_testnet_soroban"],
  mainnet: ["https://mainnet.sorobanrpc.com", "https://rpc.lightsail.network"],
};

function lista(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function entero(s: string | undefined, porDefecto: number): number {
  if (s === undefined || s.trim() === "") return porDefecto;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : porDefecto;
}

export function leerConfig(env: Partial<Env>): Config {
  const red: NombreRed = env.RED === "mainnet" ? "mainnet" : "testnet";
  const d = deployments[red] as { contractId?: string; networkPassphrase?: string } | null;
  const maxSellos = entero(env.MAX_SELLOS_MES, 20);
  const maxSellosVerificada = entero(env.MAX_SELLOS_VERIFICADA, 50);
  const rpcUrls = lista(env.RPC_URLS);
  return {
    red,
    passphrase: d?.networkPassphrase ?? (red === "mainnet" ? "Public Global Stellar Network ; September 2015" : "Test SDF Network ; September 2015"),
    contractId: d?.contractId ?? null,
    rpcUrls: rpcUrls.length ? rpcUrls : RPC_POR_DEFECTO[red],
    maxSellos,
    maxSellosVerificada,
    maxSorteos: maxSellos * 2,
    maxSorteosVerificada: maxSellosVerificada * 2,
    verificadas: new Set(lista(env.CUENTAS_VERIFICADAS)),
    // Una cuenta de prueba salta el control de "la abrió nuestra app": en mainnet no existe esa puerta, aunque la variable esté puesta.
    prueba: new Set(red === "testnet" ? lista(env.CUENTAS_PRUEBA) : []),
    patrocinadoresApp: new Set(env.PATROCINADORES_APP !== undefined ? lista(env.PATROCINADORES_APP) : red === "testnet" ? [POLLAR_TESTNET] : []),
    topeGeneral: entero(env.TOPE_GENERAL_STROOPS, 15 * XLM),
    topeTx: entero(env.TOPE_TX_STROOPS, 1 * XLM),
    saldoAlerta: entero(env.SALDO_ALERTA_STROOPS, SALDO_ALERTA_STROOPS),
    reservaSorteo: entero(env.RESERVA_SORTEO_STROOPS, RESERVA_SORTEO_STROOPS),
    inclusionBump: Math.max(1000, entero(env.INCLUSION_BUMP_STROOPS, INCLUSION_BUMP_STROOPS)),
    margenRecursos: entero(env.MARGEN_RECURSOS_STROOPS, MARGEN_RECURSOS_STROOPS),
    ventanaMaxS: entero(env.VENTANA_MAX_S, 300),
    porIpPorHora: entero(env.POR_IP_POR_HORA, 240),
    apagadoPorVariable: env.APAGADO === "1",
  };
}

/** El tope de sellos y de sorteos por mes que le toca a una cuenta. */
export function topesDeCuenta(cfg: Config, cuenta: string): { sellos: number; sorteos: number } {
  return cfg.verificadas.has(cuenta) ? { sellos: cfg.maxSellosVerificada, sorteos: cfg.maxSorteosVerificada } : { sellos: cfg.maxSellos, sorteos: cfg.maxSorteos };
}

/**
 * Una dirección IP, agrupada igual que el contador de enlaces: una IPv4 es ella
 * misma y una IPv6 es su bloque /64, porque una sola conexión reparte millones
 * de direcciones. Copia de `workers/enlaces/src/conteo.ts`: son dos scripts y no
 * comparten código.
 */
export function grupoDeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4?.[1]) return v4[1];
  const doble = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = doble && cola ? cola.split(":") : [];
  const bloques = doble ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${bloques
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** El mes UTC de un instante, `AAAA-MM`: lo único del momento que se guarda junto a la cuenta. */
export function mesUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** El primer instante del mes siguiente, en ms: cuándo se libera un cupo mensual. */
export function inicioDelMesQueViene(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
