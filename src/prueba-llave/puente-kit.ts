// El PRIMER import: el kit usa Buffer como global y los imports con efecto se evalúan en el orden escrito.
import "./buffer-global";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { IndexedDBStorage, SmartAccountKit, type StoredCredential, type StoredSession } from "smart-account-kit";
import { AlmacenConSemilla } from "./almacen-con-semilla";
import { buscarNacimiento, type Fuente } from "./buscar-cuenta";
import { clasificarErrorDelKit, ErrorDeEntrada } from "./error-de-entrada";
import { RED_DE_PRUEBA } from "./red";
import { revisarReglas } from "./reglas";
import type { Conexion, CreacionDeLlave, DatosDeEntrada, LlaveGuardada, PuenteKit } from "./puente-tipos";
import { conNombreVisible, USUARIO_DE_LA_LLAVE } from "./webauthn-envoltorio";

/**
 * El único archivo que importa el kit. Solo cruzan cadenas y números: entre el kit (que trae su propio SDK de Stellar) y
 * el resto de la prueba (que usa el del sitio) no pasa ningún objeto del SDK.
 *
 * Sin relayer, sin llave de desplegador propia y sin políticas por defecto: la cuenta nace con la llave de la persona
 * como único firmante, desde el desplegador compartido que el kit trae. Sin índice ajeno: al entrar desde otro aparato la
 * página busca el nacimiento de la cuenta en la red y se lo deja al kit como pista, y el kit la verifica entera.
 */

const BASE_DE_LA_LLAVE = "tinkazo-prueba-llave";

export interface OpcionesDelPuente {
  /** El nombre con que se ve la llave en el aparato: depende de la lengua. */
  nombreVisible: string;
  /** Si se pide una sola fuente para buscar el nacimiento. Sin valor se prueba el historial y después el RPC. */
  fuente?: Fuente | null;
  /** Solo para pruebas. */
  buscar?: typeof buscarNacimiento;
  ahoraMs?: () => number;
}

/** Abre el kit con la configuración fija de la prueba. */
export function abrirKit(o: OpcionesDelPuente): PuenteKit {
  const base = new IndexedDBStorage(BASE_DE_LA_LLAVE);
  const storage = new AlmacenConSemilla<StoredCredential, StoredSession>(base);
  const web = conNombreVisible({ startRegistration, startAuthentication }, o.nombreVisible);
  const buscar = o.buscar ?? buscarNacimiento;
  const ahoraMs = o.ahoraMs ?? ((): number => Date.now());
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
    // Sin índice ajeno: la pista de nacimiento sale de la red y la verifica el kit.
    indexerUrl: false,
    horizonUrl: RED_DE_PRUEBA.horizon,
    timeoutInSeconds: 30,
    signatureExpirationLedgers: 60,
    webAuthn: web,
  });

  const aConexion = (r: { credentialId: string; contractId: string }): Conexion => ({ credentialId: r.credentialId, contractId: r.contractId });
  const conPayload = (p: { func: string; auth: string[] } | undefined): { funcB64: string; authB64: string[] } => {
    if (!p) throw new Error("sin-payload-de-creacion");
    return { funcB64: p.func, authB64: p.auth };
  };

  /**
   * La revisión de reglas propia, más estricta que la del kit: una regla en toda la historia, un firmante y ninguna política.
   * Corre en las tres formas de conectar y antes de que el flujo reciba la cuenta. Si no se cumple, se desconecta, se borra
   * lo guardado de esa llave y no hay conexión.
   */
  const revisada = async (r: { credentialId: string; contractId: string }): Promise<Conexion> => {
    const veredicto = revisarReglas(await kit.rules.count(), (await kit.rules.get(0)).result);
    if (!veredicto.ok) {
      await kit.disconnect().catch(() => undefined);
      await storage.delete(r.credentialId).catch(() => undefined);
      throw new ErrorDeEntrada("firmantes", veredicto.motivo);
    }
    return aConexion(r);
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
      return revisada(aConexion(r));
    },

    async volver() {
      const r = await kit.connectWallet();
      return r ? revisada(aConexion(r)) : null;
    },

    async entrarConLlave(avisos = {}) {
      const desbloqueosAntes = web.autenticaciones();
      let datos: DatosDeEntrada = { fuente: "local", ledgerDeNacimiento: null, segundosBuscando: 0, desbloqueos: 0 };
      // Se arma para esta entrada y nada más. Corre con la respuesta de la llave, antes de que el kit la reciba: así la
      // pista ya está cuando el kit lee el almacén, y la misma respuesta le sirve de prueba sin pedir otro desbloqueo.
      web.armar(async (respuesta) => {
        const id = respuesta.id;
        const guardada = await base.get(id);
        // La llave ya estaba en este aparato: el registro local manda y no hay nada que buscar.
        if (guardada?.contractId) return;
        avisos.alTerminarElDesbloqueo?.();
        const t0 = ahoraMs();
        const r = await buscar(id, { fuente: o.fuente ?? null });
        const segundosBuscando = Math.round((ahoraMs() - t0) / 100) / 10;
        if (!r.ok) throw new ErrorDeEntrada(r.motivo, r.detalle);
        datos = { fuente: r.pista.fuente, ledgerDeNacimiento: r.pista.creationLedger, segundosBuscando, desbloqueos: 0 };
        storage.poner({
          credentialId: id,
          contractId: r.pista.contractId,
          birthWasmHash: r.pista.birthWasmHash,
          creationTransactionHash: r.pista.creationTransactionHash,
          creationLedger: r.pista.creationLedger,
        });
      });
      try {
        const r = await kit.connectWallet({ fresh: true });
        if (!r) throw new Error("sin-conexion");
        const c = await revisada(aConexion(r));
        return { ...c, entrada: { ...datos, desbloqueos: web.autenticaciones() - desbloqueosAntes } };
      } catch (e) {
        throw clasificarErrorDelKit(e);
      } finally {
        web.desarmar();
        storage.quitar();
      }
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
