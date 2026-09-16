#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    bytesn,
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Bytes, BytesN, Env, Event as _, String,
};

/// Ronda real de quicknet (16 de septiembre de 2026) y su firma publicada.
const ROUND: u64 = 32_254_977;
const ROUND_TIME: u64 = 1_789_568_295; // GENESIS + (ROUND - 1) * 3

fn sig_uncompressed(env: &Env) -> BytesN<96> {
    bytesn!(
        env,
        0x077a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac107dcead72cb133d9242167d8359226b699156f412e370b0850da63cd4ceba93bb81e17107bde7a4018aac91547fa2ac
    )
}

fn sig_compressed(env: &Env) -> BytesN<48> {
    bytesn!(
        env,
        0xa77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac
    )
}

fn expected_randomness(env: &Env) -> BytesN<32> {
    bytesn!(
        env,
        0x6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829
    )
}

/// Generador de G1 sin comprimir: un punto válido que NO es la firma.
fn g1_generator(env: &Env) -> BytesN<96> {
    bytesn!(
        env,
        0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1
    )
}

const SAMPLE: &str = "María Quispe\nJorge Mamani\nLucía Flores\nCarlos Choque\nAna Vargas\nDiego Rojas\nElena Condori\nPablo Gutiérrez\nSofía Aguilar\nRodrigo Peña\nValeria Torrez\nMiguel Arce\nCamila Suárez\nAndrés Villca\nPaola Mendoza\nFranco Ibáñez\nDaniela Cruz\nÓscar Limachi";
const SAMPLE_COUNT: u32 = 18;

fn list_hash(env: &Env) -> BytesN<32> {
    env.crypto()
        .sha256(&Bytes::from_slice(env, SAMPLE.as_bytes()))
        .into()
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(ROUND_TIME - 120);
    env.ledger().set_sequence_number(1_000);
    let contract_id = env.register(TinkazoRaffle, ());
    let organizer = Address::generate(&env);
    (env, contract_id, organizer)
}

fn meta(env: &Env) -> String {
    String::from_str(env, "Licencia JetBrains")
}

// ---------------------------------------------------------------- seal

#[test]
fn seal_assigns_sequential_ids_and_stores_the_raffle() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);

    assert_eq!(client.next_id(), 1);
    let id = client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &3, &ROUND, &meta(&env));
    assert_eq!(id, 1);
    // La autorización del organizador se exigió en esta invocación.
    assert_eq!(env.auths()[0].0, organizer);

    let raffle = client.get_raffle(&1).unwrap();
    assert_eq!(raffle.id, 1);
    assert_eq!(raffle.organizer, organizer);
    assert_eq!(raffle.list_hash, list_hash(&env));
    assert_eq!(raffle.count, SAMPLE_COUNT);
    assert_eq!(raffle.num_winners, 3);
    assert_eq!(raffle.round, ROUND);
    assert_eq!(raffle.sealed_at, ROUND_TIME - 120);
    assert_eq!(raffle.sealed_ledger, 1_000);
    assert_eq!(raffle.status, Status::Sealed);
    assert!(client.get_draw(&1).is_none());

    let id2 = client.seal(&organizer, &list_hash(&env), &2, &1, &ROUND, &meta(&env));
    assert_eq!(id2, 2);
    assert_eq!(client.next_id(), 3);
}

#[test]
fn seal_emits_sealed_event() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    let expected = Sealed {
        raffle_id: 1,
        organizer: organizer.clone(),
        list_hash: list_hash(&env),
        count: SAMPLE_COUNT,
        num_winners: 1,
        round: ROUND,
    };
    assert_eq!(env.events().all(), std::vec![expected.to_xdr(&env, &contract_id)]);
}

#[test]
fn seal_rejects_invalid_inputs() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    let h = list_hash(&env);
    let m = meta(&env);

    assert_eq!(
        client.try_seal(&organizer, &h, &1, &1, &ROUND, &m),
        Err(Ok(Error::TooFewEntries))
    );
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &0, &ROUND, &m),
        Err(Ok(Error::BadWinnerCount))
    );
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &6, &ROUND, &m),
        Err(Ok(Error::BadWinnerCount))
    );
    assert_eq!(
        client.try_seal(&organizer, &h, &100, &33, &ROUND, &m),
        Err(Ok(Error::BadWinnerCount))
    );
    let long = "x".repeat(161);
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &1, &ROUND, &String::from_str(&env, &long)),
        Err(Ok(Error::MetaTooLong))
    );
    let exact = "x".repeat(160);
    assert!(client
        .try_seal(&organizer, &h, &5, &1, &ROUND, &String::from_str(&env, &exact))
        .is_ok());
}

#[test]
fn seal_enforces_round_window() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    let h = list_hash(&env);
    let m = meta(&env);
    let now = env.ledger().timestamp();

    // Ronda vigente ahora: la semilla ya existe.
    let current = drand::round_at(now);
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &1, &current, &m),
        Err(Ok(Error::RoundTooSoon))
    );
    // Ronda que nace en 29 s: todavía muy pronto.
    let soon = drand::round_at(now + 29);
    assert!(drand::round_time(soon) < now + MIN_LEAD_SECS);
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &1, &soon, &m),
        Err(Ok(Error::RoundTooSoon))
    );
    // Primera ronda que nace a los 30 s o después: aceptada.
    let ok_round = drand::round_at(now + MIN_LEAD_SECS + PERIOD_MARGIN);
    assert!(drand::round_time(ok_round) >= now + MIN_LEAD_SECS);
    assert!(client.try_seal(&organizer, &h, &5, &1, &ok_round, &m).is_ok());
    // Más de 30 días: demasiado lejos.
    let far = drand::round_at(now + MAX_LEAD_SECS + 60);
    assert_eq!(
        client.try_seal(&organizer, &h, &5, &1, &far, &m),
        Err(Ok(Error::RoundTooFar))
    );
}

const PERIOD_MARGIN: u64 = drand::PERIOD;

// ---------------------------------------------------------------- draw

#[test]
fn draw_verifies_the_real_quicknet_signature_and_records_the_result() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &3, &ROUND, &meta(&env));

    env.ledger().set_timestamp(ROUND_TIME + 5);
    env.ledger().set_sequence_number(1_024);
    let draw = client.draw(&1, &sig_uncompressed(&env));

    assert_eq!(draw.raffle_id, 1);
    assert_eq!(draw.round, ROUND);
    assert_eq!(draw.signature, sig_compressed(&env));
    assert_eq!(draw.randomness, expected_randomness(&env));
    assert_eq!(draw.drawn_at, ROUND_TIME + 5);
    assert_eq!(draw.drawn_ledger, 1_024);
    assert_eq!(draw.winners.len(), 3);
    for i in 0..3 {
        let w = draw.winners.get(i).unwrap();
        assert!(w < SAMPLE_COUNT);
        for j in 0..3 {
            if i != j {
                assert_ne!(w, draw.winners.get(j).unwrap());
            }
        }
    }
    // Vector de referencia calculado fuera del contrato con Node + @noble/hashes
    // (docs/vectors.json): SAMPLE, k = 3, semilla de la ronda 32254977.
    assert_eq!(draw.winners, to_vec(&env, &[4, 11, 3]));

    assert_eq!(client.get_raffle(&1).unwrap().status, Status::Drawn);
    assert_eq!(client.get_draw(&1).unwrap(), draw);
}

fn to_vec(env: &Env, items: &[u32]) -> Vec<u32> {
    let mut v = Vec::new(env);
    for w in items {
        v.push_back(*w);
    }
    v
}

#[test]
fn select_matches_cross_language_vectors() {
    // docs/vectors.json — generado en Node, misma semilla y lista que arriba.
    let env = Env::default();
    let r = expected_randomness(&env);
    let h = list_hash(&env);
    assert_eq!(
        h,
        bytesn!(
            &env,
            0x32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef
        )
    );
    assert_eq!(select::select(&env, &r, &h, 18, 1), to_vec(&env, &[4]));
    assert_eq!(select::select(&env, &r, &h, 18, 3), to_vec(&env, &[4, 11, 3]));
    assert_eq!(
        select::select(&env, &r, &h, 18, 5),
        to_vec(&env, &[4, 11, 3, 17, 0])
    );
    assert_eq!(
        select::select(&env, &r, &h, 18, 18),
        to_vec(
            &env,
            &[4, 11, 3, 17, 0, 12, 15, 5, 7, 8, 14, 1, 9, 16, 2, 13, 6, 10]
        )
    );
    assert_eq!(select::select(&env, &r, &h, 2, 1), to_vec(&env, &[0]));
    assert_eq!(
        select::select(&env, &r, &h, 1_000, 5),
        to_vec(&env, &[312, 247, 521, 649, 166])
    );
}

#[test]
fn draw_emits_drawn_event() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME);
    let draw = client.draw(&1, &sig_uncompressed(&env));
    let expected = Drawn {
        raffle_id: 1,
        round: ROUND,
        randomness: expected_randomness(&env),
        winners: draw.winners.clone(),
    };
    assert_eq!(env.events().all(), std::vec![expected.to_xdr(&env, &contract_id)]);
}

#[test]
fn draw_rejects_before_the_round_exists() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME - 1);
    assert_eq!(
        client.try_draw(&1, &sig_uncompressed(&env)),
        Err(Ok(Error::RoundNotReady))
    );
}

#[test]
fn draw_rejects_a_valid_point_that_is_not_the_round_signature() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 3);
    assert_eq!(
        client.try_draw(&1, &g1_generator(&env)),
        Err(Ok(Error::InvalidSignature))
    );
    // El sorteo sigue abierto.
    assert_eq!(client.get_raffle(&1).unwrap().status, Status::Sealed);
}

#[test]
fn draw_rejects_the_signature_of_another_round() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    // Sellado contra la ronda siguiente: la firma de ROUND no sirve.
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &(ROUND + 1), &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 10);
    assert_eq!(
        client.try_draw(&1, &sig_uncompressed(&env)),
        Err(Ok(Error::InvalidSignature))
    );
}

#[test]
fn draw_only_once_and_only_existing_raffles() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 3);
    client.draw(&1, &sig_uncompressed(&env));
    assert_eq!(
        client.try_draw(&1, &sig_uncompressed(&env)),
        Err(Ok(Error::AlreadyDrawn))
    );
    assert_eq!(
        client.try_draw(&99, &sig_uncompressed(&env)),
        Err(Ok(Error::NotFound))
    );
}

#[test]
fn draw_needs_no_authorization() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 3);
    client.draw(&1, &sig_uncompressed(&env));
    assert!(env.auths().is_empty());
}

// ---------------------------------------------------------------- extend

#[test]
fn extend_works_for_existing_raffles_only() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    assert_eq!(client.try_extend(&1), Err(Ok(Error::NotFound)));
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    client.extend(&1);
    env.ledger().set_timestamp(ROUND_TIME + 3);
    client.draw(&1, &sig_uncompressed(&env));
    client.extend(&1);
}

// ---------------------------------------------------------------- drand

#[test]
fn round_math_matches_quicknet_parameters() {
    let (env, contract_id, _) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    assert_eq!(client.round_time(&1), drand::GENESIS_TIME);
    assert_eq!(client.round_time(&2), drand::GENESIS_TIME + 3);
    assert_eq!(client.round_time(&ROUND), ROUND_TIME);
    assert_eq!(client.round_at(&(drand::GENESIS_TIME - 1)), 1);
    assert_eq!(client.round_at(&drand::GENESIS_TIME), 1);
    assert_eq!(client.round_at(&(drand::GENESIS_TIME + 2)), 1);
    assert_eq!(client.round_at(&(drand::GENESIS_TIME + 3)), 2);
    assert_eq!(client.round_at(&ROUND_TIME), ROUND);
    assert_eq!(client.round_at(&(ROUND_TIME + 2)), ROUND);
    assert_eq!(client.round_at(&(ROUND_TIME + 3)), ROUND + 1);
}

#[test]
fn compress_g1_matches_the_drand_encoding() {
    let env = Env::default();
    assert_eq!(
        drand::compress_g1(&env, &sig_uncompressed(&env)),
        sig_compressed(&env)
    );
    // El generador de G1 comprimido es el valor canónico 0x97f1d3a7...
    let g = drand::compress_g1(&env, &g1_generator(&env));
    assert_eq!(g.get(0).unwrap(), 0x97);
}

#[test]
fn randomness_matches_drand_api() {
    let env = Env::default();
    assert_eq!(
        drand::randomness(&env, &sig_compressed(&env)),
        expected_randomness(&env)
    );
}

// ---------------------------------------------------------------- select

#[test]
fn select_is_deterministic_unique_and_in_range() {
    let env = Env::default();
    let r = expected_randomness(&env);
    let h = list_hash(&env);
    for &count in &[2u32, 3, 18, 1_000, 50_000] {
        let k = core::cmp::min(count, 5);
        let a = select::select(&env, &r, &h, count, k);
        let b = select::select(&env, &r, &h, count, k);
        assert_eq!(a, b);
        assert_eq!(a.len(), k);
        for i in 0..k {
            let w = a.get(i).unwrap();
            assert!(w < count);
            for j in 0..k {
                if i != j {
                    assert_ne!(w, a.get(j).unwrap());
                }
            }
        }
    }
}

#[test]
fn select_all_entries_when_k_equals_count() {
    let env = Env::default();
    let r = expected_randomness(&env);
    let h = list_hash(&env);
    let all = select::select(&env, &r, &h, 32, 32);
    assert_eq!(all.len(), 32);
    let mut seen = [false; 32];
    for i in 0..32 {
        seen[all.get(i).unwrap() as usize] = true;
    }
    assert!(seen.iter().all(|s| *s));
}

#[test]
fn select_depends_on_list_hash() {
    let env = Env::default();
    let r = expected_randomness(&env);
    let h1 = list_hash(&env);
    let h2: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, b"otra lista"))
        .into();
    let a = select::select(&env, &r, &h1, 1_000, 5);
    let b = select::select(&env, &r, &h2, 1_000, 5);
    assert_ne!(a, b);
}
