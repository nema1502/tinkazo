/**
 * Lo que comparten las pruebas de la devolución de un sello que entró tarde: una red de mentira, el portero de la red
 * principal con las altas, una cuenta del libro con sus sorteos oficiales y sellos de esa cuenta. No entra en el Worker.
 */
import { Keypair, Networks } from "@stellar/stellar-sdk/base";
import deployments from "../../../src/stellar/deployments.json";
import { armar } from "./armar";
import { selloQueEntro } from "./cadena-prueba";
import { leerConfig } from "./config";
import { Cupos, type Sql } from "./cupos";
import { ErrorDeRed, type Consulta, type CuentaEnRed, type Envio, type Red, type Simulacion } from "./red";
import { ESPERA_RECONCILIAR_MS, Portero, firmanteDe } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

export const CONTRATO = deployments.testnet.contractId;
/** La ronda del sello de la noche del 13 de noviembre de 2026. */
export const RONDA = 33_939_006;

/** Una red de mentira: contesta lo que se le diga. `consultar` puede esperar a que la prueba la suelte. */
export class RedFalsa implements Red {
  simulacion: Simulacion = { ok: true, minResourceFee: 40_000 };
  cuentas = new Map<string, CuentaEnRed | null>();
  envio: Envio = { status: "PENDING" };
  consultas = new Map<string, Consulta>();
  preguntas: string[] = [];
  /** La señal con que se hizo cada pregunta: sirve para ver si se cortó lo que pasó del tope. */
  senales: Array<AbortSignal | undefined> = [];
  /** Si está, cada consulta espera a esta promesa antes de contestar. */
  frenar: Promise<void> | null = null;
  caida = false;
  async simular(): Promise<Simulacion> {
    return this.simulacion;
  }
  async leerCuenta(g: string): Promise<CuentaEnRed | null> {
    return this.cuentas.get(g) ?? null;
  }
  async enviar(): Promise<Envio> {
    return this.envio;
  }
  async consultar(hash: string, senal?: AbortSignal): Promise<Consulta> {
    this.preguntas.push(hash);
    this.senales.push(senal);
    if (this.frenar) await this.frenar;
    if (this.caida) throw new ErrorDeRed("corte");
    return this.consultas.get(hash) ?? { status: "NOT_FOUND" };
  }
}

export type Anotado = Array<{ evento: string; datos?: Record<string, string | number> }>;

/** Todo lo de una prueba, nuevo cada vez: el reloj (`ahora`, que la prueba corre a mano), la red, los cupos y el registro. */
export function escena(o: { sql?: Sql; ahora?: number } = {}) {
  const e = { ahora: o.ahora ?? Date.now(), red: new RedFalsa(), cupos: new Cupos(o.sql ?? sqlDePrueba()), anotado: [] as Anotado };
  let lista = 0;
  const registrar = (evento: string, datos?: Record<string, string | number>) => void e.anotado.push({ evento, ...(datos ? { datos } : {}) });

  /** El portero de la red principal con las altas (cada sello gasta sorteos oficiales), con la frase de testnet para firmar con llaves de prueba. */
  async function portero(env: Parameters<typeof leerConfig>[0] = {}): Promise<Portero> {
    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", MAX_SELLOS_MES: "100", ...env }), contractId: CONTRATO, passphrase: Networks.TESTNET };
    return new Portero(cfg, e.cupos, e.red, await firmanteDe(Keypair.random().secret()), Keypair.random().publicKey(), () => e.ahora, () => {}, registrar);
  }

  /** Una cuenta del libro con `sorteos` sorteos oficiales que vencen en `dias` días. */
  function admitida(sorteos: number, dias = 60): Keypair {
    const k = Keypair.random();
    e.red.cuentas.set(k.publicKey(), { patrocinador: null, balance: 100_000_000n });
    e.cupos.admitir(k.publicKey(), "cupon", e.ahora);
    e.cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:h:${k.publicKey()}`, sorteos, dias }, e.ahora);
    return k;
  }

  /** Un sello de esa cuenta, con su ronda y una lista distinta cada vez. */
  const sello = (k: Keypair, s: { ronda?: number; ganadores?: number } = {}) =>
    armar({ contrato: CONTRATO, firmante: k, ronda: BigInt(s.ronda ?? RONDA), hashLista: new Uint8Array(32).fill((++lista % 250) + 1), ...(s.ganadores ? { ganadores: s.ganadores } : {}) });

  /** Los sorteos oficiales sin usar y sin vencer de la cuenta. */
  const quedan = (k: Keypair) => e.cupos.quedan({ cuenta: k.publicKey() }, e.ahora).quedan;

  /** Lo que la red dirá de ese sello: entró `faltaban` segundos antes de su ronda y el contrato lo rechazó. */
  const entroTarde = (t: { xdr: string; hash: string }, faltaban = 25, extra: Partial<Parameters<typeof selloQueEntro>[0]> = {}) =>
    void e.red.consultas.set(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban, cobrado: 6_000, ...extra }));

  /** Pasa el tiempo para que la alarma mire lo que quedó en el aire. */
  const pasaLaEspera = () => (e.ahora += ESPERA_RECONCILIAR_MS + 1_000);

  return { e, portero, admitida, sello, quedan, entroTarde, pasaLaEspera };
}
