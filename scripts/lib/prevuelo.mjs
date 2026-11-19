/**
 * Las piezas puras del prevuelo de la red principal (scripts/preflight-mainnet.mjs).
 *
 * Sin red, sin procesos y sin leer archivos: el guion lee el .wasm y el saldo, y estas funciones
 * deciden qué fila sale y de qué color. Cada fila es `[estado, nombre, detalle]`, con estado «ok»,
 * «ojo» (para mirar, no frena) o «mal» (frena el despliegue).
 *
 * En la red principal no se compila acá: se despliega el .wasm del release, tal cual. Por eso el
 * prevuelo mira ese archivo y su huella, y no un .wasm compilado en esta máquina. Y el saldo que hace
 * falta lo da la simulación del día (depende de qué tan llena esté la red), no una cifra fija.
 */
import { createHash } from "node:crypto";

/** Arriba de esto la renta anual del código sube: se avisa, no frena. */
export const WASM_GRANDE_BYTES = 20 * 1024;

const OPCIONES_CON_VALOR = new Set(["--account", "--wasm", "--sha256", "--necesario"]);

/**
 * Lee las opciones del prevuelo. Lanza un Error con un mensaje para quien lo corre si una opción no
 * existe, le falta el valor o el valor no tiene la forma esperada: una opción mal escrita no puede
 * pasar callada y dejar una comprobación en «ojo».
 */
export function leerOpciones(argv) {
  const opciones = { account: null, wasm: null, sha256: null, necesario: null, sinPruebas: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm preflight:mainnet -- --wasm …` puede dejar pasar el `--` suelto.
    if (arg === "--") continue;
    if (arg === "--sin-pruebas") {
      opciones.sinPruebas = true;
      continue;
    }
    if (!OPCIONES_CON_VALOR.has(arg)) throw new Error(`opción desconocida: ${arg}`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith("--")) throw new Error(`${arg} necesita un valor`);
    i++;
    if (arg === "--account") {
      if (!/^G[A-Z2-7]{55}$/.test(valor)) throw new Error(`--account no parece una cuenta de Stellar (G…, 56 caracteres): ${valor}`);
      opciones.account = valor;
    } else if (arg === "--wasm") {
      opciones.wasm = valor;
    } else if (arg === "--sha256") {
      const hex = valor.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`--sha256 tiene que tener 64 caracteres hexadecimales: ${valor}`);
      opciones.sha256 = hex;
    } else if (arg === "--necesario") {
      const xlm = Number(valor.replace(",", "."));
      if (!Number.isFinite(xlm) || xlm <= 0) throw new Error(`--necesario tiene que ser una cantidad de XLM mayor que cero: ${valor}`);
      opciones.necesario = xlm;
    }
  }
  return opciones;
}

/** El sha256 de unos bytes, en hexadecimal. */
export const huellaDe = (contenido) => createHash("sha256").update(contenido).digest("hex");

/**
 * Las filas del .wasm. `ruta` es la que se pasó con --wasm (o null), `bytes` su tamaño, `sha256` la
 * huella calculada del archivo y `esperado` la que se pasó con --sha256 (o null).
 *
 * Sin ruta nunca es «mal»: el .wasm se baja del release y la huella la vuelve a comparar deploy.sh.
 */
export function revisarWasm({ ruta, bytes, sha256, esperado }) {
  if (!ruta) {
    const filas = [["ojo", "el .wasm del release", "el .wasm se baja del release: pasá --wasm <ruta> --sha256 <huella>"]];
    if (esperado) filas[0][2] += " (vino --sha256 sin --wasm)";
    return filas;
  }
  const kb = `${(bytes / 1024).toFixed(1)} KB`;
  const filas = [];
  if (!esperado) {
    filas.push(["ojo", "el .wasm coincide con la huella", `${ruta}, ${kb}: no vino --sha256; su huella es ${sha256}, comparala con la del release`]);
  } else if (sha256 === esperado) {
    filas.push(["ok", "el .wasm coincide con la huella", `${ruta}, ${kb}, sha256 ${sha256}`]);
  } else {
    filas.push(["mal", "el .wasm coincide con la huella", `${ruta} tiene ${sha256} y se esperaba ${esperado}`]);
  }
  // La renta del código depende del tamaño del módulo, así que un salto acá se paga todos los años.
  if (bytes > WASM_GRANDE_BYTES) filas.push(["ojo", "el contrato creció", `${kb}: arriba de 20 KB la renta anual sube`]);
  return filas;
}

/** La reserva base de la red por cada entrada de una cuenta (0,5 XLM desde 2019). */
export const RESERVA_BASE_XLM = 0.5;

/**
 * Lo que la cuenta no puede gastar, con los campos de Horizon (`/accounts/<G>`): la reserva mínima,
 * (2 + subentradas + patrocinadas por ella − patrocinadas por otros) × 0,5 XLM, más lo que tiene
 * comprometido en ofertas de venta de XLM.
 */
export function reservaDeLaCuenta(cuenta, base = RESERVA_BASE_XLM) {
  // Un campo ausente es 0; uno presente que no es número queda NaN, y revisarSaldo lo da por «mal».
  const n = (v) => (v == null ? 0 : Number(v));
  const nativo = (cuenta?.balances ?? []).find((b) => b.asset_type === "native");
  const entradas = 2 + n(cuenta?.subentry_count) + n(cuenta?.num_sponsoring) - n(cuenta?.num_sponsored);
  return entradas * base + n(nativo?.selling_liabilities);
}

/** El margen sobre la cifra de la simulación: entre medir y enviar, la tarifa puede subir. */
export const MARGEN_DEL_SALDO = 0.1;

const xlmTexto = (x) => `${(Math.round(x * 100) / 100).toFixed(2)} XLM`;

/**
 * La fila del saldo, contra lo que la cuenta puede gastar (el saldo menos su reserva), no contra el
 * saldo entero: lo que pide la simulación no puede salir de la reserva. «mal» si no alcanza, «ojo» si
 * alcanza sin el margen del 10 % y «ok» con el margen. Sin --necesario, «ojo» con el saldo a la vista.
 */
export function revisarSaldo({ xlm, necesario, reserva = 0 }) {
  if (!Number.isFinite(xlm) || !Number.isFinite(reserva)) {
    return [["mal", "el saldo alcanza", `Horizon devolvió el saldo o la reserva en un formato inesperado (saldo ${xlm}, reserva ${reserva})`]];
  }
  const gastable = xlm - reserva;
  const tiene = reserva > 0 ? `${xlmTexto(xlm)}, de los que ${xlmTexto(reserva)} son la reserva de la cuenta: ${xlmTexto(gastable)} para gastar` : `${xlmTexto(xlm)} para gastar`;
  if (necesario == null) {
    return [["ojo", "el saldo alcanza", `${tiene}; pasá --necesario con la cifra de la simulación del día`]];
  }
  const conMargen = necesario * (1 + MARGEN_DEL_SALDO);
  if (gastable < necesario) return [["mal", "el saldo alcanza", `${tiene}, y la simulación pide ${necesario} XLM`]];
  if (gastable < conMargen) {
    return [["ojo", "el saldo alcanza", `${tiene}: alcanza para los ${necesario} XLM de la simulación, pero sin el margen del 10 % (${xlmTexto(conMargen)}) por si la tarifa sube`]];
  }
  return [["ok", "el saldo alcanza", `${tiene}, de ${necesario} XLM más el 10 % de margen`]];
}

/** El tope de cada corrida de pruebas del prevuelo: la suite entera tardó entre 280 y 345 s en la máquina del autor. */
export const TOPE_DE_PRUEBAS_MS = 900_000;

/**
 * La fila de una corrida de pruebas. Un corte por tiempo dice que fue por tiempo y no una prueba
 * roja; cada fila lleva cuánto tardó.
 */
export function filaDePruebas(nombre, { codigo, porTiempo, ms, tope = TOPE_DE_PRUEBAS_MS, error = "" }) {
  const duro = `${Math.round(ms / 1000)} s`;
  if (porTiempo) {
    return ["mal", nombre, `se cortó por tiempo a los ${Math.round(tope / 1000)} s: no es una prueba roja; repetilo o corré las pruebas aparte y pasá --sin-pruebas`];
  }
  if (codigo === 0) return ["ok", nombre, `en ${duro}`];
  return ["mal", nombre, `salió con ${codigo} en ${duro}${error ? `: ${error}` : ""}`];
}

/** El renglón del costo al final del informe. */
export function lineaDeCosto(necesario) {
  return necesario == null
    ? "El costo del día lo da la simulación: pasalo con --necesario para comprobar el saldo."
    : `Saldo pedido para el día: ${necesario} XLM (la cifra de la simulación que se pasó con --necesario).`;
}

/** Las dos órdenes del paso siguiente, con el .wasm y la huella si vinieron. */
export function ordenesDeDespliegue({ wasm, sha256 }) {
  const base = `scripts/deploy.sh mainnet <identidad> --wasm ${wasm ?? "<archivo .wasm del release>"} --sha256 ${sha256 ?? "<huella del release>"}`;
  return [`${base} --ensayo`, base];
}
