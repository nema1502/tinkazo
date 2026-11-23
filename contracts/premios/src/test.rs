#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    bytesn, contract, contractimpl,
    testutils::{
        Address as _, Deployer as _, Events as _, IssuerFlags, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    xdr::{
        AccountId, AlphaNum4, AssetCode4, LedgerEntry, LedgerEntryData, LedgerEntryExt, LedgerKey,
        LedgerKeyTrustLine, PublicKey, ScAddress, TrustLineAsset, TrustLineEntry,
        TrustLineEntryExt, Uint256,
    },
    Address, Bytes, BytesN, Env, Event as _, IntoVal, MuxedAddress, String, TryFromVal, Vec,
};
use std::cell::Cell;
use std::rc::Rc;
use std::vec::Vec as StdVec;

// El contrato del sorteo de verdad, compilado desde su fuente. No se usa como
// dependencia de desarrollo porque su `cdylib` no enlaza en Windows con el
// toolchain gnu (demasiados símbolos exportados); incluirlo así prueba el
// mismo código que va a la red. `rustfmt::skip` para que formatear premios no
// toque la fuente del raffle, y `clippy::all` porque esa fuente se revisa en su
// propio crate.
#[rustfmt::skip]
#[allow(dead_code, unused_imports, unused_attributes, clippy::all)]
#[path = "../../raffle/src/lib.rs"]
mod tinkazo_raffle;
use tinkazo_raffle::{TinkazoRaffle, TinkazoRaffleClient};

/// Ronda real de quicknet y su firma (la misma de contracts/raffle/src/test.rs).
const ROUND: u64 = 32_254_977;
const ROUND_TIME: u64 = 1_789_568_295;

fn signature(env: &Env) -> BytesN<96> {
    bytesn!(
        env,
        0x077a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac107dcead72cb133d9242167d8359226b699156f412e370b0850da63cd4ceba93bb81e17107bde7a4018aac91547fa2ac
    )
}

const START: u64 = ROUND_TIME - 3_600;
const OPENS: u64 = START + 60;
const SEAL_BY: u64 = ROUND_TIME - 600;

struct Setup {
    env: Env,
    premios: Address,
    raffle: Address,
    token: Address,
    sac: soroban_sdk::testutils::StellarAssetContract,
    sponsor: Address,
    operator: Address,
    treasury: Address,
}

impl Setup {
    /// El contrato con el modo especie habilitado.
    fn new() -> Self {
        Self::build(&|_| StdVec::new(), true)
    }

    /// El contrato como se despliega en mainnet: solo plata.
    fn cash_only() -> Self {
        Self::build(&|_| StdVec::new(), false)
    }

    /// `extra` entrega tokens adicionales para la lista blanca del contrato;
    /// `allow_in_kind` fija si el constructor admite promociones en especie.
    fn build(extra: &dyn Fn(&Env) -> StdVec<Address>, allow_in_kind: bool) -> Self {
        reset_keys();
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);
        env.ledger().set_sequence_number(1_000);
        let raffle = env.register(TinkazoRaffle, ());
        let treasury = Address::generate(&env);
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token = sac.address();
        let mut allowed = StdVec::new();
        allowed.push(token.clone());
        allowed.extend(extra(&env));
        let premios = env.register(
            TinkazoPremios,
            (
                raffle.clone(),
                treasury.clone(),
                200u32,
                list_of(&env, &allowed),
                allow_in_kind,
            ),
        );
        let sponsor = Address::generate(&env);
        let operator = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&sponsor, &1_000_000_000);
        Setup {
            env,
            premios,
            raffle,
            token,
            sac,
            sponsor,
            operator,
            treasury,
        }
    }

    fn client(&self) -> TinkazoPremiosClient<'_> {
        TinkazoPremiosClient::new(&self.env, &self.premios)
    }

    fn raffle(&self) -> TinkazoRaffleClient<'_> {
        TinkazoRaffleClient::new(&self.env, &self.raffle)
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    fn rules(&self) -> BytesN<32> {
        self.env
            .crypto()
            .sha256(&Bytes::from_slice(&self.env, b"{\"v\":1}"))
            .into()
    }

    fn title(&self) -> String {
        String::from_str(&self.env, "Evento de prueba: 40 USDC de marca")
    }

    fn create_cash(&self, prizes: &[i128]) -> u64 {
        self.client().create(
            &self.sponsor,
            &self.operator,
            &self.token,
            &vec_of(&self.env, prizes),
            &false,
            &0,
            &self.rules(),
            &OPENS,
            &SEAL_BY,
            &self.title(),
        )
    }

    fn create_in_kind(&self, prizes: &[i128], delivery: u64) -> u64 {
        self.client().create(
            &self.sponsor,
            &self.operator,
            &self.token,
            &vec_of(&self.env, prizes),
            &true,
            &delivery,
            &self.rules(),
            &OPENS,
            &SEAL_BY,
            &self.title(),
        )
    }

    /// `n` cuentas `G…` ordenadas, cada una con línea de confianza al token
    /// del contrato: pueden recibir el pago.
    fn entries(&self, n: u32) -> Vec<Address> {
        sort(&self.env, (0..n).map(|_| self.funded_account()).collect())
    }

    /// Una cuenta `G…` con línea de confianza al token.
    fn funded_account(&self) -> Address {
        let who = fresh_account(&self.env);
        open_trustline(&self.env, &self.sac, &who);
        who
    }

    fn at(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }

    /// Abre, sella, avanza hasta la ronda y registra el sorteo.
    fn seal_and_draw(&self, id: u64, entries: &Vec<Address>) -> u64 {
        self.at(OPENS);
        let raffle_id = self.client().seal(&id, entries, &ROUND);
        self.at(ROUND_TIME + 5);
        self.raffle().draw(&raffle_id, &signature(&self.env));
        raffle_id
    }

    fn winners(&self, raffle_id: u64, entries: &Vec<Address>) -> StdVec<Address> {
        let draw = self.raffle().get_draw(&raffle_id).unwrap();
        draw.winners
            .iter()
            .map(|i| entries.get(i).unwrap())
            .collect()
    }
}

fn list_of(env: &Env, xs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for x in xs {
        v.push_back(x.clone());
    }
    v
}

std::thread_local! {
    /// Contador de cuentas por hilo. Cada prueba corre en su hilo y lo
    /// reinicia al armar su entorno: así las cuentas, y con ellas los
    /// test_snapshots, salen iguales en cada corrida, sin depender del orden
    /// en que corren las pruebas en paralelo.
    static NEXT_KEY: Cell<u32> = const { Cell::new(1) };
}

/// Vuelve a numerar las cuentas desde 1 (al armar un entorno nuevo).
fn reset_keys() {
    NEXT_KEY.with(|k| k.set(1));
}

/// Una cuenta `G…` distinta de las demás del mismo entorno, sin nada en el ledger.
fn fresh_account(env: &Env) -> Address {
    let n = NEXT_KEY.with(|k| {
        let n = k.get();
        k.set(n + 1);
        n
    });
    let mut key = [0xA5u8; 32];
    key[..4].copy_from_slice(&n.to_be_bytes());
    let sc = ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(key))));
    Address::try_from_val(env, &sc).unwrap()
}

/// Abre una línea de confianza autorizada, en cero, de `who` al token del SAC.
fn open_trustline(env: &Env, sac: &soroban_sdk::testutils::StellarAssetContract, who: &Address) {
    let ScAddress::Account(account_id) = ScAddress::from(who) else {
        panic!("se esperaba una cuenta");
    };
    let soroban_sdk::xdr::Asset::CreditAlphanum4(AlphaNum4 { asset_code, issuer }) = sac.asset()
    else {
        panic!("se esperaba un activo de cuatro letras");
    };
    let asset = TrustLineAsset::CreditAlphanum4(AlphaNum4 {
        asset_code: AssetCode4(asset_code.0),
        issuer,
    });
    let key = Rc::new(LedgerKey::Trustline(LedgerKeyTrustLine {
        account_id: account_id.clone(),
        asset: asset.clone(),
    }));
    let entry = Rc::new(LedgerEntry {
        last_modified_ledger_seq: 0,
        data: LedgerEntryData::Trustline(TrustLineEntry {
            account_id,
            asset,
            balance: 0,
            limit: i64::MAX,
            flags: 1,
            ext: TrustLineEntryExt::V0,
        }),
        ext: LedgerEntryExt::V0,
    });
    env.host().add_ledger_entry(&key, &entry, None).unwrap();
}

fn vec_of(env: &Env, xs: &[i128]) -> Vec<i128> {
    let mut v = Vec::new(env);
    for x in xs {
        v.push_back(*x);
    }
    v
}

fn strkey_std(a: &Address) -> [u8; 56] {
    let s = a.to_string();
    let mut b = [0u8; 56];
    s.copy_into_slice(&mut b);
    b
}

fn sort(env: &Env, xs: StdVec<Address>) -> Vec<Address> {
    let mut pairs: StdVec<([u8; 56], Address)> =
        xs.into_iter().map(|a| (strkey_std(&a), a)).collect();
    pairs.sort_by_key(|p| p.0);
    let mut v = Vec::new(env);
    for (_, a) in pairs {
        v.push_back(a);
    }
    v
}

/// Cuentas `G…` ordenadas, sin nada en el ledger.
fn entries(env: &Env, n: u32) -> Vec<Address> {
    sort(env, (0..n).map(|_| fresh_account(env)).collect())
}

/// Cuentas `G…` que no existen en el ledger: no pueden recibir el token.
fn account_entries(env: &Env, n: u8) -> Vec<Address> {
    let xs = (0..n)
        .map(|i| {
            let sc = ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
                [i + 1; 32],
            ))));
            Address::try_from_val(env, &sc).unwrap()
        })
        .collect();
    sort(env, xs)
}

/// El hash del protocolo §1, calculado aparte: direcciones unidas por "\n".
fn protocol_hash(env: &Env, entries: &Vec<Address>) -> BytesN<32> {
    let mut text = std::string::String::new();
    for (i, a) in entries.iter().enumerate() {
        if i > 0 {
            text.push('\n');
        }
        text.push_str(std::str::from_utf8(&strkey_std(&a)).unwrap());
    }
    env.crypto()
        .sha256(&Bytes::from_slice(env, text.as_bytes()))
        .into()
}

// ------------------------------------------------------------ constructor

#[test]
fn constructor_fixes_config() {
    let s = Setup::new();
    let c = s.client().get_config();
    assert_eq!(c.raffle, s.raffle);
    assert_eq!(c.treasury, s.treasury);
    assert_eq!(c.fee_bps, 200);
    // El constructor también guarda si se admite el modo especie.
    assert!(c.allow_in_kind);
}

/// Registra el contrato con los parámetros dados; el constructor los valida.
fn register(env: &Env, raffle: &Address, treasury: &Address, fee_bps: u32, tokens: &[Address]) {
    env.register(
        TinkazoPremios,
        (
            raffle.clone(),
            treasury.clone(),
            fee_bps,
            list_of(env, tokens),
            false,
        ),
    );
}

#[test]
fn constructor_fixes_the_token_whitelist() {
    let s = Setup::new();
    assert_eq!(
        s.client().get_config().tokens,
        list_of(&s.env, core::slice::from_ref(&s.token))
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_fee_above_ten_percent() {
    let env = Env::default();
    let (a, b, t) = (
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    );
    register(&env, &a, &b, 1_001, &[t]);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_an_empty_token_list() {
    let env = Env::default();
    let (a, b) = (Address::generate(&env), Address::generate(&env));
    register(&env, &a, &b, 200, &[]);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_more_than_eight_tokens() {
    let env = Env::default();
    let (a, b) = (Address::generate(&env), Address::generate(&env));
    let tokens: StdVec<Address> = (0..=MAX_TOKENS).map(|_| Address::generate(&env)).collect();
    register(&env, &a, &b, 200, &tokens);
}

#[test]
fn constructor_accepts_eight_tokens() {
    let env = Env::default();
    let (a, b) = (Address::generate(&env), Address::generate(&env));
    let tokens: StdVec<Address> = (0..MAX_TOKENS).map(|_| Address::generate(&env)).collect();
    register(&env, &a, &b, 200, &tokens);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_repeated_tokens() {
    let env = Env::default();
    let (a, b, t, u) = (
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    );
    register(&env, &a, &b, 200, &[t.clone(), u, t]);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_itself_as_token() {
    let env = Env::default();
    let me = Address::generate(&env);
    let (a, b) = (Address::generate(&env), Address::generate(&env));
    env.register_at(
        &me,
        TinkazoPremios,
        (
            a,
            b,
            200u32,
            list_of(&env, core::slice::from_ref(&me)),
            false,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_itself_as_raffle() {
    let env = Env::default();
    let me = Address::generate(&env);
    let (b, t) = (Address::generate(&env), Address::generate(&env));
    env.register_at(
        &me,
        TinkazoPremios,
        (me.clone(), b, 200u32, list_of(&env, &[t]), false),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn constructor_rejects_itself_as_treasury() {
    let env = Env::default();
    let me = Address::generate(&env);
    let (a, t) = (Address::generate(&env), Address::generate(&env));
    env.register_at(
        &me,
        TinkazoPremios,
        (a, me.clone(), 200u32, list_of(&env, &[t]), false),
    );
}

#[test]
fn the_binver_meta_matches_the_crate_version() {
    // El contrato publica su versión en el meta `binver` (lo muestran `stellar
    // contract info meta` y stellar.expert): tiene que ser la del crate.
    let declared = std::format!(
        "contractmeta!(key = \"binver\", val = \"{}\");",
        env!("CARGO_PKG_VERSION")
    );
    assert!(
        include_str!("lib.rs").contains(&declared),
        "el meta binver de lib.rs no coincide con la versión del crate ({})",
        env!("CARGO_PKG_VERSION")
    );
}

#[test]
fn fee_rounds_up() {
    let s = Setup::new();
    assert_eq!(s.client().fee_for(&400_000_000), 8_000_000); // 40 USDC -> 0,80
    assert_eq!(s.client().fee_for(&1), 1);
    assert_eq!(s.client().fee_for(&50), 1);
    assert_eq!(s.client().fee_for(&51), 2);
}

// ----------------------------------------------------------------- create

#[test]
fn create_takes_prize_plus_fee() {
    let s = Setup::new();
    let id = s.create_cash(&[400_000_000]);
    // La autorización de la empresa se exigió.
    assert_eq!(s.env.auths()[0].0, s.sponsor);
    assert_eq!(id, 1);
    assert_eq!(s.balance(&s.premios), 408_000_000);
    assert_eq!(s.balance(&s.sponsor), 1_000_000_000 - 408_000_000);
    let p = s.client().get_promo(&id).unwrap();
    assert_eq!(p.status, PromoStatus::Funded);
    assert_eq!(p.fee, 8_000_000);
    assert_eq!(p.sponsor, s.sponsor);
    assert_eq!(p.raffle_id, 0);
    assert_eq!(s.client().next_id(), 2);
}

#[test]
fn create_rejects_bad_inputs() {
    let s = Setup::new();
    let c = s.client();
    let e = &s.env;
    let r = s.rules();
    let t = s.title();
    let ok = vec_of(e, &[10]);
    let call = |prizes: &Vec<i128>,
                in_kind: bool,
                delivery: u64,
                opens: u64,
                seal_by: u64,
                title: &String| {
        c.try_create(
            &s.sponsor,
            &s.operator,
            &s.token,
            prizes,
            &in_kind,
            &delivery,
            &r,
            &opens,
            &seal_by,
            title,
        )
    };
    assert_eq!(
        call(&vec_of(e, &[]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&vec_of(e, &[10, 0]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&vec_of(e, &[-5]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&vec_of(e, &[1; 11]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&vec_of(e, &[i128::MAX, 1]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&vec_of(e, &[i128::MAX / 2]), false, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidPrizes))
    );
    assert_eq!(
        call(&ok, false, 0, OPENS, START, &t),
        Err(Ok(Error::InvalidSchedule))
    );
    assert_eq!(
        call(&ok, false, 0, SEAL_BY + 1, SEAL_BY, &t),
        Err(Ok(Error::InvalidSchedule))
    );
    assert_eq!(
        call(&ok, false, 0, OPENS, START + MAX_SEAL_WINDOW_SECS + 1, &t),
        Err(Ok(Error::InvalidSchedule))
    );
    assert_eq!(
        call(&ok, false, 5, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidDelivery))
    );
    assert_eq!(
        call(&ok, true, 0, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidDelivery))
    );
    assert_eq!(
        call(&ok, true, MAX_DELIVERY_SECS + 1, OPENS, SEAL_BY, &t),
        Err(Ok(Error::InvalidDelivery))
    );
    let long = String::from_str(e, &"x".repeat(161));
    assert_eq!(
        call(&ok, false, 0, OPENS, SEAL_BY, &long),
        Err(Ok(Error::TitleTooLong))
    );
    // Nada se movió.
    assert_eq!(s.balance(&s.premios), 0);
}

/// Un token que se queda con una unidad en cada transferencia.
#[contract]
pub struct SkimmingToken;

#[contractimpl]
impl SkimmingToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let b: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&to, &(b + amount));
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&id).unwrap_or(0)
    }
    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        let bf: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        let bt: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&from, &(bf - amount));
        env.storage().persistent().set(&to, &(bt + amount - 1));
    }
}

#[test]
fn create_rejects_token_that_skims() {
    // El token está en la lista blanca: queda la comprobación de saldos.
    let s = Setup::build(&|env| std::vec![env.register(SkimmingToken, ())], true);
    let bad = s.client().get_config().tokens.get(1).unwrap();
    SkimmingTokenClient::new(&s.env, &bad).mint(&s.sponsor, &1_000);
    let r = s.client().try_create(
        &s.sponsor,
        &s.operator,
        &bad,
        &vec_of(&s.env, &[100]),
        &false,
        &0,
        &s.rules(),
        &OPENS,
        &SEAL_BY,
        &s.title(),
    );
    assert_eq!(r, Err(Ok(Error::FundingMismatch)));
}

// ------------------------------------------------- modo especie apagado

#[test]
fn create_in_kind_is_rejected_when_the_contract_is_cash_only() {
    let s = Setup::cash_only();
    assert!(!s.client().get_config().allow_in_kind);
    let sponsor_before = s.balance(&s.sponsor);
    let r = s.client().try_create(
        &s.sponsor,
        &s.operator,
        &s.token,
        &vec_of(&s.env, &[9_000]),
        &true,
        &86_400,
        &s.rules(),
        &OPENS,
        &SEAL_BY,
        &s.title(),
    );
    assert_eq!(r, Err(Ok(Error::InKindDisabled)));
    // No se movió ningún token ni quedó nada creado.
    assert_eq!(s.balance(&s.sponsor), sponsor_before);
    assert_eq!(s.balance(&s.premios), 0);
    assert_eq!(s.client().next_id(), 1);
    assert!(s.client().get_promo(&1).is_none());
    // Plata sí: lo que rechaza es el modo especie, no la promoción.
    assert_eq!(s.create_cash(&[9_000]), 1);
}

#[test]
fn a_cash_only_contract_runs_a_cash_promo_the_same() {
    let s = Setup::cash_only();
    // Una de las dos ganadoras no puede recibir: queda adeudada y se cobra
    // después, como en un contrato con el modo especie habilitado.
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let id = s.create_cash(&[300, 200]);
    let id2 = s.create_cash(&[400]);
    let list = s.entries(8);
    let raffle_id = s.seal_and_draw(id, &list);
    let ws = s.winners(raffle_id, &list);
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.set_authorized(&ws[0], &false);

    s.client().settle(&id, &list);
    assert_eq!(s.balance(&ws[1]), 200);
    assert_eq!(s.balance(&s.treasury), 10);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Owed
    );
    sac.set_authorized(&ws[0], &true);
    s.client().claim(&id, &0);
    assert_eq!(s.balance(&ws[0]), 300);
    let p = s.client().get_promo(&id).unwrap();
    assert!(!p.in_kind);
    assert_eq!(p.status, PromoStatus::Settled);

    // Y una promoción que nadie selló vuelve a la empresa (ya pasó `seal_by`).
    assert_eq!(s.balance(&s.premios), 408);
    let before = s.balance(&s.sponsor);
    s.client().refund(&id2);
    assert_eq!(s.balance(&s.sponsor), before + 408);
    assert_eq!(s.balance(&s.premios), 0);
}

// ----------------------------------------------------------------- cancel

#[test]
fn cancel_only_before_opening() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let id2 = s.create_cash(&[400]);
    s.client().cancel(&id);
    assert_eq!(
        s.client().get_promo(&id).unwrap().status,
        PromoStatus::Cancelled
    );
    assert_eq!(s.client().try_cancel(&id), Err(Ok(Error::WrongStatus)));
    s.at(OPENS);
    assert_eq!(s.client().try_cancel(&id2), Err(Ok(Error::TooLate)));
    assert_eq!(s.balance(&s.premios), 408);
    assert_eq!(s.client().try_cancel(&99), Err(Ok(Error::NotFound)));
}

// ------------------------------------------------------------------- seal

#[test]
fn seal_binds_the_list_to_a_raffle_organized_by_this_contract() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(18);
    s.at(OPENS);
    let raffle_id = s.client().seal(&id, &list, &ROUND);
    assert_eq!(raffle_id, 1);
    // La autorización que se pidió fue la del operador.
    assert_eq!(s.env.auths()[0].0, s.operator);

    let sealed = s.raffle().get_raffle(&raffle_id).unwrap();
    assert_eq!(sealed.organizer, s.premios);
    assert_eq!(sealed.list_hash, protocol_hash(&s.env, &list));
    assert_eq!(sealed.count, 18);
    assert_eq!(sealed.num_winners, 1);
    assert_eq!(sealed.round, ROUND);
    assert_eq!(sealed.meta, s.title());

    let p = s.client().get_promo(&id).unwrap();
    assert_eq!(p.status, PromoStatus::Sealed);
    assert_eq!(p.raffle_id, raffle_id);
    assert_eq!(p.list_hash, sealed.list_hash);
    assert_eq!(p.count, 18);

    // Una sola vez.
    assert_eq!(
        s.client().try_seal(&id, &list, &ROUND),
        Err(Ok(Error::WrongStatus))
    );
}

#[test]
fn seal_emits_event() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(3);
    s.at(OPENS);
    s.client().seal(&id, &list, &ROUND);
    let expected = PromoSealed {
        promo_id: id,
        raffle_id: 1,
        list_hash: protocol_hash(&s.env, &list),
        count: 3,
        round: ROUND,
    };
    assert!(s
        .env
        .events()
        .all()
        .events()
        .contains(&expected.to_xdr(&s.env, &s.premios)));
}

#[test]
fn seal_rejects_bad_lists_and_times() {
    let s = Setup::new();
    let id = s.create_cash(&[400, 300, 200]);
    let list = s.entries(5);
    let c = s.client();

    assert_eq!(c.try_seal(&id, &list, &ROUND), Err(Ok(Error::TooEarly)));
    s.at(OPENS);

    // Menos cuentas que premios, y menos de dos.
    assert_eq!(
        c.try_seal(&id, &s.entries(2), &ROUND),
        Err(Ok(Error::TooFewEntries))
    );

    // Desordenada.
    let mut unsorted = list.clone();
    let a = unsorted.get(0).unwrap();
    let b = unsorted.get(1).unwrap();
    unsorted.set(0, b);
    unsorted.set(1, a);
    assert_eq!(
        c.try_seal(&id, &unsorted, &ROUND),
        Err(Ok(Error::EntriesNotSorted))
    );

    // Repetida.
    let mut dup = list.clone();
    dup.set(1, list.get(0).unwrap());
    assert_eq!(
        c.try_seal(&id, &dup, &ROUND),
        Err(Ok(Error::EntriesNotSorted))
    );

    // La empresa, el operador o la tesorería en la lista.
    for who in [&s.sponsor, &s.operator, &s.treasury] {
        let mut xs: StdVec<Address> = list.iter().collect();
        xs.push(who.clone());
        assert_eq!(
            c.try_seal(&id, &sort(&s.env, xs), &ROUND),
            Err(Ok(Error::ExcludedEntry))
        );
    }

    // Una ronda que ya existe la rechaza el raffle (y no queda nada sellado).
    assert!(c.try_seal(&id, &list, &(ROUND - 2_000)).is_err());
    assert_eq!(c.get_promo(&id).unwrap().status, PromoStatus::Funded);
    assert_eq!(s.raffle().next_id(), 1);

    s.at(SEAL_BY + 1);
    assert_eq!(c.try_seal(&id, &list, &ROUND), Err(Ok(Error::TooLate)));
}

#[test]
fn seal_rejects_more_than_max_entries() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.at(OPENS);
    s.env.cost_estimate().budget().reset_unlimited();
    let list = entries(&s.env, MAX_ENTRIES + 1);
    assert_eq!(
        s.client().try_seal(&id, &list, &ROUND),
        Err(Ok(Error::TooManyEntries))
    );
}

/// Tope de instrucciones por llamada que se exige a `seal` y a `settle`: un
/// cuarto del límite de mainnet (400 millones), para tener al menos cuatro
/// veces de margen si el protocolo 30 recalibra el costo de las instrucciones.
const MAX_INSTRUCTIONS: u64 = 100_000_000;

/// Cuántas veces más instrucciones gasta el .wasm real que el mismo contrato
/// en código nativo, con la carga del peor caso (1.000 cuentas y 10 premios
/// pagados de verdad, sorteo incluido). Medido el 5 de noviembre de 2026:
/// `seal` pasa de 5,5 millones nativos a 45,1 millones en WASM (8,2 veces) y
/// `settle`, de 8,0 a 47,6 millones (5,9 veces). Se toma 10 para dar holgura
/// sobre la peor de las dos. Si cambia el contrato, se vuelve a medir: se
/// compila el .wasm y se corre esta prueba y la del .wasm con `--nocapture`.
const NATIVE_TO_WASM_FACTOR: u64 = 10;

#[test]
fn seal_and_settle_with_max_entries_work() {
    // Esta prueba corre el contrato en código nativo, que no cuenta las
    // instrucciones del WASM: solo las llamadas al host, entre seis y ocho veces
    // menos que lo que gasta el .wasm real. Por eso la aserción de presupuesto
    // multiplica lo medido por `NATIVE_TO_WASM_FACTOR` y lo compara con el
    // tope; así protege el presupuesto aunque no esté compilado el .wasm. La
    // medida exacta, con el .wasm, está en
    // `wasm_budget_seal_and_settle_with_max_entries`.
    //
    // La carga es la del peor caso, la misma de la prueba del .wasm: 1.000
    // cuentas y `MAX_PRIZES` premios, con las diez ganadoras en condiciones de
    // recibir. Así el factor se calibra con diez pagos, no con uno.
    let s = Setup::new();
    let id = s.create_cash(&[100i128; MAX_PRIZES as usize]);
    s.env.cost_estimate().budget().reset_unlimited();
    let list = entries(&s.env, MAX_ENTRIES);
    s.at(OPENS);
    s.env.cost_estimate().budget().reset_unlimited();
    s.client().seal(&id, &list, &ROUND);
    let cpu_seal = s.env.cost_estimate().budget().cpu_instruction_cost();
    s.at(ROUND_TIME + 5);
    s.raffle().draw(&1, &signature(&s.env));
    // Las diez ganadoras reciben plata: se les abre la línea de confianza para
    // que el pago sea real y se mida entero.
    let winners = s.winners(1, &list);
    assert_eq!(winners.len(), MAX_PRIZES as usize);
    for winner in &winners {
        open_trustline(&s.env, &s.sac, winner);
    }
    s.env.cost_estimate().budget().reset_unlimited();
    s.client().settle(&id, &list);
    let cpu_settle = s.env.cost_estimate().budget().cpu_instruction_cost();
    for winner in &winners {
        assert_eq!(s.balance(winner), 100);
    }
    assert_eq!(s.balance(&s.premios), 0);
    std::println!(
        "1.000 cuentas, en nativo (no es el presupuesto de la red): seal {cpu_seal} instrucciones, settle {cpu_settle}"
    );
    assert!(
        cpu_seal * NATIVE_TO_WASM_FACTOR < MAX_INSTRUCTIONS,
        "seal gasta {cpu_seal} instrucciones en nativo: en WASM pasaría de {MAX_INSTRUCTIONS}"
    );
    assert!(
        cpu_settle * NATIVE_TO_WASM_FACTOR < MAX_INSTRUCTIONS,
        "settle gasta {cpu_settle} instrucciones en nativo: en WASM pasaría de {MAX_INSTRUCTIONS}"
    );
}

// -------------------------------------------- presupuesto con el WASM real

/// Directorio donde `cargo build --release --target wasm32v1-none` deja los .wasm.
fn wasm_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/wasm32v1-none/release")
}

/// Mide `seal` y `settle` con el .wasm compilado de este contrato, el mismo que
/// va a la red, en el peor caso que admite: 1.000 cuentas y 10 premios, todos
/// pagados de verdad. Exige menos de 100 millones de instrucciones y menos de
/// 30 MB de memoria por llamada, para dejar al menos cuatro veces de margen
/// respecto del límite de mainnet por si el protocolo 30 recalibra el costo de
/// las instrucciones.
///
/// El sorteo también corre en WASM si su .wasm está compilado; si no, corre en
/// nativo y el costo de sus llamadas sale subestimado (se avisa).
///
/// Cómo correrla:
///
/// ```text
/// cargo build --release --target wasm32v1-none -p tinkazo-premios
/// cargo build --release --target wasm32v1-none -p tinkazo-raffle   (opcional)
/// ```
///
/// Está marcada `#[ignore]`: `cargo test --workspace` corre antes de que exista
/// el .wasm (en la CI y en el release no se compila antes de las pruebas) y la
/// dejaría en rojo en un checkout limpio. Se corre a propósito, después de
/// compilar, con `--ignored`:
///
/// ```text
/// cargo build --release --target wasm32v1-none -p tinkazo-premios
/// cargo test -p tinkazo-premios -- --ignored wasm_budget --nocapture
/// ```
///
/// Cuando se corre, el .wasm es obligatorio: si no existe, o es más viejo que la
/// fuente, la prueba FALLA con las instrucciones para compilarlo, en vez de
/// saltarse en silencio y medir nada.
#[test]
#[ignore = "mide con el .wasm real: compilarlo primero y correr con --ignored"]
fn wasm_budget_seal_and_settle_with_max_entries() {
    const MAX_MEMORY: u64 = 30 * 1_000_000;
    let dir = wasm_dir();
    let premios_path = dir.join("tinkazo_premios.wasm");
    let premios_wasm = std::fs::read(&premios_path).unwrap_or_else(|_| {
        panic!(
            "falta {}: esta prueba mide el presupuesto con el .wasm real y no se puede saltar.
Generalo con
  cargo build --release --target wasm32v1-none -p tinkazo-premios
y volvé a correr
  cargo test -p tinkazo-premios -- --ignored wasm_budget",
            premios_path.display()
        )
    });
    // Si el .wasm es más viejo que la fuente, mediría otro código.
    let wasm_time = std::fs::metadata(&premios_path)
        .and_then(|m| m.modified())
        .expect("no se pudo leer la fecha del .wasm");
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for name in ["lib.rs", "list.rs", "raffle.rs"] {
        let src_time = std::fs::metadata(src.join(name))
            .and_then(|m| m.modified())
            .expect("no se pudo leer la fecha de la fuente");
        assert!(
            src_time <= wasm_time,
            "src/{name} es más nuevo que el .wasm: compilalo de nuevo (cargo build --release --target wasm32v1-none -p tinkazo-premios) antes de medir"
        );
    }
    let raffle_wasm = std::fs::read(dir.join("tinkazo_raffle.wasm")).ok();

    reset_keys();
    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    env.ledger().set_sequence_number(1_000);
    let raffle = match &raffle_wasm {
        Some(code) => env.register(code.as_slice(), ()),
        None => {
            std::println!("ADVERTENCIA: no está tinkazo_raffle.wasm; el sorteo corre en nativo");
            env.register(TinkazoRaffle, ())
        }
    };
    let treasury = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = sac.address();
    let premios = env.register(
        premios_wasm.as_slice(),
        (
            raffle.clone(),
            treasury.clone(),
            200u32,
            list_of(&env, core::slice::from_ref(&token)),
            // Como se despliega en mainnet: solo plata.
            false,
        ),
    );
    let client = TinkazoPremiosClient::new(&env, &premios);
    let sponsor = Address::generate(&env);
    let operator = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&sponsor, &1_000_000_000);

    let prizes = [100i128; MAX_PRIZES as usize];
    let rules: BytesN<32> = env.crypto().sha256(&Bytes::from_slice(&env, b"{}")).into();
    let id = client.create(
        &sponsor,
        &operator,
        &token,
        &vec_of(&env, &prizes),
        &false,
        &0,
        &rules,
        &OPENS,
        &SEAL_BY,
        &String::from_str(&env, "Evento de prueba: 40 USDC de marca"),
    );
    env.cost_estimate().budget().reset_unlimited();
    let list = entries(&env, MAX_ENTRIES);
    env.ledger().set_timestamp(OPENS);

    env.cost_estimate().budget().reset_unlimited();
    let raffle_id = client.seal(&id, &list, &ROUND);
    let seal_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let seal_mem = env.cost_estimate().budget().memory_bytes_cost();

    env.ledger().set_timestamp(ROUND_TIME + 5);
    let raffle_client = TinkazoRaffleClient::new(&env, &raffle);
    env.cost_estimate().budget().reset_unlimited();
    raffle_client.draw(&raffle_id, &signature(&env));
    let draw = raffle_client.get_draw(&raffle_id).unwrap();
    // Las diez ganadoras pueden recibir: el pago es real y se mide entero.
    let winners: StdVec<Address> = draw.winners.iter().map(|i| list.get(i).unwrap()).collect();
    assert_eq!(winners.len(), MAX_PRIZES as usize);
    for w in &winners {
        open_trustline(&env, &sac, w);
    }

    env.cost_estimate().budget().reset_unlimited();
    client.settle(&id, &list);
    let settle_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let settle_mem = env.cost_estimate().budget().memory_bytes_cost();

    let token_client = TokenClient::new(&env, &token);
    for w in &winners {
        assert_eq!(token_client.balance(w), 100);
    }
    assert_eq!(token_client.balance(&premios), 0);
    std::println!(
        "WASM de premios ({} bytes), 1.000 cuentas y 10 premios, sorteo en {}:\n  seal   {seal_cpu} instrucciones, {seal_mem} bytes de memoria\n  settle {settle_cpu} instrucciones, {settle_mem} bytes de memoria",
        premios_wasm.len(),
        if raffle_wasm.is_some() {
            "WASM"
        } else {
            "nativo"
        }
    );
    assert!(
        seal_cpu < MAX_INSTRUCTIONS,
        "seal gasta {seal_cpu} instrucciones"
    );
    assert!(
        settle_cpu < MAX_INSTRUCTIONS,
        "settle gasta {settle_cpu} instrucciones"
    );
    assert!(seal_mem < MAX_MEMORY, "seal usa {seal_mem} bytes");
    assert!(settle_mem < MAX_MEMORY, "settle usa {settle_mem} bytes");
}

// ----------------------------------------------------------------- settle

#[test]
fn settle_pays_the_winner_and_the_fee() {
    let s = Setup::new();
    let id = s.create_cash(&[400_000_000]);
    let list = s.entries(18);
    let raffle_id = s.seal_and_draw(id, &list);
    let winner = s.winners(raffle_id, &list)[0].clone();

    s.client().settle(&id, &list);
    let paid = PrizePaid {
        promo_id: id,
        winner: winner.clone(),
        position: 0,
        amount: 400_000_000,
    };
    assert!(s
        .env
        .events()
        .all()
        .events()
        .contains(&paid.to_xdr(&s.env, &s.premios)));

    assert_eq!(s.balance(&winner), 400_000_000);
    assert_eq!(s.balance(&s.treasury), 8_000_000);
    assert_eq!(s.balance(&s.premios), 0);
    let prize = s.client().get_prize(&id, &0).unwrap();
    assert_eq!(prize.state, PrizeState::Paid);
    assert_eq!(prize.winner, winner);
    assert_eq!(
        prize.index,
        s.raffle()
            .get_draw(&raffle_id)
            .unwrap()
            .winners
            .get(0)
            .unwrap()
    );
    let p = s.client().get_promo(&id).unwrap();
    assert_eq!(p.status, PromoStatus::Settled);
    assert_eq!(p.settled_at, ROUND_TIME + 5);

    // Una sola vez, y nadie más cobra.
    assert_eq!(
        s.client().try_settle(&id, &list),
        Err(Ok(Error::WrongStatus))
    );
    assert_eq!(
        s.client().try_claim(&id, &0),
        Err(Ok(Error::WrongPrizeState))
    );
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::WrongStatus)));
}

#[test]
fn settle_pays_several_prizes_in_order() {
    let s = Setup::new();
    let id = s.create_cash(&[300, 200, 100]);
    let list = s.entries(10);
    let raffle_id = s.seal_and_draw(id, &list);
    let ws = s.winners(raffle_id, &list);
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&ws[0]), 300);
    assert_eq!(s.balance(&ws[1]), 200);
    assert_eq!(s.balance(&ws[2]), 100);
    assert_eq!(s.balance(&s.treasury), 12);
    assert_eq!(s.balance(&s.premios), 0);
    let paid: i128 = list.iter().map(|a| s.balance(&a)).sum();
    assert_eq!(paid, 600);
}

#[test]
fn settle_before_the_draw_fails() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    s.at(OPENS);
    s.client().seal(&id, &list, &ROUND);
    assert_eq!(s.client().try_settle(&id, &list), Err(Ok(Error::NotDrawn)));
    let id2 = s.create_cash(&[400]);
    assert_eq!(
        s.client().try_settle(&id2, &list),
        Err(Ok(Error::WrongStatus))
    );
}

#[test]
fn settle_rejects_any_list_other_than_the_sealed_one() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(8);
    s.seal_and_draw(id, &list);
    let c = s.client();

    // Una cuenta cambiada por otra (la lista sigue ordenada).
    let mut xs: StdVec<Address> = list.iter().collect();
    xs[3] = s.funded_account();
    let swapped = sort(&s.env, xs);
    assert_eq!(c.try_settle(&id, &swapped), Err(Ok(Error::ListMismatch)));

    // Una de menos, una de más.
    let mut shorter = list.clone();
    shorter.pop_back();
    assert_eq!(c.try_settle(&id, &shorter), Err(Ok(Error::ListMismatch)));
    let mut ys: StdVec<Address> = list.iter().collect();
    ys.push(s.funded_account());
    assert_eq!(
        c.try_settle(&id, &sort(&s.env, ys)),
        Err(Ok(Error::ListMismatch))
    );

    // Reordenada para poner a otro en la posición ganadora.
    let mut rev = Vec::new(&s.env);
    for a in list.iter().rev() {
        rev.push_back(a);
    }
    assert_eq!(c.try_settle(&id, &rev), Err(Ok(Error::EntriesNotSorted)));

    assert_eq!(s.balance(&s.premios), 408);
    c.settle(&id, &list);
    assert_eq!(s.balance(&s.premios), 0);
}

#[test]
fn a_raffle_sealed_directly_cannot_be_used() {
    // Alguien sella la misma lista directo en el raffle: no cambia nada,
    // porque la promoción quedó atada a su propio sorteo al sellar.
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(6);
    let other = Address::generate(&s.env);
    s.at(OPENS);
    let rogue = s.raffle().seal(
        &other,
        &protocol_hash(&s.env, &list),
        &6,
        &1,
        &(ROUND + 10),
        &s.title(),
    );
    let mine = s.client().seal(&id, &list, &ROUND);
    assert_ne!(rogue, mine);
    assert_eq!(s.client().get_promo(&id).unwrap().raffle_id, mine);
}

#[test]
fn a_winner_that_cannot_receive_is_owed_and_does_not_block_others() {
    let s = Setup::new();
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let id = s.create_cash(&[300, 200]);
    let list = s.entries(6);
    let raffle_id = s.seal_and_draw(id, &list);
    let ws = s.winners(raffle_id, &list);
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.set_authorized(&ws[0], &false);

    s.client().settle(&id, &list);
    let p0 = s.client().get_prize(&id, &0).unwrap();
    assert_eq!(p0.state, PrizeState::Owed);
    assert_eq!(p0.claim_until, ROUND_TIME + 5 + CLAIM_WINDOW_SECS);
    assert_eq!(
        s.client().get_prize(&id, &1).unwrap().state,
        PrizeState::Paid
    );
    assert_eq!(s.balance(&ws[1]), 200);
    assert_eq!(s.balance(&s.premios), 300);

    // Mientras no pueda recibir, cobrar falla y no cambia nada.
    assert!(s.client().try_claim(&id, &0).is_err());
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Owed
    );
    // Todavía no vence: la empresa no lo puede recuperar.
    assert_eq!(s.client().try_reclaim(&id, &0), Err(Ok(Error::TooEarly)));

    sac.set_authorized(&ws[0], &true);
    s.client().claim(&id, &0);
    assert_eq!(s.balance(&ws[0]), 300);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Paid
    );
    assert_eq!(
        s.client().try_claim(&id, &0),
        Err(Ok(Error::WrongPrizeState))
    );
}

#[test]
fn accounts_without_trustline_are_owed() {
    // Cuentas G que no existen en el ledger: el token no les puede pagar.
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = account_entries(&s.env, 5);
    assert_eq!(protocol_hash(&s.env, &list).len(), 32);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    let p = s.client().get_prize(&id, &0).unwrap();
    assert_eq!(p.state, PrizeState::Owed);
    assert_eq!(s.balance(&s.treasury), 8);
    assert_eq!(s.balance(&s.premios), 400);
}

#[test]
fn an_unclaimed_prize_returns_to_the_sponsor_after_the_window() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = account_entries(&s.env, 3);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    let before = s.balance(&s.sponsor);
    s.at(ROUND_TIME + 5 + CLAIM_WINDOW_SECS + 1);
    assert_eq!(s.client().try_claim(&id, &0), Err(Ok(Error::TooLate)));
    s.client().reclaim(&id, &0);
    assert_eq!(s.balance(&s.sponsor), before + 400);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Returned
    );
    assert_eq!(
        s.client().try_reclaim(&id, &0),
        Err(Ok(Error::WrongPrizeState))
    );
    assert_eq!(s.client().try_reclaim(&id, &5), Err(Ok(Error::BadPosition)));
}

// ----------------------------------------------------------------- especie

#[test]
fn in_kind_guarantee_returns_when_the_winner_confirms() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 30 * 86_400);
    let list = s.entries(7);
    let raffle_id = s.seal_and_draw(id, &list);
    let winner = s.winners(raffle_id, &list)[0].clone();
    let sponsor_before = s.balance(&s.sponsor);

    s.client().settle(&id, &list);
    let p = s.client().get_prize(&id, &0).unwrap();
    assert_eq!(p.state, PrizeState::Held);
    assert_eq!(p.deliver_by, ROUND_TIME + 5 + 30 * 86_400);
    assert_eq!(s.balance(&s.treasury), 180);
    assert_eq!(s.balance(&s.premios), 9_000);
    assert_eq!(s.balance(&winner), 0);

    // Antes del vencimiento nadie se lo puede llevar al ganador.
    assert_eq!(s.client().try_claim(&id, &0), Err(Ok(Error::TooEarly)));
    assert_eq!(s.client().try_reclaim(&id, &0), Err(Ok(Error::TooEarly)));

    s.client().confirm(&id, &0);
    // Lo firmó el ganador.
    assert_eq!(s.env.auths()[0].0, winner);
    assert_eq!(s.balance(&s.sponsor), sponsor_before + 9_000);
    assert_eq!(s.balance(&s.premios), 0);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Returned
    );
    assert_eq!(
        s.client().try_confirm(&id, &0),
        Err(Ok(Error::WrongPrizeState))
    );
}

#[test]
fn in_kind_guarantee_goes_to_the_winner_if_not_delivered() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 86_400);
    let list = s.entries(4);
    let raffle_id = s.seal_and_draw(id, &list);
    let winner = s.winners(raffle_id, &list)[0].clone();
    s.client().settle(&id, &list);

    s.at(ROUND_TIME + 5 + 86_400 + 1);
    assert_eq!(s.client().try_confirm(&id, &0), Err(Ok(Error::TooLate)));
    s.client().claim(&id, &0);
    assert_eq!(s.balance(&winner), 9_000);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Paid
    );
}

#[test]
fn in_kind_guarantee_unclaimed_returns_after_the_window() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 86_400);
    let list = account_entries(&s.env, 4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    s.at(ROUND_TIME + 5 + 86_400 + 10);
    // El ganador no puede recibir: cobrar falla.
    assert!(s.client().try_claim(&id, &0).is_err());
    s.at(ROUND_TIME + 5 + 86_400 + CLAIM_WINDOW_SECS + 1);
    let before = s.balance(&s.sponsor);
    s.client().reclaim(&id, &0);
    assert_eq!(s.balance(&s.sponsor), before + 9_000);
}

#[test]
fn only_the_winner_confirms() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 86_400);
    let list = s.entries(4);
    let raffle_id = s.seal_and_draw(id, &list);
    let winner = s.winners(raffle_id, &list)[0].clone();
    s.client().settle(&id, &list);
    let state = || s.client().get_prize(&id, &0).unwrap().state;

    // Sin ninguna firma, confirmar falla.
    s.env.mock_auths(&[]);
    assert!(s.client().try_confirm(&id, &0).is_err());
    // La firma de la empresa sola tampoco alcanza.
    s.env.mock_auths(&[MockAuth {
        address: &s.sponsor,
        invoke: &MockAuthInvoke {
            contract: &s.premios,
            fn_name: "confirm",
            args: (id, 0u32).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.client().try_confirm(&id, &0).is_err());
    assert_eq!(state(), PrizeState::Held);
    assert_eq!(s.balance(&s.premios), 9_000);

    // Con las firmas que pida el contrato, la garantía vuelve a la empresa, y la
    // que pidió es la del ganador.
    s.env.mock_all_auths();
    s.client().confirm(&id, &0);
    assert_eq!(s.env.auths()[0].0, winner);
    assert_eq!(state(), PrizeState::Returned);
    assert_eq!(s.balance(&s.premios), 0);
}

// ------------------------------------------------------------- devolución

#[test]
fn refund_when_never_sealed() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let before = s.balance(&s.sponsor);
    s.at(SEAL_BY);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::TooEarly)));
    s.at(SEAL_BY + 1);
    s.client().refund(&id);
    assert_eq!(s.balance(&s.sponsor), before + 408);
    assert_eq!(
        s.client().get_promo(&id).unwrap().status,
        PromoStatus::Refunded
    );
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::WrongStatus)));
}

#[test]
fn refund_when_sealed_but_never_drawn() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    s.at(OPENS);
    s.client().seal(&id, &list, &ROUND);
    s.at(ROUND_TIME + DRAW_GRACE_SECS);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::TooEarly)));
    s.at(ROUND_TIME + DRAW_GRACE_SECS + 1);
    let before = s.balance(&s.sponsor);
    s.client().refund(&id);
    assert_eq!(s.balance(&s.sponsor), before + 408);
    // Ya devuelta, aunque alguien registre el sorteo, no se paga dos veces.
    s.raffle().draw(&1, &signature(&s.env));
    assert_eq!(
        s.client().try_settle(&id, &list),
        Err(Ok(Error::WrongStatus))
    );
}

#[test]
fn no_refund_once_drawn() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    s.seal_and_draw(id, &list);
    s.at(ROUND_TIME + DRAW_GRACE_SECS + 1);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::AlreadyDrawn)));
    // Aunque pase el tiempo, el que paga es el ganador.
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&s.premios), 0);
}

#[test]
fn extend_keeps_promo_alive() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.client().extend(&id);
    assert_eq!(s.client().try_extend(&42), Err(Ok(Error::NotFound)));
}

#[test]
fn a_treasury_that_cannot_receive_does_not_block_the_winner() {
    let s = Setup::new();
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.set_authorized(&s.treasury, &false);
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    let raffle_id = s.seal_and_draw(id, &list);
    let winner = s.winners(raffle_id, &list)[0].clone();
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&winner), 400);
    assert!(!s.client().get_promo(&id).unwrap().fee_paid);
    assert_eq!(s.balance(&s.premios), 8);
    assert!(s.client().try_collect_fee(&id).is_err());
    sac.set_authorized(&s.treasury, &true);
    s.client().collect_fee(&id);
    assert_eq!(s.balance(&s.treasury), 8);
    assert_eq!(s.balance(&s.premios), 0);
    assert_eq!(
        s.client().try_collect_fee(&id),
        Err(Ok(Error::FeeAlreadyPaid))
    );
}

#[test]
fn fee_is_marked_paid_in_the_normal_case() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(3);
    s.seal_and_draw(id, &list);
    assert_eq!(s.client().try_collect_fee(&id), Err(Ok(Error::WrongStatus)));
    s.client().settle(&id, &list);
    assert!(s.client().get_promo(&id).unwrap().fee_paid);
    assert_eq!(
        s.client().try_collect_fee(&id),
        Err(Ok(Error::FeeAlreadyPaid))
    );
}

// ------------------------------------------------- solo cuentas en la lista

#[test]
fn seal_rejects_contract_addresses_in_the_list() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.at(OPENS);
    let other_contract = Address::generate(&s.env);
    // El propio contrato, el token, el sorteo y un contrato cualquiera.
    for who in [&s.premios, &s.token, &s.raffle, &other_contract] {
        let mut xs: StdVec<Address> = s.entries(5).iter().collect();
        xs.push(who.clone());
        assert_eq!(
            s.client().try_seal(&id, &sort(&s.env, xs), &ROUND),
            Err(Ok(Error::InvalidEntry)),
        );
    }
    // Nada quedó sellado, y una lista de cuentas sí se acepta.
    assert_eq!(
        s.client().get_promo(&id).unwrap().status,
        PromoStatus::Funded
    );
    s.client().seal(&id, &s.entries(5), &ROUND);
}

#[test]
fn settle_rejects_a_list_with_a_contract_address() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(6);
    s.seal_and_draw(id, &list);
    // Misma cantidad, con el propio contrato en lugar de una cuenta.
    let mut xs: StdVec<Address> = list.iter().collect();
    xs[2] = s.premios.clone();
    assert_eq!(
        s.client().try_settle(&id, &sort(&s.env, xs)),
        Err(Ok(Error::InvalidEntry)),
    );
    // Nada se movió, y la lista de verdad sigue pudiendo liquidar.
    assert_eq!(s.balance(&s.premios), 408);
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&s.premios), 0);
}

// ----------------------------------------------------------- lista blanca

#[test]
fn create_rejects_a_token_that_is_not_listed() {
    let s = Setup::new();
    let other_admin = Address::generate(&s.env);
    let other = s
        .env
        .register_stellar_asset_contract_v2(other_admin)
        .address();
    StellarAssetClient::new(&s.env, &other).mint(&s.sponsor, &1_000);
    for token in [&other, &s.premios, &s.raffle] {
        let r = s.client().try_create(
            &s.sponsor,
            &s.operator,
            token,
            &vec_of(&s.env, &[100]),
            &false,
            &0,
            &s.rules(),
            &OPENS,
            &SEAL_BY,
            &s.title(),
        );
        assert_eq!(r, Err(Ok(Error::TokenNotAllowed)));
    }
    assert_eq!(s.client().next_id(), 1);
    assert_eq!(TokenClient::new(&s.env, &other).balance(&s.sponsor), 1_000);
}

#[test]
fn error_codes_keep_their_numbers() {
    assert_eq!(Error::InvalidEntry as u32, 21);
    assert_eq!(Error::FeeAlreadyPaid as u32, 22);
    assert_eq!(Error::TokenNotAllowed as u32, 23);
    assert_eq!(Error::InKindDisabled as u32, 24);
}

// ------------------------------------------- salida si nadie liquida (90 d)

#[test]
fn lost_list_refund_opens_after_the_settle_grace() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    let raffle_id = s.seal_and_draw(id, &list);
    let drawn_at = s.raffle().get_draw(&raffle_id).unwrap().drawn_at;
    let before = s.balance(&s.sponsor);

    // Pasada la ventana del sorteo, mientras corre el plazo, no hay salida.
    s.at(ROUND_TIME + DRAW_GRACE_SECS + 1);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::AlreadyDrawn)));
    // El borde exacto todavía no.
    s.at(drawn_at + SETTLE_GRACE_SECS);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::AlreadyDrawn)));
    assert_eq!(s.balance(&s.premios), 408);

    // Un segundo más y la empresa recupera premios y comisión.
    s.at(drawn_at + SETTLE_GRACE_SECS + 1);
    s.client().refund(&id);
    let refunded = Refunded {
        promo_id: id,
        amount: 408,
    };
    assert!(s
        .env
        .events()
        .all()
        .events()
        .contains(&refunded.to_xdr(&s.env, &s.premios)));
    assert_eq!(s.balance(&s.sponsor), before + 408);
    assert_eq!(s.balance(&s.premios), 0);
    assert_eq!(s.balance(&s.treasury), 0);
    assert_eq!(
        s.client().get_promo(&id).unwrap().status,
        PromoStatus::Refunded
    );

    // Ya devuelto: no se paga dos veces ni se devuelve dos veces.
    assert_eq!(
        s.client().try_settle(&id, &list),
        Err(Ok(Error::WrongStatus))
    );
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::WrongStatus)));
}

#[test]
fn settle_can_still_pay_after_the_grace_until_someone_refunds() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    let raffle_id = s.seal_and_draw(id, &list);
    let drawn_at = s.raffle().get_draw(&raffle_id).unwrap().drawn_at;
    let winner = s.winners(raffle_id, &list)[0].clone();

    // Vencido el plazo, pero nadie pidió la devolución: settle paga igual.
    s.at(drawn_at + SETTLE_GRACE_SECS + 1);
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&winner), 400);
    assert_eq!(s.balance(&s.treasury), 8);
    assert_eq!(s.balance(&s.premios), 0);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::WrongStatus)));
}

#[test]
fn settle_pays_in_the_last_second_before_the_grace_ends() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    let raffle_id = s.seal_and_draw(id, &list);
    let drawn_at = s.raffle().get_draw(&raffle_id).unwrap().drawn_at;
    s.at(drawn_at + SETTLE_GRACE_SECS);
    assert_eq!(s.client().try_refund(&id), Err(Ok(Error::AlreadyDrawn)));
    s.client().settle(&id, &list);
    assert_eq!(s.balance(&s.premios), 0);
}

// ------------------------------------------------------------------ renta

impl Setup {
    /// Cuántos ledgers de renta le quedan a la instancia y al código.
    fn rent_ttls(&self) -> (u32, u32) {
        (
            self.env.deployer().get_contract_instance_ttl(&self.premios),
            self.env.deployer().get_contract_code_ttl(&self.premios),
        )
    }

    /// Deja pasar el tiempo (solo avanza los ledgers, no la hora) hasta que a la
    /// instancia y al código del contrato les queden `ledgers` de renta.
    fn leave_rent(&self, ledgers: u32) {
        let (instance, code) = self.rent_ttls();
        let quedan = instance.min(code);
        let now = self.env.ledger().sequence();
        self.env
            .ledger()
            .set_sequence_number(now + quedan.saturating_sub(ledgers));
    }

    /// Deja pasar casi toda la vida de la instancia y del código del contrato
    /// sin que nadie los toque, hasta que a ambos les queden unos 100 ledgers.
    fn age_rent(&self) {
        self.leave_rent(100);
        let (instance, code) = self.rent_ttls();
        assert!(
            instance <= 100 && code <= 100,
            "la renta debía estar por vencer: instancia {instance}, código {code}"
        );
    }

    /// Comprueba que la última llamada renovó la renta de la instancia y la del
    /// código hasta casi el máximo de la red.
    fn assert_rent_renewed(&self, function: &str) {
        let max = self.env.storage().max_ttl();
        let instance = self.env.deployer().get_contract_instance_ttl(&self.premios);
        let code = self.env.deployer().get_contract_code_ttl(&self.premios);
        assert!(
            instance >= max - 30 * DAY_LEDGERS,
            "{function} no renovó la renta de la instancia: {instance} de {max}"
        );
        assert!(
            code >= max - 30 * DAY_LEDGERS,
            "{function} no renovó la renta del código: {code} de {max}"
        );
    }
}

impl Setup {
    /// Comprueba que la última llamada renovó la renta de la instancia y la del
    /// código, pero solo hasta 60 días: ni se queda corta ni carga con el resto.
    fn assert_rent_bounded(&self, function: &str) {
        let bounded = 60 * DAY_LEDGERS;
        let instance = self.env.deployer().get_contract_instance_ttl(&self.premios);
        let code = self.env.deployer().get_contract_code_ttl(&self.premios);
        for (what, ttl) in [("instancia", instance), ("código", code)] {
            assert!(
                ttl >= bounded - 1_000,
                "{function} no renovó la renta de la {what}: {ttl} ledgers"
            );
            assert!(
                ttl <= bounded,
                "{function} cargó con más renta de la debida en la {what}: {ttl} ledgers, tope {bounded}"
            );
        }
    }
}

// Cada función que cambia estado renueva la renta de la instancia (Config,
// NextId) y la del código. Una prueba por función: si alguna pierde su `bump`,
// falla esa y solo esa. Importa sobre todo en las que pueden ser lo único que
// toque el contrato en meses de espera (confirm, claim, reclaim, collect_fee).
// Create, cancel, seal y extend la llevan hasta casi el máximo; las que puede
// llamar cualquiera (settle, confirm, claim, reclaim, refund, collect_fee) la
// extienden solo hasta 60 días: la renta es de todas las promociones y quien
// llegue primero tras una espera larga no debe pagarla toda. La excepción es
// settle cuando deja un premio adeudado o una garantía retenida: crea una
// obligación de hasta 270 días y el contrato tiene que seguir vivo mientras
// dure, así que la lleva hasta casi el máximo y la renta la asume quien liquida.

#[test]
fn create_renews_the_rent() {
    let s = Setup::new();
    s.age_rent();
    s.create_cash(&[400]);
    s.assert_rent_renewed("create");
}

#[test]
fn cancel_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.age_rent();
    s.client().cancel(&id);
    s.assert_rent_renewed("cancel");
}

#[test]
fn seal_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(4);
    s.at(OPENS);
    s.age_rent();
    s.client().seal(&id, &list, &ROUND);
    s.assert_rent_renewed("seal");
}

#[test]
fn settle_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.age_rent();
    s.client().settle(&id, &list);
    s.assert_rent_bounded("settle");
}

#[test]
fn settle_that_leaves_an_owed_prize_renews_all_the_rent() {
    // Un premio adeudado se puede cobrar durante 180 días: quien liquida deja
    // la instancia y el código vivos hasta entonces, aunque otro premio de la
    // misma promoción sí se haya pagado en el momento.
    let s = Setup::new();
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let id = s.create_cash(&[300, 200]);
    let list = s.entries(6);
    let raffle_id = s.seal_and_draw(id, &list);
    let ws = s.winners(raffle_id, &list);
    StellarAssetClient::new(&s.env, &s.token).set_authorized(&ws[0], &false);
    s.age_rent();
    s.client().settle(&id, &list);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Owed
    );
    assert_eq!(
        s.client().get_prize(&id, &1).unwrap().state,
        PrizeState::Paid
    );
    s.assert_rent_renewed("settle con un premio adeudado");
}

#[test]
fn settle_that_holds_a_guarantee_renews_all_the_rent() {
    // La garantía de un premio en especie se puede cobrar hasta 270 días después
    // de liquidar (90 de entrega y 180 de cobro).
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], MAX_DELIVERY_SECS);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.age_rent();
    s.client().settle(&id, &list);
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Held
    );
    s.assert_rent_renewed("settle con una garantía retenida");
}

#[test]
fn confirm_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 30 * 86_400);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    s.age_rent();
    s.client().confirm(&id, &0);
    s.assert_rent_bounded("confirm");
}

#[test]
fn claim_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 86_400);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    s.at(ROUND_TIME + 5 + 86_400 + 1);
    s.age_rent();
    s.client().claim(&id, &0);
    s.assert_rent_bounded("claim");
}

#[test]
fn reclaim_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    // Ganadora sin línea de confianza: el premio queda retenido en el contrato.
    let list = account_entries(&s.env, 3);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    s.at(ROUND_TIME + 5 + CLAIM_WINDOW_SECS + 1);
    s.age_rent();
    s.client().reclaim(&id, &0);
    s.assert_rent_bounded("reclaim");
}

#[test]
fn refund_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.at(SEAL_BY + 1);
    s.age_rent();
    s.client().refund(&id);
    s.assert_rent_bounded("refund");
}

#[test]
fn collect_fee_renews_the_rent() {
    let s = Setup::new();
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.set_authorized(&s.treasury, &false);
    let id = s.create_cash(&[400]);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    sac.set_authorized(&s.treasury, &true);
    s.age_rent();
    s.client().collect_fee(&id);
    s.assert_rent_bounded("collect_fee");
}

#[test]
fn extend_renews_the_rent() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    s.age_rent();
    s.client().extend(&id);
    s.assert_rent_renewed("extend");
}

#[test]
fn a_user_call_after_a_long_wait_pays_a_bounded_rent_and_extend_renews_all() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 30 * 86_400);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    let max = s.env.storage().max_ttl();
    s.age_rent();
    s.client().confirm(&id, &0);
    let after = s.env.deployer().get_contract_instance_ttl(&s.premios);
    assert!(
        after <= 60 * DAY_LEDGERS && after < max - 30 * DAY_LEDGERS,
        "confirm renovó {after} de {max} ledgers: es toda la renta de todas las promociones"
    );
    // Con más de 30 días por delante, otra llamada de usuario no toca nada.
    let before = s.env.deployer().get_contract_instance_ttl(&s.premios);
    s.client().extend(&id);
    s.assert_rent_renewed("extend");
    assert!(s.env.deployer().get_contract_instance_ttl(&s.premios) > before);
}

#[test]
fn a_user_call_with_enough_rent_left_extends_nothing() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    // Después de create y seal la instancia tiene casi el máximo: settle no la toca.
    let before = s.env.deployer().get_contract_instance_ttl(&s.premios);
    s.client().settle(&id, &list);
    let after = s.env.deployer().get_contract_instance_ttl(&s.premios);
    assert!(
        after <= before,
        "settle extendió la renta aunque había de sobra: {before} a {after}"
    );
}

// Una llamada de usuario apunta a 60 días de renta pero no extiende si el
// aumento es de menos de 30 (`BOUNDED_MIN_EXTENSION`). Con unos 45 días por
// delante faltan 15: no se paga renta por poco y no se toca nada. Las pruebas de
// arriba dejan la renta en casi el máximo o a punto de vencer, así que un mínimo
// en cero, que extendería también esos 15 días, no las hacía fallar.
const DAYS_LEFT: u32 = 45 * DAY_LEDGERS;

impl Setup {
    /// Comprueba que a la instancia y al código les quedan unos `DAYS_LEFT`
    /// ledgers de renta y que la llamada que sigue no los hace crecer.
    fn assert_rent_untouched(&self, function: &str, call: impl FnOnce()) {
        let before = self.rent_ttls();
        for (what, ttl) in [("instancia", before.0), ("código", before.1)] {
            assert!(
                ttl > 30 * DAY_LEDGERS && ttl <= DAYS_LEFT,
                "el escenario debía dejar unos 45 días de renta en la {what}: {ttl} ledgers"
            );
        }
        call();
        let after = self.rent_ttls();
        assert!(
            after.0 <= before.0 && after.1 <= before.1,
            "{function} extendió la renta aunque quedaban unos 45 días: {before:?} a {after:?}"
        );
    }
}

#[test]
fn settle_with_45_days_of_rent_left_extends_nothing() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.leave_rent(DAYS_LEFT);
    s.assert_rent_untouched("settle", || s.client().settle(&id, &list));
    assert_eq!(s.balance(&s.premios), 0);
}

#[test]
fn claim_with_45_days_of_rent_left_extends_nothing() {
    let s = Setup::new();
    let id = s.create_in_kind(&[9_000], 86_400);
    let list = s.entries(4);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    s.at(ROUND_TIME + 5 + 86_400 + 1);
    s.leave_rent(DAYS_LEFT);
    s.assert_rent_untouched("claim", || s.client().claim(&id, &0));
    assert_eq!(
        s.client().get_prize(&id, &0).unwrap().state,
        PrizeState::Paid
    );
}

// ------------------------------------------------- evento de la comisión

#[test]
fn collect_fee_emits_fee_collected() {
    let s = Setup::new();
    s.sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.set_authorized(&s.treasury, &false);
    let id = s.create_cash(&[400]);
    let list = s.entries(5);
    s.seal_and_draw(id, &list);
    s.client().settle(&id, &list);
    sac.set_authorized(&s.treasury, &true);
    s.client().collect_fee(&id);
    let expected = FeeCollected {
        promo_id: id,
        amount: 8,
    };
    assert!(s
        .env
        .events()
        .all()
        .events()
        .contains(&expected.to_xdr(&s.env, &s.premios)));
}

// ----------------------------------------------- cantidad antes del hash

#[test]
fn settle_checks_the_count_before_hashing() {
    let s = Setup::new();
    let id = s.create_cash(&[400]);
    let list = s.entries(6);
    s.seal_and_draw(id, &list);
    // Una lista de otro largo y además desordenada: falla por la cantidad
    // (ListMismatch), sin llegar a recorrerla (que daría EntriesNotSorted).
    let mut rev = Vec::new(&s.env);
    for a in list.iter().rev().skip(1) {
        rev.push_back(a);
    }
    assert_eq!(
        s.client().try_settle(&id, &rev),
        Err(Ok(Error::ListMismatch))
    );
}

// Pruebas de propiedades: escenarios al azar con semilla fija.
#[path = "test_properties.rs"]
mod properties;
