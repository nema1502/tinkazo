/**
 * Quién pagó la comisión de una transacción, leído de lo que cuenta Horizon.
 *
 * Es la parte que decide de `scripts/verificar-patrocinio.mjs`, y no toca la red:
 * recibe las respuestas de Horizon ya bajadas y devuelve veredictos. Así se
 * prueba con respuestas guardadas (`scripts/lib/muestras-patrocinio/`) sin
 * depender de que Horizon esté vivo.
 *
 * Sin dependencias. El dinero va siempre en `BigInt` de stroops (1 XLM =
 * 10 000 000 stroops) y nunca en flotantes: la comprobación de la billetera es
 * "al stroop", y un flotante no la puede dar.
 */

export const STROOPS_POR_XLM = 10_000_000n;

/**
 * Lo que cuesta abrir la cuenta de una persona nueva en Pollar: tres operaciones
 * (patrocinar la reserva, crear la cuenta, dejar de patrocinar) a 100 stroops
 * cada una, que paga la billetera de la app. Son 0,00003 XLM.
 */
export const STROOPS_POR_ALTA = 300n;

export const HORIZON = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

/* ----------------------------------------------------------------- montos */

const MONTO = /^(\d+)(?:[.,](\d{1,7}))?$/;

/**
 * `"9998.8158600"` -> `99988158600n`. Exacto: no pasa por flotantes. Acepta punto
 * o coma como decimal y hasta siete decimales, que es lo que tiene un XLM.
 */
export function aStroops(monto) {
  const texto = String(monto ?? "").trim();
  const m = MONTO.exec(texto);
  if (!m) throw new Error(`monto inválido "${texto}": usá el formato de Horizon, por ejemplo 9998.8158600`);
  const [, entero, decimales = ""] = m;
  return BigInt(entero) * STROOPS_POR_XLM + BigInt(decimales.padEnd(7, "0"));
}

/** `99988158600n` -> `"9998.8158600"`: siete decimales, como lo escribe Horizon. */
export function aXlm(stroops) {
  const negativo = stroops < 0n;
  const v = negativo ? -stroops : stroops;
  return `${negativo ? "-" : ""}${v / STROOPS_POR_XLM}.${(v % STROOPS_POR_XLM).toString().padStart(7, "0")}`;
}

/** `fee_charged` viene como un entero de stroops escrito en una cadena. */
function stroopsEnteros(valor, campo) {
  if (typeof valor !== "string" || !/^\d+$/.test(valor)) throw new Error(`Horizon no trajo ${campo} (o no es un entero de stroops)`);
  return BigInt(valor);
}

/* ------------------------------------------------------------ transacción */

/**
 * ¿Quién pagó?
 *
 * - `patrocinada`: la envolvió un fee-bump y la comisión la pagó una cuenta
 *   distinta de la dueña de la transacción.
 * - `propia`: la pagó su misma cuenta (con o sin fee-bump: una cuenta puede
 *   envolver su propia transacción, y eso no es un patrocinio).
 * - `sin-datos`: Horizon no trajo con qué decidirlo, o trajo algo que no cierra
 *   (una cuenta distinta pagando sin fee-bump no existe en la red).
 */
export function quienPago({ esFeeBump, pagadaPor, deLaCuenta }) {
  if (!pagadaPor || !deLaCuenta) return "sin-datos";
  if (pagadaPor === deLaCuenta) return "propia";
  return esFeeBump ? "patrocinada" : "sin-datos";
}

/**
 * Lo que dice Horizon de una transacción (`GET /transactions/<hash>`), ya leído.
 *
 * Horizon cuenta una transacción envuelta con dos hashes: el de adentro (la
 * transacción de la persona, que es el que guarda Tinkazo) y el de afuera (el
 * fee-bump). Se puede preguntar por cualquiera de los dos.
 */
export function analizarTransaccion(resp) {
  if (!resp || typeof resp !== "object") throw new Error("Horizon no devolvió nada para esta transacción");
  const esFeeBump = Boolean(resp.fee_bump_transaction);
  const pagadaPor = resp.fee_account ?? null;
  const deLaCuenta = resp.source_account ?? null;
  const comisionStroops = stroopsEnteros(resp.fee_charged, "fee_charged");
  return {
    hash: resp.hash ?? null,
    hashDeAdentro: resp.inner_transaction?.hash ?? null,
    hashDeAfuera: resp.fee_bump_transaction?.hash ?? null,
    ledger: resp.ledger ?? null,
    creada: resp.created_at ?? null,
    exitosa: resp.successful === true,
    esFeeBump,
    pagadaPor,
    deLaCuenta,
    comisionStroops,
    comisionXlm: aXlm(comisionStroops),
    veredicto: quienPago({ esFeeBump, pagadaPor, deLaCuenta }),
  };
}

/**
 * ¿Es lo que se esperaba? Por defecto, que la transacción esté patrocinada
 * (`--espero-patrocinada`); con `"propia"`, el control negativo: que haya pagado
 * la propia cuenta. Una transacción que no fue exitosa nunca cumple.
 */
export function cumpleLoEsperado(analisis, esperado = "patrocinada") {
  if (!analisis.exitosa) return { ok: false, motivo: "no fue exitosa en la red" };
  if (analisis.veredicto === "sin-datos") return { ok: false, motivo: "Horizon no trajo con qué saber quién pagó la comisión" };
  if (analisis.veredicto === esperado) {
    return {
      ok: true,
      motivo: esperado === "patrocinada" ? "la comisión la pagó otra cuenta, no la de quien firmó" : "la comisión la pagó la propia cuenta",
    };
  }
  return {
    ok: false,
    motivo:
      esperado === "patrocinada"
        ? "la comisión la pagó la propia cuenta: no hubo patrocinio"
        : "la comisión la pagó otra cuenta: se esperaba que la pagara la propia",
  };
}

/* ----------------------------------------------------------------- cuenta */

const positivo = (monto) => {
  try {
    return aStroops(monto) > 0n;
  } catch {
    return false;
  }
};

/**
 * Las operaciones de esta cuenta que le pudieron poner fondos. Una cuenta nueva
 * de Pollar solo debería tener `begin_sponsoring_future_reserves`,
 * `create_account` con saldo inicial 0 y `end_sponsoring_future_reserves`.
 *
 * Cuentan: un `create_account` con saldo inicial mayor que cero (es el caso del
 * grifo con una cuenta nueva), un pago que llega a la cuenta (también del grifo
 * con una cuenta que ya existe), un `account_merge` hacia ella y el cobro de un
 * saldo reclamable. Un pago que la cuenta hace, o una cuenta que ella crea, no.
 */
export function fondosQueRecibio(cuenta, operaciones) {
  const hallados = [];
  for (const op of operaciones ?? []) {
    switch (op?.type) {
      case "create_account":
        if (op.account === cuenta && positivo(op.starting_balance)) {
          hallados.push({ tipo: op.type, de: op.funder ?? op.source_account ?? null, monto: `${op.starting_balance} XLM` });
        }
        break;
      case "payment":
      case "path_payment_strict_receive":
      case "path_payment_strict_send":
        if (op.to === cuenta && positivo(op.amount)) {
          hallados.push({
            tipo: op.type,
            de: op.from ?? op.source_account ?? null,
            monto: `${op.amount} ${op.asset_type === "native" ? "XLM" : (op.asset_code ?? "de otro activo")}`,
          });
        }
        break;
      case "account_merge":
        if (op.into === cuenta) hallados.push({ tipo: op.type, de: op.account ?? op.source_account ?? null, monto: "su saldo" });
        break;
      case "claim_claimable_balance":
        if (op.claimant === cuenta) hallados.push({ tipo: op.type, de: null, monto: "un saldo reclamable" });
        break;
    }
  }
  return hallados;
}

/** Cuántas operaciones de cada tipo, en el orden en que aparecen. */
export function resumenDeOperaciones(operaciones) {
  const cuenta = new Map();
  for (const op of operaciones ?? []) cuenta.set(op?.type ?? "?", (cuenta.get(op?.type ?? "?") ?? 0) + 1);
  return [...cuenta];
}

/**
 * La cuenta del organizador, vista desde Horizon (`GET /accounts/<G>` y sus
 * operaciones): su saldo hoy, cuántas entradas le patrocinan y si alguna vez
 * recibió fondos. La prueba de 0 XLM vale solo si nunca los recibió y hoy sigue
 * en cero: si no, cualquier comisión pudo pagarla la cuenta con eso.
 */
export function analizarCuenta({ cuenta, cuentaHorizon, operaciones }) {
  if (!cuentaHorizon) return { existe: false, cuenta };
  const nativo = (cuentaHorizon.balances ?? []).find((b) => b.asset_type === "native");
  const saldoStroops = nativo ? aStroops(nativo.balance) : 0n;
  const fondos = fondosQueRecibio(cuenta, operaciones);
  return {
    existe: true,
    cuenta,
    saldoStroops,
    saldoXlm: aXlm(saldoStroops),
    numPatrocinadas: Number(cuentaHorizon.num_sponsored ?? 0),
    operaciones: resumenDeOperaciones(operaciones),
    totalDeOperaciones: (operaciones ?? []).length,
    fondosRecibidos: fondos,
    enCero: saldoStroops === 0n,
    // Anulada: recibió fondos, o tiene saldo aunque no se vea de dónde.
    anulada: fondos.length > 0 || saldoStroops > 0n,
  };
}

/* -------------------------------------------------------------- billetera */

/**
 * La billetera que paga: lo que bajó su saldo entre el antes y el ahora tiene que
 * ser EXACTAMENTE la suma de las comisiones de las transacciones, o esa suma más
 * 300 stroops (0,00003 XLM) si en el medio se abrió una cuenta nueva (la alta de
 * la persona que entró para probar). Cualquier otra diferencia quiere decir que
 * pasó algo más con esa billetera en el medio: otra transacción, otra alta.
 *
 * Todos los montos en stroops (BigInt).
 */
export function cotejarBilletera({ antes, ahora, comisiones }) {
  const diferencia = antes - ahora;
  const suma = comisiones.reduce((a, c) => a + c, 0n);
  if (diferencia === suma) return { ok: true, diferencia, suma, altas: 0 };
  if (diferencia === suma + STROOPS_POR_ALTA) return { ok: true, diferencia, suma, altas: 1 };
  return { ok: false, diferencia, suma, sobra: diferencia - suma };
}
