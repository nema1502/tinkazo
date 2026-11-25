import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDeBusqueda } from "./buscar-cuenta";
import { ErrorDeEntrada } from "./error-de-entrada";

/** El kit de mentira sigue el orden del verdadero al entrar: pide la llave, lee el almacén y recién ahí sigue. */
const mundo = vi.hoisted(() => ({
  config: null as null | { storage: Record<string, (...a: unknown[]) => Promise<unknown>>; webAuthn: { startAuthentication: (o: unknown) => Promise<{ id: string }> } },
  filas: new Map<string, Record<string, unknown>>(),
  ordenes: [] as string[],
  visto: null as Record<string, unknown> | null,
  cuenta: 1 as unknown,
  regla: { signers: [{}], policies: [], valid_until: undefined } as unknown,
  desconexiones: 0,
  errorAlConectar: null as unknown,
  sesion: null as null | { credentialId: string; contractId: string },
}));

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: async () => ({ id: "cred" }),
  startAuthentication: async () => {
    mundo.ordenes.push("llave");
    return { id: "cred" };
  },
}));

vi.mock("smart-account-kit", () => {
  class IndexedDBStorage {
    async get(id: string) {
      return mundo.filas.get(id) ?? null;
    }
    async save(r: Record<string, unknown>) {
      mundo.filas.set(String(r["credentialId"]), r);
    }
    async update(id: string, cambios: Record<string, unknown>) {
      const previo = mundo.filas.get(id);
      if (previo) mundo.filas.set(id, { ...previo, ...cambios });
    }
    async delete(id: string) {
      mundo.ordenes.push("delete");
      mundo.filas.delete(id);
    }
    async getAll() {
      return [...mundo.filas.values()];
    }
    async getByContract() {
      return [];
    }
    async clear() {}
    async saveSession() {}
    async getSession() {
      return null;
    }
    async clearSession() {}
  }
  class SmartAccountKit {
    rules = {
      count: async () => mundo.cuenta,
      get: async () => ({ result: mundo.regla }),
    };
    constructor(config: NonNullable<typeof mundo.config>) {
      mundo.config = config;
    }
    async connectWallet(o?: { fresh?: boolean; credentialId?: string; contractId?: string }) {
      if (o?.fresh) {
        const r = await mundo.config!.webAuthn.startAuthentication({ optionsJSON: {} });
        const cred = (await mundo.config!.storage["get"]!(r.id)) as Record<string, unknown> | null;
        mundo.ordenes.push("leer-almacen");
        mundo.visto = cred;
        if (mundo.errorAlConectar) throw mundo.errorAlConectar;
        if (!cred) throw new Error("sin pista");
        await mundo.config!.storage["save"]!({ ...cred, publicKey: new Uint8Array(65), deploymentStatus: "deployed" });
        return { credentialId: r.id, contractId: cred["contractId"] };
      }
      if (o?.credentialId) return { credentialId: o.credentialId, contractId: o.contractId };
      return mundo.sesion;
    }
    async disconnect() {
      mundo.desconexiones++;
    }
  }
  return { IndexedDBStorage, SmartAccountKit };
});

import { abrirKit } from "./puente-kit";

const PISTA_OK: ResultadoDeBusqueda = {
  ok: true,
  pista: { contractId: "CCUENTA", creationTransactionHash: "ab".repeat(32), creationLedger: 4242, birthWasmHash: "cd".repeat(32), fuente: "historial" },
};

function abrir(buscar: (id: string) => Promise<ResultadoDeBusqueda>, fuente: "historial" | "rpc" | null = null): ReturnType<typeof abrirKit> & { pedidos: Array<{ id: string; fuente: unknown }> } {
  const pedidos: Array<{ id: string; fuente: unknown }> = [];
  const puente = abrirKit({
    nombreVisible: "Llave de prueba",
    fuente,
    buscar: async (id, o) => {
      mundo.ordenes.push("buscar");
      pedidos.push({ id, fuente: o?.fuente });
      return buscar(id);
    },
    ahoraMs: () => 0,
  });
  return Object.assign(puente, { pedidos });
}

beforeEach(() => {
  vi.stubGlobal("location", { hostname: "ejemplo.org", origin: "https://ejemplo.org" });
  mundo.filas.clear();
  mundo.ordenes.length = 0;
  mundo.visto = null;
  mundo.cuenta = 1;
  mundo.regla = { signers: [{}], policies: [], valid_until: undefined };
  mundo.desconexiones = 0;
  mundo.errorAlConectar = null;
  mundo.sesion = null;
});

describe("entrar con una llave de otro aparato", () => {
  it("pide la llave una vez, busca la cuenta, la deja como pista para el kit y devuelve la conexión", async () => {
    const puente = abrir(async () => PISTA_OK, "rpc");
    let avisos = 0;
    const r = await puente.entrarConLlave({ alTerminarElDesbloqueo: () => void avisos++ });
    expect(mundo.ordenes).toEqual(["llave", "buscar", "leer-almacen"]);
    expect(avisos).toBe(1);
    expect(puente.pedidos).toEqual([{ id: "cred", fuente: "rpc" }]);
    expect(mundo.visto).toMatchObject({ credentialId: "cred", contractId: "CCUENTA", creationLedger: 4242, creationTransactionHash: "ab".repeat(32), birthWasmHash: "cd".repeat(32) });
    expect(mundo.visto).not.toHaveProperty("publicKey");
    expect(mundo.visto).not.toHaveProperty("birthConstructorArgsHash");
    expect(r).toEqual({ credentialId: "cred", contractId: "CCUENTA", entrada: { fuente: "historial", ledgerDeNacimiento: 4242, segundosBuscando: 0, desbloqueos: 1 } });
    // Lo verificado quedó abajo, y la pista no queda en ninguna parte.
    expect(mundo.filas.get("cred")).toMatchObject({ deploymentStatus: "deployed" });
  });

  it("si la búsqueda dice que no hay cuenta, el error llega tal cual y el kit no sigue", async () => {
    const puente = abrir(async () => ({ ok: false, motivo: "sin-cuenta", detalle: "x" }));
    const e = await puente.entrarConLlave().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorDeEntrada);
    expect((e as ErrorDeEntrada).motivo).toBe("sin-cuenta");
    expect(mundo.filas.size).toBe(0);
    expect(mundo.ordenes).not.toContain("delete");
  });

  it("si la llave ya estaba guardada en este aparato, no se busca nada", async () => {
    mundo.filas.set("cred", { credentialId: "cred", contractId: "CLOCAL", deploymentStatus: "deployed" });
    const puente = abrir(async () => PISTA_OK);
    let avisos = 0;
    const r = await puente.entrarConLlave({ alTerminarElDesbloqueo: () => void avisos++ });
    expect(puente.pedidos).toEqual([]);
    expect(avisos).toBe(0);
    expect(r).toMatchObject({ contractId: "CLOCAL", entrada: { fuente: "local", desbloqueos: 1 } });
  });

  it("si la persona cancela, el error llega igual y el aviso queda desarmado para la próxima vez", async () => {
    const cancelada = Object.assign(new Error("no"), { name: "NotAllowedError" });
    mundo.errorAlConectar = cancelada;
    const puente = abrir(async () => PISTA_OK);
    await expect(puente.entrarConLlave()).rejects.toBe(cancelada);
    mundo.errorAlConectar = null;
    // Una autenticación suelta, fuera de entrarConLlave, ya no dispara la búsqueda ni deja pistas.
    mundo.ordenes.length = 0;
    mundo.filas.clear();
    await mundo.config!.webAuthn.startAuthentication({});
    expect(mundo.ordenes).toEqual(["llave"]);
    expect(await mundo.config!.storage["get"]!("cred")).toBeNull();
  });

  it("la pista no sobrevive a la entrada aunque falle: nada se escribe abajo", async () => {
    mundo.errorAlConectar = new Error("se cortó");
    const puente = abrir(async () => PISTA_OK);
    await expect(puente.entrarConLlave()).rejects.toThrow("se cortó");
    expect(mundo.filas.size).toBe(0);
    expect(await mundo.config!.storage["get"]!("cred")).toBeNull();
  });

  it("los errores del kit se clasifican por su código", async () => {
    mundo.errorAlConectar = Object.assign(new Error("del kit"), { code: 2006, context: {} });
    const puente = abrir(async () => PISTA_OK);
    const e = await puente.entrarConLlave().catch((x: unknown) => x);
    expect((e as ErrorDeEntrada).motivo).toBe("rechazada");
    mundo.errorAlConectar = Object.assign(new Error("del kit"), { code: 2005, context: { reason: "transaction_not_found" } });
    const e2 = await puente.entrarConLlave().catch((x: unknown) => x);
    expect((e2 as ErrorDeEntrada).motivo).toBe("red");
  });
});

describe("la revisión de reglas corre en las tres formas de conectar", () => {
  const conCuentaDeMas = (): void => {
    mundo.cuenta = 2;
  };

  it("al entrar: si falla, se desconecta, se borra lo guardado y no hay conexión", async () => {
    conCuentaDeMas();
    const puente = abrir(async () => PISTA_OK);
    const e = await puente.entrarConLlave().catch((x: unknown) => x);
    expect((e as ErrorDeEntrada).motivo).toBe("firmantes");
    expect(mundo.desconexiones).toBe(1);
    expect(mundo.ordenes).toContain("delete");
    expect(mundo.filas.has("cred")).toBe(false);
  });

  it("al conectar una llave de este aparato", async () => {
    const puente = abrir(async () => PISTA_OK);
    expect(await puente.conectar("cred", "CCUENTA")).toEqual({ credentialId: "cred", contractId: "CCUENTA" });
    conCuentaDeMas();
    const e = await puente.conectar("cred", "CCUENTA").catch((x: unknown) => x);
    expect((e as ErrorDeEntrada).motivo).toBe("firmantes");
    expect(mundo.desconexiones).toBe(1);
  });

  it("al volver con la sesión guardada", async () => {
    const puente = abrir(async () => PISTA_OK);
    expect(await puente.volver()).toBeNull();
    mundo.sesion = { credentialId: "cred", contractId: "CCUENTA" };
    expect(await puente.volver()).toEqual({ credentialId: "cred", contractId: "CCUENTA" });
    mundo.regla = { signers: [{}, {}], policies: [], valid_until: undefined };
    const e = await puente.volver().catch((x: unknown) => x);
    expect((e as ErrorDeEntrada).motivo).toBe("firmantes");
  });

  it("una política o un vencimiento también la frenan", async () => {
    const puente = abrir(async () => PISTA_OK);
    mundo.sesion = { credentialId: "cred", contractId: "CCUENTA" };
    mundo.regla = { signers: [{}], policies: ["limite"], valid_until: undefined };
    await expect(puente.volver()).rejects.toBeInstanceOf(ErrorDeEntrada);
    mundo.regla = { signers: [{}], policies: [], valid_until: 99 };
    await expect(puente.volver()).rejects.toBeInstanceOf(ErrorDeEntrada);
  });
});
