//! Pruebas de propiedades: escenarios al azar, con semilla fija, contra el
//! contrato de premios y el sorteo de verdad.
//!
//! Cada escenario arma varias promociones (en plata y en especie, con 1 a 4
//! premios, en los dos tokens de la lista blanca) y les aplica una secuencia
//! al azar de operaciones válidas e inválidas: crear, cancelar, sellar,
//! registrar el sorteo con la firma real de drand, liquidar con la lista
//! correcta y con listas equivocadas, confirmar, cobrar, recuperar, devolver,
//! cobrar la comisión, bloquear y desbloquear cuentas en los tokens y avanzar
//! el reloj del ledger.
//!
//! Un modelo independiente predice si cada operación tiene que salir bien y
//! cuánto le tiene que llegar a cada cuenta, y después de cada operación se
//! comprueban cuatro propiedades:
//!
//! 1. Conservación: la suma de los saldos de todas las cuentas y del contrato
//!    no cambia nunca, en ningún token.
//! 2. Destinos: todo lo que sale del contrato va a la empresa de esa
//!    promoción, a la tesorería o a una cuenta ganadora según la lista sellada
//!    y el resultado del sorteo; nunca a otra.
//! 3. Tope: por promoción nunca sale más de lo que se depositó.
//! 4. Vivacidad: pasados todos los plazos y llamadas todas las salidas que
//!    cualquiera puede llamar, el contrato queda en cero en cada token, salvo
//!    las comisiones de promociones liquidadas cuya tesorería rechaza el
//!    token, que tienen que coincidir exactamente con lo debido.
//!
//! El token `PickyToken` rechaza las transferencias a las cuentas que se le
//! indiquen; en el token del SAC se rechaza quitando la autorización o porque
//! la cuenta no tiene línea de confianza. Así se ejercitan los premios
//! adeudados y la comisión pendiente.
//!
//! Todo corre dos veces: con el modo especie habilitado y con `allow_in_kind`
//! en falso, que es como se despliega en mainnet. Con la bandera apagada el
//! generador sigue intentando crear promociones en especie: el modelo predice que
//! `create` las rechaza con `InKindDisabled`, que no queda ningún rastro (ni
//! promoción, ni id gastado, ni saldos movidos) y que, al final, ninguna
//! promoción ni ningún premio quedó en especie. Todo lo demás se comprueba igual.

use super::*;
use soroban_sdk::{contracterror, contracttype, testutils::EnvTestConfig};
use std::format;
use std::string::String as StdString;

/// Semillas del barrido. El enunciado pide al menos 200.
const SEEDS: u64 = 200;
/// Personas que pueden entrar a las listas.
const PEOPLE: usize = 14;
/// Una ronda que nunca se puede registrar: no hay firma para ella.
const ALT_ROUND: u64 = ROUND + 1_000;
const DAY: u64 = 86_400;
/// Cada cuántos pasos se releen todos los saldos de los dos tokens.
const FULL_CHECK_EVERY: u32 = 10;

// ------------------------------------------------------ token que rechaza

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PickyError {
    Blocked = 1,
    Insufficient = 2,
    Negative = 3,
}

#[contracttype]
#[derive(Clone)]
pub enum PickyKey {
    Balance(Address),
    Blocked(Address),
}

/// Token mínimo con la interfaz que usa el contrato, que rechaza las
/// transferencias hacia las cuentas bloqueadas.
#[contract]
pub struct PickyToken;

fn picky_balance(env: &Env, who: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&PickyKey::Balance(who.clone()))
        .unwrap_or(0)
}

#[contractimpl]
impl PickyToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let b = picky_balance(&env, &to);
        env.storage()
            .persistent()
            .set(&PickyKey::Balance(to), &(b + amount));
    }

    pub fn block(env: Env, who: Address, blocked: bool) {
        env.storage()
            .persistent()
            .set(&PickyKey::Blocked(who), &blocked);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        picky_balance(&env, &id)
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        if amount < 0 {
            panic_with_error!(&env, PickyError::Negative);
        }
        let blocked: bool = env
            .storage()
            .persistent()
            .get(&PickyKey::Blocked(to.clone()))
            .unwrap_or(false);
        if blocked {
            panic_with_error!(&env, PickyError::Blocked);
        }
        let bf = picky_balance(&env, &from);
        if bf < amount {
            panic_with_error!(&env, PickyError::Insufficient);
        }
        env.storage()
            .persistent()
            .set(&PickyKey::Balance(from), &(bf - amount));
        let bt = picky_balance(&env, &to);
        env.storage()
            .persistent()
            .set(&PickyKey::Balance(to), &(bt + amount));
    }
}

// -------------------------------------------------------------- azar fijo

/// xorshift64: simple, determinista y sin dependencias.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03);
        if r.0 == 0 {
            r.0 = 1;
        }
        for _ in 0..4 {
            r.next();
        }
        r
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    /// Entre `lo` y `hi`, ambos incluidos.
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.below(hi - lo + 1)
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    fn index(&mut self, len: usize) -> usize {
        self.below(len as u64) as usize
    }
}

// ----------------------------------------------------------------- modelo

#[derive(Clone)]
enum Kind {
    Sac,
    Picky,
}

#[derive(Clone)]
struct Tok {
    addr: Address,
    kind: Kind,
}

#[derive(Clone, Debug)]
struct MPrize {
    index: u32,
    winner: Address,
    amount: i128,
    state: PrizeState,
    deliver_by: u64,
    claim_until: u64,
}

#[derive(Clone, Debug)]
struct MPromo {
    id: u64,
    sponsor: Address,
    operator: Address,
    tok: usize,
    prizes: StdVec<i128>,
    fee: i128,
    in_kind: bool,
    delivery: u64,
    opens_at: u64,
    seal_by: u64,
    status: PromoStatus,
    /// Índice en `World::raffles` (cero si no se selló).
    raffle_id: u64,
    round: u64,
    /// La lista sellada, en claro.
    list: StdVec<Address>,
    /// Si alguien conserva la lista: si no, nadie puede llamar a `settle`.
    known: bool,
    settled_at: u64,
    fee_paid: bool,
    prize_m: StdVec<MPrize>,
    deposited: i128,
    paid_out: i128,
}

#[derive(Clone, Debug)]
struct MRaffle {
    round: u64,
    drawn_at: Option<u64>,
    winners: StdVec<u32>,
}

#[derive(Clone)]
struct CreateArgs {
    /// `None`: un token que no está en la lista blanca.
    tok: Option<usize>,
    sponsor: Address,
    operator: Address,
    prizes: StdVec<i128>,
    in_kind: bool,
    delivery: u64,
    opens_at: u64,
    seal_by: u64,
    title_len: u32,
}

/// Cuántas veces pasó cada cosa en todo el barrido, para exigir que las
/// propiedades se comprobaron sobre casos que de verdad ocurrieron.
#[derive(Default, Debug, Clone)]
struct Stats {
    created: u32,
    rejected_creates: u32,
    /// Creaciones en especie que el contrato rechazó por tener la bandera apagada.
    in_kind_blocked: u32,
    cancelled: u32,
    sealed: u32,
    rejected_seals: u32,
    drawn: u32,
    settled: u32,
    wrong_settles: u32,
    paid_at_settle: u32,
    owed_at_settle: u32,
    held_at_settle: u32,
    fee_pending_at_settle: u32,
    confirmed: u32,
    claimed: u32,
    reclaimed: u32,
    refunded_unsealed: u32,
    refunded_undrawn: u32,
    refunded_lost_list: u32,
    fees_collected: u32,
    pending_fee_at_end: u32,
    failed_ops: u32,
    ops: u32,
}

impl Stats {
    fn add(&mut self, o: &Stats) {
        self.created += o.created;
        self.rejected_creates += o.rejected_creates;
        self.in_kind_blocked += o.in_kind_blocked;
        self.cancelled += o.cancelled;
        self.sealed += o.sealed;
        self.rejected_seals += o.rejected_seals;
        self.drawn += o.drawn;
        self.settled += o.settled;
        self.wrong_settles += o.wrong_settles;
        self.paid_at_settle += o.paid_at_settle;
        self.owed_at_settle += o.owed_at_settle;
        self.held_at_settle += o.held_at_settle;
        self.fee_pending_at_settle += o.fee_pending_at_settle;
        self.confirmed += o.confirmed;
        self.claimed += o.claimed;
        self.reclaimed += o.reclaimed;
        self.refunded_unsealed += o.refunded_unsealed;
        self.refunded_undrawn += o.refunded_undrawn;
        self.refunded_lost_list += o.refunded_lost_list;
        self.fees_collected += o.fees_collected;
        self.pending_fee_at_end += o.pending_fee_at_end;
        self.failed_ops += o.failed_ops;
        self.ops += o.ops;
    }
}

fn round_time_of(round: u64) -> u64 {
    const GENESIS: u64 = 1_692_803_367;
    GENESIS.saturating_add(round.saturating_sub(1).saturating_mul(3))
}

fn model_fee(sum: i128, fee_bps: u32) -> i128 {
    (sum * fee_bps as i128 + 9_999) / 10_000
}

struct World {
    env: Env,
    seed: u64,
    step: u32,
    last_op: StdString,
    premios: Address,
    raffle: Address,
    treasury: Address,
    tokens: StdVec<Tok>,
    unlisted: Address,
    fee_bps: u32,
    /// Si el constructor admite promociones en especie.
    allow_in_kind: bool,
    sponsors: StdVec<Address>,
    operators: StdVec<Address>,
    people: StdVec<Address>,
    /// Personas con línea de confianza al token del SAC.
    trust: StdVec<bool>,
    /// (token, cuenta) que hoy rechazan transferencias.
    blocked: StdVec<(usize, Address)>,
    /// Todas las cuentas cuyo saldo se sigue.
    tracked: StdVec<Address>,
    supply: StdVec<i128>,
    /// Últimos saldos leídos de `tracked`, por token.
    cache: [StdVec<i128>; 2],
    /// Si la última operación salió bien (si falló, el host deshace todo).
    last_ok: bool,
    promos: StdVec<MPromo>,
    raffles: StdVec<MRaffle>,
    stats: Stats,
}

impl World {
    fn new(seed: u64, rng: &mut Rng, allow_in_kind: bool) -> World {
        Self::build(seed, rng, None, false, allow_in_kind)
    }

    /// `fee_bps` fija la comisión (si no, sale al azar); con `all_trust` todas
    /// las personas tienen línea de confianza al token del SAC; `allow_in_kind`
    /// es la bandera del constructor.
    fn build(
        seed: u64,
        rng: &mut Rng,
        fee_bps: Option<u32>,
        all_trust: bool,
        allow_in_kind: bool,
    ) -> World {
        reset_keys();
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.ledger()
            .set_timestamp(ROUND_TIME - rng.range(1_200, 4 * DAY));
        env.ledger().set_sequence_number(1_000);
        let raffle = env.register(TinkazoRaffle, ());
        let treasury = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let picky = env.register(PickyToken, ());
        let unlisted = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let tokens = std::vec![
            Tok {
                addr: sac.address(),
                kind: Kind::Sac,
            },
            Tok {
                addr: picky.clone(),
                kind: Kind::Picky,
            },
        ];
        let fee_bps = fee_bps.unwrap_or([0u32, 1, 200, 1_000][rng.index(4)]);
        let premios = env.register(
            TinkazoPremios,
            (
                raffle.clone(),
                treasury.clone(),
                fee_bps,
                list_of(&env, &[sac.address(), picky.clone()]),
                allow_in_kind,
            ),
        );

        let sponsors: StdVec<Address> = (0..2).map(|_| Address::generate(&env)).collect();
        let operators: StdVec<Address> = (0..2).map(|_| Address::generate(&env)).collect();
        let people: StdVec<Address> = (0..PEOPLE).map(|_| fresh_account(&env)).collect();
        let mut trust = StdVec::new();
        for p in &people {
            let t = all_trust || rng.chance(85);
            if t {
                open_trustline(&env, &sac, p);
            }
            trust.push(t);
        }
        for s in &sponsors {
            StellarAssetClient::new(&env, &sac.address()).mint(s, &1_000_000_000_000);
            PickyTokenClient::new(&env, &picky).mint(s, &1_000_000_000_000);
            StellarAssetClient::new(&env, &unlisted).mint(s, &1_000_000_000_000);
        }
        let mut tracked = std::vec![premios.clone(), raffle.clone(), treasury.clone()];
        tracked.extend(sponsors.iter().cloned());
        tracked.extend(operators.iter().cloned());
        tracked.extend(people.iter().cloned());

        let mut w = World {
            env,
            seed,
            step: 0,
            last_op: StdString::new(),
            premios,
            raffle,
            treasury,
            tokens,
            unlisted,
            fee_bps,
            allow_in_kind,
            sponsors,
            operators,
            people,
            trust,
            blocked: StdVec::new(),
            tracked,
            supply: StdVec::new(),
            cache: [StdVec::new(), StdVec::new()],
            last_ok: false,
            promos: StdVec::new(),
            raffles: StdVec::new(),
            stats: Stats::default(),
        };
        w.cache = w.snap_all();
        w.supply = w.cache.iter().map(|b| b.iter().sum()).collect();
        w
    }

    // ------------------------------------------------------------ ayudas

    fn ctx(&self) -> StdString {
        format!(
            "semilla {} paso {} ({}) t={}",
            self.seed,
            self.step,
            self.last_op,
            self.now()
        )
    }

    fn client(&self) -> TinkazoPremiosClient<'_> {
        TinkazoPremiosClient::new(&self.env, &self.premios)
    }

    fn raffle_client(&self) -> TinkazoRaffleClient<'_> {
        TinkazoRaffleClient::new(&self.env, &self.raffle)
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    /// El reloj solo avanza.
    fn at(&mut self, t: u64) {
        if t > self.now() {
            self.env.ledger().set_timestamp(t);
        }
    }

    fn begin(&mut self, op: StdString) {
        self.step += 1;
        self.stats.ops += 1;
        self.last_op = op;
    }

    fn receivable(&self, tok: usize, who: &Address) -> bool {
        if self.blocked.iter().any(|(t, a)| *t == tok && a == who) {
            return false;
        }
        if let Kind::Sac = self.tokens[tok].kind {
            if let Some(i) = self.people.iter().position(|p| p == who) {
                return self.trust[i];
            }
        }
        true
    }

    fn balance(&self, tok: usize, who: &Address) -> i128 {
        if let Kind::Sac = self.tokens[tok].kind {
            if let Some(i) = self.people.iter().position(|p| p == who) {
                if !self.trust[i] {
                    return 0;
                }
            }
        }
        TokenClient::new(&self.env, &self.tokens[tok].addr).balance(who)
    }

    fn snap(&self, tok: usize) -> StdVec<i128> {
        self.tracked.iter().map(|a| self.balance(tok, a)).collect()
    }

    fn snap_all(&self) -> [StdVec<i128>; 2] {
        [self.snap(0), self.snap(1)]
    }

    /// Los saldos de antes de una operación: los últimos leídos.
    fn cached(&self) -> [StdVec<i128>; 2] {
        self.cache.clone()
    }

    /// Después de una operación que salió bien se releen, en el token en
    /// juego, el contrato y las cuentas que pueden recibir (`parties`). Lo
    /// demás no debería moverse: el otro token no lo toca la operación, una
    /// operación que falla no deja nada (el host la deshace) y nadie más puede
    /// recibir. Eso lo comprueba `full_check`, que relee todas las cuentas de
    /// los dos tokens cada `FULL_CHECK_EVERY` pasos y al final de cada
    /// escenario: un pago a cualquier otra cuenta aparece ahí.
    fn read_after(&self, tok: Option<usize>, parties: &[Address]) -> [StdVec<i128>; 2] {
        let mut after = self.cache.clone();
        if let Some(t) = tok {
            if self.last_ok {
                for (k, a) in self.tracked.iter().enumerate() {
                    if *a == self.premios || parties.contains(a) {
                        after[t][k] = self.balance(t, a);
                    }
                }
            }
        }
        after
    }

    /// Relee todos los saldos de los dos tokens y exige que coincidan con lo
    /// último leído: nada se movió fuera de las operaciones comprobadas.
    fn full_check(&self) {
        let now = self.snap_all();
        for (t, balances) in now.iter().enumerate() {
            assert_eq!(
                balances.iter().sum::<i128>(),
                self.supply[t],
                "{}: (1) conservación en la relectura completa del token {t}",
                self.ctx()
            );
        }
        assert_eq!(
            now,
            self.cache,
            "{}: un saldo cambió sin que el modelo lo esperara",
            self.ctx()
        );
    }

    fn store_after(&mut self, after: [StdVec<i128>; 2]) {
        self.cache = after;
        if self.step.is_multiple_of(FULL_CHECK_EVERY) {
            self.full_check();
        }
    }

    /// Las cuentas ganadoras según la lista sellada y el sorteo registrado,
    /// calculadas aparte del contrato.
    fn expected_winners(&self, p: usize) -> StdVec<Address> {
        let promo = &self.promos[p];
        if promo.raffle_id == 0 {
            return StdVec::new();
        }
        let r = &self.raffles[promo.raffle_id as usize - 1];
        r.winners
            .iter()
            .map(|i| promo.list[*i as usize].clone())
            .collect()
    }

    /// A quién puede llegar plata de la promoción `p` (propiedad 2).
    fn allowed(&self, p: usize) -> StdVec<Address> {
        let mut v = std::vec![self.promos[p].sponsor.clone(), self.treasury.clone()];
        v.extend(self.expected_winners(p));
        v
    }

    /// Compara el resultado con lo que predijo el modelo.
    fn expect<T: core::fmt::Debug, E: core::fmt::Debug>(
        &mut self,
        predicted: bool,
        result: &Result<T, E>,
    ) -> bool {
        let got = result.is_ok();
        self.last_ok = got;
        if predicted != got {
            panic!(
                "{}: el modelo esperaba {} y el contrato dio {:?}",
                self.ctx(),
                if predicted { "éxito" } else { "error" },
                result
            );
        }
        if !got {
            self.stats.failed_ops += 1;
        }
        got
    }

    /// Las cuatro comprobaciones de saldos después de una operación. `credits`
    /// es lo que el modelo espera que reciba (o pague, si es negativo) cada
    /// cuenta en el token `tok`; `promo` es la promoción en juego.
    fn observe(
        &mut self,
        tok: Option<usize>,
        promo: Option<usize>,
        before: &[StdVec<i128>; 2],
        credits: &[(Address, i128)],
    ) {
        let parties = promo.map(|p| self.allowed(p)).unwrap_or_default();
        let after = self.read_after(tok, &parties);
        self.check_moves(tok, promo, before, credits, &after);
        self.store_after(after);
    }

    fn check_moves(
        &mut self,
        tok: Option<usize>,
        promo: Option<usize>,
        before: &[StdVec<i128>; 2],
        credits: &[(Address, i128)],
        after: &[StdVec<i128>; 2],
    ) {
        for t in 0..2 {
            // (1) Conservación.
            let total: i128 = after[t].iter().sum();
            assert_eq!(
                total,
                self.supply[t],
                "{}: (1) conservación: la suma de saldos del token {t} cambió",
                self.ctx()
            );
            if Some(t) != tok {
                assert_eq!(
                    before[t],
                    after[t],
                    "{}: se movió un token que la operación no usa",
                    self.ctx()
                );
                continue;
            }
            let allowed = promo.map(|p| self.allowed(p)).unwrap_or_default();
            let mut out = 0i128;
            for (k, addr) in self.tracked.iter().enumerate() {
                let delta = after[t][k] - before[t][k];
                let is_contract = *addr == self.premios;
                // (2) Destinos.
                if delta > 0 && !is_contract {
                    assert!(
                        allowed.contains(addr),
                        "{}: (2) destinos: {} recibió {delta} y no es la empresa, la tesorería ni una ganadora",
                        self.ctx(),
                        text(addr)
                    );
                    out += delta;
                }
                if delta < 0 && !is_contract && promo.is_some() {
                    panic!(
                        "{}: (2) destinos: a {} le sacaron {delta}",
                        self.ctx(),
                        text(addr)
                    );
                }
                // Lo que predijo el modelo, exacto.
                let expected: i128 = credits
                    .iter()
                    .filter(|(a, _)| a == addr)
                    .map(|(_, v)| *v)
                    .sum::<i128>()
                    - if is_contract {
                        credits.iter().map(|(_, v)| *v).sum::<i128>()
                    } else {
                        0
                    };
                assert_eq!(
                    delta,
                    expected,
                    "{}: el saldo de {} cambió {delta} y el modelo esperaba {expected}",
                    self.ctx(),
                    if is_contract {
                        StdString::from("el contrato")
                    } else {
                        text(addr)
                    }
                );
            }
            // (3) Nunca sale más de lo depositado.
            if let Some(p) = promo {
                self.promos[p].paid_out += out;
                let (id, paid, deposited) = (
                    self.promos[p].id,
                    self.promos[p].paid_out,
                    self.promos[p].deposited,
                );
                assert!(
                    paid <= deposited,
                    "{}: (3) la promoción {id} pagó {paid} y se depositó {deposited}",
                    self.ctx()
                );
            }
        }
    }

    /// El estado guardado en el contrato coincide con el modelo.
    fn compare(&self, p: usize) {
        let m = &self.promos[p];
        let c = self
            .client()
            .get_promo(&m.id)
            .unwrap_or_else(|| panic!("{}: falta la promoción {}", self.ctx(), m.id));
        assert_eq!(c.status, m.status, "{}: estado de la promoción", self.ctx());
        assert_eq!(c.fee_paid, m.fee_paid, "{}: fee_paid", self.ctx());
        assert_eq!(c.fee, m.fee, "{}: comisión", self.ctx());
        assert_eq!(c.in_kind, m.in_kind, "{}: in_kind", self.ctx());
        assert_eq!(c.delivery_secs, m.delivery, "{}: delivery_secs", self.ctx());
        assert_eq!(c.raffle_id, m.raffle_id, "{}: raffle_id", self.ctx());
        assert_eq!(c.sponsor, m.sponsor, "{}: empresa", self.ctx());
        assert_eq!(c.token, self.tokens[m.tok].addr, "{}: token", self.ctx());
        if m.raffle_id != 0 {
            assert_eq!(c.count as usize, m.list.len(), "{}: count", self.ctx());
            let list = list_of(&self.env, &m.list);
            assert_eq!(
                c.list_hash,
                protocol_hash(&self.env, &list),
                "{}: list_hash",
                self.ctx()
            );
            assert_eq!(c.round, m.round, "{}: ronda", self.ctx());
        }
        if m.status == PromoStatus::Settled {
            assert_eq!(c.settled_at, m.settled_at, "{}: settled_at", self.ctx());
        }
        for pos in 0..m.prizes.len() as u32 {
            let got = self.client().get_prize(&m.id, &pos);
            match m.prize_m.get(pos as usize) {
                None => assert!(got.is_none(), "{}: premio antes de liquidar", self.ctx()),
                Some(e) => {
                    let g = got.unwrap_or_else(|| panic!("{}: falta el premio", self.ctx()));
                    assert_eq!(g.state, e.state, "{}: estado del premio {pos}", self.ctx());
                    assert_eq!(
                        g.winner,
                        e.winner,
                        "{}: ganadora del premio {pos}",
                        self.ctx()
                    );
                    assert_eq!(g.index, e.index, "{}: índice del premio {pos}", self.ctx());
                    assert_eq!(g.amount, e.amount, "{}: monto del premio {pos}", self.ctx());
                    assert_eq!(g.deliver_by, e.deliver_by, "{}: deliver_by", self.ctx());
                    assert_eq!(g.claim_until, e.claim_until, "{}: claim_until", self.ctx());
                }
            }
        }
    }

    // ------------------------------------------------------- operaciones

    fn create(&mut self, a: CreateArgs) -> Option<usize> {
        self.begin(format!(
            "create tok={:?} premios={:?} especie={} entrega={} abre={} sella_hasta={}",
            a.tok, a.prizes, a.in_kind, a.delivery, a.opens_at, a.seal_by
        ));
        let now = self.now();
        let prizes_ok = !a.prizes.is_empty()
            && a.prizes.len() <= MAX_PRIZES as usize
            && a.prizes.iter().all(|x| *x > 0);
        let sum: i128 = if prizes_ok { a.prizes.iter().sum() } else { 0 };
        let fee = model_fee(sum, self.fee_bps);
        let ok = a.tok.is_some()
            && prizes_ok
            && a.seal_by > now
            && a.opens_at <= a.seal_by
            && a.seal_by <= now + MAX_SEAL_WINDOW_SECS
            && if a.in_kind {
                self.allow_in_kind && a.delivery >= 1 && a.delivery <= MAX_DELIVERY_SECS
            } else {
                a.delivery == 0
            }
            && a.title_len <= MAX_TITLE_LEN;
        // Con la bandera apagada y un token de la lista, lo primero que mira el
        // contrato es la bandera: el error es siempre `InKindDisabled`.
        let blocked = a.tok.is_some() && a.in_kind && !self.allow_in_kind;
        let token = match a.tok {
            Some(t) => self.tokens[t].addr.clone(),
            None => self.unlisted.clone(),
        };
        let unlisted_before = TokenClient::new(&self.env, &self.unlisted).balance(&a.sponsor);
        let before = self.cached();
        let title = String::from_str(&self.env, &"t".repeat(a.title_len as usize));
        let r = self.client().try_create(
            &a.sponsor,
            &a.operator,
            &token,
            &vec_of(&self.env, &a.prizes),
            &a.in_kind,
            &a.delivery,
            &BytesN::from_array(&self.env, &[7u8; 32]),
            &a.opens_at,
            &a.seal_by,
            &title,
        );
        let got = self.expect(ok, &r);
        if blocked {
            assert_eq!(
                r,
                Err(Ok(Error::InKindDisabled)),
                "{}: una promoción en especie con la bandera apagada",
                self.ctx()
            );
            self.stats.in_kind_blocked += 1;
        }
        assert_eq!(
            TokenClient::new(&self.env, &self.unlisted).balance(&a.sponsor),
            unlisted_before,
            "{}: se movió el token que no está en la lista",
            self.ctx()
        );
        let credits = if got {
            std::vec![
                (a.sponsor.clone(), -(sum + fee)),
                (self.premios.clone(), sum + fee)
            ]
        } else {
            StdVec::new()
        };
        // El contrato recibe: el modelo lo anota como débito de la empresa
        // más crédito del contrato, que `observe` compensa.
        self.observe_create(a.tok, &before, &credits);
        if !got {
            self.stats.rejected_creates += 1;
            // Una creación rechazada no gasta ningún id.
            assert_eq!(
                self.client().next_id() as usize,
                self.promos.len() + 1,
                "{}: una creación rechazada gastó un id",
                self.ctx()
            );
            return None;
        }
        let id = r.unwrap().unwrap();
        assert_eq!(id as usize, self.promos.len() + 1, "{}: id", self.ctx());
        self.promos.push(MPromo {
            id,
            sponsor: a.sponsor,
            operator: a.operator,
            tok: a.tok.unwrap(),
            prizes: a.prizes,
            fee,
            in_kind: a.in_kind,
            delivery: a.delivery,
            opens_at: a.opens_at,
            seal_by: a.seal_by,
            status: PromoStatus::Funded,
            raffle_id: 0,
            round: 0,
            list: StdVec::new(),
            known: true,
            settled_at: 0,
            fee_paid: false,
            prize_m: StdVec::new(),
            deposited: sum + fee,
            paid_out: 0,
        });
        self.stats.created += 1;
        let p = self.promos.len() - 1;
        self.compare(p);
        Some(p)
    }

    /// Como `observe`, para `create`: la empresa paga y el contrato recibe.
    fn observe_create(
        &mut self,
        tok: Option<usize>,
        before: &[StdVec<i128>; 2],
        moves: &[(Address, i128)],
    ) {
        let parties: StdVec<Address> = moves.iter().map(|(a, _)| a.clone()).collect();
        let after = self.read_after(tok, &parties);
        self.check_create_moves(tok, before, moves, &after);
        self.store_after(after);
    }

    fn check_create_moves(
        &self,
        tok: Option<usize>,
        before: &[StdVec<i128>; 2],
        moves: &[(Address, i128)],
        after: &[StdVec<i128>; 2],
    ) {
        for t in 0..2 {
            let total: i128 = after[t].iter().sum();
            assert_eq!(
                total,
                self.supply[t],
                "{}: (1) conservación al crear",
                self.ctx()
            );
            for (k, addr) in self.tracked.iter().enumerate() {
                let delta = after[t][k] - before[t][k];
                let expected: i128 = if Some(t) == tok {
                    moves
                        .iter()
                        .filter(|(a, _)| a == addr)
                        .map(|(_, v)| *v)
                        .sum()
                } else {
                    0
                };
                assert_eq!(
                    delta,
                    expected,
                    "{}: al crear, el saldo de {} cambió {delta} y se esperaba {expected}",
                    self.ctx(),
                    text(addr)
                );
            }
        }
    }

    fn cancel(&mut self, p: usize) {
        self.begin(format!("cancel {}", self.promos[p].id));
        let m = self.promos[p].clone();
        let ok = m.status == PromoStatus::Funded && self.now() < m.opens_at;
        let before = self.cached();
        let r = self.client().try_cancel(&m.id);
        let got = self.expect(ok, &r);
        let credits = if got {
            std::vec![(m.sponsor.clone(), m.deposited)]
        } else {
            StdVec::new()
        };
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            self.promos[p].status = PromoStatus::Cancelled;
            self.stats.cancelled += 1;
        }
        self.compare(p);
    }

    fn list_ok(&self, m: &MPromo, list: &[Address]) -> bool {
        let n = list.len();
        if n < 2 || n < m.prizes.len() || n > MAX_ENTRIES as usize {
            return false;
        }
        let excluded = [
            strkey_std(&m.sponsor),
            strkey_std(&m.operator),
            strkey_std(&self.treasury),
        ];
        let mut prev: Option<[u8; 56]> = None;
        for a in list {
            let k = strkey_std(a);
            if let Some(pk) = prev {
                if k <= pk {
                    return false;
                }
            }
            if excluded.contains(&k) || k[0] != b'G' {
                return false;
            }
            prev = Some(k);
        }
        true
    }

    fn seal(&mut self, p: usize, list: StdVec<Address>, round: u64, known: bool) {
        self.begin(format!(
            "seal {} con {} cuentas, ronda {round}",
            self.promos[p].id,
            list.len()
        ));
        let m = self.promos[p].clone();
        let now = self.now();
        let rt = round_time_of(round);
        let ok = m.status == PromoStatus::Funded
            && now >= m.opens_at
            && now <= m.seal_by
            && self.list_ok(&m, &list)
            && rt >= now + 30
            && rt <= now + 30 * DAY;
        let before = self.cached();
        let r = self
            .client()
            .try_seal(&m.id, &list_of(&self.env, &list), &round);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &[]);
        if got {
            let raffle_id = r.unwrap().unwrap();
            assert_eq!(
                raffle_id as usize,
                self.raffles.len() + 1,
                "{}: id del sorteo",
                self.ctx()
            );
            self.raffles.push(MRaffle {
                round,
                drawn_at: None,
                winners: StdVec::new(),
            });
            let mm = &mut self.promos[p];
            mm.status = PromoStatus::Sealed;
            mm.raffle_id = raffle_id;
            mm.round = round;
            mm.list = list;
            mm.known = known;
            self.stats.sealed += 1;
        } else {
            self.stats.rejected_seals += 1;
        }
        self.compare(p);
    }

    /// Registra el sorteo en `tinkazo-raffle` con la firma real de `ROUND`.
    fn draw(&mut self, raffle_id: u64) {
        self.begin(format!("draw {raffle_id}"));
        let r_m = self.raffles[raffle_id as usize - 1].clone();
        let now = self.now();
        let ok = r_m.drawn_at.is_none() && r_m.round == ROUND && now >= ROUND_TIME;
        let before = self.cached();
        let r = self
            .raffle_client()
            .try_draw(&raffle_id, &signature(&self.env));
        let got = self.expect(ok, &r);
        self.observe(None, None, &before, &[]);
        if got {
            let d = self.raffle_client().get_draw(&raffle_id).unwrap();
            let p = self
                .promos
                .iter()
                .position(|m| m.raffle_id == raffle_id)
                .unwrap();
            let count = self.promos[p].list.len() as u32;
            let winners: StdVec<u32> = d.winners.iter().collect();
            assert_eq!(winners.len(), self.promos[p].prizes.len());
            for (i, w) in winners.iter().enumerate() {
                assert!(
                    *w < count,
                    "{}: índice ganador fuera de la lista",
                    self.ctx()
                );
                assert!(
                    !winners[..i].contains(w),
                    "{}: índice ganador repetido",
                    self.ctx()
                );
            }
            assert_eq!(d.drawn_at, now);
            let rr = &mut self.raffles[raffle_id as usize - 1];
            rr.drawn_at = Some(now);
            rr.winners = winners;
            self.stats.drawn += 1;
        }
    }

    fn drawn_at(&self, m: &MPromo) -> Option<u64> {
        if m.raffle_id == 0 {
            return None;
        }
        self.raffles[m.raffle_id as usize - 1].drawn_at
    }

    fn settle(&mut self, p: usize, list: StdVec<Address>) {
        let m = self.promos[p].clone();
        let correct = m.raffle_id != 0 && list == m.list;
        self.begin(format!(
            "settle {} con {} cuentas ({})",
            m.id,
            list.len(),
            if correct {
                "la lista sellada"
            } else {
                "otra lista"
            }
        ));
        let now = self.now();
        let ok = m.status == PromoStatus::Sealed && self.drawn_at(&m).is_some() && correct;
        let mut credits = StdVec::new();
        let mut new_prizes = StdVec::new();
        let fee_paid = m.fee == 0 || self.receivable(m.tok, &self.treasury);
        if ok {
            if m.fee > 0 && fee_paid {
                credits.push((self.treasury.clone(), m.fee));
            }
            let r = &self.raffles[m.raffle_id as usize - 1];
            for (pos, idx) in r.winners.iter().enumerate() {
                let winner = m.list[*idx as usize].clone();
                let amount = m.prizes[pos];
                let mut prize = MPrize {
                    index: *idx,
                    winner: winner.clone(),
                    amount,
                    state: PrizeState::Held,
                    deliver_by: 0,
                    claim_until: 0,
                };
                if m.in_kind {
                    prize.deliver_by = now + m.delivery;
                    prize.claim_until = prize.deliver_by + CLAIM_WINDOW_SECS;
                } else if self.receivable(m.tok, &winner) {
                    prize.state = PrizeState::Paid;
                    credits.push((winner, amount));
                } else {
                    prize.state = PrizeState::Owed;
                    prize.claim_until = now + CLAIM_WINDOW_SECS;
                }
                new_prizes.push(prize);
            }
        }
        let before = self.cached();
        let r = self.client().try_settle(&m.id, &list_of(&self.env, &list));
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            for pr in &new_prizes {
                match pr.state {
                    PrizeState::Paid => self.stats.paid_at_settle += 1,
                    PrizeState::Owed => self.stats.owed_at_settle += 1,
                    _ => self.stats.held_at_settle += 1,
                }
            }
            if !fee_paid {
                self.stats.fee_pending_at_settle += 1;
            }
            let mm = &mut self.promos[p];
            mm.status = PromoStatus::Settled;
            mm.settled_at = now;
            mm.fee_paid = fee_paid;
            mm.prize_m = new_prizes;
            self.stats.settled += 1;
        } else if !correct {
            self.stats.wrong_settles += 1;
        }
        self.compare(p);
    }

    fn confirm(&mut self, p: usize, pos: u32) {
        let m = self.promos[p].clone();
        self.begin(format!("confirm {} premio {pos}", m.id));
        let now = self.now();
        let prize = m.prize_m.get(pos as usize).cloned();
        let ok = matches!(&prize, Some(x) if x.state == PrizeState::Held && now <= x.deliver_by);
        let credits = match (&prize, ok) {
            (Some(x), true) => std::vec![(m.sponsor.clone(), x.amount)],
            _ => StdVec::new(),
        };
        let before = self.cached();
        let r = self.client().try_confirm(&m.id, &pos);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            self.promos[p].prize_m[pos as usize].state = PrizeState::Returned;
            self.stats.confirmed += 1;
        }
        self.compare(p);
    }

    fn claim(&mut self, p: usize, pos: u32) {
        let m = self.promos[p].clone();
        self.begin(format!("claim {} premio {pos}", m.id));
        let now = self.now();
        let prize = m.prize_m.get(pos as usize).cloned();
        let ok = match &prize {
            Some(x) => {
                let state_ok = x.state == PrizeState::Owed
                    || (x.state == PrizeState::Held && now > x.deliver_by);
                state_ok && now <= x.claim_until && self.receivable(m.tok, &x.winner)
            }
            None => false,
        };
        let credits = match (&prize, ok) {
            (Some(x), true) => std::vec![(x.winner.clone(), x.amount)],
            _ => StdVec::new(),
        };
        let before = self.cached();
        let r = self.client().try_claim(&m.id, &pos);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            self.promos[p].prize_m[pos as usize].state = PrizeState::Paid;
            self.stats.claimed += 1;
        }
        self.compare(p);
    }

    fn reclaim(&mut self, p: usize, pos: u32) {
        let m = self.promos[p].clone();
        self.begin(format!("reclaim {} premio {pos}", m.id));
        let now = self.now();
        let prize = m.prize_m.get(pos as usize).cloned();
        let ok = matches!(&prize, Some(x)
            if (x.state == PrizeState::Owed || x.state == PrizeState::Held) && now > x.claim_until);
        let credits = match (&prize, ok) {
            (Some(x), true) => std::vec![(m.sponsor.clone(), x.amount)],
            _ => StdVec::new(),
        };
        let before = self.cached();
        let r = self.client().try_reclaim(&m.id, &pos);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            self.promos[p].prize_m[pos as usize].state = PrizeState::Returned;
            self.stats.reclaimed += 1;
        }
        self.compare(p);
    }

    fn refund(&mut self, p: usize) {
        let m = self.promos[p].clone();
        self.begin(format!("refund {}", m.id));
        let now = self.now();
        let drawn = self.drawn_at(&m);
        let ok = match m.status {
            PromoStatus::Funded => now > m.seal_by,
            PromoStatus::Sealed => match drawn {
                Some(d) => now > d + SETTLE_GRACE_SECS,
                None => now > round_time_of(m.round) + DRAW_GRACE_SECS,
            },
            _ => false,
        };
        let credits = if ok {
            std::vec![(m.sponsor.clone(), m.deposited)]
        } else {
            StdVec::new()
        };
        let before = self.cached();
        let r = self.client().try_refund(&m.id);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            match (m.status, drawn) {
                (PromoStatus::Funded, _) => self.stats.refunded_unsealed += 1,
                (_, None) => self.stats.refunded_undrawn += 1,
                (_, Some(_)) => self.stats.refunded_lost_list += 1,
            }
            self.promos[p].status = PromoStatus::Refunded;
        }
        self.compare(p);
    }

    fn collect_fee(&mut self, p: usize) {
        let m = self.promos[p].clone();
        self.begin(format!("collect_fee {}", m.id));
        let ok = m.status == PromoStatus::Settled
            && !m.fee_paid
            && self.receivable(m.tok, &self.treasury);
        let credits = if ok {
            std::vec![(self.treasury.clone(), m.fee)]
        } else {
            StdVec::new()
        };
        let before = self.cached();
        let r = self.client().try_collect_fee(&m.id);
        let got = self.expect(ok, &r);
        self.observe(Some(m.tok), Some(p), &before, &credits);
        if got {
            self.promos[p].fee_paid = true;
            self.stats.fees_collected += 1;
        }
        self.compare(p);
    }

    fn extend(&mut self, p: usize) {
        let m = self.promos[p].clone();
        self.begin(format!("extend {}", m.id));
        let before = self.cached();
        let r = self.client().try_extend(&m.id);
        self.expect(true, &r);
        self.observe(Some(m.tok), Some(p), &before, &[]);
        self.compare(p);
    }

    /// Operaciones sobre una promoción o un premio que no existen.
    fn bogus(&mut self, rng: &mut Rng) {
        self.begin(StdString::from("operación sobre algo que no existe"));
        let before = self.cached();
        let missing = self.promos.len() as u64 + 1 + rng.below(5);
        let c = self.client();
        let rs = [
            c.try_cancel(&missing).is_err(),
            c.try_refund(&missing).is_err(),
            c.try_collect_fee(&missing).is_err(),
            c.try_claim(&missing, &0).is_err(),
            c.try_reclaim(&missing, &0).is_err(),
            c.try_confirm(&missing, &0).is_err(),
            c.try_settle(&missing, &list_of(&self.env, &self.people[..2]))
                .is_err(),
        ];
        assert!(rs.iter().all(|e| *e), "{}: {rs:?}", self.ctx());
        if let Some(p) = (!self.promos.is_empty()).then(|| rng.index(self.promos.len())) {
            let m = self.promos[p].clone();
            let pos = m.prizes.len() as u32 + rng.below(3) as u32;
            assert!(c.try_claim(&m.id, &pos).is_err());
            assert!(c.try_reclaim(&m.id, &pos).is_err());
            assert!(c.try_confirm(&m.id, &pos).is_err());
        }
        self.observe(None, None, &before, &[]);
    }

    /// Bloquea o desbloquea a una persona o a la tesorería en un token.
    fn set_blocked(&mut self, tok: usize, who: &Address, block: bool) {
        self.begin(format!(
            "{} {} en el token {tok}",
            if block { "bloquea" } else { "desbloquea" },
            text(who)
        ));
        match &self.tokens[tok].kind {
            Kind::Sac => {
                StellarAssetClient::new(&self.env, &self.tokens[tok].addr)
                    .set_authorized(who, &!block);
            }
            Kind::Picky => {
                PickyTokenClient::new(&self.env, &self.tokens[tok].addr).block(who, &block);
            }
        }
        self.blocked.retain(|(t, a)| !(*t == tok && a == who));
        if block {
            self.blocked.push((tok, who.clone()));
        }
    }

    // ------------------------------------------------ generadores al azar

    fn random_create_args(&self, rng: &mut Rng) -> CreateArgs {
        let now = self.now();
        let n = rng.range(1, 4) as usize;
        let prizes: StdVec<i128> = (0..n)
            .map(|_| {
                if rng.chance(15) {
                    1
                } else {
                    rng.range(1, 5_000_000) as i128
                }
            })
            .collect();
        let in_kind = rng.chance(40);
        let delivery = if in_kind {
            if rng.chance(20) {
                MAX_DELIVERY_SECS
            } else {
                rng.range(1, 20 * DAY)
            }
        } else {
            0
        };
        let mut opens_at = if rng.chance(15) {
            now.saturating_sub(rng.range(0, DAY))
        } else {
            now + rng.range(0, DAY)
        };
        let mut seal_by = opens_at + rng.range(0, 5 * DAY);
        seal_by = seal_by.max(now + 1).min(now + MAX_SEAL_WINDOW_SECS);
        if opens_at > seal_by {
            opens_at = seal_by;
        }
        CreateArgs {
            tok: Some(rng.index(2)),
            sponsor: self.sponsors[rng.index(2)].clone(),
            operator: self.operators[rng.index(2)].clone(),
            prizes,
            in_kind,
            delivery,
            opens_at,
            seal_by,
            title_len: rng.range(0, 40) as u32,
        }
    }

    fn random_create(&mut self, rng: &mut Rng, valid: bool) {
        let mut a = self.random_create_args(rng);
        if !valid {
            let now = self.now();
            match rng.below(11) {
                0 => a.tok = None,
                1 => a.prizes.clear(),
                2 => {
                    let i = rng.index(a.prizes.len());
                    a.prizes[i] = -(rng.below(2) as i128);
                }
                3 => a.prizes = std::vec![1; MAX_PRIZES as usize + 1],
                4 => {
                    a.seal_by = now;
                    a.opens_at = a.opens_at.min(now);
                }
                5 => a.opens_at = a.seal_by + 1,
                6 => a.seal_by = now + MAX_SEAL_WINDOW_SECS + 1,
                7 => {
                    a.in_kind = true;
                    a.delivery = 0;
                }
                8 => {
                    a.in_kind = true;
                    a.delivery = MAX_DELIVERY_SECS + 1;
                }
                9 => {
                    a.in_kind = false;
                    a.delivery = 1;
                }
                _ => a.title_len = MAX_TITLE_LEN + 1,
            }
        }
        self.create(a);
    }

    /// Prefiere (80 %) una promoción que cumpla `pref`; si no, cualquiera.
    fn pick(&self, rng: &mut Rng, pref: impl Fn(&World, &MPromo) -> bool) -> Option<usize> {
        if self.promos.is_empty() {
            return None;
        }
        let good: StdVec<usize> = (0..self.promos.len())
            .filter(|i| pref(self, &self.promos[*i]))
            .collect();
        if !good.is_empty() && rng.chance(80) {
            Some(good[rng.index(good.len())])
        } else {
            Some(rng.index(self.promos.len()))
        }
    }

    fn random_list(&self, rng: &mut Rng, n: usize) -> StdVec<Address> {
        let mut pool = self.people.clone();
        let mut out = StdVec::new();
        for _ in 0..n.min(pool.len()) {
            let i = rng.index(pool.len());
            out.push(pool.swap_remove(i));
        }
        sorted(out)
    }

    fn random_seal(&mut self, rng: &mut Rng, valid: bool) {
        let Some(p) = self.pick(rng, |_, m| m.status == PromoStatus::Funded) else {
            return;
        };
        let m = self.promos[p].clone();
        if self.now() < m.opens_at && rng.chance(60) {
            self.at(m.opens_at + rng.below(30));
        }
        let min = m.prizes.len().max(2);
        let n = rng.range(min as u64, 12) as usize;
        let mut list = self.random_list(rng, n);
        let round_ok = round_time_of(ROUND) >= self.now() + 30;
        let mut round = if round_ok && rng.chance(88) {
            ROUND
        } else {
            ALT_ROUND
        };
        if !valid {
            match rng.below(7) {
                0 if list.len() >= 2 => list.swap(0, 1),
                1 if list.len() >= 2 => list[1] = list[0].clone(),
                2 => {
                    let who = [m.sponsor.clone(), m.operator.clone(), self.treasury.clone()]
                        [rng.index(3)]
                    .clone();
                    list.push(who);
                    list = sorted(list);
                }
                3 => {
                    let who = [
                        self.premios.clone(),
                        self.raffle.clone(),
                        self.tokens[m.tok].addr.clone(),
                    ][rng.index(3)]
                    .clone();
                    list.pop();
                    list.push(who);
                    list = sorted(list);
                }
                4 => list.truncate(if m.prizes.len() >= 2 {
                    m.prizes.len() - 1
                } else {
                    1
                }),
                5 => round = ROUND - 2_000,
                _ => round = ROUND + 30 * DAY,
            }
        }
        self.seal(p, list, round, !rng.chance(25));
    }

    fn random_draw(&mut self, rng: &mut Rng) {
        if self.raffles.is_empty() {
            return;
        }
        let pending: StdVec<usize> = (0..self.raffles.len())
            .filter(|i| self.raffles[*i].drawn_at.is_none())
            .collect();
        let i = if !pending.is_empty() && rng.chance(85) {
            pending[rng.index(pending.len())]
        } else {
            rng.index(self.raffles.len())
        };
        if self.now() < ROUND_TIME && rng.chance(50) {
            self.at(ROUND_TIME + rng.below(60));
        }
        self.draw(i as u64 + 1);
    }

    fn random_settle(&mut self, rng: &mut Rng, correct: bool) {
        let Some(p) = self.pick(rng, |w, m| {
            m.status == PromoStatus::Sealed && w.drawn_at(m).is_some()
        }) else {
            return;
        };
        let m = self.promos[p].clone();
        if correct {
            // La lista perdida nadie la tiene: no se puede liquidar con ella.
            if m.raffle_id == 0 || !m.known {
                return;
            }
            self.settle(p, m.list.clone());
            return;
        }
        let base = if m.list.is_empty() {
            let n = rng.range(2, 8) as usize;
            self.random_list(rng, n)
        } else {
            m.list.clone()
        };
        let outsider = |w: &World, rng: &mut Rng, l: &[Address]| -> Address {
            let free: StdVec<Address> = w
                .people
                .iter()
                .filter(|a| !l.contains(a))
                .cloned()
                .collect();
            if free.is_empty() {
                fresh_account(&w.env)
            } else {
                free[rng.index(free.len())].clone()
            }
        };
        let mut l = base.clone();
        match rng.below(7) {
            0 => {
                l.pop();
            }
            1 => {
                let x = outsider(self, rng, &l);
                l.push(x);
                l = sorted(l);
            }
            2 => {
                let x = outsider(self, rng, &l);
                let i = rng.index(l.len());
                l[i] = x;
                l = sorted(l);
            }
            3 => l.reverse(),
            4 => {
                let i = rng.index(l.len());
                l[i] = self.premios.clone();
                l = sorted(l);
            }
            5 => {
                let others: StdVec<&MPromo> = self
                    .promos
                    .iter()
                    .filter(|o| o.id != m.id && !o.list.is_empty())
                    .collect();
                if !others.is_empty() {
                    l = others[rng.index(others.len())].list.clone();
                }
            }
            _ => {
                if l.len() >= 2 {
                    let i = rng.index(l.len() - 1);
                    l.swap(i, i + 1);
                }
            }
        }
        if l == m.list {
            return;
        }
        self.settle(p, l);
    }

    fn random_prize_op(&mut self, rng: &mut Rng, which: u8) {
        let Some(p) = self.pick(rng, |_, m| !m.prize_m.is_empty()) else {
            return;
        };
        let n = self.promos[p].prizes.len() as u64;
        let pos = if rng.chance(90) {
            rng.below(n)
        } else {
            n + rng.below(2)
        } as u32;
        // A veces se espera hasta un borde del premio.
        if let Some(x) = self.promos[p].prize_m.get(pos as usize).cloned() {
            if rng.chance(30) {
                let t = [
                    x.deliver_by,
                    x.deliver_by + 1,
                    x.claim_until,
                    x.claim_until + 1,
                ][rng.index(4)];
                self.at(t);
            }
            // Para cobrar: a veces la ganadora vuelve a poder recibir, o se
            // espera a que venza la entrega en especie.
            if which == 1 {
                let tok = self.promos[p].tok;
                if x.state == PrizeState::Owed && rng.chance(50) {
                    let blocked = self
                        .blocked
                        .iter()
                        .any(|(t, a)| *t == tok && *a == x.winner);
                    if blocked {
                        self.set_blocked(tok, &x.winner, false);
                    }
                }
                if x.state == PrizeState::Held && rng.chance(60) {
                    self.at(x.deliver_by + 1 + rng.below(DAY));
                }
            }
        }
        match which {
            0 => self.confirm(p, pos),
            1 => self.claim(p, pos),
            _ => self.reclaim(p, pos),
        }
    }

    fn random_block(&mut self, rng: &mut Rng) {
        let tok = rng.index(2);
        let who = if rng.chance(40) {
            self.treasury.clone()
        } else {
            let candidates: StdVec<Address> = self
                .people
                .iter()
                .enumerate()
                .filter(|(i, _)| matches!(self.tokens[tok].kind, Kind::Picky) || self.trust[*i])
                .map(|(_, a)| a.clone())
                .collect();
            if candidates.is_empty() {
                return;
            }
            candidates[rng.index(candidates.len())].clone()
        };
        let now_blocked = self.blocked.iter().any(|(t, a)| *t == tok && *a == who);
        self.set_blocked(tok, &who, !now_blocked);
    }

    /// Bordes de tiempo que importan en este escenario.
    fn edges(&self) -> StdVec<u64> {
        let mut v = std::vec![ROUND_TIME, ROUND_TIME + 1];
        for m in &self.promos {
            v.extend([m.opens_at, m.seal_by, m.seal_by + 1]);
            if m.raffle_id != 0 {
                let g = round_time_of(m.round) + DRAW_GRACE_SECS;
                v.extend([g, g + 1]);
                if let Some(d) = self.drawn_at(m) {
                    v.extend([d + SETTLE_GRACE_SECS, d + SETTLE_GRACE_SECS + 1]);
                }
            }
            for x in &m.prize_m {
                v.extend([
                    x.deliver_by,
                    x.deliver_by + 1,
                    x.claim_until,
                    x.claim_until + 1,
                ]);
            }
        }
        v
    }

    fn advance(&mut self, rng: &mut Rng) {
        let now = self.now();
        let t = match rng.below(100) {
            0..=34 => now + rng.range(1, 300),
            35..=59 => now + rng.range(300, DAY),
            60..=89 => {
                let future: StdVec<u64> = self.edges().into_iter().filter(|t| *t > now).collect();
                if future.is_empty() {
                    now + rng.range(1, 300)
                } else {
                    future[rng.index(future.len())]
                }
            }
            _ => now + rng.range(10 * DAY, 120 * DAY),
        };
        self.at(t);
    }

    /// Antes de la ronda: crear, cancelar y sellar, con pasos cortos de reloj.
    fn early_op(&mut self, rng: &mut Rng) {
        match rng.below(100) {
            0..=14 => {
                let t = self.now() + rng.range(1, 3_600);
                if t + 31 <= ROUND_TIME || rng.chance(10) {
                    self.at(t);
                }
            }
            15..=29 => self.random_create(rng, true),
            30..=37 => self.random_create(rng, false),
            38..=43 => {
                if let Some(p) = self.pick(rng, |w, m| {
                    m.status == PromoStatus::Funded && w.now() < m.opens_at
                }) {
                    self.cancel(p);
                }
            }
            44..=73 => self.random_seal(rng, true),
            74..=83 => self.random_seal(rng, false),
            84..=93 => self.random_block(rng),
            _ => self.bogus(rng),
        }
    }

    fn random_op(&mut self, rng: &mut Rng) {
        match rng.below(100) {
            0..=17 => self.advance(rng),
            18..=20 => self.random_create(rng, true),
            21..=22 => self.random_create(rng, false),
            23..=24 => {
                if let Some(p) = self.pick(rng, |w, m| {
                    m.status == PromoStatus::Funded && w.now() < m.opens_at
                }) {
                    self.cancel(p);
                }
            }
            25..=29 => self.random_seal(rng, true),
            30..=31 => self.random_seal(rng, false),
            32..=41 => self.random_draw(rng),
            42..=53 => self.random_settle(rng, true),
            54..=59 => self.random_settle(rng, false),
            60..=66 => self.random_prize_op(rng, 0),
            67..=74 => self.random_prize_op(rng, 1),
            75..=78 => self.random_prize_op(rng, 2),
            79..=84 => {
                if let Some(p) = self.pick(rng, |_, m| {
                    m.status == PromoStatus::Funded || m.status == PromoStatus::Sealed
                }) {
                    self.refund(p);
                }
            }
            85..=89 => {
                if let Some(p) =
                    self.pick(rng, |_, m| m.status == PromoStatus::Settled && !m.fee_paid)
                {
                    self.collect_fee(p);
                }
            }
            90..=96 => self.random_block(rng),
            97 => {
                if let Some(p) = self.pick(rng, |_, _| true) {
                    self.extend(p);
                }
            }
            _ => self.bogus(rng),
        }
    }

    // ------------------------------------------------------ vivacidad

    /// Pasan todos los plazos y se llaman, en orden, todas las salidas que
    /// cualquiera puede llamar. `settle` reabre plazos (entrega y cobro), así
    /// que después de liquidar se vuelve a avanzar el reloj.
    fn sweep(&mut self) {
        let far = self.now() + 500 * DAY;
        self.at(far);
        for p in 0..self.promos.len() {
            let m = &self.promos[p];
            if m.status == PromoStatus::Sealed && m.known {
                let list = m.list.clone();
                self.settle(p, list);
            }
        }
        for p in 0..self.promos.len() {
            for pos in 0..self.promos[p].prize_m.len() as u32 {
                self.claim(p, pos);
            }
        }
        let far = self.now() + MAX_DELIVERY_SECS + CLAIM_WINDOW_SECS + DAY;
        self.at(far);
        for p in 0..self.promos.len() {
            for pos in 0..self.promos[p].prize_m.len() as u32 {
                self.claim(p, pos);
                self.reclaim(p, pos);
            }
        }
        for p in 0..self.promos.len() {
            self.refund(p);
        }
        for p in 0..self.promos.len() {
            self.collect_fee(p);
        }
    }

    /// (4) El contrato queda en cero salvo la comisión que la tesorería no
    /// puede recibir, y toda promoción terminó.
    fn check_liveness(&mut self) {
        for t in 0..2 {
            let bal = self.balance(t, &self.premios);
            let pending: i128 = self
                .promos
                .iter()
                .filter(|m| m.tok == t && m.status == PromoStatus::Settled && !m.fee_paid)
                .map(|m| m.fee)
                .sum();
            assert_eq!(
                bal,
                pending,
                "semilla {}: (4) vivacidad: el contrato quedó con {bal} del token {t} y solo debía quedar la comisión pendiente {pending}",
                self.seed
            );
            if pending > 0 {
                assert!(
                    !self.receivable(t, &self.treasury),
                    "semilla {}: (4) quedó comisión aunque la tesorería puede recibir",
                    self.seed
                );
                self.stats.pending_fee_at_end += 1;
            }
        }
        for m in &self.promos {
            let done = match m.status {
                PromoStatus::Cancelled | PromoStatus::Refunded => true,
                PromoStatus::Settled => m
                    .prize_m
                    .iter()
                    .all(|x| matches!(x.state, PrizeState::Paid | PrizeState::Returned)),
                _ => false,
            };
            assert!(
                done,
                "semilla {}: (4) la promoción {} quedó viva: {:?}",
                self.seed, m.id, m
            );
            let pending = if m.status == PromoStatus::Settled && !m.fee_paid {
                m.fee
            } else {
                0
            };
            assert_eq!(
                m.paid_out,
                m.deposited - pending,
                "semilla {}: (4) la promoción {} no devolvió todo lo depositado",
                self.seed,
                m.id
            );
        }
    }
}

/// La dirección en texto, para los mensajes.
fn text(a: &Address) -> StdString {
    StdString::from_utf8(strkey_std(a).to_vec()).unwrap()
}

fn sorted(xs: StdVec<Address>) -> StdVec<Address> {
    let mut pairs: StdVec<([u8; 56], Address)> =
        xs.into_iter().map(|a| (strkey_std(&a), a)).collect();
    pairs.sort_by_key(|p| p.0);
    pairs.into_iter().map(|(_, a)| a).collect()
}

/// Un escenario al azar completo. Devuelve lo que pasó en él.
///
/// Primero, antes de la ronda, se crean y sellan promociones; después corre
/// todo lo demás mezclado (incluidos nuevos intentos de crear y sellar), y al
/// final se pasan todos los plazos y se comprueba la vivacidad.
fn run_seed(seed: u64, allow_in_kind: bool) -> Stats {
    let mut rng = Rng::new(seed);
    let mut w = World::new(seed, &mut rng, allow_in_kind);
    for _ in 0..rng.range(1, 3) {
        w.random_create(&mut rng, true);
    }
    for _ in 0..rng.range(6, 14) {
        w.early_op(&mut rng);
    }
    if rng.chance(70) {
        w.at(ROUND_TIME + rng.below(120));
    }
    for _ in 0..rng.range(18, 32) {
        w.random_op(&mut rng);
    }
    w.sweep();
    w.check_liveness();
    w.full_check();
    if !allow_in_kind {
        // Con la bandera apagada no puede haber nada en especie, ni en el modelo
        // ni en el contrato.
        for m in &w.promos {
            assert!(
                !m.in_kind,
                "semilla {seed}: la promoción {} es en especie",
                m.id
            );
        }
        assert_eq!(
            w.stats.held_at_settle, 0,
            "semilla {seed}: garantía retenida"
        );
        assert_eq!(w.stats.confirmed, 0, "semilla {seed}: entrega confirmada");
    }
    w.stats
}

/// Barre todas las semillas con la bandera dada y devuelve lo que pasó en total.
/// Las semillas se reparten entre hilos: cada escenario arma su propio entorno y
/// su resultado depende solo de su semilla, así que el total es el mismo.
fn sweep(allow_in_kind: bool) -> Stats {
    let started = std::time::Instant::now();
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .clamp(1, 8) as u64;
    let mut total = Stats::default();
    std::thread::scope(|scope| {
        let handles: StdVec<_> = (0..workers)
            .map(|first| {
                scope.spawn(move || {
                    let mut stats = Stats::default();
                    for seed in (1 + first..=SEEDS).step_by(workers as usize) {
                        stats.add(&run_seed(seed, allow_in_kind));
                    }
                    stats
                })
            })
            .collect();
        for handle in handles {
            match handle.join() {
                Ok(stats) => total.add(&stats),
                // El mensaje con la semilla y el paso ya salió del hilo.
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
    });
    std::println!(
        "{SEEDS} semillas con allow_in_kind={allow_in_kind} en {:.1} s: {total:#?}",
        started.elapsed().as_secs_f64()
    );
    total
}

#[test]
fn properties_hold_for_random_scenarios() {
    let total = sweep(true);
    // Que el barrido haya pasado de verdad por cada camino.
    let t = &total;
    assert_eq!(
        t.in_kind_blocked, 0,
        "con la bandera encendida nada se rechaza por ella"
    );
    for (name, n) in [
        ("creadas", t.created),
        ("creaciones rechazadas", t.rejected_creates),
        ("canceladas", t.cancelled),
        ("selladas", t.sealed),
        ("sellados rechazados", t.rejected_seals),
        ("sorteos registrados", t.drawn),
        ("liquidadas", t.settled),
        ("liquidaciones con otra lista", t.wrong_settles),
        ("pagados al liquidar", t.paid_at_settle),
        ("adeudados al liquidar", t.owed_at_settle),
        ("garantías retenidas", t.held_at_settle),
        ("comisión pendiente al liquidar", t.fee_pending_at_settle),
        ("entregas confirmadas", t.confirmed),
        ("cobrados con claim", t.claimed),
        ("recuperados con reclaim", t.reclaimed),
        ("devueltas sin sellar", t.refunded_unsealed),
        ("devueltas sin sorteo", t.refunded_undrawn),
        ("devueltas con la lista perdida", t.refunded_lost_list),
        ("comisiones cobradas después", t.fees_collected),
        ("comisión pendiente al final", t.pending_fee_at_end),
    ] {
        assert!(n > 0, "el barrido nunca pasó por: {name}");
    }
}

/// El mismo barrido con `allow_in_kind` en falso, que es como se despliega en
/// mainnet: todo lo de plata se comprueba igual y lo de especie no existe.
#[test]
fn properties_hold_for_random_scenarios_with_in_kind_disabled() {
    let total = sweep(false);
    let t = &total;
    for (name, n) in [
        ("creadas", t.created),
        ("creaciones rechazadas", t.rejected_creates),
        (
            "creaciones en especie rechazadas por la bandera",
            t.in_kind_blocked,
        ),
        ("canceladas", t.cancelled),
        ("selladas", t.sealed),
        ("sellados rechazados", t.rejected_seals),
        ("sorteos registrados", t.drawn),
        ("liquidadas", t.settled),
        ("liquidaciones con otra lista", t.wrong_settles),
        ("pagados al liquidar", t.paid_at_settle),
        ("adeudados al liquidar", t.owed_at_settle),
        ("comisión pendiente al liquidar", t.fee_pending_at_settle),
        ("cobrados con claim", t.claimed),
        ("recuperados con reclaim", t.reclaimed),
        ("devueltas sin sellar", t.refunded_unsealed),
        ("devueltas sin sorteo", t.refunded_undrawn),
        ("devueltas con la lista perdida", t.refunded_lost_list),
        ("comisiones cobradas después", t.fees_collected),
        ("comisión pendiente al final", t.pending_fee_at_end),
    ] {
        assert!(n > 0, "el barrido sin especie nunca pasó por: {name}");
    }
    // Lo único que no puede aparecer.
    assert_eq!(t.held_at_settle, 0);
    assert_eq!(t.confirmed, 0);
}

// ------------------------------------------------ escenarios explícitos

fn cash_args(w: &World, tok: usize, prizes: &[i128]) -> CreateArgs {
    let now = w.now();
    CreateArgs {
        tok: Some(tok),
        sponsor: w.sponsors[0].clone(),
        operator: w.operators[0].clone(),
        prizes: prizes.to_vec(),
        in_kind: false,
        delivery: 0,
        opens_at: now + 60,
        seal_by: ROUND_TIME - 600,
        title_len: 10,
    }
}

/// Lista de `n` personas que pueden recibir en los dos tokens.
fn receiving_list(w: &World, n: usize) -> StdVec<Address> {
    let xs: StdVec<Address> = w
        .people
        .iter()
        .enumerate()
        .filter(|(i, _)| w.trust[*i])
        .map(|(_, a)| a.clone())
        .take(n)
        .collect();
    assert_eq!(xs.len(), n);
    sorted(xs)
}

#[test]
fn lost_list_scenario_returns_everything_to_the_sponsor() {
    for (tok, allow_in_kind) in [(0, true), (1, true), (0, false), (1, false)] {
        let mut rng = Rng::new(10_001 + tok as u64);
        let mut w = World::build(10_001, &mut rng, Some(200), true, allow_in_kind);
        let start = w.now();
        let a = cash_args(&w, tok, &[400, 100]);
        let p = w.create(a).unwrap();
        w.at(w.promos[p].opens_at);
        let list = receiving_list(&w, 8);
        // Se sella y se pierde la lista: nadie puede llamar a settle.
        w.seal(p, list, ROUND, false);
        w.at(ROUND_TIME + 5);
        w.draw(1);
        // Mientras corre el plazo, nadie puede devolver.
        w.at(ROUND_TIME + 30 * DAY);
        w.refund(p);
        assert_eq!(w.promos[p].status, PromoStatus::Sealed);
        w.sweep();
        w.check_liveness();
        w.full_check();
        assert_eq!(w.promos[p].status, PromoStatus::Refunded);
        assert_eq!(w.stats.refunded_lost_list, 1);
        let sponsor = w.promos[p].sponsor.clone();
        assert_eq!(w.balance(tok, &sponsor), 1_000_000_000_000);
        assert!(w.now() > start);
    }
}

#[test]
fn winner_that_cannot_receive_scenario_ends_with_the_sponsor() {
    for (tok, allow_in_kind) in [(0, true), (1, true), (0, false), (1, false)] {
        let mut rng = Rng::new(20_001 + tok as u64);
        let mut w = World::build(20_001, &mut rng, Some(200), true, allow_in_kind);
        let a = cash_args(&w, tok, &[300, 200]);
        let p = w.create(a).unwrap();
        w.at(w.promos[p].opens_at);
        let list = receiving_list(&w, 6);
        w.seal(p, list, ROUND, true);
        w.at(ROUND_TIME + 5);
        w.draw(1);
        // Ninguna ganadora puede recibir, ni la tesorería.
        let winners = w.expected_winners(p);
        for who in &winners {
            w.set_blocked(tok, who, true);
        }
        let treasury = w.treasury.clone();
        w.set_blocked(tok, &treasury, true);
        let list = w.promos[p].list.clone();
        w.settle(p, list);
        assert!(w.promos[p]
            .prize_m
            .iter()
            .all(|x| x.state == PrizeState::Owed));
        // La primera vuelve a poder recibir y cobra; la segunda nunca.
        w.set_blocked(tok, &winners[0], false);
        w.claim(p, 0);
        w.claim(p, 1);
        w.sweep();
        w.check_liveness();
        w.full_check();
        let m = &w.promos[p];
        assert_eq!(m.prize_m[0].state, PrizeState::Paid);
        assert_eq!(m.prize_m[1].state, PrizeState::Returned);
        // La comisión espera en el contrato, exacta.
        assert!(!m.fee_paid);
        assert_eq!(w.balance(tok, &w.premios), m.fee);
        assert_eq!(w.balance(tok, &winners[0]), 300);
        assert_eq!(w.balance(tok, &winners[1]), 0);
    }
}
