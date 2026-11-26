// La línea base del protocolo y de los costos, servida por el portero para que la compare el vigilante (issue 220).
// Es la MISMA línea base que compara el detector de GitHub (scripts/vigilar-red.base.json): el archivo de siempre,
// servido a la vista, para que no haya dos copias que se desincronizan. Sin llaves: lo que da la red es público.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUTA_LINEA_BASE, atenderLineaBase } from "./linea-base";

const pedida = JSON.parse(readFileSync(new URL("../../../scripts/vigilar-red.base.json", import.meta.url), "utf8")) as {
  version: unknown;
  networks: Record<string, { params: Record<string, unknown> }>;
};

const pedir = (metodo: string) => new Request(`https://pm.tinkazo.app${RUTA_LINEA_BASE}`, { method: metodo });

/** Los 17 parámetros de costo y de ajustes que mira el detector, junto con el protocolo. */
const PARAMETROS = Object.keys(pedida.networks.mainnet!.params).filter((n) => n !== "protocol_version");

describe("la línea base en el servicio", () => {
  it("por GET devuelve exactamente el contenido que compara el detector de GitHub", async () => {
    const r = atenderLineaBase(pedir("GET"));
    expect(r.status).toBe(200);
    expect(Object.fromEntries(r.headers)["content-type"]).toContain("json");
    expect(JSON.parse(await r.text())).toEqual(pedida);
  });

  it("trae el protocolo y los 17 parámetros de las dos redes, testnet y mainnet", async () => {
    const cuerpo = (await (await atenderLineaBase(pedir("GET"))).text()) as string;
    const base = JSON.parse(cuerpo) as typeof pedida;
    expect(Object.keys(base.networks).sort()).toEqual(["mainnet", "testnet"]);
    for (const red of ["testnet", "mainnet"] as const) {
      const params = base.networks[red]!.params;
      expect(typeof params.protocol_version).toBe("number");
      expect(Object.keys(params).filter((n) => n !== "protocol_version")).toEqual(PARAMETROS);
    }
  });

  it("se puede guardar un ratito: el contenido no cambia cada segundo, solo el día que se commitea una base nueva", () => {
    const r = atenderLineaBase(pedir("GET"));
    expect(Object.fromEntries(r.headers)["cache-control"]).toBe("public, max-age=60");
  });

  it("con otro método dice que no: es de lectura y ya", () => {
    expect(atenderLineaBase(pedir("PUT")).status).toBe(405);
    expect(atenderLineaBase(pedir("POST")).status).toBe(405);
  });
});
