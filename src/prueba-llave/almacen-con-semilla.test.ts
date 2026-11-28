import { describe, expect, it } from "vitest";
import { AlmacenConSemilla, semillaDe, type AlmacenDeRegistros, type PistaDeNacimiento } from "./almacen-con-semilla";

interface Registro {
  credentialId: string;
  contractId?: string;
  deploymentStatus?: string;
  publicKey?: Uint8Array;
}

/** Un almacén de memoria que, como el del navegador, no crea nada al actualizar un registro que no existe. */
function almacenDeMemoria(): AlmacenDeRegistros<Registro, { contractId: string }> & { filas: Map<string, Registro>; llamadas: string[] } {
  const filas = new Map<string, Registro>();
  const llamadas: string[] = [];
  let sesion: { contractId: string } | null = null;
  return {
    filas,
    llamadas,
    save: async (r) => void (llamadas.push("save"), filas.set(r.credentialId, r)),
    get: async (id) => filas.get(id) ?? null,
    getByContract: async (c) => [...filas.values()].filter((r) => r.contractId === c),
    getAll: async () => [...filas.values()],
    delete: async (id) => void (llamadas.push("delete"), filas.delete(id)),
    update: async (id, cambios) => {
      llamadas.push("update");
      const previo = filas.get(id);
      if (previo) filas.set(id, { ...previo, ...cambios });
    },
    clear: async () => void filas.clear(),
    saveSession: async (s) => void (sesion = s),
    getSession: async () => sesion,
    clearSession: async () => void (sesion = null),
  };
}

const PISTA: PistaDeNacimiento = { credentialId: "cred", contractId: "CUENTA", birthWasmHash: "ab".repeat(32), creationTransactionHash: "cd".repeat(32), creationLedger: 77 };

describe("la capa con la pista de nacimiento", () => {
  it("get devuelve primero lo que hay abajo", async () => {
    const abajo = almacenDeMemoria();
    abajo.filas.set("cred", { credentialId: "cred", contractId: "OTRA", deploymentStatus: "deployed" });
    const capa = new AlmacenConSemilla(abajo);
    capa.poner(PISTA);
    expect(await capa.get("cred")).toMatchObject({ contractId: "OTRA", deploymentStatus: "deployed" });
  });

  it("sin nada abajo, get devuelve la pista, y solo para su credencial", async () => {
    const capa = new AlmacenConSemilla(almacenDeMemoria(), () => 5);
    expect(await capa.get("cred")).toBeNull();
    capa.poner(PISTA);
    expect(await capa.get("cred")).toEqual({
      credentialId: "cred",
      contractId: "CUENTA",
      createdAt: 5,
      isPrimary: true,
      birthWasmHash: PISTA.birthWasmHash,
      creationTransactionHash: PISTA.creationTransactionHash,
      creationLedger: 77,
    });
    expect(await capa.get("otra")).toBeNull();
  });

  it("actualizar un registro que solo es pista no escribe nada abajo", async () => {
    const abajo = almacenDeMemoria();
    const capa = new AlmacenConSemilla(abajo);
    capa.poner(PISTA);
    await capa.update("cred", { deploymentStatus: "pending" });
    expect(abajo.filas.size).toBe(0);
    expect(await capa.get("cred")).toMatchObject({ credentialId: "cred", creationLedger: 77 });
  });

  it("guardar el registro verificado lo escribe abajo y borra la pista", async () => {
    const abajo = almacenDeMemoria();
    const capa = new AlmacenConSemilla(abajo);
    capa.poner(PISTA);
    await capa.save({ credentialId: "cred", contractId: "CUENTA", deploymentStatus: "deployed", publicKey: new Uint8Array(65) });
    expect(capa.hayPista()).toBe(false);
    expect(abajo.filas.get("cred")?.deploymentStatus).toBe("deployed");
  });

  it("guardar otra credencial no borra la pista", async () => {
    const capa = new AlmacenConSemilla(almacenDeMemoria());
    capa.poner(PISTA);
    await capa.save({ credentialId: "otra" });
    expect(capa.hayPista()).toBe(true);
  });

  it("la pista nunca se escribe sola y quitar la borra de la memoria", async () => {
    const abajo = almacenDeMemoria();
    const capa = new AlmacenConSemilla(abajo);
    capa.poner(PISTA);
    await capa.get("cred");
    expect(abajo.llamadas).toEqual([]);
    capa.quitar();
    expect(await capa.get("cred")).toBeNull();
  });

  it("todo lo demás pasa al almacén de abajo", async () => {
    const abajo = almacenDeMemoria();
    const capa = new AlmacenConSemilla(abajo);
    await capa.saveSession({ contractId: "C" });
    expect(await capa.getSession()).toEqual({ contractId: "C" });
    await capa.save({ credentialId: "a", contractId: "C" });
    expect(await capa.getByContract("C")).toHaveLength(1);
    expect(await capa.getAll()).toHaveLength(1);
    await capa.delete("a");
    expect(await capa.getAll()).toHaveLength(0);
    await capa.clearSession();
    expect(await capa.getSession()).toBeNull();
  });
});

describe("el registro de la pista", () => {
  it("nunca trae la clave pública ni la huella de los argumentos del constructor", () => {
    // Con una clave pública el kit dejaría de leer la del nacimiento. Con la huella daría la cuenta por aprobada
    // sin comprobar el desplegador, la sal ni las políticas, y se saltearía la prueba de que la llave es de quien entra.
    const s = semillaDe(PISTA, 1);
    for (const prohibido of ["publicKey", "birthConstructorArgsHash", "deploymentStatus", "associationVerified"]) expect(s, prohibido).not.toHaveProperty(prohibido);
  });
});
