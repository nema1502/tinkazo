/**
 * El cifrado de los nombres de la sala, del lado de la pantalla.
 *
 * Lo mismo que hace la página del celular (`CIFRA_JS` en workers/sala/src/pagina.ts):
 * AES-GCM con una clave de 16 bytes que genera el navegador de la pantalla y que
 * viaja solo en el fragmento del QR (`s.tinkazo.app/<id>#<clave>`), que ningún
 * navegador le manda a un servidor. Lo que se manda y se guarda es
 * `[1][IV de 12 bytes][cifrado]` en base64url: el servicio no puede leer los nombres.
 */

const VERSION = 1;

export const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const deB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** 16 bytes de `crypto.getRandomValues`, en base64url (22 caracteres). */
export function generarClave(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

async function importar(clave: string, uso: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = deB64url(clave);
  if (raw.length !== 16) throw new Error("clave");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [uso]);
}

export async function cifrarNombre(clave: string, texto: string): Promise<string> {
  const k = await importar(clave, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(texto)));
  const out = new Uint8Array(13 + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return b64url(out);
}

/** El nombre, o `null` si no es de esta sala (otra clave, otra versión o bytes rotos). */
export async function descifrarNombre(clave: string, dato: string): Promise<string | null> {
  try {
    const u = deB64url(dato);
    if (u[0] !== VERSION || u.length < 13 + 16) return null;
    const k = await importar(clave, "decrypt");
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(1, 13) }, k, u.subarray(13));
    return new TextDecoder("utf-8", { fatal: true }).decode(claro);
  } catch {
    return null;
  }
}
