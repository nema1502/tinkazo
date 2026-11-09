/**
 * El desbloqueo del aparato (huella, rostro o PIN) como forma de recuperar la cuenta de Pollar.
 *
 * Con Turnkey (la custodia de Pollar en mainnet) la cuenta no firma hasta tener una forma de volver a entrar sin este
 * aparato. Pollar no trae la ceremonia del navegador en `@pollar/core`: la pone `@pollar/react`, que Tinkazo no usa.
 * Esta es la misma, escrita con la API del navegador (`navigator.credentials`) y sin dependencias: lo que ve el SDK
 * (`RecoveryPasskeyCeremony`) son textos en base64url, como los da la serialización JSON de WebAuthn.
 *
 * Los parámetros son los de `browserRecoveryPasskey` de `@pollar/react` 0.12.0: las dos curvas que Turnkey acepta
 * (ES256 y RS256) y sin atestación. El identificador es el dominio del sitio: `tinkazo.app` para el sitio y para
 * cualquiera de sus subdominios (una llave creada en www sirve en el dominio base); en otra dirección (localhost,
 * una vista previa) es el nombre de esa dirección y es otra llave.
 */

/** El dominio al que pertenece la llave: el mismo al crearla y al usarla. */
export function rpIdDe(host: string): string {
  return host === "tinkazo.app" || host.endsWith(".tinkazo.app") ? "tinkazo.app" : host;
}

/** Lo que el SDK espera de una ceremonia (`RecoveryPasskeyCeremony` de `@pollar/core`, copiado para no depender del tipo). */
export interface CeremoniaDePasskey {
  create(options: { challenge: string; userName: string }): Promise<{ credentialId: string; clientDataJson: string; attestationObject: string; transports: string[] }>;
  get(options: { challenge: string; allowCredentials: string[] }): Promise<{ credentialId: string; authenticatorData: string; clientDataJson: string; signature: string }>;
}

/** Texto en base64url a bytes. */
export function deBase64url(s: string): Uint8Array<ArrayBuffer> {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes a texto en base64url, sin relleno. */
export function aBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ¿Este navegador sabe crear llaves de acceso? Sin esto no se ofrece el botón. */
export function hayPasskeys(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined" && !!navigator.credentials?.create;
}

/** Un identificador al azar para la llave nueva: es solo un nombre interno de la ceremonia, no decide nada del sorteo. */
function idDeUsuario(): Uint8Array<ArrayBuffer> {
  const id = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(id);
  return id;
}

export const ceremoniaDelNavegador: CeremoniaDePasskey = {
  async create({ challenge, userName }) {
    const rpId = rpIdDe(window.location.hostname);
    const credencial = (await navigator.credentials.create({
      publicKey: {
        challenge: deBase64url(challenge),
        rp: { id: rpId, name: rpId },
        user: { id: idDeUsuario(), name: userName, displayName: userName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!credencial) throw new Error("passkey-cancelada");
    const r = credencial.response as AuthenticatorAttestationResponse;
    return {
      credentialId: credencial.id,
      clientDataJson: aBase64url(r.clientDataJSON),
      attestationObject: aBase64url(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    };
  },
  async get({ challenge, allowCredentials }) {
    const credencial = (await navigator.credentials.get({
      publicKey: {
        challenge: deBase64url(challenge),
        rpId: rpIdDe(window.location.hostname),
        allowCredentials: allowCredentials.map((id) => ({ id: deBase64url(id), type: "public-key" as const })),
        userVerification: "preferred",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!credencial) throw new Error("passkey-cancelada");
    const r = credencial.response as AuthenticatorAssertionResponse;
    return {
      credentialId: credencial.id,
      authenticatorData: aBase64url(r.authenticatorData),
      clientDataJson: aBase64url(r.clientDataJSON),
      signature: aBase64url(r.signature),
    };
  },
};
