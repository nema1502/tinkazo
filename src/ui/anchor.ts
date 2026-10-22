import { getLang, t } from "../i18n";
import { roundTime } from "../protocol/quicknet";
import { network, txUrl } from "../stellar/config";
import type { IntentoDeSello, Resolucion } from "../stellar/envio";
import type { TxArmada } from "./envio-sdk";
import { grifoApagado, grifoDisponible, hayAyudaDeFondos } from "../stellar/grifo";
import { conAyudaDeFondos, conCuentaLista, conTope, dormirCancelable, esperarCuenta, esperarHasta } from "./reintento";

export type { IntentoDeSello, Resolucion } from "../stellar/envio";

/** Lo que manda y averigua (`envio.ts`): se baja junto con el SDK, no con la página. */
const envio = (): Promise<typeof import("../stellar/envio")> => import("../stellar/envio");
/** Cómo se habla con el SDK al mandar (`envio-sdk.ts`): igual, recién cuando alguien sella o sortea. */
const sdk = (): Promise<typeof import("./envio-sdk")> => import("./envio-sdk");

/**
 * Sellar y sortear contra el contrato.
 *
 * Cada paso avisa por `onStep` para que la interfaz cuente qué está pasando:
 * una transacción que tarda sin decir nada parece una que se colgó.
 *
 * El SDK vive en un fragmento aparte, así que estas funciones lo cargan con
 * `import()` la primera vez que alguien sella de verdad.
 *
 * Cómo se manda (desde el 21 de octubre de 2026, ver `envio.ts` y la decisión
 * D-17 de docs/architecture.md): con Freighter o la cuenta de prueba se firma una
 * vez y se manda esa misma transacción hasta saber cómo terminó, sin otra ventana
 * de la billetera; con Pollar se le entrega la transacción y se pregunta por su
 * hash. Un sello del que no se sabe si entró sale como `SelloIncierto`, y
 * `freeze.ts` no manda otro sin averiguarlo.
 */

/**
 * Los pasos `preparing` y `funding` solo los ve una cuenta de Pollar (ver
 * `conFondos`): `preparing` es la espera a que la red abra la cuenta, que Pollar
 * crea de fondo después de entrar y tarda unos segundos; `funding`, la carga con
 * el grifo de testnet cuando la comisión no la paga la app. `verifying` es la
 * pregunta de si un sello que se cortó llegó a entrar; `retrying`, la espera
 * antes de volver a probar cuando la red no contestó. `starting` es lo que dice
 * el botón apenas se aprieta, antes que nada ("Preparando el sello…", ver
 * `clienteListo`).
 */
export type AnchorStep = "starting" | "simulating" | "signing" | "sending" | "confirmed" | "funding" | "preparing" | "verifying" | "retrying";

/**
 * `detail` lleva el costo estimado en el paso de firma y el hash de la
 * transacción al confirmar. Antes de firmar, quien paga la comisión tiene que
 * ver cuánto le va a salir. Con una cuenta de Pollar no hay costo que mostrar:
 * quizá la paga la app, y si no, la persona lo sabrá por la ayuda de fondos.
 */
export type OnStep = (step: AnchorStep, detail?: string) => void;

/** Fee de la transacción ya simulada, en XLM, para mostrarlo antes de firmar. */
function feeInXlm(tx: { built?: { fee?: string | number } }): string | undefined {
  const raw = tx.built?.fee;
  if (raw === undefined) return undefined;
  const stroops = Number(raw);
  if (!Number.isFinite(stroops)) return undefined;
  // Es el tope que se firma, no lo que se cobra: la red devuelve lo que no usa.
  return (stroops / 1e7).toLocaleString(getLang() === "en" ? "en-US" : "es-BO", { maximumFractionDigits: 2 }) + " XLM";
}

export interface SealArgs {
  organizer: string;
  listHash: Uint8Array;
  count: number;
  numWinners: number;
  round: number;
  meta: string;
}

export interface SealResult {
  raffleId: bigint;
  txHash: string;
}

export interface DrawResult {
  winners: number[];
  randomness: string;
  txHash: string;
}

const toHex = (b: Uint8Array | ArrayLike<number>): string =>
  [...Array.from(b as ArrayLike<number>)].map((n) => n.toString(16).padStart(2, "0")).join("");

/** Registra el sello en el contrato. Exige la firma del organizador. */
export function sealOnChain(args: SealArgs, onStep: OnStep): Promise<SealResult> {
  return conFondos(() => sellar(args, onStep), onStep);
}

/* ------------------------------------------ lo que el sello necesita antes */

/**
 * Antes de "Armando la transacción…" hay que armar el cliente del contrato
 * (`getClient`), que baja la interfaz del contrato de la red: dos consultas al
 * RPC, una detrás de la otra, y la primera vez la consulta previa de CORS. Medido
 * el 21 de octubre de 2026 en la testnet con la cuenta de prueba, del clic a
 * "Armando la transacción…": de 0,6 a 1,1 s en cinco de ocho sellos, y 5,1, 14,2
 * y 14,2 s en los otros tres, casi todo en una de esas consultas, con el botón
 * apagado y diciendo todavía "Sellar en Stellar". No lo agregó la protección contra sellos
 * duplicados (sin un intento pendiente no consulta nada): la versión de antes de
 * esa protección midió lo mismo.
 *
 * Desde ese día el botón dice "Preparando el sello…" apenas se aprieta
 * (`starting`), el cliente se arma de antemano al abrir la sesión
 * (`precalentarSello`), y `freeze.ts` elige la ronda con el cliente ya armado:
 * con 14 s de espera la ronda quedaba cerca y se pedía otra.
 *
 * Lo que se espera al cliente antes de elegir la ronda. Es `CLIENTE_VIEJO_MS` de
 * contract.ts (no se importa: traería el SDK con la página): pasado ese tiempo,
 * `sellar` pide un cliente nuevo en vez de esperar uno que quedó colgado.
 */
const ESPERA_DEL_CLIENTE_MS = 10_000;

/** Espera a que el cliente del contrato esté armado, hasta `hastaMs`. Nunca tira: si falla, `sellar` lo vuelve a pedir y su error se cuenta como siempre. */
export function clienteListo(hastaMs = ESPERA_DEL_CLIENTE_MS): Promise<void> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<void>((r) => {
    reloj = setTimeout(r, hastaMs);
  });
  const listo = import("../stellar/contract")
    .then((m) => m.getClient())
    .then(
      () => undefined,
      () => undefined,
    );
  return Promise.race([listo, tope]).finally(() => clearTimeout(reloj));
}

/**
 * Con una sesión abierta lo próximo es sellar: el cliente del contrato y lo que
 * usa el sello se bajan antes, con la página quieta (lo llama `wallet-ui.ts`). Así
 * el botón pasa enseguida a "Armando la transacción…". Nunca tira.
 */
export function precalentarSello(): void {
  void clienteListo();
  for (const m of [import("./sello-seguro"), sdk(), envio(), import("../stellar/errores")]) m.catch(() => undefined);
}

/* ------------------------------------------------- cuánto vive cada envío */

/**
 * Segundos de más para la ronda cuando hay que aprobar a mano en una billetera.
 *
 * El contrato no acepta un sello cuya ronda nazca a menos de 30 segundos del
 * ledger. Con 45 de margen y la cuenta que firma sola (Pollar, la de prueba)
 * sobra; con Freighter, entre que aparece la ventana y la persona la aprueba
 * pasan diez, veinte segundos, y el sello entraba tarde y fallaba, con la
 * comisión cobrada y otra ventana para aprobar. Con 45 más, la persona tiene
 * casi un minuto para leer y aprobar.
 */
export const MARGEN_PARA_APROBAR_S = 45;

/** La billetera activa pide aprobar cada operación a mano (Freighter): Pollar y la cuenta de prueba firman solas. */
async function apruebaAMano(): Promise<boolean> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
  const w = activeWallet();
  return !!w && w.kind === "external" && !submitsItself(w);
}

/** Lo que se suma al margen de la ronda al sellar: 45 s con Freighter, nada con las demás. */
export async function margenParaAprobar(): Promise<number> {
  return (await apruebaAMano()) ? MARGEN_PARA_APROBAR_S : 0;
}

/**
 * Cuánto vale el sello (`timeoutInSeconds`): hasta 15 segundos después de que el
 * contrato ya no lo aceptaría (`round_time - 30`). Más tarde no tiene sentido:
 * entraría al ledger y fallaría, con la comisión cobrada. Así la red lo descarta
 * gratis y "venció" llega antes. Antes valía cinco minutos.
 *
 * El SDK fija el vencimiento al firmar (Freighter: cuando aparece la ventana), así
 * que con aprobación a mano queda un poco más tarde, nunca antes.
 */
export function vidaDelSello(round: number, ahoraS = Date.now() / 1000): number {
  return Math.max(20, Math.round(roundTime(round) - 15 - ahoraS));
}

/**
 * Cuánto vale el sorteo: un minuto si la cuenta firma sola, tres si hay que
 * aprobar a mano. Un sorteo que entra tarde no hace daño (el contrato acepta uno
 * solo y el resultado es el mismo), pero la sala está mirando: más que eso es
 * una ventana abierta de más.
 */
async function vidaDelSorteo(): Promise<number> {
  return (await apruebaAMano()) ? 180 : 60;
}

/**
 * Después de aprobar, cuántos segundos tienen que faltar para que valga la pena
 * mandar el sello: 30 que pide el contrato más lo que tarda en entrar. Con
 * menos, entraría y fallaría: mejor no mandarlo y pedir otra ronda.
 */
const MARGEN_AL_MANDAR_S = 35;

/**
 * Cuánto se espera, ya mandada la transacción, sin poder hablar con la red antes
 * de decir que no se sabe. Con el sello, después viene la pregunta de si entró
 * (otro tanto como mucho): medido el 21 de octubre de 2026 en la testnet, con la
 * red cortada justo después de mandar, eran 69 segundos hasta el mensaje con 30
 * y 30; con 20 y 20, unos 45. Con el sorteo la sala está mirando, y `draw.ts`
 * vuelve a probar (es seguro): 15.
 */
const SIN_RED_SELLO_MS = 20_000;
const SIN_RED_SORTEO_MS = 15_000;

/**
 * Cuántos segundos tienen que faltar para que nazca la ronda al empezar a armar
 * el sello.
 *
 * El contrato rechaza (`RoundTooSoon`, #5) una ronda que nazca a menos de 30 s de
 * cuando la transacción entra a un ledger. `freeze.ts` elige la ronda con 45 s de
 * margen al hacer clic, y de ahí salen unos segundos para simular, firmar y
 * entrar. Si antes se esperó a que Pollar abriera la cuenta, el margen se come: la
 * simulación todavía pasa (mira el último ledger, unos segundos atrás) y la
 * transacción entra al ledger y falla. Se vio el 20 de octubre de 2026 con una
 * cuenta nueva: costó una comisión y unos veinte segundos. Con menos de esto se
 * pide otra ronda antes de mandar nada.
 */
const MARGEN_DE_RONDA_S = 40;

/**
 * La ronda ya no alcanza. Es el mismo caso que el contrato rechaza con `RoundTooSoon`
 * (#5), y por eso lleva ese texto: `selloSinGrabar` lo reconoce y `freeze.ts` reintenta
 * con una ronda nueva, sin que haya quedado nada en la cadena; si fuera lo último que
 * pasa, `errorKey` lo cuenta como "esa ronda está demasiado cerca".
 */
class RondaMuyCerca extends Error {
  constructor(faltan: number) {
    super(`la ronda quedó cerca antes de mandar el sello (faltan ${Math.max(0, Math.round(faltan))} s): Error(Contract, #5)`);
    this.name = "RondaMuyCerca";
  }
}

async function sellar(args: SealArgs, onStep: OnStep): Promise<SealResult> {
  const [{ getClient }, { armar, submitElsewhere, firmarYConfirmar, valorNativo, errorDelDesenlace }] = await Promise.all([import("../stellar/contract"), sdk()]);
  const client = await armar(() => getClient());
  const faltan = roundTime(args.round) - Date.now() / 1000;
  if (faltan < MARGEN_DE_RONDA_S) throw new RondaMuyCerca(faltan);
  onStep("simulating");
  const tx: TxArmada = await armar(() =>
    client.seal(
      {
        organizer: args.organizer,
        list_hash: args.listHash as unknown as Buffer,
        count: args.count,
        num_winners: args.numWinners,
        round: BigInt(args.round),
        meta: args.meta.slice(0, 160),
      },
      { timeoutInSeconds: vidaDelSello(args.round) },
    ),
  );
  onStep("signing", await costoVisible(tx));
  // Desde acá, lo que se manda puede entrar: si no se sabe cómo terminó, es un `SelloIncierto`.
  const intento: IntentoDeSello = {
    organizer: args.organizer,
    listHash: toHex(args.listHash),
    round: args.round,
    count: args.count,
    numWinners: args.numWinners,
    meta: args.meta.slice(0, 160),
    desde: Math.floor(Date.now() / 1000),
  };

  const delegated = await submitElsewhere(tx, onStep, SIN_RED_SELLO_MS, intento);
  if (delegated) {
    return { raffleId: unwrap<bigint>(delegated.value), txHash: delegated.hash };
  }

  const { hash, desenlace } = await firmarYConfirmar(tx, onStep, SIN_RED_SELLO_MS, () => {
    // Recién aprobado (con Freighter puede haber pasado un rato): si la ronda ya
    // no alcanza, no se manda. Entraría y fallaría, con la comisión cobrada.
    const quedan = roundTime(args.round) - Date.now() / 1000;
    if (quedan < MARGEN_AL_MANDAR_S) throw new RondaMuyCerca(quedan);
  });
  if (desenlace.estado === "entro") {
    let raffleId: bigint;
    try {
      raffleId = unwrap<bigint>(await valorNativo(desenlace.valor));
    } catch (sinValor) {
      // Entró, y no se pudo leer el número que devolvió: no es una falla que se
      // arregle con otra ronda (eso dejaría dos sellos). El número lo dice el contrato.
      throw new (await envio()).SelloIncierto({ ...intento, hash }, sinValor);
    }
    onStep("confirmed", hash);
    return { raffleId, txHash: hash };
  }
  if (desenlace.estado === "sin-respuesta") throw new (await envio()).SelloIncierto({ ...intento, hash }, desenlace.error);
  throw errorDelDesenlace(desenlace);
}

/**
 * El costo que se le muestra a quien firma. Con una cuenta de Pollar no se
 * muestra: puede que la comisión la pague la app y entonces es cero, y un
 * número que quizá paga otro asusta a quien solo quiere sortear. Con las demás
 * wallets es el de siempre, porque ahí lo paga quien firma.
 */
async function costoVisible(tx: Parameters<typeof feeInXlm>[0]): Promise<string | undefined> {
  // Justo antes del paso de firmar: de quién firma dependen el costo y cómo se dice el paso.
  const { mandaSola } = await quienFirma();
  return mandaSola ? undefined : feeInXlm(tx);
}

/**
 * La cuenta que sella o sortea firma sin abrir ninguna ventana.
 *
 * "Aprobá la operación en tu billetera…" solo tiene sentido si se abre una
 * billetera para aprobar: Freighter. La cuenta de prueba firma en el navegador
 * y Pollar firma y manda desde su servidor, sin ninguna ventana; con ellas la
 * pantalla decía "Aprobá…" y "Comisión de la red: hasta 0,81 XLM" durante unos
 * doce segundos, y la persona buscaba una ventana que no existía (buscador de
 * detalles, D05; medido el 21 de octubre de 2026 con la cuenta de prueba: de
 * los 2,7 a los 9,4 s del sello). Con ellas, el paso de firmar se dice como lo
 * que es, "Mandando a la red…", sin el costo ni la palabra XLM (docs/ux.md,
 * §7). Con Freighter sigue igual, con la comisión, que paga quien aprueba.
 *
 * Los pasos (`AnchorStep`) no cambian: cambia cómo se dicen (`stepLabel`,
 * `showTxStatus`). Hasta saber qué cuenta es, se supone Freighter: decir
 * "Aprobá" de más confunde menos que no decirlo con una ventana esperando.
 */
let firmaSinVentana = false;

/**
 * Mira qué cuenta va a firmar y lo anota (`firmaSinVentana`). Lo llama
 * `costoVisible`, justo antes del paso de firmar. Devuelve si es de las que
 * firman y mandan solas (Pollar), que no muestran la comisión.
 */
export async function quienFirma(): Promise<{ mandaSola: boolean }> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([
    import("../stellar/wallet-lite"),
    import("../stellar/wallet-pollar"),
  ]);
  const w = activeWallet();
  const mandaSola = submitsItself(w);
  firmaSinVentana = !!w && (w.kind === "guest" || mandaSola);
  return { mandaSola };
}

/** Cuándo se le pidió fondos al grifo a cada cuenta, para no insistir. */
const grifoPedido = new Map<string, number>();
const ENTRE_PEDIDOS_MS = 90_000;

/**
 * Sellar y sortear con una cuenta de Pollar no debe trabar a nadie.
 *
 * Primero, que la cuenta exista. Pollar la abre en la red de fondo después de
 * entrar y tarda de 5 a 62 segundos: antes de simular se espera a que aparezca
 * (hasta 90 s, con la línea "Preparando tu cuenta…") y nunca se la confunde con
 * una cuenta sin saldo. Si pasan los 90 segundos, se le dice que todavía no está
 * lista y que pruebe de nuevo.
 *
 * Después se intenta como siempre. Si Pollar paga la comisión por la app (con la
 * regla de contrato de su panel prendida) no pasa nada más. Si no la paga y la
 * red dice que la cuenta no tiene con qué, en testnet se la carga sola con el
 * grifo y se reintenta una vez, con una línea de estado y sin que la persona
 * toque nada. Lo que no se puede resolver solo avisa con el evento
 * `tinkazo:sin-fondos` y la pantalla muestra la caja de fondos como último
 * recurso, pero solo en testnet y con el grifo prendido: en mainnet no hay grifo
 * y la persona ve el error de falta de saldo, tal cual.
 *
 * Con otra wallet no cambia nada.
 */
async function conFondos<T>(intento: () => Promise<T>, onStep: OnStep): Promise<T> {
  const [w, { submitsItself }, contrato] = await Promise.all([
    import("../stellar/wallet-lite"),
    import("../stellar/wallet-pollar"),
    import("../stellar/contract"),
  ]);
  const wallet = w.activeWallet();
  const address = wallet?.address ?? "";
  const esPollar = submitsItself(wallet);
  // Si la persona cierra la sesión o cambia de cuenta mientras se espera, se deja de esperar.
  const sesion = esPollar ? cancelarSiCambiaLaSesion(address) : null;
  // El sorteo reintenta varias veces y cada una pasaría por acá: un pedido al
  // grifo cada tanto alcanza, más no cambia nada.
  const reciente = Date.now() - (grifoPedido.get(address) ?? 0) < ENTRE_PEDIDOS_MS;
  const cuentaLista = (): Promise<T> =>
    conCuentaLista(intento, {
      esPollar,
      esperar: (hastaMs) =>
        esperarCuenta({
          existe: () => contrato.accountOnRpc(address),
          alEsperar: () => onStep("preparing"),
          hastaMs,
          ...(sesion ? { signal: sesion.signal } : {}),
        }),
      noExiste: contrato.esCuentaInexistente,
      respirar: (ms) => dormirCancelable(ms, sesion?.signal),
    });
  try {
    return await conAyudaDeFondos(cuentaLista, {
      esPollar,
      // Con `?grifo=0` no hay grifo aunque sea testnet: la persona ve el error tal cual.
      hayGrifo: grifoDisponible() && !reciente,
      sinSaldo: contrato.esSinSaldo,
      avisar: () => {
        console.warn("[tinkazo] la cuenta no tiene con qué pagar la comisión: se la carga con el grifo y se reintenta una vez");
        onStep("funding");
      },
      cargar: async () => {
        grifoPedido.set(address, Date.now());
        // Con tope: el grifo a veces no contesta, y el sellado no puede quedarse
        // esperándolo para siempre. Si no llega, se sigue con el último recurso.
        await conTope(w.fundWithFriendbot(address), 20_000, "friendbot-timeout");
      },
      esperar: async () => {
        // El grifo ya contestó, pero el saldo tarda un instante en verse. Y un
        // respiro más: el RPC, que es el que simula, puede ir un poco atrás de
        // Horizon, que es al que se le pregunta.
        const visto = await esperarHasta(async () => (await w.xlmBalance(address)) >= 1, { cadaMs: 700, hastaMs: 10_000 });
        if (visto) await new Promise((r) => setTimeout(r, 800));
      },
      sinRecurso: () => {
        // La caja de fondos de último recurso es la del grifo: en mainnet no existe
        // (quien entra con Google o con un correo nunca ve una caja que le pide
        // XLM), y con `?grifo=0` quien prueba quiere ver el error y nada más.
        if (!hayAyudaDeFondos(network.name, grifoApagado)) return;
        if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("tinkazo:sin-fondos", { detail: { address } }));
      },
    });
  } finally {
    sesion?.soltar();
  }
}

/**
 * Un `AbortSignal` que se dispara cuando la sesión deja de ser de `address`: se
 * cerró, o se entró con otra cuenta. La pantalla avisa cada vez que se repinta
 * con `tinkazo:sesion` (y lo hace también al cambiar de idioma, con la misma
 * cuenta: ahí no se cancela nada).
 */
function cancelarSiCambiaLaSesion(address: string): { signal: AbortSignal; soltar: () => void } {
  const control = new AbortController();
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return { signal: control.signal, soltar: () => undefined };
  }
  const alCambiar = (e: Event): void => {
    if ((e as CustomEvent<string | null>).detail !== address) control.abort();
  };
  document.addEventListener("tinkazo:sesion", alCambiar);
  return { signal: control.signal, soltar: () => document.removeEventListener("tinkazo:sesion", alCambiar) };
}

/**
 * Finaliza el sorteo en el contrato con la firma de la ronda. No exige
 * autorización del organizador: cualquiera puede hacerlo una vez que la ronda
 * existe, así que el organizador no puede retener un resultado que no le gusta.
 *
 * Reintentarlo siempre es seguro: el contrato acepta un solo sorteo por sello
 * (`AlreadyDrawn`) y el resultado no depende de quién ni cuándo lo manda. Los
 * reintentos los hace `draw.ts`, que antes de cada uno mira si ya está.
 */
export function drawOnChain(
  raffleId: bigint,
  signature96: Uint8Array,
  onStep: OnStep,
): Promise<DrawResult> {
  return conFondos(() => sortear(raffleId, signature96, onStep), onStep);
}

async function sortear(raffleId: bigint, signature96: Uint8Array, onStep: OnStep): Promise<DrawResult> {
  const [{ getClient }, { armar, submitElsewhere, firmarYConfirmar, valorNativo, errorDelDesenlace }] = await Promise.all([import("../stellar/contract"), sdk()]);
  const client = await armar(() => getClient());
  onStep("simulating");
  const vida = await vidaDelSorteo();
  const tx: TxArmada = await armar(() =>
    client.draw(
      {
        raffle_id: raffleId,
        signature: signature96 as unknown as Buffer,
      },
      { timeoutInSeconds: vida },
    ),
  );
  onStep("signing", await costoVisible(tx));

  const delegated = await submitElsewhere(tx, onStep, SIN_RED_SORTEO_MS);
  if (delegated) {
    const d = unwrap<{ winners: number[]; randomness: Uint8Array }>(delegated.value);
    return { winners: [...d.winners], randomness: toHex(d.randomness), txHash: delegated.hash };
  }

  const { hash, desenlace } = await firmarYConfirmar(tx, onStep, SIN_RED_SORTEO_MS);
  if (desenlace.estado === "entro") {
    const draw = unwrap<{ winners: number[]; randomness: Uint8Array }>(await valorNativo(desenlace.valor));
    onStep("confirmed", hash);
    return { winners: [...draw.winners], randomness: toHex(draw.randomness), txHash: hash };
  }
  // Con el hash, para "Ver detalle": es lo que sirve para buscarla en el explorador.
  if (desenlace.estado === "sin-respuesta") throw Object.assign(new Error("sin-confirmar", { cause: desenlace.error }), { txHash: hash });
  throw errorDelDesenlace(desenlace);
}

/**
 * Averigua si un sello que se cortó entró (`resolverSello`), con la red de
 * testigo: la hora de cierre del último ledger, el contrato y, si se sabe, el
 * hash de su transacción.
 */
export async function resolverSelloEnLaRed(intento: IntentoDeSello, onStep?: OnStep): Promise<Resolucion> {
  return (await sdk()).resolverSelloEnLaRed(intento, onStep);
}

/** Lee un sorteo ya registrado. Sirve para reanudar y para `AlreadyDrawn`. */
export async function readDraw(
  raffleId: bigint,
): Promise<{ winners: number[]; randomness: string } | null> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  const res = await client.get_draw({ raffle_id: raffleId });
  const d = res.result;
  if (!d) return null;
  return { winners: [...d.winners], randomness: toHex(d.randomness as unknown as Uint8Array) };
}

/** Los métodos que devuelven `Result` traen un envoltorio con `unwrap`. */
function unwrap<T>(value: unknown): T {
  if (value && typeof value === "object" && "unwrap" in value) {
    return (value as { unwrap(): T }).unwrap();
  }
  return value as T;
}

/* --------------------------------------------------------------- interfaz */

/** La clave de cada paso. Firmar se dice según quién firma (ver `quienFirma`). */
const CLAVE_DEL_PASO: Record<Exclude<AnchorStep, "signing">, string> = {
  starting: "txStarting",
  simulating: "txSimulating",
  sending: "txSending",
  confirmed: "txConfirmed",
  funding: "txFunding",
  preparing: "txPreparing",
  verifying: "txVerifying",
  retrying: "txRetrying",
};

/** Texto de cada paso, para el botón y la línea de estado. */
export function stepLabel(step: AnchorStep): string {
  return t(step === "signing" ? (firmaSinVentana ? "txSending" : "txSigning") : CLAVE_DEL_PASO[step]);
}

/**
 * Línea de estado bajo el botón. Al confirmarse deja el enlace a la
 * transacción en el explorador, que es lo que el organizador va a compartir.
 */
export function showTxStatus(containerId: string, step: AnchorStep, detail?: string): void {
  const host = document.getElementById(containerId);
  if (!host) return;
  limpiarDetalle(containerId);
  host.style.display = "block";
  host.className = step === "confirmed" ? "txstatus ok" : "txstatus";
  host.textContent = stepLabel(step);
  if (step === "signing" && detail && !firmaSinVentana) {
    // El costo antes de firmar, no después. Solo a quien aprueba en su billetera.
    host.textContent = `${stepLabel(step)} ${t("txCost")} ${detail}`;
    return;
  }
  const txHash = step === "confirmed" ? detail : undefined;
  if (step === "confirmed" && txHash) {
    host.textContent = stepLabel(step) + " ";
    const a = document.createElement("a");
    a.href = txUrl(txHash);
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "mono";
    a.textContent = `${txHash.slice(0, 8)}… ↗`;
    host.appendChild(a);
    const net = document.createElement("span");
    net.className = "kicker";
    net.style.marginLeft = "8px";
    net.textContent = network.name;
    host.appendChild(net);
  }
}

export function hideTxStatus(containerId: string): void {
  const host = document.getElementById(containerId);
  if (host) host.style.display = "none";
  limpiarDetalle(containerId);
}

/** Saca el detalle plegado de un error anterior (`detalle-error.ts`): ya no es de lo que se ve. */
export function limpiarDetalle(containerId: string): void {
  document.getElementById(`${containerId}-detalle`)?.remove();
}

/**
 * Si el sello falló sin dejar nada en la cadena, de una forma que se arregla con
 * otra ronda: la ronda quedó demasiado cerca (el contrato devuelve el error 5 al
 * simular), la transacción entró y falló, venció sin entrar, o la red la rechazó
 * al recibirla por la secuencia o por tarde. En todos reintentar no puede dejar
 * dos sellos. Un corte de red o una respuesta que no llegó no entran: ahí no se
 * sabe si el primero quedó grabado, y eso es un `SelloIncierto`.
 *
 * "Entró y falló" se lee distinto según la wallet: "Transaction failed!" y
 * `tx-FAILED` salen del SDK de Stellar y de esta capa, y Pollar lo cuenta como
 * `txFailed` o, desde su API, `TX_CONTRACT_FAILED`. Sin el de Pollar, quien entra
 * con Google veía "la red rechazó la transacción" y tenía que apretar de nuevo a
 * mano, y el reintento con el grifo, que suma unos segundos, hace que la ronda
 * quede cerca más seguido.
 */
export function selloSinGrabar(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Error\(Contract,\s*#5\)|Transaction failed!|tx-FAILED|txFailed|tx_failed|TX_CONTRACT_FAILED|tx-EXPIRED|tx_?bad_?seq|TX_BAD_SEQUENCE|tx_?too_?late/i.test(msg);
}

/**
 * Mensaje de error de una invocación, ya traducido. Clasifica sin el SDK de
 * Stellar (`errores.ts`): si la red se cayó antes de bajarlo, igual se dice qué
 * pasó. Una clave sin texto cae en el mensaje genérico, nunca en la clave cruda.
 */
export async function anchorErrorText(e: unknown): Promise<string> {
  try {
    const { errorKey } = await import("../stellar/errores");
    const clave = "errAnchor." + errorKey(e);
    const texto = t(clave);
    return texto && texto !== clave ? texto : t("errAnchor.unknown");
  } catch {
    return sinConexion();
  }
}

/**
 * Si ni siquiera se pudo bajar el módulo que clasifica el error, es que no hay
 * conexión: la página no alcanza ni sus propios archivos. Se dice eso, con lo
 * que ya está en la página.
 */
const sinConexion = (): string =>
  t(typeof navigator !== "undefined" && navigator.onLine === false ? "errAnchor.offline" : "errAnchor.rpcDown");

/**
 * Escribe el error en `status`, con el detalle plegado debajo (`detalle-error.ts`).
 * Si el detalle no se puede bajar (sin conexión, con la página a medio cargar),
 * igual queda el mensaje: medido el 21 de octubre de 2026 con DevTools sin red,
 * sin esto el sellado terminaba sin decir nada.
 */
export async function escribirError(status: HTMLElement, e: unknown, paso: "sello" | "sorteo"): Promise<void> {
  try {
    await (await import("./detalle-error")).mostrarError(status, e, paso);
  } catch {
    limpiarDetalle(status.id);
    status.textContent = sinConexion();
  }
}

/**
 * Lo que hace falta para contar un error del sorteo, bajado de antemano: el
 * sorteo es frente a la sala, y el wifi de un evento se cae justo ahí. Se pide
 * con el sello ya hecho, que es cuando seguro hubo conexión.
 */
export function precargarParaElSorteo(): void {
  for (const m of [import("./sorteo-seguro"), import("./detalle-error"), import("../stellar/errores")]) m.catch(() => undefined);
}
