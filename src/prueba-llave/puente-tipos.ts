/**
 * Lo que el flujo necesita del kit, sin importar el kit: solo cadenas y números cruzan. Lo implementa `puente-kit.ts`, el
 * único archivo que importa el kit, y las pruebas ponen uno de mentira.
 */

export interface CreacionDeLlave {
  credentialId: string;
  /** La dirección de la cuenta de contrato, que nace de la llave. */
  contractId: string;
  /** La función de creación y sus entradas de autorización, en base64, como las dejó armadas el kit. */
  funcB64: string;
  authB64: string[];
}

export interface LlaveGuardada {
  credentialId: string;
  contractId: string;
  /** Si la cuenta ya está creada en la red (`deployed`), a medias (`pending`, `failed`, `occupied`) o no se sabe. */
  estado: string;
}

export interface Conexion {
  credentialId: string;
  contractId: string;
}

export interface PuenteKit {
  /** Pide el desbloqueo, crea la llave y deja armada la creación de la cuenta. No manda nada a la red. */
  crearLlave(): Promise<CreacionDeLlave>;
  /** Vuelve a armar la creación de una llave ya guardada, sin pedir otro desbloqueo. */
  rehacerCreacion(credentialId: string): Promise<{ contractId: string; funcB64: string; authB64: string[] }>;
  /** Anota en el aparato que la cuenta quedó creada. */
  anotarCreacion(credentialId: string, hash: string, ledger: number): Promise<void>;
  /** Conecta una llave de este aparato con su cuenta. No pide desbloqueo: el registro es local. */
  conectar(credentialId: string, contractId: string): Promise<Conexion>;
  /** Retoma la sesión de los últimos 7 días, si la hay. */
  volver(): Promise<Conexion | null>;
  /** Entra con una llave que no está en este aparato: pide el desbloqueo y busca la cuenta en el índice. */
  entrarConLlave(): Promise<Conexion>;
  llavesGuardadas(): Promise<LlaveGuardada[]>;
  /** La llave firma una entrada de autorización. Pide el desbloqueo. */
  firmarEntrada(entradaB64: string, vence: number): Promise<string>;
}
