//! La lista de cuentas y su hash, con el método de docs/protocolo.md §1.
//!
//! Cada entrada es la dirección en texto de una cuenta (`G…`, 56 caracteres).
//! Las direcciones de contrato (`C…`) no participan: un contrato puede no tener
//! salida y dejar el premio trabado, y nadie las valida al armar la lista. La
//! lista va en orden estricto ascendente por esos bytes: así no hay repetidas
//! y es canónica tal cual (sin comas, sin espacios, sin duplicados), de modo
//! que `verificar.html` la comprueba como cualquier lista pegada.

use crate::Error;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

/// Largo de una dirección `G…` o `C…` en texto.
pub const STRKEY_LEN: usize = 56;

pub fn strkey(address: &Address) -> Result<[u8; STRKEY_LEN], Error> {
    let text = address.to_string();
    if text.len() as usize != STRKEY_LEN {
        return Err(Error::InvalidEntry);
    }
    let mut out = [0u8; STRKEY_LEN];
    text.copy_into_slice(&mut out);
    Ok(out)
}

/// Entradas que se juntan en memoria antes de pasarlas al host. `Bytes` es un
/// objeto del host que se copia entero en cada agregado: de a una, la lista de
/// 1.000 cuentas costaría cuadrático.
const CHUNK: usize = 32;

/// `SHA-256(e_0 ‖ "\n" ‖ … ‖ e_{n-1})`. Exige orden estricto, que ninguna
/// entrada esté en `excluded` y que todas sean cuentas `G…`.
pub fn hash(
    env: &Env,
    entries: &Vec<Address>,
    excluded: &[[u8; STRKEY_LEN]],
) -> Result<BytesN<32>, Error> {
    let mut out = Bytes::new(env);
    let mut chunk = [0u8; CHUNK * (STRKEY_LEN + 1)];
    let mut used = 0usize;
    let mut prev = [0u8; STRKEY_LEN];
    for (i, entry) in entries.iter().enumerate() {
        let cur = strkey(&entry)?;
        if i > 0 {
            if cur <= prev {
                return Err(Error::EntriesNotSorted);
            }
            chunk[used] = b'\n';
            used += 1;
        }
        if excluded.contains(&cur) {
            return Err(Error::ExcludedEntry);
        }
        // Solo cuentas: las direcciones de contrato (`C…`), incluidas las de
        // este contrato, el token y el sorteo, no pueden quedar en la lista.
        if cur[0] != b'G' {
            return Err(Error::InvalidEntry);
        }
        chunk[used..used + STRKEY_LEN].copy_from_slice(&cur);
        used += STRKEY_LEN;
        if used + STRKEY_LEN + 1 > chunk.len() {
            out.extend_from_slice(&chunk[..used]);
            used = 0;
        }
        prev = cur;
    }
    if used > 0 {
        out.extend_from_slice(&chunk[..used]);
    }
    Ok(env.crypto().sha256(&out).into())
}
