/**
 * El mundo de las pruebas de la activación al pagar: el Worker de la sala entero (`mundo-sala.ts`) más un Horizon y un portero
 * de mentira. Nada sale a la red: el `fetch` global contesta según lo que cada prueba deje escrito acá.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@stellar/stellar-sdk/base";
import { vi } from "vitest";
import { DOLAR, comisionDe, notaDeLaComision, umbralPagado } from "../campana/comision";
import { montarMundo, personaDePrueba, type MundoDeSala, type PersonaDePrueba } from "./mundo-sala";

export const EMISOR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const PORTERO = "https://pm.tinkazo.app";
export const SECRETO_DE_SALA = "secreto-de-sala-de-prueba-0123456789";
/** La cuenta de Tinkazo que recibe la comisión: una cuenta inventada con forma válida. */
export const CUENTA_DE_COMISION = Keypair.random().publicKey();
export const LLAVE_AUTO_PRIVADA = ed25519.utils.randomSecretKey();
export const LLAVE_AUTO_HEX = Buffer.from(LLAVE_AUTO_PRIVADA).toString("hex");
export const LLAVE_AUTO_PUBLICA = Buffer.from(ed25519.getPublicKey(LLAVE_AUTO_PRIVADA)).toString("hex");
export const HORA_DE_LA_PRUEBA = Date.UTC(2026, 10, 21, 15, 0, 0);
const DIA_S = 86_400;

/** Lo que cuesta una campaña de dos premios de 50 dólares digitales con la configuración de la prueba. */
export const PREMIO = 500_000_000n;
export const COMISION_DE_DOS = comisionDe([PREMIO, PREMIO], 200n, 15_000_000n);
export const UMBRAL_DE_DOS = umbralPagado(COMISION_DE_DOS, 5_000_000n);

export interface Registro {
  from: string;
  to?: string;
  monto: string;
  nota: string;
  tipoDeNota?: string;
  cuandoS: number;
  codigo?: string;
  emisor?: string;
  exitoso?: boolean;
  tipo?: string;
}

/** Un registro de `payments?join=transactions` tal como lo devuelve Horizon. */
function registroDe(r: Registro, n: number): Record<string, unknown> {
  return {
    id: String(n),
    paging_token: String(n),
    type: r.tipo ?? "payment",
    created_at: new Date(r.cuandoS * 1000).toISOString(),
    transaction_successful: r.exitoso ?? true,
    from: r.from,
    to: r.to ?? CUENTA_DE_COMISION,
    asset_type: "credit_alphanum4",
    asset_code: r.codigo ?? "USDC",
    asset_issuer: r.emisor ?? EMISOR,
    amount: r.monto,
    transaction: { successful: r.exitoso ?? true, memo_type: r.tipoDeNota ?? "id", memo: r.nota },
  };
}

export interface HorizonFalso {
  /** De lo más nuevo a lo más viejo, como los entrega Horizon. */
  pagos: Registro[];
  /** El saldo de dólares digitales de la cuenta de quien organiza; null si la cuenta no existe. */
  saldo: string | null;
  caido: boolean;
  /** Cuántos pedidos de pagos recibió. */
  paginasPedidas: number;
  /** De qué cuentas se pidieron los pagos, en orden. */
  cuentasMiradas: string[];
  /** Si los pagos de cualquier cuenta contestan 404 (la cuenta no existe en la red). */
  pagosSinCuenta: boolean;
}

export interface PorteroFalso {
  /** Dice que sí, rechaza el secreto, no contesta, está apagado o tiene lleno el tope del día. */
  modo: "ok" | "rechaza" | "corte" | "apagado" | "cupo";
  llamadas: { cabeceras: Record<string, string>; cuerpo: unknown }[];
}

export interface MundoDeActivar {
  mundo: MundoDeSala;
  horizon: HorizonFalso;
  portero: PorteroFalso;
  /** Una persona con sesión de Google y su cuenta. */
  organizadora: PersonaDePrueba;
  /** El texto de una campaña de empresa que esa cuenta puede activar. */
  campana(cambios?: Record<string, unknown>): Record<string, unknown>;
  /** El pago que deja pagada la comisión de una campaña de dos premios. */
  pagoCompleto(evento: string, cambios?: Partial<Registro>): Registro;
  activar(cuerpo: unknown, extra?: { ip?: string; base?: string }): Promise<Response>;
}

/** Las variables que prenden la activación en el Worker de la prueba. */
export const VARIABLES_DE_ACTIVAR = {
  ACTIVAR_AL_PAGAR: "1",
  COMISION_PB: "200",
  COMISION_MINIMO: "1.50",
  COSTO_RETIRO: "0.50",
  COMISION_CUENTA: CUENTA_DE_COMISION,
  PORTERO_URL: PORTERO,
  SALA_SECRETO: SECRETO_DE_SALA,
  CAMPANAS_LLAVE_AUTO: LLAVE_AUTO_HEX,
};

/** Arma el Worker con la activación prendida, un Horizon vacío y un portero que dice que sí. `extra` pisa variables. */
export async function montarMundoDeActivar(extra: Record<string, string> = {}): Promise<MundoDeActivar> {
  const mundo = await montarMundo({ ...VARIABLES_DE_ACTIVAR, ...extra });
  const horizon: HorizonFalso = { pagos: [], saldo: "1000.0000000", caido: false, paginasPedidas: 0, cuentasMiradas: [], pagosSinCuenta: false };
  const portero: PorteroFalso = { modo: "ok", llamadas: [] };
  const organizadora = personaDePrueba(mundo, 1);
  const delProveedor = globalThis.fetch;

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    if (u.host === "horizon.stellar.org") {
      if (horizon.caido) return new Response("{}", { status: 503 });
      const ruta = decodeURIComponent(u.pathname);
      const dePagos = /^\/accounts\/(G[A-Z0-9]{55})\/payments$/.exec(ruta)?.[1];
      if (dePagos !== undefined) {
        horizon.paginasPedidas++;
        horizon.cuentasMiradas.push(dePagos);
        if (horizon.pagosSinCuenta) return new Response("{}", { status: 404 });
        // Como Horizon: los pagos en que la cuenta manda o recibe, con su número de página de siempre.
        const desde = Number(u.searchParams.get("cursor") ?? "0");
        const limite = Number(u.searchParams.get("limit") ?? "10");
        const filas = horizon.pagos
          .map((p, i) => registroDe(p, i + 1))
          .filter((r) => r.from === dePagos || r.to === dePagos)
          .filter((r) => Number(r.paging_token) > desde)
          .slice(0, limite);
        return new Response(JSON.stringify({ _embedded: { records: filas } }), { status: 200 });
      }
      const cuenta = /^\/accounts\/(G[A-Z0-9]{55})$/.exec(ruta)?.[1];
      if (cuenta !== undefined) {
        if (horizon.saldo === null) return new Response("{}", { status: 404 });
        const balances = [
          { asset_type: "native", balance: "10.0000000" },
          { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: EMISOR, balance: horizon.saldo },
        ];
        return new Response(JSON.stringify({ id: cuenta, balances }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }
    if (u.host === new URL(PORTERO).host) {
      if (portero.modo === "corte") throw new TypeError("Failed to fetch");
      const cabeceras: Record<string, string> = {};
      new Headers(init?.headers).forEach((valor, nombre) => {
        cabeceras[nombre] = valor;
      });
      const cuerpo = JSON.parse(String(init?.body)) as unknown;
      portero.llamadas.push({ cabeceras, cuerpo });
      const responder = (estado: number, x: unknown): Response => new Response(JSON.stringify(x), { status: estado });
      if (portero.modo === "rechaza") return responder(401, { motivo: "secreto" });
      if (portero.modo === "apagado") return responder(503, { motivo: "apagada" });
      // Como el portero de verdad: con el secreto bien, un cuerpo sin cuenta es 400 forma y no escribe nada.
      if (typeof cuerpo !== "object" || cuerpo === null || !("cuenta" in cuerpo)) return responder(400, { motivo: "forma" });
      if (portero.modo === "cupo") return responder(429, { motivo: "cupo", liberaEn: Date.now() + 2 * 3_600_000 });
      return responder(200, { ok: true, ya: false });
    }
    return delProveedor(url, init);
  });

  return {
    mundo,
    horizon,
    portero,
    organizadora,
    campana(cambios = {}) {
      return {
        v: 1,
        evento: "casa-andina-k7p2",
        red: "mainnet",
        estado: "abierta",
        empresa: { nombre: "Casa Andina", logo: null, color: "verde" },
        lugar: { es: "Feria del libro", en: "Book fair" },
        zona: "America/La_Paz",
        premios: [PREMIO.toString(), PREMIO.toString()],
        abre_ms: HORA_DE_LA_PRUEBA,
        cierra_ms: HORA_DE_LA_PRUEBA + 3_600_000,
        sorteo_ms: HORA_DE_LA_PRUEBA + 7_200_000,
        recibir_hasta_ms: HORA_DE_LA_PRUEBA + 30 * DIA_S * 1000,
        entrada: "google",
        pasos: [],
        bases: { es: "Participar es gratis.", en: "Taking part is free." },
        anotadas: 0,
        contrato: null,
        promo: null,
        comprobante: null,
        organizadora: organizadora.cuenta,
        ...cambios,
      };
    },
    pagoCompleto(evento, cambios = {}) {
      return {
        from: organizadora.cuenta,
        monto: `${UMBRAL_DE_DOS / DOLAR}.${(UMBRAL_DE_DOS % DOLAR).toString().padStart(7, "0")}`,
        nota: notaDeLaComision(evento),
        cuandoS: Math.floor(HORA_DE_LA_PRUEBA / 1000) - 3_600,
        ...cambios,
      };
    },
    activar(cuerpo, opciones = {}) {
      return mundo.pedir("/v1/activar", {
        cuerpo,
        ...(opciones.base ? { base: opciones.base } : {}),
        cabeceras: { "CF-Connecting-IP": opciones.ip ?? "190.129.10.20" },
      });
    },
  };
}
