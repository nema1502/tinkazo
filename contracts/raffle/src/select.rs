//! Selección determinista de ganadores (`docs/protocolo.md` §5).
//!
//! ```text
//! ctr = 0
//! mientras faltan ganadores:
//!     h   = sha256(randomness || list_hash || be32(ctr))
//!     idx = be64(h[0..8]) mod count
//!     si idx no fue elegido: agregarlo
//!     ctr += 1
//! ```
//!
//! Termina siempre que `k <= count`, lo que `seal` garantiza. El mismo
//! algoritmo se implementa en TypeScript para el navegador; ambos comparten
//! vectores de prueba.

use soroban_sdk::{Bytes, BytesN, Env, Vec};

pub fn select(
    env: &Env,
    randomness: &BytesN<32>,
    list_hash: &BytesN<32>,
    count: u32,
    k: u32,
) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new(env);
    let r = randomness.to_array();
    let l = list_hash.to_array();
    let mut ctr: u32 = 0;
    while out.len() < k {
        let mut pre = [0u8; 68];
        pre[..32].copy_from_slice(&r);
        pre[32..64].copy_from_slice(&l);
        pre[64..].copy_from_slice(&ctr.to_be_bytes());
        let h: [u8; 32] = env.crypto().sha256(&Bytes::from_array(env, &pre)).to_array();
        let mut eight = [0u8; 8];
        eight.copy_from_slice(&h[..8]);
        let idx = (u64::from_be_bytes(eight) % count as u64) as u32;
        if !out.contains(&idx) {
            out.push_back(idx);
        }
        ctr += 1;
    }
    out
}
