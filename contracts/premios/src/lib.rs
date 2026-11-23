#![no_std]
//! Tinkazo: premios garantizados.
//!
//! Una empresa deposita el premio antes de que exista la lista; la lista de
//! cuentas se sella en `tinkazo-raffle` antes de que exista la semilla; y este
//! contrato solo sabe pagarle a la cuenta que quedó en la posición ganadora de
//! esa lista sellada. Ninguna función recibe "a quién pagar": el destino sale
//! siempre de `entries[draw.winners[j]]`, con `entries` atada al hash sellado,
//! o es la cuenta de la empresa fijada al crear.
//!
//! Flujo:
//! 1. `create`: la empresa deposita la suma de los premios más la comisión.
//! 2. `seal`: el operador pasa las cuentas en claro, ordenadas; el contrato
//!    calcula el hash con el método del protocolo (docs/protocolo.md §1) y
//!    sella en `tinkazo-raffle` como organizador. Una sola vez por promoción.
//! 3. Cualquiera registra el sorteo en `tinkazo-raffle` (`draw`).
//! 4. `settle`: cualquiera pasa la lista otra vez; el contrato exige que su
//!    hash sea el sellado, lee el resultado y paga.
//!
//! Sin administrador y sin actualización. La tesorería, la comisión, el
//! contrato del sorteo, la lista de tokens aceptados y si se admite el modo
//! especie se fijan en el constructor y no cambian.
//!
//! # Garantías y límites
//!
//! Lo que este contrato garantiza:
//! - El destino de cada pago sale siempre de la lista sellada y del sorteo
//!   registrado, de la cuenta de la empresa o de la tesorería. Ninguna función
//!   recibe "a quién pagar".
//! - No hay administrador ni actualización: nadie puede cambiar las reglas ni
//!   mover fondos fuera de esos caminos.
//! - Hay salidas por tiempo: si no se sella, si se sella y nadie registra el
//!   sorteo, o si se registra y nadie liquida en `SETTLE_GRACE_SECS` (90 días),
//!   `refund` devuelve todo a la empresa. Un premio que nadie cobra vuelve a
//!   la empresa con `reclaim`.
//! - Solo participan cuentas `G…`: las direcciones de contrato (el propio
//!   contrato, el token, el sorteo o cualquier otro) se rechazan al sellar, de
//!   modo que un premio nunca queda en una dirección sin salida.
//! - Solo se aceptan los tokens de la lista fijada en el constructor.
//! - El modo especie se enciende o se apaga para siempre en el constructor
//!   (`allow_in_kind`). El saldo del contrato es compartido por todas las
//!   promociones, así que un defecto en cualquier camino alcanzable pone en
//!   riesgo a todas. Con el modo apagado, `create` rechaza `in_kind` con
//!   `InKindDisabled` antes de mover ningún token: no puede existir una garantía
//!   retenida, y `confirm` y el cobro de una entrega vencida no tienen nada que
//!   procesar. Una instalación que solo reparte plata lo deja apagado.
//!
//! Lo que NO garantiza:
//! - Que la lista sea la que dicen las reglas de participación. La arma el
//!   operador; se verifica porque es pública y cualquiera puede recomputarla
//!   contra el hash sellado.
//! - Que el emisor del token no congele ni confisque saldos. Un token con
//!   esas facultades puede afectar los fondos que custodia este contrato.
//! - Que la comisión llegue a la tesorería si esta no puede recibir la
//!   moneda: queda en el contrato (se reintenta con `collect_fee`) y es plata
//!   de Tinkazo; nunca traba el pago al ganador.
//! - Que `settle` alcance en el presupuesto de la red si cambian los costos de
//!   CPU. Por eso existe la salida a los 90 días.

mod list;
mod raffle;

use raffle::RaffleClient;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, contracttype,
    panic_with_error, token, Address, BytesN, Env, String, Vec,
};

contractmeta!(key = "binver", val = "0.2.0");
contractmeta!(key = "protocol", val = "tinkazo-v2");

/// Tope de la comisión que acepta el constructor (10 %).
pub const MAX_FEE_BPS: u32 = 1_000;
/// Premios por promoción.
pub const MAX_PRIZES: u32 = 10;
/// Cuentas por lista: la lista viaja dos veces (en `seal` y en `settle`).
pub const MAX_ENTRIES: u32 = 1_000;
/// Mismo tope que el `meta` de `tinkazo-raffle`, porque el título viaja ahí.
pub const MAX_TITLE_LEN: u32 = 160;
/// Plazo máximo entre crear y sellar.
pub const MAX_SEAL_WINDOW_SECS: u64 = 60 * 86_400;
/// Plazo máximo para entregar un premio en especie.
pub const MAX_DELIVERY_SECS: u64 = 90 * 86_400;
/// Si a la ronda más este plazo nadie registró el sorteo, se devuelve todo.
pub const DRAW_GRACE_SECS: u64 = 7 * 86_400;
/// Tiempo para cobrar un premio que no se pudo pagar en el momento.
pub const CLAIM_WINDOW_SECS: u64 = 180 * 86_400;
/// Si registrado el sorteo nadie liquidó en este plazo, la empresa recupera todo.
pub const SETTLE_GRACE_SECS: u64 = 90 * 86_400;
/// Tokens que admite la lista blanca del constructor.
pub const MAX_TOKENS: u32 = 8;

const BPS: i128 = 10_000;
const DAY_LEDGERS: u32 = 17_280;
/// Lo que puede cobrar de renta una llamada de usuario (`settle` cuando todos los
/// premios se pagaron en el momento, `confirm`, `claim`, `reclaim`, `refund`,
/// `collect_fee`): la instancia y el código se extienden hasta 60 días como
/// mucho, y solo si les quedan menos de 30.
const BOUNDED_TTL: u32 = 60 * DAY_LEDGERS;
const BOUNDED_MIN_EXTENSION: u32 = 30 * DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    NextId,
    Promo(u64),
    Prize(u64, u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub raffle: Address,
    pub treasury: Address,
    pub fee_bps: u32,
    /// Tokens con los que se puede crear una promoción.
    pub tokens: Vec<Address>,
    /// Si se admiten promociones en especie. Fijo desde el constructor.
    pub allow_in_kind: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromoStatus {
    Funded,
    Sealed,
    Settled,
    Refunded,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Promo {
    pub id: u64,
    pub sponsor: Address,
    /// Quien puede sellar la lista. Se recomienda que no sea la empresa.
    pub operator: Address,
    pub token: Address,
    /// Monto de cada premio, en orden de premio (en especie: la garantía).
    pub prizes: Vec<i128>,
    /// Comisión de Tinkazo sobre la suma de los premios.
    pub fee: i128,
    pub in_kind: bool,
    /// Especie: plazo para entregar, contado desde `settle`.
    pub delivery_secs: u64,
    /// SHA-256 del JSON de las reglas de participación.
    pub rules_hash: BytesN<32>,
    /// Antes de este instante la empresa puede cancelar; desde él, se puede sellar.
    pub opens_at: u64,
    /// Último instante para sellar.
    pub seal_by: u64,
    pub title: String,
    pub status: PromoStatus,
    pub created_at: u64,
    /// Lo que sigue se completa al sellar (cero antes).
    pub raffle_id: u64,
    pub round: u64,
    pub list_hash: BytesN<32>,
    pub count: u32,
    pub settled_at: u64,
    /// Si la comisión ya llegó a la tesorería.
    pub fee_paid: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrizeState {
    /// Pagado al ganador.
    Paid,
    /// No se pudo pagar en el momento: el ganador lo cobra con `claim`.
    Owed,
    /// Especie: garantía retenida hasta la entrega o el vencimiento.
    Held,
    /// Devuelto a la empresa (entrega confirmada o cobro vencido).
    Returned,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prize {
    pub promo_id: u64,
    pub position: u32,
    /// Índice ganador en la lista sellada.
    pub index: u32,
    pub winner: Address,
    pub amount: i128,
    pub state: PrizeState,
    /// Especie: hasta cuándo puede confirmar la entrega (0 en plata).
    pub deliver_by: u64,
    /// Último instante para cobrar; después vuelve a la empresa.
    pub claim_until: u64,
}

/// Errores. Son ABI: nunca se renumeran; los nuevos van al final.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidPrizes = 2,
    InvalidSchedule = 3,
    InvalidDelivery = 4,
    TitleTooLong = 5,
    FundingMismatch = 6,
    WrongStatus = 7,
    TooEarly = 8,
    TooLate = 9,
    TooFewEntries = 10,
    TooManyEntries = 11,
    EntriesNotSorted = 12,
    ExcludedEntry = 13,
    NotDrawn = 14,
    ListMismatch = 15,
    AlreadyDrawn = 16,
    BadPosition = 17,
    WrongPrizeState = 18,
    BadConfig = 19,
    RaffleMismatch = 20,
    InvalidEntry = 21,
    FeeAlreadyPaid = 22,
    TokenNotAllowed = 23,
    InKindDisabled = 24,
}

#[contractevent]
pub struct Created {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub sponsor: Address,
    pub token: Address,
    pub total: i128,
    pub fee: i128,
    pub in_kind: bool,
    pub rules_hash: BytesN<32>,
}

#[contractevent]
pub struct Cancelled {
    #[topic]
    pub promo_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct PromoSealed {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub raffle_id: u64,
    pub list_hash: BytesN<32>,
    pub count: u32,
    pub round: u64,
}

#[contractevent]
pub struct Settled {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub raffle_id: u64,
    pub fee: i128,
}

#[contractevent]
pub struct PrizePaid {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub winner: Address,
    pub position: u32,
    pub amount: i128,
}

#[contractevent]
pub struct PrizeOwed {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub winner: Address,
    pub position: u32,
    pub amount: i128,
    pub claim_until: u64,
}

#[contractevent]
pub struct PrizeHeld {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub winner: Address,
    pub position: u32,
    pub amount: i128,
    pub deliver_by: u64,
}

#[contractevent]
pub struct DeliveryConfirmed {
    #[topic]
    pub promo_id: u64,
    #[topic]
    pub winner: Address,
    pub position: u32,
}

#[contractevent]
pub struct PrizeReturned {
    #[topic]
    pub promo_id: u64,
    pub position: u32,
    pub amount: i128,
}

#[contractevent]
pub struct Refunded {
    #[topic]
    pub promo_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct FeeCollected {
    #[topic]
    pub promo_id: u64,
    pub amount: i128,
}

#[contract]
pub struct TinkazoPremios;

#[contractimpl]
impl TinkazoPremios {
    /// Fija para siempre el contrato del sorteo, la tesorería, la comisión, los
    /// tokens aceptados (entre 1 y `MAX_TOKENS`, sin repetidos) y si se admite el
    /// modo especie (`allow_in_kind`). Ni el sorteo, ni la tesorería, ni ningún
    /// token pueden ser este mismo contrato.
    pub fn __constructor(
        env: Env,
        raffle: Address,
        treasury: Address,
        fee_bps: u32,
        tokens: Vec<Address>,
        allow_in_kind: bool,
    ) {
        let me = env.current_contract_address();
        if fee_bps > MAX_FEE_BPS
            || raffle == me
            || treasury == me
            || tokens.is_empty()
            || tokens.len() > MAX_TOKENS
        {
            panic_with_error!(&env, Error::BadConfig);
        }
        for (i, token) in tokens.iter().enumerate() {
            if token == me {
                panic_with_error!(&env, Error::BadConfig);
            }
            for other in tokens.iter().skip(i + 1) {
                if other == token {
                    panic_with_error!(&env, Error::BadConfig);
                }
            }
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                raffle,
                treasury,
                fee_bps,
                tokens,
                allow_in_kind,
            },
        );
    }

    /// Crea una promoción y deposita `suma(prizes) + comisión`. Devuelve su id.
    /// En especie (`in_kind`) solo si el constructor lo permitió; si no, devuelve
    /// `InKindDisabled` sin mover ningún token.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        env: Env,
        sponsor: Address,
        operator: Address,
        token: Address,
        prizes: Vec<i128>,
        in_kind: bool,
        delivery_secs: u64,
        rules_hash: BytesN<32>,
        opens_at: u64,
        seal_by: u64,
        title: String,
    ) -> Result<u64, Error> {
        sponsor.require_auth();
        let config = config(&env);
        if !config.tokens.contains(&token) {
            return Err(Error::TokenNotAllowed);
        }
        if in_kind && !config.allow_in_kind {
            return Err(Error::InKindDisabled);
        }
        bump(&env);
        let now = env.ledger().timestamp();

        if prizes.is_empty() || prizes.len() > MAX_PRIZES {
            return Err(Error::InvalidPrizes);
        }
        let mut sum: i128 = 0;
        for amount in prizes.iter() {
            if amount <= 0 {
                return Err(Error::InvalidPrizes);
            }
            sum = sum.checked_add(amount).ok_or(Error::InvalidPrizes)?;
        }
        let fee = fee_for(sum, config.fee_bps)?;
        let total = sum.checked_add(fee).ok_or(Error::InvalidPrizes)?;

        if seal_by <= now
            || opens_at > seal_by
            || seal_by > now.saturating_add(MAX_SEAL_WINDOW_SECS)
        {
            return Err(Error::InvalidSchedule);
        }
        if in_kind {
            if delivery_secs == 0 || delivery_secs > MAX_DELIVERY_SECS {
                return Err(Error::InvalidDelivery);
            }
        } else if delivery_secs != 0 {
            return Err(Error::InvalidDelivery);
        }
        if title.len() > MAX_TITLE_LEN {
            return Err(Error::TitleTooLong);
        }

        // Exige que llegue exactamente lo depositado: descarta tokens que
        // cobran al transferir o que no transfieren lo que dicen.
        let me = env.current_contract_address();
        let client = token::TokenClient::new(&env, &token);
        let before = client.balance(&me);
        client.transfer(&sponsor, &me, &total);
        let after = client.balance(&me);
        if after.checked_sub(before) != Some(total) {
            return Err(Error::FundingMismatch);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1u64);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let promo = Promo {
            id,
            sponsor: sponsor.clone(),
            operator,
            token: token.clone(),
            prizes,
            fee,
            in_kind,
            delivery_secs,
            rules_hash: rules_hash.clone(),
            opens_at,
            seal_by,
            title,
            status: PromoStatus::Funded,
            created_at: now,
            raffle_id: 0,
            round: 0,
            list_hash: BytesN::from_array(&env, &[0u8; 32]),
            count: 0,
            settled_at: 0,
            fee_paid: false,
        };
        save_promo(&env, &promo);

        Created {
            promo_id: id,
            sponsor,
            token,
            total,
            fee,
            in_kind,
            rules_hash,
        }
        .publish(&env);
        Ok(id)
    }

    /// La empresa se echa atrás. Solo antes de que abra la participación.
    pub fn cancel(env: Env, promo_id: u64) -> Result<(), Error> {
        let mut promo = load_promo(&env, promo_id)?;
        promo.sponsor.require_auth();
        bump(&env);
        if promo.status != PromoStatus::Funded {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() >= promo.opens_at {
            return Err(Error::TooLate);
        }
        let amount = total_of(&promo);
        pay(&env, &promo.token, &promo.sponsor, amount);
        promo.status = PromoStatus::Cancelled;
        save_promo(&env, &promo);
        Cancelled { promo_id, amount }.publish(&env);
        Ok(())
    }

    /// Sella la lista de cuentas en `tinkazo-raffle`, con este contrato como
    /// organizador. `entries` va en orden estricto ascendente por la dirección
    /// en texto (así no hay repetidas); la empresa, el operador y la tesorería
    /// no pueden estar. Devuelve el id del sorteo en `tinkazo-raffle`.
    pub fn seal(env: Env, promo_id: u64, entries: Vec<Address>, round: u64) -> Result<u64, Error> {
        let mut promo = load_promo(&env, promo_id)?;
        promo.operator.require_auth();
        bump(&env);
        if promo.status != PromoStatus::Funded {
            return Err(Error::WrongStatus);
        }
        let now = env.ledger().timestamp();
        if now < promo.opens_at {
            return Err(Error::TooEarly);
        }
        if now > promo.seal_by {
            return Err(Error::TooLate);
        }
        let count = entries.len();
        if count < 2 || count < promo.prizes.len() {
            return Err(Error::TooFewEntries);
        }
        if count > MAX_ENTRIES {
            return Err(Error::TooManyEntries);
        }
        let config = config(&env);
        let excluded = [
            list::strkey(&promo.sponsor)?,
            list::strkey(&promo.operator)?,
            list::strkey(&config.treasury)?,
        ];
        let list_hash = list::hash(&env, &entries, &excluded)?;

        let me = env.current_contract_address();
        let raffle_id = RaffleClient::new(&env, &config.raffle).seal(
            &me,
            &list_hash,
            &count,
            &promo.prizes.len(),
            &round,
            &promo.title,
        );

        promo.status = PromoStatus::Sealed;
        promo.raffle_id = raffle_id;
        promo.round = round;
        promo.list_hash = list_hash.clone();
        promo.count = count;
        save_promo(&env, &promo);

        PromoSealed {
            promo_id,
            raffle_id,
            list_hash,
            count,
            round,
        }
        .publish(&env);
        Ok(raffle_id)
    }

    /// Paga según el sorteo registrado. Cualquiera puede llamarlo: el destino
    /// sale de la lista sellada y del resultado, nunca de quien llama.
    pub fn settle(env: Env, promo_id: u64, entries: Vec<Address>) -> Result<(), Error> {
        let mut promo = load_promo(&env, promo_id)?;
        if promo.status != PromoStatus::Sealed {
            return Err(Error::WrongStatus);
        }
        let config = config(&env);
        let raffle = RaffleClient::new(&env, &config.raffle);
        let sealed = raffle
            .get_raffle(&promo.raffle_id)
            .ok_or(Error::RaffleMismatch)?;
        if sealed.organizer != env.current_contract_address() {
            return Err(Error::RaffleMismatch);
        }
        let draw = raffle.get_draw(&promo.raffle_id).ok_or(Error::NotDrawn)?;

        // La cantidad se compara antes del hash: una lista de otro largo
        // falla barato, sin recorrerla.
        if entries.len() != sealed.count {
            return Err(Error::ListMismatch);
        }
        let list_hash = list::hash(&env, &entries, &[])?;
        if list_hash != sealed.list_hash || list_hash != promo.list_hash {
            return Err(Error::ListMismatch);
        }
        if draw.winners.len() != promo.prizes.len() {
            return Err(Error::RaffleMismatch);
        }

        let now = env.ledger().timestamp();
        let client = token::TokenClient::new(&env, &promo.token);
        let me = env.current_contract_address();

        // Si la tesorería no puede recibir esta moneda, la comisión espera en
        // el contrato (`collect_fee`): nunca traba el pago al ganador.
        promo.fee_paid = promo.fee == 0
            || matches!(
                client.try_transfer(&me, &config.treasury, &promo.fee),
                Ok(Ok(()))
            );
        // Si algún premio queda adeudado (plata) o retenido (especie): se cobra
        // más tarde, no en esta llamada.
        let mut pending = false;
        for position in 0..promo.prizes.len() {
            let index = draw.winners.get_unchecked(position);
            let winner = entries.get(index).ok_or(Error::ListMismatch)?;
            let amount = promo.prizes.get_unchecked(position);
            let mut prize = Prize {
                promo_id,
                position,
                index,
                winner: winner.clone(),
                amount,
                state: PrizeState::Held,
                deliver_by: 0,
                claim_until: 0,
            };
            if promo.in_kind {
                pending = true;
                prize.deliver_by = now.saturating_add(promo.delivery_secs);
                prize.claim_until = prize.deliver_by.saturating_add(CLAIM_WINDOW_SECS);
                PrizeHeld {
                    promo_id,
                    winner,
                    position,
                    amount,
                    deliver_by: prize.deliver_by,
                }
                .publish(&env);
            } else {
                // Una cuenta que no puede recibir (sin línea de confianza,
                // congelada) no traba a los demás: su premio queda adeudado.
                let ok = matches!(client.try_transfer(&me, &winner, &amount), Ok(Ok(())));
                if ok {
                    prize.state = PrizeState::Paid;
                    PrizePaid {
                        promo_id,
                        winner,
                        position,
                        amount,
                    }
                    .publish(&env);
                } else {
                    pending = true;
                    prize.state = PrizeState::Owed;
                    prize.claim_until = now.saturating_add(CLAIM_WINDOW_SECS);
                    PrizeOwed {
                        promo_id,
                        winner,
                        position,
                        amount,
                        claim_until: prize.claim_until,
                    }
                    .publish(&env);
                }
            }
            save_prize(&env, &prize);
        }

        // Un premio adeudado se puede cobrar durante 180 días y la garantía de
        // uno en especie hasta 270 (90 de entrega y 180 de cobro): esta llamada
        // crea esa obligación y la instancia y el código tienen que seguir
        // vivos mientras dure. Por eso quien liquida (normalmente el servicio de
        // Tinkazo) asume la renta completa, como en create, seal, cancel y
        // extend. Si todos los premios se pagaron en el momento no queda nada
        // pendiente y alcanza la renta acotada de las llamadas de usuario.
        if pending {
            bump(&env);
        } else {
            bump_bounded(&env);
        }

        promo.status = PromoStatus::Settled;
        promo.settled_at = now;
        save_promo(&env, &promo);
        Settled {
            promo_id,
            raffle_id: promo.raffle_id,
            fee: promo.fee,
        }
        .publish(&env);
        Ok(())
    }

    /// Especie: el ganador confirma desde su cuenta que recibió el premio, y
    /// la garantía vuelve a la empresa. Solo antes del vencimiento.
    pub fn confirm(env: Env, promo_id: u64, position: u32) -> Result<(), Error> {
        let promo = load_promo(&env, promo_id)?;
        let mut prize = load_prize(&env, promo_id, position)?;
        prize.winner.require_auth();
        bump_bounded(&env);
        if prize.state != PrizeState::Held {
            return Err(Error::WrongPrizeState);
        }
        if env.ledger().timestamp() > prize.deliver_by {
            return Err(Error::TooLate);
        }
        pay(&env, &promo.token, &promo.sponsor, prize.amount);
        prize.state = PrizeState::Returned;
        save_prize(&env, &prize);
        DeliveryConfirmed {
            promo_id,
            winner: prize.winner.clone(),
            position,
        }
        .publish(&env);
        PrizeReturned {
            promo_id,
            position,
            amount: prize.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Paga al ganador un premio adeudado, o la garantía de una entrega que
    /// venció sin confirmarse. Cualquiera puede llamarlo; paga siempre al ganador.
    pub fn claim(env: Env, promo_id: u64, position: u32) -> Result<(), Error> {
        let promo = load_promo(&env, promo_id)?;
        let mut prize = load_prize(&env, promo_id, position)?;
        bump_bounded(&env);
        let now = env.ledger().timestamp();
        match prize.state {
            PrizeState::Owed => {}
            PrizeState::Held => {
                if now <= prize.deliver_by {
                    return Err(Error::TooEarly);
                }
            }
            _ => return Err(Error::WrongPrizeState),
        }
        if now > prize.claim_until {
            return Err(Error::TooLate);
        }
        pay(&env, &promo.token, &prize.winner, prize.amount);
        prize.state = PrizeState::Paid;
        save_prize(&env, &prize);
        PrizePaid {
            promo_id,
            winner: prize.winner.clone(),
            position,
            amount: prize.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Un premio que nadie cobró a tiempo vuelve a la empresa. Cualquiera
    /// puede llamarlo; paga siempre a la empresa.
    pub fn reclaim(env: Env, promo_id: u64, position: u32) -> Result<(), Error> {
        let promo = load_promo(&env, promo_id)?;
        let mut prize = load_prize(&env, promo_id, position)?;
        bump_bounded(&env);
        if prize.state != PrizeState::Owed && prize.state != PrizeState::Held {
            return Err(Error::WrongPrizeState);
        }
        if env.ledger().timestamp() <= prize.claim_until {
            return Err(Error::TooEarly);
        }
        pay(&env, &promo.token, &promo.sponsor, prize.amount);
        prize.state = PrizeState::Returned;
        save_prize(&env, &prize);
        PrizeReturned {
            promo_id,
            position,
            amount: prize.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Devuelve todo a la empresa (premios y comisión) en tres casos:
    /// - no se selló a tiempo (pasado `seal_by`);
    /// - se selló y nadie registró el sorteo en el plazo de gracia
    ///   (`DRAW_GRACE_SECS` después de la hora de la ronda);
    /// - se registró el sorteo y nadie llamó a `settle` en `SETTLE_GRACE_SECS`
    ///   (90 días) desde `drawn_at`: la lista se perdió, el operador no la
    ///   publicó o `settle` ya no cabe en el presupuesto de la red.
    ///
    /// Mientras corra ese plazo, con el sorteo registrado devuelve
    /// `AlreadyDrawn`: el que paga es el ganador, vía `settle`. `settle` sigue
    /// pudiendo pagar hasta el último segundo anterior a que alguien llame a
    /// `refund`; después de un `refund`, `settle` falla con `WrongStatus`.
    /// Cualquiera puede llamarlo; paga siempre a la empresa.
    pub fn refund(env: Env, promo_id: u64) -> Result<(), Error> {
        let mut promo = load_promo(&env, promo_id)?;
        let now = env.ledger().timestamp();
        match promo.status {
            PromoStatus::Funded => {
                if now <= promo.seal_by {
                    return Err(Error::TooEarly);
                }
            }
            PromoStatus::Sealed => {
                let raffle = RaffleClient::new(&env, &config(&env).raffle);
                match raffle.get_draw(&promo.raffle_id) {
                    Some(draw) => {
                        if now <= draw.drawn_at.saturating_add(SETTLE_GRACE_SECS) {
                            return Err(Error::AlreadyDrawn);
                        }
                    }
                    None => {
                        let deadline = round_time(promo.round).saturating_add(DRAW_GRACE_SECS);
                        if now <= deadline {
                            return Err(Error::TooEarly);
                        }
                    }
                }
            }
            _ => return Err(Error::WrongStatus),
        }
        bump_bounded(&env);
        let amount = total_of(&promo);
        pay(&env, &promo.token, &promo.sponsor, amount);
        promo.status = PromoStatus::Refunded;
        save_promo(&env, &promo);
        Refunded { promo_id, amount }.publish(&env);
        Ok(())
    }

    /// Paga a la tesorería una comisión que no pudo recibir en `settle`.
    /// Cualquiera puede llamarlo; paga siempre a la tesorería.
    pub fn collect_fee(env: Env, promo_id: u64) -> Result<(), Error> {
        let mut promo = load_promo(&env, promo_id)?;
        if promo.status != PromoStatus::Settled {
            return Err(Error::WrongStatus);
        }
        if promo.fee_paid {
            return Err(Error::FeeAlreadyPaid);
        }
        bump_bounded(&env);
        pay(&env, &promo.token, &config(&env).treasury, promo.fee);
        promo.fee_paid = true;
        save_promo(&env, &promo);
        FeeCollected {
            promo_id,
            amount: promo.fee,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_promo(env: Env, promo_id: u64) -> Option<Promo> {
        env.storage().persistent().get(&DataKey::Promo(promo_id))
    }

    pub fn get_prize(env: Env, promo_id: u64, position: u32) -> Option<Prize> {
        env.storage()
            .persistent()
            .get(&DataKey::Prize(promo_id, position))
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    pub fn next_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1u64)
    }

    /// Comisión que cobraría este contrato sobre un monto.
    pub fn fee_for(env: Env, amount: i128) -> Result<i128, Error> {
        fee_for(amount, config(&env).fee_bps)
    }

    /// Renueva la renta de una promoción, de sus premios y de la instancia.
    pub fn extend(env: Env, promo_id: u64) -> Result<(), Error> {
        let promo = load_promo(&env, promo_id)?;
        save_promo(&env, &promo);
        for position in 0..promo.prizes.len() {
            let key = DataKey::Prize(promo_id, position);
            if env.storage().persistent().has(&key) {
                extend_key(&env, &key);
            }
        }
        bump(&env);
        Ok(())
    }
}

/// `ceil(amount * fee_bps / 10_000)`.
fn fee_for(amount: i128, fee_bps: u32) -> Result<i128, Error> {
    let scaled = amount
        .checked_mul(fee_bps as i128)
        .ok_or(Error::InvalidPrizes)?;
    Ok((scaled + BPS - 1) / BPS)
}

fn total_of(promo: &Promo) -> i128 {
    let mut sum = promo.fee;
    for amount in promo.prizes.iter() {
        sum += amount;
    }
    sum
}

/// Instante en que se publica una ronda de quicknet (docs/protocolo.md §2).
fn round_time(round: u64) -> u64 {
    const GENESIS: u64 = 1_692_803_367;
    const PERIOD: u64 = 3;
    GENESIS.saturating_add(round.saturating_sub(1).saturating_mul(PERIOD))
}

fn config(env: &Env) -> Config {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(env, Error::BadConfig))
}

fn pay(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount);
}

/// Renueva la renta de la instancia (Config, NextId) y del código del propio
/// contrato hasta casi el máximo. Lo llaman todas las funciones que cambian
/// estado, para que el contrato no caduque mientras haya actividad.
fn bump(env: &Env) {
    let max = env.storage().max_ttl();
    env.deployer().extend_ttl(
        env.current_contract_address(),
        max.saturating_sub(30 * DAY_LEDGERS),
        max,
    );
}

/// Como `bump`, pero acotada: la renta de la instancia y del código es de todas
/// las promociones, y quien llegue primero tras una espera larga no debe cargar
/// con hasta seis meses de renta de todas (el ganador de un premio en especie,
/// con un Max fee de 1 XLM, podría no poder cobrar). Cada llamada extiende
/// como mucho 60 días y solo si queda menos de 30; el resto lo renueva `extend`,
/// que corre quien opera. `settle` la usa solo si no deja nada pendiente: si
/// queda un premio adeudado o retenido, crea una obligación de hasta 270 días y
/// renueva con `bump`.
fn bump_bounded(env: &Env) {
    let max = env.storage().max_ttl();
    env.deployer().extend_ttl_with_limits(
        env.current_contract_address(),
        BOUNDED_TTL.min(max),
        BOUNDED_MIN_EXTENSION,
        BOUNDED_TTL,
    );
}

fn extend_key(env: &Env, key: &DataKey) {
    let max = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(key, max.saturating_sub(30 * DAY_LEDGERS), max);
}

fn load_promo(env: &Env, promo_id: u64) -> Result<Promo, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Promo(promo_id))
        .ok_or(Error::NotFound)
}

fn save_promo(env: &Env, promo: &Promo) {
    let key = DataKey::Promo(promo.id);
    env.storage().persistent().set(&key, promo);
    extend_key(env, &key);
}

fn load_prize(env: &Env, promo_id: u64, position: u32) -> Result<Prize, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Prize(promo_id, position))
        .ok_or(Error::BadPosition)
}

fn save_prize(env: &Env, prize: &Prize) {
    let key = DataKey::Prize(prize.promo_id, prize.position);
    env.storage().persistent().set(&key, prize);
    extend_key(env, &key);
}

mod test;
