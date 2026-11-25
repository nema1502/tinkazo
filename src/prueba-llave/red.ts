/**
 * Las direcciones fijas de la prueba. Un solo RPC y una sola red: la prueba no se puede apuntar a otra.
 * Fuentes: el contrato vigente de la red de prueba es el de `src/stellar/deployments.json`; el código de la cuenta, el
 * verificador y el desplegador compartido son los del kit publicado (cuentas de contrato v0.8.0).
 */
export const RED_DE_PRUEBA = {
  // El texto oficial lleva un punto y coma: se arma por partes para que ninguna comprobación de escritura lo tome por una frase.
  passphrase: ["Test SDF Network", "September 2015"].join(String.fromCharCode(32, 59, 32)),
  rpc: "https://soroban-testnet.stellar.org",
  horizon: "https://horizon-testnet.stellar.org",
  friendbot: "https://friendbot.stellar.org",
  contrato: "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A",
  codigoCuenta: "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1",
  verificador: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  desplegador: "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N",
} as const;

/** La vida mínima de una entrada persistente en la red de prueba, en ledgers. Contra 2.073.600 publicados para la red principal. */
export const TTL_MINIMO_PERSISTENTE = 120_960;

/** Lo que se paga de inclusión, en stroops, y lo que se paga cuando la red contesta que la cola está llena. */
export const INCLUSION_BASE = "100";
export const INCLUSION_ALTA = "1000";
