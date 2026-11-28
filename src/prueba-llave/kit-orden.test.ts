import "./buffer-global";
import { readFileSync } from "node:fs";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { MemoryStorage, SmartAccountKit, type StoredCredential, type StoredSession } from "smart-account-kit";
import { describe, expect, it } from "vitest";
import { AlmacenConSemilla } from "./almacen-con-semilla";
import { RED_DE_PRUEBA } from "./red";
import { conNombreVisible, type ImplementacionDeWebAuthn } from "./webauthn-envoltorio";

/**
 * Con el kit de verdad, la versión exacta que fija el sitio, se vigila el orden en que se apoya la entrada con un solo
 * desbloqueo: el kit pide la llave, DESPUÉS lee el almacén y recién ahí mira la instancia en la red. Si una versión nueva
 * cambia ese orden, la pista de nacimiento no estaría a tiempo: el kit cae cerrado (sin índice no tiene de dónde sacarla)
 * y esta prueba avisa antes de que alguien lo note en pantalla.
 */

const ID = "AQIDBAUGBwgJCgsMDQ4PEA";
const RESPUESTA = { id: ID, rawId: ID, type: "public-key", clientExtensionResults: {}, response: {} } as unknown as AuthenticationResponseJSON;

describe("el orden interno del kit al entrar", () => {
  it("pide la llave, lee el almacén y recién después mira la instancia de la cuenta", async () => {
    const ordenes: string[] = [];
    const capa = new AlmacenConSemilla<StoredCredential, StoredSession>(new MemoryStorage());
    const leer = capa.get.bind(capa);
    capa.get = async (id: string) => {
      ordenes.push("get");
      return leer(id);
    };
    const impl = {
      startRegistration: async () => {
        throw new Error("no se registra");
      },
      startAuthentication: async () => {
        ordenes.push("startAuthentication");
        return RESPUESTA;
      },
    } as unknown as ImplementacionDeWebAuthn;
    const web = conNombreVisible(impl, "Llave de prueba");
    const kit = new SmartAccountKit({
      rpcUrl: RED_DE_PRUEBA.rpc,
      networkPassphrase: RED_DE_PRUEBA.passphrase,
      accountWasmHash: RED_DE_PRUEBA.codigoCuenta,
      acceptedWasmHashes: [RED_DE_PRUEBA.codigoCuenta],
      acceptedBirthWasmHashes: [RED_DE_PRUEBA.codigoCuenta],
      webauthnVerifierAddress: RED_DE_PRUEBA.verificador,
      rpId: "ejemplo.org",
      allowedOrigins: ["https://ejemplo.org"],
      storage: capa,
      indexerUrl: false,
      webAuthn: web,
    });
    // En lugar de la red, un lector que anota que lo llamaron y falla con un error que se reconoce.
    (kit.rpc as unknown as { getContractData: () => Promise<never> }).getContractData = async () => {
      ordenes.push("getContractData");
      throw new Error("centinela");
    };
    web.armar(async (r) => {
      ordenes.push("aviso");
      capa.poner({ credentialId: r.id, contractId: RED_DE_PRUEBA.contrato, birthWasmHash: RED_DE_PRUEBA.codigoCuenta, creationTransactionHash: "ab".repeat(32), creationLedger: 10 });
    });

    await expect(kit.connectWallet({ fresh: true })).rejects.toThrow(/not found on-chain/);
    expect(ordenes).toEqual(["startAuthentication", "aviso", "get", "getContractData"]);
    expect(web.autenticaciones()).toBe(1);
  });

  it("la versión del kit está fijada exacta", () => {
    const paquete = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { devDependencies: Record<string, string> };
    expect(paquete.devDependencies["smart-account-kit"]).toBe("0.10.0");
  });
});
