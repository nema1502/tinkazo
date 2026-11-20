import deployments from "./deployments.json";
import { MAX_WINNERS } from "../protocol/select";
import { cuponDelFragmento } from "./cupon-guardado";
import { parseModeValue, type NetworkName } from "./modo-valor";

/**
 * Configuración de red. El modo se decide una sola vez al cargar la página:
 * primero manda `?red=` de la dirección, después un cupón bien formado en
 * `#cupon=`, la elección de esta pestaña, y por último el modo con el que abre
 * el sitio (`VITE_STELLAR_NETWORK`: Oficial con `mainnet` u `oficial`, Prueba sin
 * la variable). La demo y la escena fija (`?demo=`, `?pose=`) no graban nada y
 * sin otra indicación abren en Prueba, aunque el sitio abra en Oficial. Si el
 * modo elegido es Oficial pero todavía no hay contrato en la lista oficial,
 * abre en Prueba.
 *
 * La app declara contra qué contrato habla. Nunca deduce la red de la wallet:
 * si la wallet está en otra, se avisa y se bloquea el sellado.
 */

export type { NetworkName };
export { parseModeValue };

/**
 * Los puntos de entrada a la cadena, en un solo lugar.
 *
 * Estaban escritos a mano en cuatro archivos, y eso tiene dos problemas. El
 * chico es que se despegan entre ellos sin que nadie lo note. El grande es que
 * `mainnet.sorobanrpc.com` es de un tercero ·la SDF no ofrece un RPC público de
 * mainnet· y hoy es un punto único de falla para el sitio entero. El día que
 * haya que rotarlo, o poner una lista de respaldo, tiene que ser un cambio de
 * una línea y no una cacería.
 */
export const RPC_LISTAS: Record<NetworkName, readonly [string, ...string[]]> = {
  // El de la SDF y Ankr: los dos con CORS abierto, mismo ledger y mismo costo (medido el 25 de octubre de 2026).
  testnet: ["https://soroban-testnet.stellar.org", "https://rpc.ankr.com/stellar_testnet_soroban"],
  // Los mismos que vigila el detector de la red (`scripts/vigilar-red.mjs`): mainnet.sorobanrpc.com y Lightsail.
  mainnet: ["https://mainnet.sorobanrpc.com", "https://rpc.lightsail.network"],
};

/**
 * El primero de cada lista: el RPC de siempre. Lo que lee la verificación, que no
 * cambia de RPC. Quien sella usa el vigente de la lista (`rpc-red.ts`): si el
 * primero se cae, sigue con el segundo sin que nadie toque nada.
 */
export const RPC_URLS: Record<NetworkName, string> = {
  testnet: RPC_LISTAS.testnet[0],
  mainnet: RPC_LISTAS.mainnet[0],
};

/**
 * Horizon, el historial de transacciones de cada red.
 *
 * El RPC lee el estado del contrato, que vence (7 días en testnet, 120 en
 * mainnet) y cuesta mantener vivo. Horizon guarda las transacciones mientras la
 * red exista, sin renta: de ahí sale la verificación por historial
 * (`historial.ts`, docs/protocolo.md §7.1). También es de un tercero en mainnet:
 * rotarlo es un cambio de una línea, como el RPC.
 */
export const HORIZON_URLS: Record<NetworkName, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

export interface NetworkConfig {
  name: NetworkName;
  rpcUrl: string;
  networkPassphrase: string;
  /** Dirección del contrato, o null si todavía no está desplegado en esa red. */
  contractId: string | null;
  explorerBase: string;
  /** Friendbot solo existe en testnet: habilita la cuenta invitada. */
  friendbotUrl: string | null;
  /** Cuántos ganadores admite el contrato vigente de esta red (ver `topeDeLaRed`). */
  maxWinners: number;
}

/**
 * Cuántos ganadores por sorteo admite el contrato vigente de una red.
 *
 * El protocolo permite hasta `MAX_WINNERS` (300), pero cada contrato desplegado es inmutable y trae el tope de su
 * versión: el de testnet de hoy admite 32 y devolvería el error 4 con 33. Lo que cada red admite se declara en
 * `deployments.json` (`maxWinners`, en la entrada vigente), y el sitio no ofrece más que eso: así no se promete en
 * producción un tope que la red todavía no tiene. Sin el dato, vale el del protocolo, que es el del contrato que sale de
 * este repositorio: un despliegue nuevo con `MAX_WINNERS` = 300 no necesita declararlo. Nunca pasa de `MAX_WINNERS`
 * ni baja de 1.
 */
export function topeDeLaRed(despliegue: { maxWinners?: unknown } | null | undefined): number {
  const m = despliegue?.maxWinners;
  return typeof m === "number" && Number.isInteger(m) && m >= 1 ? Math.min(m, MAX_WINNERS) : MAX_WINNERS;
}

/** Mainnet en la lista oficial. Hoy es `null`: el tipo del JSON no deja leerle campos, así que se lee como lo que será. */
const mainnetEnLista = (deployments as unknown as { mainnet?: { contractId?: string; rpcUrl?: string; maxWinners?: number } | null }).mainnet;

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    rpcUrl: deployments.testnet?.rpcUrl ?? RPC_URLS.testnet,
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: deployments.testnet?.contractId ?? null,
    explorerBase: "https://stellar.expert/explorer/testnet",
    friendbotUrl: "https://friendbot.stellar.org",
    maxWinners: topeDeLaRed(deployments.testnet),
  },
  mainnet: {
    name: "mainnet",
    rpcUrl: mainnetEnLista?.rpcUrl ?? RPC_URLS.mainnet,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: mainnetEnLista?.contractId ?? null,
    explorerBase: "https://stellar.expert/explorer/public",
    friendbotUrl: null,
    maxWinners: topeDeLaRed(mainnetEnLista),
  },
};

/** La elección de modo de esta pestaña. Dura hasta cerrarla y no pasa a otra visita. */
export const MODE_STORAGE_KEY = "tinkazo.red";

export interface ModeEnvironment {
  /** La parte de la dirección donde viaja `red`, o la dirección entera. */
  search?: string | null | undefined;
  /** El fragmento de la dirección, donde puede viajar `cupon`. */
  hash?: string | null | undefined;
  /** Lo guardado para esta pestaña. */
  stored?: string | null | undefined;
  /** El modo con el que abre el sitio, como llega de la construcción. */
  build?: string | null | undefined;
  /** Si la lista oficial ya tiene contrato en la red real. */
  hasOfficialContract?: boolean | undefined;
}

const modeFromSearch = (search: string | null | undefined): NetworkName | null => {
  if (!search) return null;
  try {
    const query = search.includes("?") ? search.slice(search.indexOf("?")) : search;
    return parseModeValue(new URLSearchParams(query.split("#")[0] ?? "").get("red"));
  } catch {
    return null;
  }
};

/** Un cupón bien formado en la dirección pide Oficial, igual que `?red=oficial`. */
const modeFromCoupon = (hash: string | null | undefined): NetworkName | null => (cuponDelFragmento(hash ?? "").codigo ? "mainnet" : null);

/**
 * La demo y la escena fija nunca graban: sin `?red=` ni elección de la pestaña abren en Prueba, aunque el sitio abra en
 * Oficial. Así una demo compartida no lleva a nadie a la red principal sin que lo pida.
 */
const pideDemo = (search: string | null | undefined): boolean => {
  if (!search) return false;
  try {
    const query = search.includes("?") ? search.slice(search.indexOf("?")) : search;
    const q = new URLSearchParams(query.split("#")[0] ?? "");
    return q.has("demo") || q.has("pose");
  } catch {
    return false;
  }
};

/** Las reglas del modo, en orden, sin tocar el navegador: así se prueban. */
export function resolveNetworkName(env: ModeEnvironment = {}): NetworkName {
  const hash = env.hash ?? (env.search?.includes("#") ? env.search.slice(env.search.indexOf("#")) : null);
  // El build se lee con las mismas palabras que `?red=`. Un valor que no se entiende abre en Prueba, y el build no sale con él.
  const porDefecto: NetworkName = pideDemo(env.search) ? "testnet" : (parseModeValue(env.build) ?? "testnet");
  const chosen = modeFromSearch(env.search) ?? modeFromCoupon(hash) ?? parseModeValue(env.stored) ?? porDefecto;
  if (chosen === "mainnet" && !env.hasOfficialContract) return "testnet";
  return chosen;
}

/** La dirección para recargar en otro modo: pone `red` y conserva lo demás. Con `hash`, ese es el destino en la página. */
export function urlForMode(current: string, target: NetworkName, hash?: string): string {
  try {
    const url = new URL(current, "https://tinkazo.app/");
    url.searchParams.set("red", target === "mainnet" ? "oficial" : "prueba");
    if (hash) url.hash = hash;
    const base = current.trim().startsWith("http") ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    return base;
  } catch {
    return current;
  }
}

/** La clave del nombre visible de una red: Prueba u Oficial, nunca su nombre técnico. */
export const modeNameKey = (name: NetworkName): "netTest" | "netMain" => (name === "mainnet" ? "netMain" : "netTest");

/** De qué red es la frase que dice una billetera, o `null` si no es ninguna de las dos (o no la sabe decir). */
export const networkOfPassphrase = (passphrase: string | null | undefined): NetworkName | null =>
  passphrase === NETWORKS.mainnet.networkPassphrase ? "mainnet" : passphrase === NETWORKS.testnet.networkPassphrase ? "testnet" : null;

/** La clave del nombre visible del modo vigente. */
export const currentModeNameKey = (): "netTest" | "netMain" => modeNameKey(network.name);

function readStoredMode(): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(MODE_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStoredMode(name: NetworkName): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(MODE_STORAGE_KEY, name === "mainnet" ? "oficial" : "prueba");
  } catch {
    /* sin almacenamiento, el modo dura lo que la dirección */
  }
}

function pickNetwork(): NetworkConfig {
  let search: string | null = null;
  let hash: string | null = null;
  try {
    search = typeof location !== "undefined" ? location.search : null;
    hash = typeof location !== "undefined" ? location.hash : null;
  } catch {
    search = null;
    hash = null;
  }
  const fromUrl = modeFromSearch(search) ?? modeFromCoupon(hash);
  // Lo que trae la dirección queda guardado para esta pestaña: sobrevive a la recarga, a la ventana de Google y a quitar el cupón del fragmento.
  if (fromUrl && (fromUrl !== "mainnet" || NETWORKS.mainnet.contractId)) writeStoredMode(fromUrl);
  const name = resolveNetworkName({
    search,
    hash,
    stored: readStoredMode(),
    build: import.meta.env.VITE_STELLAR_NETWORK as string | undefined,
    hasOfficialContract: !!NETWORKS.mainnet.contractId,
  });
  return NETWORKS[name];
}

/** Si hay modo Oficial para ofrecer: la lista oficial ya tiene contrato en la red real. */
export const hayModoOficial = !!NETWORKS.mainnet.contractId;

/**
 * Cambia de modo recargando la página en la otra red. Guarda la elección para
 * esta pestaña y conserva el resto de la dirección, con `red` del modo pedido.
 * El `hash` opcional lleva a otro lugar de la página, como la herramienta.
 * Si la dirección nueva resulta igual a la actual (ya traía ese modo), recarga
 * igual: una dirección con fragmento no recarga por sí sola. Sin contrato
 * oficial no hay a dónde pasar: devuelve `false` y no toca nada. Y si la
 * recarga no se puede pedir, tampoco escribe el modo: nunca queda un cambio
 * pendiente sin recarga.
 */
export function changeMode(target: NetworkName, hash?: string): boolean {
  if (target === "mainnet" && !hayModoOficial) return false;
  try {
    if (typeof location === "undefined") return false;
    const next = urlForMode(location.href, target, hash);
    if (next === location.href) location.reload();
    else location.assign(next);
  } catch {
    return false;
  }
  writeStoredMode(target);
  return true;
}

export const network = pickNetwork();

/** Cuántos ganadores se pueden pedir en esta red: lo que admite su contrato (ver `topeDeLaRed`). */
export const topeDeGanadores = (): number => network.maxWinners;

/** El anclaje en Stellar solo se ofrece si hay contrato en la red configurada. */
export const anchoringAvailable = network.contractId !== null;

export const contractUrl = (): string => `${network.explorerBase}/contract/${network.contractId}`;
/**
 * La transacción en el explorador. Sin `red`, la de este build; un comprobante
 * puede venir de la otra red, y entonces el enlace tiene que ser el de la suya.
 */
export const txUrl = (hash: string, red: NetworkName = network.name): string => `${NETWORKS[red].explorerBase}/tx/${hash}`;
export const accountUrl = (address: string): string => `${network.explorerBase}/account/${address}`;

/** `GABC…WXYZ` para mostrar una dirección sin ocupar media pantalla. */
export const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
