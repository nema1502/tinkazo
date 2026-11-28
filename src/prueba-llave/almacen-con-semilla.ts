/**
 * Una capa sobre el almacén del kit que le pasa, solo por un momento, lo que la página encontró del nacimiento de una
 * cuenta. El kit lee el almacén después de pedir la llave: si encuentra ahí el hash, el ledger y el código de nacimiento, los
 * verifica contra la red en su modo más estricto y no consulta ningún índice.
 *
 * La pista vive solo en memoria. Se la ve con `get`, nunca se escribe abajo por sí sola y se borra cuando el kit guarda el
 * registro ya verificado. Nunca lleva la clave pública ni la huella de los argumentos del constructor: con la primera el
 * kit dejaría de leer la clave del nacimiento, y con la segunda daría la cuenta por aprobada sin comprobar el desplegador,
 * la sal ni las políticas.
 *
 * No importa el kit: trabaja con la forma mínima de su almacén, así el kit sigue entrando por un solo archivo.
 */

/** La forma del almacén del kit que esta capa necesita y repite. */
export interface AlmacenDeRegistros<R, S> {
  save(registro: R): Promise<void>;
  get(credentialId: string): Promise<R | null>;
  getByContract(contractId: string): Promise<R[]>;
  getAll(): Promise<R[]>;
  delete(credentialId: string): Promise<void>;
  update(credentialId: string, cambios: Partial<R>): Promise<void>;
  clear(): Promise<void>;
  saveSession(sesion: S): Promise<void>;
  getSession(): Promise<S | null>;
  clearSession(): Promise<void>;
}

/** Lo que se encontró del nacimiento de una cuenta. */
export interface PistaDeNacimiento {
  credentialId: string;
  contractId: string;
  birthWasmHash: string;
  creationTransactionHash: string;
  creationLedger: number;
}

/**
 * El registro que ve el kit. No lleva `publicKey`, `birthConstructorArgsHash`, `deploymentStatus` ni `associationVerified`:
 * ninguno se puede dar por cierto antes de que el kit lo compruebe.
 */
export function semillaDe(p: PistaDeNacimiento, ahora: number): Record<string, unknown> {
  return {
    credentialId: p.credentialId,
    contractId: p.contractId,
    createdAt: ahora,
    isPrimary: true,
    birthWasmHash: p.birthWasmHash,
    creationTransactionHash: p.creationTransactionHash,
    creationLedger: p.creationLedger,
  };
}

export class AlmacenConSemilla<R extends { credentialId: string }, S> implements AlmacenDeRegistros<R, S> {
  private pista: PistaDeNacimiento | null = null;

  constructor(
    private readonly abajo: AlmacenDeRegistros<R, S>,
    private readonly ahora: () => number = () => Date.now(),
  ) {}

  /** Deja la pista a la vista del kit. */
  poner(pista: PistaDeNacimiento): void {
    this.pista = pista;
  }

  /** Borra la pista de la memoria. */
  quitar(): void {
    this.pista = null;
  }

  hayPista(): boolean {
    return this.pista !== null;
  }

  async get(credentialId: string): Promise<R | null> {
    const real = await this.abajo.get(credentialId);
    if (real) return real;
    // El único lugar donde la pista toma la forma del registro del kit: es una frontera y se dice acá.
    if (this.pista && this.pista.credentialId === credentialId) return semillaDe(this.pista, this.ahora()) as unknown as R;
    return null;
  }

  /** Abajo no se crea nada si el registro no existe: una actualización de un registro que es solo pista no deja rastro. */
  update(credentialId: string, cambios: Partial<R>): Promise<void> {
    return this.abajo.update(credentialId, cambios);
  }

  async save(registro: R): Promise<void> {
    await this.abajo.save(registro);
    if (this.pista && this.pista.credentialId === registro.credentialId) this.pista = null;
  }

  getByContract(contractId: string): Promise<R[]> {
    return this.abajo.getByContract(contractId);
  }

  getAll(): Promise<R[]> {
    return this.abajo.getAll();
  }

  delete(credentialId: string): Promise<void> {
    return this.abajo.delete(credentialId);
  }

  clear(): Promise<void> {
    return this.abajo.clear();
  }

  saveSession(sesion: S): Promise<void> {
    return this.abajo.saveSession(sesion);
  }

  getSession(): Promise<S | null> {
    return this.abajo.getSession();
  }

  clearSession(): Promise<void> {
    return this.abajo.clearSession();
  }
}
