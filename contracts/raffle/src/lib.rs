#![no_std]
//! Tinkazo — sorteos verificables para comunidades.
//!
//! Flujo (ver `docs/protocolo.md`, v2):
//! 1. `seal`: el organizador compromete el hash de la lista, la cantidad de
//!    entradas y una ronda futura de drand quicknet. El contrato exige que la
//!    ronda nazca al menos 30 s después del sello, así la semilla no existe
//!    todavía cuando la lista queda congelada.
//! 2. `draw`: cualquiera envía la firma BLS de esa ronda. El contrato la
//!    verifica contra la clave pública de quicknet, deriva la semilla
//!    (`sha256(firma)`, igual al `randomness` de drand) y ejecuta la selección
//!    determinista. El resultado queda registrado y es consultable por RPC.
//!
//! El contrato no custodia fondos, no tiene administrador y no es actualizable:
//! cada versión es un despliegue nuevo y los comprobantes llevan la dirección.
//!
//! Renta: cada sorteo paga la renta de sus dos entradas (`Raffle`, `Draw`) por
//! 120 días. La renta de la instancia y del código del contrato se renueva con
//! `extend`, nunca dentro de `seal` o `draw`.

mod drand;
mod select;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, contracttype, Address,
    BytesN, Env, String, Vec,
};

contractmeta!(key = "binver", val = "0.1.0");
contractmeta!(key = "protocol", val = "tinkazo-v2");

/// La ronda objetivo debe publicarse al menos este tiempo después del sello.
pub const MIN_LEAD_SECS: u64 = 30;
/// Y a lo sumo este tiempo después (30 días).
pub const MAX_LEAD_SECS: u64 = 30 * 86_400;
/// Cota superior de ganadores por sorteo (acota el bucle de selección).
pub const MAX_WINNERS: u32 = 32;
/// Largo máximo del texto libre (premio o título).
pub const MAX_META_LEN: u32 = 160;

const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 60 * DAY_LEDGERS;
const TTL_EXTEND_TO: u32 = 120 * DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NextId,
    Raffle(u64),
    Draw(u64),
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Sealed,
    Drawn,
}

/// Sello de un sorteo: lo que el organizador compromete antes de la semilla.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Raffle {
    pub id: u64,
    pub organizer: Address,
    /// SHA-256 de la lista canónica (docs/protocolo.md §1).
    pub list_hash: BytesN<32>,
    /// Cantidad de entradas de la lista canónica.
    pub count: u32,
    /// Cantidad de ganadores a seleccionar.
    pub num_winners: u32,
    /// Ronda objetivo de drand quicknet.
    pub round: u64,
    /// Timestamp del ledger en que se selló.
    pub sealed_at: u64,
    pub sealed_ledger: u32,
    /// Texto libre corto: premio o título.
    pub meta: String,
    pub status: Status,
}

/// Registro del resultado.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Draw {
    pub raffle_id: u64,
    pub round: u64,
    /// Firma BLS de la ronda, comprimida (48 bytes), tal como la publica drand.
    pub signature: BytesN<48>,
    /// `sha256(signature)`: idéntico al campo `randomness` de drand.
    pub randomness: BytesN<32>,
    /// Índices ganadores en la lista canónica, en orden de premio.
    pub winners: Vec<u32>,
    pub drawn_at: u64,
    pub drawn_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    AlreadyDrawn = 2,
    TooFewEntries = 3,
    BadWinnerCount = 4,
    RoundTooSoon = 5,
    RoundTooFar = 6,
    RoundNotReady = 7,
    InvalidSignature = 8,
    MetaTooLong = 9,
}

#[contractevent]
pub struct Sealed {
    #[topic]
    pub raffle_id: u64,
    #[topic]
    pub organizer: Address,
    pub list_hash: BytesN<32>,
    pub count: u32,
    pub num_winners: u32,
    pub round: u64,
}

#[contractevent]
pub struct Drawn {
    #[topic]
    pub raffle_id: u64,
    pub round: u64,
    pub randomness: BytesN<32>,
    pub winners: Vec<u32>,
}

#[contract]
pub struct TinkazoRaffle;

#[contractimpl]
impl TinkazoRaffle {
    /// Compromete una lista. Devuelve el `id` del sorteo (secuencial desde 1).
    pub fn seal(
        env: Env,
        organizer: Address,
        list_hash: BytesN<32>,
        count: u32,
        num_winners: u32,
        round: u64,
        meta: String,
    ) -> Result<u64, Error> {
        organizer.require_auth();

        if count < 2 {
            return Err(Error::TooFewEntries);
        }
        if num_winners == 0 || num_winners > count || num_winners > MAX_WINNERS {
            return Err(Error::BadWinnerCount);
        }
        if meta.len() > MAX_META_LEN {
            return Err(Error::MetaTooLong);
        }

        let now = env.ledger().timestamp();
        let round_time = drand::round_time(round);
        if round_time < now.saturating_add(MIN_LEAD_SECS) {
            return Err(Error::RoundTooSoon);
        }
        if round_time > now.saturating_add(MAX_LEAD_SECS) {
            return Err(Error::RoundTooFar);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1u64);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let raffle = Raffle {
            id,
            organizer: organizer.clone(),
            list_hash: list_hash.clone(),
            count,
            num_winners,
            round,
            sealed_at: now,
            sealed_ledger: env.ledger().sequence(),
            meta,
            status: Status::Sealed,
        };
        let key = DataKey::Raffle(id);
        env.storage().persistent().set(&key, &raffle);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Sealed {
            raffle_id: id,
            organizer,
            list_hash,
            count,
            num_winners,
            round,
        }
        .publish(&env);

        Ok(id)
    }

    /// Registra el resultado. Sin autorización: cualquiera puede finalizar un
    /// sorteo cuya ronda ya existe. `signature` es la firma de la ronda en
    /// formato G1 sin comprimir (96 bytes, big-endian, `x || y`).
    pub fn draw(env: Env, raffle_id: u64, signature: BytesN<96>) -> Result<Draw, Error> {
        let key = DataKey::Raffle(raffle_id);
        let mut raffle: Raffle = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        if raffle.status == Status::Drawn {
            return Err(Error::AlreadyDrawn);
        }

        let now = env.ledger().timestamp();
        if now < drand::round_time(raffle.round) {
            return Err(Error::RoundNotReady);
        }
        if !drand::verify(&env, raffle.round, &signature) {
            return Err(Error::InvalidSignature);
        }

        let sig48 = drand::compress_g1(&env, &signature);
        let randomness = drand::randomness(&env, &sig48);
        let winners = select::select(
            &env,
            &randomness,
            &raffle.list_hash,
            raffle.count,
            raffle.num_winners,
        );

        let draw = Draw {
            raffle_id,
            round: raffle.round,
            signature: sig48,
            randomness: randomness.clone(),
            winners: winners.clone(),
            drawn_at: now,
            drawn_ledger: env.ledger().sequence(),
        };

        raffle.status = Status::Drawn;
        env.storage().persistent().set(&key, &raffle);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        let dkey = DataKey::Draw(raffle_id);
        env.storage().persistent().set(&dkey, &draw);
        env.storage()
            .persistent()
            .extend_ttl(&dkey, TTL_THRESHOLD, TTL_EXTEND_TO);

        Drawn {
            raffle_id,
            round: raffle.round,
            randomness,
            winners,
        }
        .publish(&env);

        Ok(draw)
    }

    pub fn get_raffle(env: Env, raffle_id: u64) -> Option<Raffle> {
        env.storage().persistent().get(&DataKey::Raffle(raffle_id))
    }

    pub fn get_draw(env: Env, raffle_id: u64) -> Option<Draw> {
        env.storage().persistent().get(&DataKey::Draw(raffle_id))
    }

    /// Próximo `id` que asignará `seal`.
    pub fn next_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1u64)
    }

    /// Renueva el TTL de un sorteo, de su registro y de la instancia del
    /// contrato (código incluido). Cualquiera puede llamarlo.
    ///
    /// `seal` y `draw` solo extienden las entradas del propio sorteo: la renta
    /// del código del contrato (la partida cara) se paga aquí, de forma
    /// explícita, y no por sorpresa al organizador que llega justo cuando el
    /// TTL cae bajo el umbral.
    pub fn extend(env: Env, raffle_id: u64) -> Result<(), Error> {
        let key = DataKey::Raffle(raffle_id);
        if !env.storage().persistent().has(&key) {
            return Err(Error::NotFound);
        }
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        let dkey = DataKey::Draw(raffle_id);
        if env.storage().persistent().has(&dkey) {
            env.storage()
                .persistent()
                .extend_ttl(&dkey, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Ronda de quicknet vigente en un instante (Unix, segundos).
    pub fn round_at(_env: Env, timestamp: u64) -> u64 {
        drand::round_at(timestamp)
    }

    /// Instante (Unix, segundos) en que se publica una ronda de quicknet.
    pub fn round_time(_env: Env, round: u64) -> u64 {
        drand::round_time(round)
    }
}

mod test;
