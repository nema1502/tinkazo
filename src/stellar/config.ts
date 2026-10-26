import deployments from "./deployments.json";

/**
 * Configuración de red. La red se elige en tiempo de build con
 * `VITE_STELLAR_NETWORK`; por defecto, testnet.
 *
 * La app declara contra qué contrato habla. Nunca deduce la red de la wallet:
 * si la wallet está en otra, se avisa y se bloquea el sellado.
 */

export type NetworkName = "testnet" | "mainnet";

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
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    rpcUrl: deployments.testnet?.rpcUrl ?? RPC_URLS.testnet,
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: deployments.testnet?.contractId ?? null,
    explorerBase: "https://stellar.expert/explorer/testnet",
    friendbotUrl: "https://friendbot.stellar.org",
  },
  mainnet: {
    name: "mainnet",
    rpcUrl: RPC_URLS.mainnet,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: null,
    explorerBase: "https://stellar.expert/explorer/public",
    friendbotUrl: null,
  },
};

function pickNetwork(): NetworkConfig {
  const raw = import.meta.env.VITE_STELLAR_NETWORK;
  const name: NetworkName = raw === "mainnet" ? "mainnet" : "testnet";
  return NETWORKS[name];
}

export const network = pickNetwork();

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
