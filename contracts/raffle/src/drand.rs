//! drand quicknet: parámetros de la cadena y verificación BLS on-chain.
//!
//! Esquema `bls-unchained-g1-rfc9380`: la firma vive en G1 (48 bytes
//! comprimida, 96 sin comprimir) y la clave pública en G2 (96 / 192 bytes).
//! Mensaje firmado: `sha256(be64(round))`. Ver `docs/protocolo.md` §2 y §6.

use soroban_sdk::{
    bytesn,
    crypto::bls12_381::{Bls12381G1Affine as G1Affine, Bls12381G2Affine as G2Affine},
    vec, Bytes, BytesN, Env,
};

/// `genesis_time` de quicknet (Unix, segundos).
pub const GENESIS_TIME: u64 = 1_692_803_367;
/// Período entre rondas, en segundos.
pub const PERIOD: u64 = 3;
/// Domain separation tag de RFC 9380 para firmas cortas en G1.
pub const DST: &[u8] = b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

/// `(p - 1) / 2` del cuerpo base de BLS12-381, big-endian. Umbral para la
/// bandera de signo al comprimir un punto (`y > (p-1)/2`).
const P_MINUS_1_HALF: [u8; 48] = [
    0x0d, 0x00, 0x88, 0xf5, 0x1c, 0xbf, 0xf3, 0x4d, 0x25, 0x8d, 0xd3, 0xdb, 0x21, 0xa5, 0xd6, 0x6b,
    0xb2, 0x3b, 0xa5, 0xc2, 0x79, 0xc2, 0x89, 0x5f, 0xb3, 0x98, 0x69, 0x50, 0x7b, 0x58, 0x7b, 0x12,
    0x0f, 0x55, 0xff, 0xff, 0x58, 0xa9, 0xff, 0xff, 0xdc, 0xff, 0x7f, 0xff, 0xff, 0xff, 0xd5, 0x55,
];

/// Instante en que se publica la ronda `round`. La ronda 1 nace en el génesis.
pub fn round_time(round: u64) -> u64 {
    GENESIS_TIME.saturating_add(round.saturating_sub(1).saturating_mul(PERIOD))
}

/// Ronda vigente en el instante `timestamp`.
pub fn round_at(timestamp: u64) -> u64 {
    if timestamp < GENESIS_TIME {
        1
    } else {
        (timestamp - GENESIS_TIME) / PERIOD + 1
    }
}

/// Clave pública de quicknet en G2, sin comprimir (192 bytes).
fn public_key(env: &Env) -> G2Affine {
    G2Affine::from_bytes(bytesn!(
        env,
        0x03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273
    ))
}

/// Generador de G2 negado, sin comprimir (192 bytes).
fn neg_g2_generator(env: &Env) -> G2Affine {
    G2Affine::from_bytes(bytesn!(
        env,
        0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa
    ))
}

/// Mensaje firmado por quicknet para una ronda: `sha256(be64(round))`.
pub fn message(env: &Env, round: u64) -> Bytes {
    env.crypto()
        .sha256(&Bytes::from_array(env, &round.to_be_bytes()))
        .into()
}

/// Verifica que `signature` (G1 sin comprimir) firma la ronda `round`:
/// `e(sig, -G2) · e(H(msg), PK) == 1`, es decir `e(sig, G2) == e(H(msg), PK)`.
///
/// Un punto malformado (fuera de la curva o del subgrupo) hace fallar la
/// invocación en el host; el cliente debe validar la codificación antes.
pub fn verify(env: &Env, round: u64, signature: &BytesN<96>) -> bool {
    let bls = env.crypto().bls12_381();
    let msg = message(env, round);
    let dst = Bytes::from_slice(env, DST);
    let h = bls.hash_to_g1(&msg, &dst);
    let sig = G1Affine::from_bytes(signature.clone());
    bls.pairing_check(
        vec![env, sig, h],
        vec![env, neg_g2_generator(env), public_key(env)],
    )
}

/// Comprime un punto G1 (`x || y`, 96 bytes) a los 48 bytes que publica drand:
/// `x` con la bandera de compresión (bit 7) y la de signo (bit 5, si
/// `y > (p-1)/2`). Ver `docs/protocolo.md` §6.
pub fn compress_g1(env: &Env, point: &BytesN<96>) -> BytesN<48> {
    let raw: [u8; 96] = point.to_array();
    let mut out = [0u8; 48];
    out.copy_from_slice(&raw[..48]);
    out[0] &= 0x1f;
    out[0] |= 0x80;
    if y_is_larger_root(&raw[48..]) {
        out[0] |= 0x20;
    }
    BytesN::from_array(env, &out)
}

fn y_is_larger_root(y: &[u8]) -> bool {
    for i in 0..48 {
        if y[i] != P_MINUS_1_HALF[i] {
            return y[i] > P_MINUS_1_HALF[i];
        }
    }
    false
}

/// Semilla del sorteo: `sha256(firma comprimida)`. Coincide con el campo
/// `randomness` que publica drand.
pub fn randomness(env: &Env, signature48: &BytesN<48>) -> BytesN<32> {
    env.crypto()
        .sha256(&Bytes::from_array(env, &signature48.to_array()))
        .into()
}
