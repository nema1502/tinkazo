// Un RPC de Soroban falso para probar `scripts/vigilar-red.mjs` como proceso, sin red y sin tocar el guion:
//
//   node --import ./scripts/lib/vigilar-red-rpc-falso.mjs scripts/vigilar-red.mjs --anterior f.json --guardar f.json
//
// Reemplaza `globalThis.fetch` antes de que el guion arranque y contesta lo que contestaría cada red (la
// de testnet si el host de la URL lo dice, la de mainnet si no) con lo que dice la línea base commiteada,
// o sea, «la red no cambió»: sigue valiendo cuando la base se actualiza. VIGILAR_FALSO_CAMBIOS, un JSON,
// cambia parámetros de una red; el protocolo también:
//
//   {"testnet": {"contract_max_size_bytes": 1, "protocol_version": 30}}
//
// El estado vivo es siempre de 1.000 MB, normal en las dos redes. Solo lo usa `vigilar-red.test.mjs`.

import { readFileSync } from "node:fs";

const base = JSON.parse(readFileSync(new URL("../vigilar-red.base.json", import.meta.url), "utf8"));
const cambios = JSON.parse(process.env.VIGILAR_FALSO_CAMBIOS || "{}");

const LEDGER = 100_000;
const HORA = 1_792_977_800; // la hora de cierre del ledger, en segundos
const BYTES_DEL_ESTADO = 1_000_000_000;

/** Un ajuste de configuración como lo devuelve `getLedgerEntries` con `xdrFormat: "json"`. */
const ajuste = (nombre, valor) => ({
  keyJson: { config_setting: { config_setting_id: nombre } },
  dataJson: { config_setting: { [nombre]: valor } },
  lastModifiedLedgerSeq: 1_000,
});

function responder(red, metodo) {
  const params = { ...structuredClone(base.networks[red].params), ...cambios[red] };
  if (metodo === "getLatestLedger") {
    return { sequence: LEDGER, protocolVersion: params.protocol_version, closeTime: String(HORA) };
  }
  if (metodo === "getLedgerEntries") {
    // El protocolo no es un ajuste: llega con el último ledger.
    const { protocol_version: _protocolo, ...ajustes } = params;
    return {
      latestLedger: LEDGER,
      entries: [
        ...Object.entries(ajustes).map(([nombre, valor]) => ajuste(nombre, valor)),
        ajuste("live_soroban_state_size_window", Array.from({ length: 30 }, () => String(BYTES_DEL_ESTADO))),
        ajuste("eviction_iterator", { bucket_list_level: 9 }),
      ],
    };
  }
  if (metodo === "getLedgers") {
    return {
      ledgers: [
        {
          sequence: LEDGER - 17_280,
          ledgerCloseTime: String(HORA - 86_400),
          metadataJson: { v2: { total_byte_size_of_live_soroban_state: String(BYTES_DEL_ESTADO) } },
        },
      ],
    };
  }
  throw new Error(`método inesperado ${metodo}`);
}

globalThis.fetch = async (url, init) => {
  const red = new URL(url).host.includes("testnet") ? "testnet" : "mainnet";
  const { method } = JSON.parse(init.body);
  const texto = JSON.stringify({ jsonrpc: "2.0", id: 1, result: responder(red, method) });
  return { ok: true, status: 200, text: async () => texto };
};
