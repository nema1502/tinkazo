#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    bytesn,
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _},
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
        client.try_seal(&organizer, &h, &200, &(MAX_WINNERS + 1), &ROUND, &m),
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

/// TTL restante, en ledgers, de la entrada `clave` del sorteo.
fn ttl_de(env: &Env, contract_id: &Address, clave: DataKey) -> u32 {
    env.as_contract(contract_id, || env.storage().persistent().get_ttl(&clave))
}

#[test]
fn las_entradas_del_sorteo_viven_120_dias_y_extend_las_renueva_bajo_los_30() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &SAMPLE_COUNT, &1, &ROUND, &meta(&env));
    // La red de pruebas las crea con un mínimo bajo; el contrato las deja en 120 días.
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Raffle(1)),
        TTL_ENTRADA_EXTEND_TO
    );
    assert_eq!(TTL_ENTRADA_EXTEND_TO, 120 * DAY_LEDGERS);
    assert_eq!(TTL_ENTRADA_THRESHOLD, 30 * DAY_LEDGERS);

    env.ledger().set_timestamp(ROUND_TIME + 3);
    client.draw(&1, &sig_uncompressed(&env));
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Draw(1)),
        TTL_ENTRADA_EXTEND_TO
    );

    // A los 89 días (de los 90 que el contrato de premios lee el sorteo) quedan 31:
    // `extend` no toca nada, porque todavía está sobre el umbral.
    let seq = env.ledger().sequence();
    env.ledger().set_sequence_number(seq + 89 * DAY_LEDGERS);
    client.extend(&1);
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Raffle(1)),
        31 * DAY_LEDGERS
    );
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Draw(1)),
        31 * DAY_LEDGERS
    );

    // A los 91 días quedan 29, bajo el umbral: `extend` las deja otra vez en 120.
    env.ledger().set_sequence_number(seq + 91 * DAY_LEDGERS);
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Raffle(1)),
        29 * DAY_LEDGERS
    );
    client.extend(&1);
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Raffle(1)),
        TTL_ENTRADA_EXTEND_TO
    );
    assert_eq!(
        ttl_de(&env, &contract_id, DataKey::Draw(1)),
        TTL_ENTRADA_EXTEND_TO
    );
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

// ---------------------------------------------------------------- tope de ganadores

/// Huella de una lista de ganadores: `sha256` de los índices en `be32`, uno
/// detrás de otro. Se compara contra la misma cuenta hecha fuera del contrato,
/// con `node:crypto` y el algoritmo de `docs/protocolo.md` §5.
fn winners_digest(env: &Env, winners: &Vec<u32>) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    for w in winners.iter() {
        bytes.extend_from_slice(&w.to_be_bytes());
    }
    env.crypto().sha256(&bytes).into()
}

/// Sella y sortea con la ronda y la firma reales de quicknet.
fn sorteo_con(count: u32, k: u32) -> (Env, Draw) {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &count, &k, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 5);
    let draw = client.draw(&1, &sig_uncompressed(&env));
    (env, draw)
}

/// Todos distintos y todos dentro del rango.
fn assert_distinct_in_range(winners: &Vec<u32>, count: u32) {
    let mut seen = std::vec![false; count as usize];
    for w in winners.iter() {
        assert!(w < count, "{w} fuera de rango (count {count})");
        assert!(!seen[w as usize], "{w} repetido");
        seen[w as usize] = true;
    }
}

/// Entradas de la lista larga de las pruebas del tope (siempre más que el tope).
const ENTRADAS_LARGAS: u32 = 1_000;

/// Lo que da la referencia independiente (Node, `node:crypto`, `docs/protocolo.md` §5)
/// con la ronda real y la lista de estas pruebas, para un tope en particular.
struct ReferenciaDelTope {
    /// Huella de los ganadores de `MAX_WINNERS` de `MAX_WINNERS` entradas.
    permutacion: &'static str,
    /// El primero, el quinto y el último de esa permutación.
    extremos: (u32, u32, u32),
    /// Huella de los ganadores de `MAX_WINNERS` de `ENTRADAS_LARGAS` entradas.
    de_mil: &'static str,
}

/// La referencia del tope vigente. Cambiar `MAX_WINNERS` es cambiar esa constante: si el
/// valor nuevo ya tiene fila acá, las pruebas del tope siguen solas. Un tope sin fila hace
/// fallar las pruebas diciéndolo, en lugar de comparar contra los números de otro.
fn referencia_del_tope() -> ReferenciaDelTope {
    match MAX_WINNERS {
        100 => ReferenciaDelTope {
            permutacion: "dbc1fe6ab52d7c555c8b49b42a7b88d22cf97f9c3f01a737c7eb71283457af68",
            extremos: (12, 66, 87),
            de_mil: "90fe82cc7071d4906c3032c89e6fa172bf5ed8f0b001d1dcb7a748d3a76055b4",
        },
        300 => ReferenciaDelTope {
            permutacion: "aeff37e289741168ba66ed60ee7dd5e94d63c7ebcdc180483ee6d7e10d8f913e",
            extremos: (112, 66, 1),
            de_mil: "8382aa628d4e87ac8aa2ed81bed868dd98f94dbf1aa6ee82ef50f6f4fe3a8c7a",
        },
        otro => panic!(
            "no hay referencia independiente para MAX_WINNERS = {otro}: calcularla con la \
             selección de docs/protocolo.md §5 (node:crypto) y sumar su fila a referencia_del_tope"
        ),
    }
}

fn huella_hex(env: &Env, hex: &str) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
    }
    BytesN::from_array(env, &bytes)
}

#[test]
fn seal_accepts_the_cap_and_rejects_one_more() {
    let (env, contract_id, organizer) = setup();
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    let h = list_hash(&env);
    let m = meta(&env);

    // El tope exacto, con tantas entradas como ganadores y con muchas más.
    assert!(client
        .try_seal(&organizer, &h, &MAX_WINNERS, &MAX_WINNERS, &ROUND, &m)
        .is_ok());
    assert!(client
        .try_seal(&organizer, &h, &ENTRADAS_LARGAS, &MAX_WINNERS, &ROUND, &m)
        .is_ok());
    assert_eq!(client.get_raffle(&1).unwrap().num_winners, MAX_WINNERS);
    assert_eq!(client.get_raffle(&2).unwrap().num_winners, MAX_WINNERS);

    // Uno más: por el tope, aunque las entradas alcancen.
    assert_eq!(
        client.try_seal(&organizer, &h, &ENTRADAS_LARGAS, &(MAX_WINNERS + 1), &ROUND, &m),
        Err(Ok(Error::BadWinnerCount))
    );
    // Y por las entradas, aunque el tope alcance.
    assert_eq!(
        client.try_seal(&organizer, &h, &MAX_WINNERS, &(MAX_WINNERS + 1), &ROUND, &m),
        Err(Ok(Error::BadWinnerCount))
    );
    // Los rechazados no consumen número de sorteo.
    assert_eq!(client.next_id(), 3);
}

#[test]
fn draw_with_cap_winners_of_cap_entries_is_a_full_permutation() {
    let referencia = referencia_del_tope();
    let (env, draw) = sorteo_con(MAX_WINNERS, MAX_WINNERS);
    assert_eq!(draw.winners.len(), MAX_WINNERS);
    assert_distinct_in_range(&draw.winners, MAX_WINNERS);
    // Distintos y en rango con tantos ganadores como entradas: está cada índice una vez.
    let mut sorted: std::vec::Vec<u32> = draw.winners.iter().collect();
    sorted.sort_unstable();
    assert_eq!(sorted, (0..MAX_WINNERS).collect::<std::vec::Vec<u32>>());
    // El orden es el que calcula la referencia independiente (Node, node:crypto).
    assert_eq!(
        winners_digest(&env, &draw.winners),
        huella_hex(&env, referencia.permutacion)
    );
    // El primero, el quinto y el último, como en la referencia.
    let (primero, quinto, ultimo) = referencia.extremos;
    assert_eq!(draw.winners.get(0).unwrap(), primero);
    assert_eq!(draw.winners.get(4).unwrap(), quinto);
    assert_eq!(draw.winners.get(MAX_WINNERS - 1).unwrap(), ultimo);
}

#[test]
fn draw_with_cap_winners_of_a_long_list_has_no_repeats() {
    let referencia = referencia_del_tope();
    let (env, draw) = sorteo_con(ENTRADAS_LARGAS, MAX_WINNERS);
    assert_eq!(draw.winners.len(), MAX_WINNERS);
    assert_distinct_in_range(&draw.winners, ENTRADAS_LARGAS);
    assert_eq!(
        winners_digest(&env, &draw.winners),
        huella_hex(&env, referencia.de_mil)
    );
    // Los cinco primeros son los del vector de `docs/vectors.json` con 1.000 entradas:
    // no dependen de cuántos ganadores se pidan.
    assert_eq!(
        draw.winners.iter().take(5).collect::<std::vec::Vec<u32>>(),
        std::vec![312, 247, 521, 649, 166]
    );
}

#[test]
fn the_first_winners_do_not_depend_on_how_many_are_asked_for() {
    // Pedir más ganadores no cambia a los primeros: es el mismo recorrido. Eso
    // es lo que hace estable el orden de los premios.
    let env = Env::default();
    let r = expected_randomness(&env);
    let h = list_hash(&env);
    let todos = select::select(&env, &r, &h, MAX_WINNERS, MAX_WINNERS);
    for k in [1u32, 3, 32, 50, MAX_WINNERS - 1] {
        let corto = select::select(&env, &r, &h, MAX_WINNERS, k);
        assert_eq!(corto.len(), k);
        for i in 0..k {
            assert_eq!(corto.get(i).unwrap(), todos.get(i).unwrap());
        }
    }
}

// ---------------------------------------------------------------- costo

/// Una cuarta parte del máximo por transacción de la red (400 millones de
/// instrucciones, `tx_max_instructions` en `scripts/vigilar-red.base.json`).
const CUARTA_PARTE_INSTRUCCIONES: i64 = 100_000_000;
/// Una cuarta parte de `tx_memory_limit` (40 MiB).
const CUARTA_PARTE_MEMORIA: i64 = 10_485_760;

struct Costo {
    instrucciones: i64,
    memoria: i64,
    bytes_escritos: u32,
    bytes_draw: u32,
    renta_ledger_bytes: i64,
    evento_bytes: u32,
}

/// Entorno de medición: no escribe el archivo de captura al terminar (las
/// pruebas de costo corren decenas de sorteos y no hay nada que comparar).
fn entorno_de_medicion() -> Env {
    Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

fn registrar(env: &Env, wasm: Option<&[u8]>) -> Address {
    match wasm {
        Some(bytes) => env.register(bytes, ()),
        None => env.register(TinkazoRaffle, ()),
    }
}

/// Costo de `draw` con el presupuesto de Soroban. Si `wasm` trae el `.wasm`
/// compilado, el contrato corre en la máquina virtual (lo que paga la red); si
/// no, corre como Rust nativo, que no cuenta la ejecución del WASM.
fn medir_draw(count: u32, k: u32, wasm: Option<&[u8]>) -> Costo {
    use soroban_sdk::xdr::ToXdr;
    let env = entorno_de_medicion();
    env.mock_all_auths();
    env.ledger().set_timestamp(ROUND_TIME - 120);
    env.ledger().set_sequence_number(1_000);
    let contract_id = registrar(&env, wasm);
    let organizer = Address::generate(&env);
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &count, &k, &ROUND, &meta(&env));
    env.ledger().set_timestamp(ROUND_TIME + 5);
    let draw = client.draw(&1, &sig_uncompressed(&env));
    let r = env.cost_estimate().resources();
    Costo {
        instrucciones: r.instructions,
        memoria: r.mem_bytes,
        bytes_escritos: r.write_bytes,
        bytes_draw: draw.to_xdr(&env).len(),
        renta_ledger_bytes: r.persistent_rent_ledger_bytes,
        evento_bytes: r.contract_events_size_bytes,
    }
}

/// Costo de `seal` (la entrada `Raffle` guarda la cantidad de ganadores, no la lista).
fn medir_seal(count: u32, k: u32, wasm: Option<&[u8]>) -> Costo {
    let env = entorno_de_medicion();
    env.mock_all_auths();
    env.ledger().set_timestamp(ROUND_TIME - 120);
    env.ledger().set_sequence_number(1_000);
    let contract_id = registrar(&env, wasm);
    let organizer = Address::generate(&env);
    let client = TinkazoRaffleClient::new(&env, &contract_id);
    client.seal(&organizer, &list_hash(&env), &count, &k, &ROUND, &meta(&env));
    let r = env.cost_estimate().resources();
    Costo {
        instrucciones: r.instructions,
        memoria: r.mem_bytes,
        bytes_escritos: r.write_bytes,
        bytes_draw: 0,
        renta_ledger_bytes: r.persistent_rent_ledger_bytes,
        evento_bytes: r.contract_events_size_bytes,
    }
}

/// `.wasm` compilado, si `TINKAZO_WASM` apunta a uno:
/// `TINKAZO_WASM=target/wasm32v1-none/release/tinkazo_raffle.wasm cargo test costo -- --nocapture`.
fn wasm_compilado() -> Option<std::vec::Vec<u8>> {
    std::env::var("TINKAZO_WASM")
        .ok()
        .and_then(|p| std::fs::read(p).ok())
}

fn imprimir_tabla(titulo: &str, wasm: Option<&[u8]>) -> std::vec::Vec<(u32, u32, Costo)> {
    std::println!("\n{titulo}");
    std::println!(
        "{:>9} {:>13} | {:>13} {:>10} | {:>8} {:>12} {:>16} {:>10}",
        "ganadores", "participantes", "instrucciones", "memoria", "Draw (B)", "escritos (B)", "renta (ledger-B)", "evento (B)"
    );
    let mut filas = std::vec::Vec::new();
    for (k, count) in [
        (3u32, 18u32),
        (3, 1_000),
        (32, 32),
        (32, 1_000),
        (50, 50),
        (50, 1_000),
        (MAX_WINNERS, MAX_WINNERS),
        (MAX_WINNERS, 1_000),
    ] {
        let c = medir_draw(count, k, wasm);
        std::println!(
            "{:>9} {:>13} | {:>13} {:>10} | {:>8} {:>12} {:>16} {:>10}",
            k, count, c.instrucciones, c.memoria, c.bytes_draw, c.bytes_escritos, c.renta_ledger_bytes, c.evento_bytes
        );
        filas.push((k, count, c));
    }
    filas
}

fn exigir_bajo_la_cuarta_parte(filas: &[(u32, u32, Costo)], donde: &str) {
    for (k, count, c) in filas {
        assert!(
            c.instrucciones < CUARTA_PARTE_INSTRUCCIONES,
            "{donde}: {k} ganadores de {count}: {} instrucciones, tiene que quedar bajo {CUARTA_PARTE_INSTRUCCIONES}",
            c.instrucciones
        );
        assert!(
            c.memoria < CUARTA_PARTE_MEMORIA,
            "{donde}: {k} ganadores de {count}: {} bytes de memoria, tiene que quedar bajo {CUARTA_PARTE_MEMORIA}",
            c.memoria
        );
    }
}

#[test]
fn costo_segun_ganadores() {
    // Nativo (siempre) y, si hay `.wasm`, en la máquina virtual de Soroban.
    let nativo = imprimir_tabla(
        "draw, contrato como Rust nativo (no cuenta la ejecución del WASM)",
        None,
    );

    let s3 = medir_seal(18, 3, None);
    let s_tope = medir_seal(1_000, MAX_WINNERS, None);
    std::println!(
        "\nseal nativo: {} instrucciones con 3 ganadores y {} con {MAX_WINNERS}; escritos {} B y {} B (iguales: la entrada Raffle guarda la cantidad, no la lista)",
        s3.instrucciones, s_tope.instrucciones, s3.bytes_escritos, s_tope.bytes_escritos
    );
    assert_eq!(s3.bytes_escritos, s_tope.bytes_escritos);

    if let Some(bytes) = wasm_compilado() {
        let vm = imprimir_tabla(
            "draw, WASM en la máquina virtual de Soroban (lo que paga la red)",
            Some(&bytes),
        );
        let v3 = medir_seal(18, 3, Some(&bytes));
        let v_tope = medir_seal(1_000, MAX_WINNERS, Some(&bytes));
        std::println!(
            "\nseal WASM: {} instrucciones con 3 ganadores y {} con {MAX_WINNERS}; memoria {} B; escritos {} B y {} B",
            v3.instrucciones, v_tope.instrucciones, v3.memoria, v3.bytes_escritos, v_tope.bytes_escritos
        );
        exigir_bajo_la_cuarta_parte(&vm, "WASM");
    } else {
        std::println!("\n(sin TINKAZO_WASM: solo se midió el contrato nativo)");
    }

    // La exigencia: el tope de ganadores queda bajo la cuarta parte del límite de la red.
    exigir_bajo_la_cuarta_parte(&nativo, "nativo");
    // El costo crece con los ganadores, y la entrada Draw también.
    let por = |k: u32, n: u32| &nativo.iter().find(|f| f.0 == k && f.1 == n).unwrap().2;
    assert!(por(MAX_WINNERS, MAX_WINNERS).bytes_draw > por(3, 18).bytes_draw);
    assert!(por(MAX_WINNERS, MAX_WINNERS).instrucciones > por(3, 18).instrucciones);
}

#[test]
fn peor_semilla_de_la_seleccion_con_el_tope_de_ganadores() {
    // Con tantos ganadores como entradas, el recorrido es el del coleccionista
    // de cupones: en promedio `k · H(k)` hashes (unos 519 con 100), y a veces el
    // doble. Se prueban muchas semillas para ver el peor caso y que `draw` entero
    // quede bajo el límite también con la peor. La firma real de una sola ronda no
    // permite variar la semilla en `draw`, así que se mide `select` con cada
    // semilla y se le suma el resto de `draw` (firma BLS, almacenamiento, evento).
    let env = entorno_de_medicion();
    let h = list_hash(&env);
    let mut budget = env.cost_estimate().budget();

    budget.reset_unlimited();
    let _ = select::select(&env, &expected_randomness(&env), &h, MAX_WINNERS, MAX_WINNERS);
    let real = budget.cpu_instruction_cost() as i64;

    let mut peor = 0i64;
    let mut peor_i = 0u32;
    let mut suma = 0i64;
    const SEMILLAS: u32 = 300;
    for i in 0..SEMILLAS {
        let semilla: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_array(&env, &i.to_be_bytes()))
            .into();
        budget.reset_unlimited();
        let sel = select::select(&env, &semilla, &h, MAX_WINNERS, MAX_WINNERS);
        let c = budget.cpu_instruction_cost() as i64;
        assert_eq!(sel.len(), MAX_WINNERS);
        assert_distinct_in_range(&sel, MAX_WINNERS);
        suma += c;
        if c > peor {
            peor = c;
            peor_i = i;
        }
    }
    let draw_real = medir_draw(MAX_WINNERS, MAX_WINNERS, None).instrucciones;
    let resto = draw_real - real;
    std::println!(
        "\nselect {MAX_WINNERS} de {MAX_WINNERS}, nativo, {SEMILLAS} semillas: la real {real}, promedio {}, la peor (semilla {peor_i}) {peor}; resto de draw {resto}; draw con la peor semilla {}",
        suma / SEMILLAS as i64,
        resto + peor
    );
    assert!(resto + peor < CUARTA_PARTE_INSTRUCCIONES);
}
