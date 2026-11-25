// El PRIMER import: el kit usa Buffer como global y los imports con efecto se evalúan en el orden escrito.
import "./buffer-global";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { RED_DE_PRUEBA } from "./red";
import type { Conexion, CreacionDeLlave, LlaveGuardada, PuenteKit } from "./puente-tipos";
import { conNombreVisible, USUARIO_DE_LA_LLAVE } from "./webauthn-envoltorio";

/**
 * El único archivo que importa el kit. Solo cruzan cadenas y números: entre el kit (que trae su propio SDK de Stellar) y
 * el resto de la prueba (que usa el del sitio) no pasa ningún objeto del SDK.
 *
 * Sin relayer, sin llave de desplegador propia y sin políticas por defecto: la cuenta nace con la llave de la persona
 * como único firmante, desde el desplegador compartido que el kit trae.
 */

const BASE_DE_LA_LLAVE = "tinkazo-prueba-llave";

export interface OpcionesDelPuente {
  /** El nombre con que se ve la llave en el aparato: depende de la lengua. */
  nombreVisible: string;
}

/** Abre el kit con la configuración fija de la prueba. */
export function abrirKit(o: OpcionesDelPuente): PuenteKit {
  const storage = new IndexedDBStorage(BASE_DE_LA_LLAVE);
  const kit = new SmartAccountKit({
    rpcUrl: RED_DE_PRUEBA.rpc,
    networkPassphrase: RED_DE_PRUEBA.passphrase,
    accountWasmHash: RED_DE_PRUEBA.codigoCuenta,
    acceptedWasmHashes: [RED_DE_PRUEBA.codigoCuenta],
    acceptedBirthWasmHashes: [RED_DE_PRUEBA.codigoCuenta],
    webauthnVerifierAddress: RED_DE_PRUEBA.verificador,
    rpId: location.hostname,
    rpName: "Tinkazo prueba",
    allowedOrigins: [location.origin],
    storage,
    indexerUrl: RED_DE_PRUEBA.indice,
    horizonUrl: RED_DE_PRUEBA.horizon,
    timeoutInSeconds: 30,
    signatureExpirationLedgers: 60,
    webAuthn: conNombreVisible({ startRegistration, startAuthentication }, o.nombreVisible),
  });

  const aConexion = (r: { credentialId: string; contractId: string }): Conexion => ({ credentialId: r.credentialId, contractId: r.contractId });
  const conPayload = (p: { func: string; auth: string[] } | undefined): { funcB64: string; authB64: string[] } => {
    if (!p) throw new Error("sin-payload-de-creacion");
    return { funcB64: p.func, authB64: p.auth };
  };

  return {
    async crearLlave(): Promise<CreacionDeLlave> {
      const r = await kit.createWallet("Tinkazo prueba", USUARIO_DE_LA_LLAVE, { autoSubmit: false, authenticatorSelection: { residentKey: "required" } });
      return { credentialId: r.credentialId, contractId: r.contractId, ...conPayload(r.relayerPayload) };
    },

    async rehacerCreacion(credentialId) {
      const r = await kit.credentials.deploy(credentialId, { autoSubmit: false });
      return { contractId: r.contractId, ...conPayload(r.relayerPayload) };
    },

    async anotarCreacion(credentialId, hash, ledger) {
      await storage.update(credentialId, {
        deploymentStatus: "deployed",
        deploymentTransactionHash: hash,
        creationTransactionHash: hash,
        creationLedger: ledger,
      });
    },

    async conectar(credentialId, contractId) {
      const r = await kit.connectWallet({ credentialId, contractId });
      if (!r) throw new Error("sin-conexion");
      return aConexion(r);
    },

    async volver() {
      const r = await kit.connectWallet();
      return r ? aConexion(r) : null;
    },

    async entrarConLlave() {
      const r = await kit.connectWallet({ fresh: true });
      if (!r) throw new Error("sin-conexion");
      return aConexion(r);
    },

    async llavesGuardadas(): Promise<LlaveGuardada[]> {
      const todas = await storage.getAll();
      return todas.map((c) => ({ credentialId: c.credentialId, contractId: c.contractId, estado: c.deploymentStatus ?? "desconocido" }));
    },

    async firmarEntrada(entradaB64, vence) {
      return kit.signAuthEntry(entradaB64, { contextRuleIds: [0], expiration: vence });
    },
  };
}
