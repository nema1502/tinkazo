//! Interfaz de `tinkazo-raffle` (contracts/raffle), sin depender de su crate:
//! los tipos se codifican por nombre de campo y de variante, así que basta con
//! que coincidan. Las pruebas usan el contrato de verdad.

use soroban_sdk::{contractclient, contracttype, Address, BytesN, Env, String, Vec};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RaffleStatus {
    Sealed,
    Drawn,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RaffleRecord {
    pub id: u64,
    pub organizer: Address,
    pub list_hash: BytesN<32>,
    pub count: u32,
    pub num_winners: u32,
    pub round: u64,
    pub sealed_at: u64,
    pub sealed_ledger: u32,
    pub meta: String,
    pub status: RaffleStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrawRecord {
    pub raffle_id: u64,
    pub round: u64,
    pub signature: BytesN<48>,
    pub randomness: BytesN<32>,
    pub winners: Vec<u32>,
    pub drawn_at: u64,
    pub drawn_ledger: u32,
}

#[allow(dead_code)]
#[contractclient(name = "RaffleClient")]
pub trait Raffle {
    fn seal(
        env: Env,
        organizer: Address,
        list_hash: BytesN<32>,
        count: u32,
        num_winners: u32,
        round: u64,
        meta: String,
    ) -> u64;
    fn get_raffle(env: Env, raffle_id: u64) -> Option<RaffleRecord>;
    fn get_draw(env: Env, raffle_id: u64) -> Option<DrawRecord>;
}
