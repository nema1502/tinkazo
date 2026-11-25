import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";

/**
 * El nombre con que el kit crea la llave. Corto y en ASCII: el kit arma el identificador interno del usuario con este
 * nombre, la hora y un número al azar (`nombre:hora:azar`), y WebAuthn admite hasta 64 bytes. Con este nombre queda en
 * unos 40. El nombre que ve la persona va aparte, en el envoltorio de abajo, y nunca entra en ese identificador.
 */
export const USUARIO_DE_LA_LLAVE = "llave";

/** El tope de WebAuthn para el identificador del usuario. */
export const TOPE_DEL_ID_DE_USUARIO = 64;

/** Los bytes que tendría el identificador del usuario con el nombre y los datos dados: es `nombre:hora:azar`. */
export function largoDelIdDeUsuario(nombre: string, hora: number, azar: number): number {
  return new TextEncoder().encode(`${nombre}:${hora}:${azar}`).length;
}

/** Las dos operaciones de WebAuthn que el kit pide: es la forma de su opción `webAuthn`. */
export interface ImplementacionDeWebAuthn {
  startRegistration: (o: { optionsJSON: PublicKeyCredentialCreationOptionsJSON; useAutoRegister?: boolean }) => Promise<RegistrationResponseJSON>;
  startAuthentication: (o: { optionsJSON: PublicKeyCredentialRequestOptionsJSON; useBrowserAutofill?: boolean; verifyBrowserAutofillInput?: boolean }) => Promise<AuthenticationResponseJSON>;
}

/** Lo que se puede hacer con el envoltorio además de usarlo: armar un aviso para la próxima autenticación y contarlas. */
export interface ControlDeAutenticacion {
  /** El aviso corre con la respuesta de la llave, se espera antes de devolverla y vale para un solo uso. */
  armar(alResponder: (respuesta: AuthenticationResponseJSON) => Promise<void>): void;
  desarmar(): void;
  /** Cuántas veces se pidió la llave. */
  autenticaciones(): number;
}

/**
 * Reemplaza el nombre visible de la llave (el kit pone el nombre y la hora local, con una raya larga) por `nombreVisible`,
 * en `user.name` y en `user.displayName`. No toca `user.id`.
 *
 * Además cuenta los desbloqueos y deja armar un aviso para la próxima autenticación: así la página puede dejar lista una
 * pista antes de que el kit reciba la respuesta de la llave, sin pedir un segundo desbloqueo.
 */
export function conNombreVisible(impl: ImplementacionDeWebAuthn, nombreVisible: string): ImplementacionDeWebAuthn & ControlDeAutenticacion {
  let aviso: ((respuesta: AuthenticationResponseJSON) => Promise<void>) | null = null;
  let cuenta = 0;
  return {
    startAuthentication: async (o) => {
      cuenta++;
      const respuesta = await impl.startAuthentication(o);
      const hacer = aviso;
      aviso = null;
      if (hacer) await hacer(respuesta);
      return respuesta;
    },
    startRegistration: (o) =>
      impl.startRegistration({
        ...o,
        optionsJSON: { ...o.optionsJSON, user: { ...o.optionsJSON.user, name: nombreVisible, displayName: nombreVisible } },
      }),
    armar: (alResponder) => {
      aviso = alResponder;
    },
    desarmar: () => {
      aviso = null;
    },
    autenticaciones: () => cuenta,
  };
}
