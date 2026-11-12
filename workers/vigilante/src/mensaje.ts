/**
 * Los textos de los avisos. Salen por correo (y por Telegram si está prendido) a una persona de confianza, así que
 * SÍ llevan las cifras: qué pasa, los créditos, el piso, el margen, el saldo de la cuenta que paga y qué hacer. En
 * frases cortas, en voseo y sin tecnicismos. El asunto tiene que entenderse en la pantalla bloqueada del celular: va
 * primero lo que pasa y, si hace falta, qué hacer.
 *
 * Reglas de escritura del proyecto: nada de punto y coma, comillas angulares, rayas largas ni puntos medios.
 *
 * El estado del portero llega de afuera: acá se lee con cuidado. Un campo que falta, o que no es lo que se espera, se
 * dice «sin leer» y no se inventa.
 */
import { grupoDeClave, prendidosLimpios, textoLimpio } from "../../../scripts/lib/revision-portero.mjs";

export interface Mensaje {
  asunto: string;
  texto: string;
}

/** Lo que cualquier aviso necesita saber: el estado del portero (o null si no se pudo leer), la hora y a qué portero se mira. */
export interface Contexto {
  estado: unknown;
  ahora: Date;
  portero: string;
}

type Objeto = Record<string, unknown>;
const objeto = (x: unknown): Objeto => (x && typeof x === "object" && !Array.isArray(x) ? (x as Objeto) : {});
const numero = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

const SIN_LEER = "sin leer";

/** Un entero con puntos de miles: 1234567 es «1.234.567». Lo que no es un número se dice «sin leer». */
export function miles(x: unknown): string {
  const n = numero(x);
  if (n === null) return SIN_LEER;
  const entero = Math.round(n);
  const digitos = String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return entero < 0 ? `-${digitos}` : digitos;
}

/** Stroops (como texto o como número) a XLM con un decimal y coma: «25,3 XLM». Lo que no es un monto se dice «sin leer». */
export function xlm(x: unknown): string {
  let v: bigint | null = null;
  if (typeof x === "string" && /^\d+$/.test(x)) v = BigInt(x);
  else if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) v = BigInt(x);
  if (v === null) return SIN_LEER;
  const enteros = v / 10_000_000n;
  const decimas = (v % 10_000_000n) / 1_000_000n;
  return `${miles(Number(enteros))},${decimas} XLM`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** La hora en Bolivia, que son cuatro menos que la universal: «14 de noviembre, 10:20 (hora de Bolivia)». */
export function horaDeBolivia(d: Date): string {
  const b = new Date(d.getTime() - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}, ${dos(b.getUTCHours())}:${dos(b.getUTCMinutes())} (hora de Bolivia)`;
}

// ---------- los problemas, uno por uno ----------

interface Entrada {
  /** Lo que se lee primero, en la pantalla bloqueada. */
  asunto: (clave: string) => string;
  /** Cuánto pesa para elegir el asunto cuando hay varios: el mayor va primero. */
  gravedad: (clave: string) => number;
  /** Qué pasa, con las cifras. */
  frase: (clave: string, e: Objeto) => string;
  /** Qué hacer. */
  hacer: (clave: string, c: Contexto) => string;
}

const sufijo = (clave: string): string => clave.slice(clave.indexOf(":") + 1);
const margenDe = (e: Objeto): number | null => numero(e.margen) ?? (numero(e.creditos) !== null && numero(e.piso) !== null ? (e.creditos as number) - (e.piso as number) : null);
const tramoDeFirmas = (clave: string): number => Number(/mas-de-(\d+)$/.exec(clave)?.[1] ?? 10);
/**
 * La lista de cobros de Pollar vino llena (`firmas.completo` en false): pudo quedar afuera lo más viejo del día, así que
 * la cifra de cobros sin explicar es lo menos que hay. Sin la cifra, o con `completo` en true, null o ausente, nada.
 */
const listaLlena = (e: Objeto): boolean => objeto(e.firmas).completo === false && numero(e.firmasSinExplicar) !== null;
/** Los créditos se leyeron hace más de esto: el correo dice de cuándo son. El portero los guarda un minuto. */
const CREDITOS_VIEJOS_MS = 2 * 60_000;

const CATALOGO: Record<string, Entrada> = {
  modo: {
    asunto: (clave) =>
      sufijo(clave) === "apagado" ? "El portero está apagado: nadie puede sellar" : sufijo(clave) === "pollar" ? "El portero no paga: lo pasaron a Pollar" : "No se puede leer si el portero paga",
    gravedad: (clave) => (sufijo(clave) === "apagado" || sufijo(clave) === "pollar" ? 97 : 60),
    frase: (clave) =>
      sufijo(clave) === "apagado"
        ? "El portero está apagado y no paga ningún sello ni sorteo. Nadie puede sellar ni sortear con la cuenta de Google."
        : sufijo(clave) === "pollar"
          ? "El portero le devolvió las comisiones a Pollar y no paga ningún sello ni sorteo. Si Pollar no tiene una regla que los pague, nadie puede sellar con la cuenta de Google."
          : "El portero no dice si está pagando los sellos y los sorteos.",
    hacer: (clave) =>
      sufijo(clave) === "apagado"
        ? "Si lo apagaste a propósito, no hagas nada. Si no, encendelo con encender (hoja de operación, docs/operacion.md, Cómo cortar)."
        : sufijo(clave) === "pollar"
          ? "Si no fue a propósito, encendelo con encender (docs/operacion.md, Cómo cortar). Si es el plan B3, mirá que la regla del contrato esté prendida en Pollar."
          : "Mirá el estado a mano: modo tiene que decir portero. Si dice otra cosa, encendelo (docs/operacion.md, Cómo cortar).",
  },
  "portero-sin-llave": {
    asunto: () => "El portero no tiene la llave: nadie puede sellar",
    gravedad: () => 96,
    frase: () => "Al portero le falta su llave, la que usa para pagar. No paga ningún sello ni sorteo, así que nadie puede sellar ni sortear con la cuenta de Google.",
    hacer: () =>
      "Cargá de nuevo la llave en el portero, desde workers/patrocinio, con npx wrangler@4.160.0 secret put CLAVE_PATROCINADOR --env mainnet --config wrangler.toml (README del portero).",
  },
  "creditos-bajo-el-piso": {
    asunto: () => "Créditos de Pollar bajo el piso: cargá ya",
    gravedad: () => 90,
    frase: (_c, e) => {
      const margen = margenDe(e);
      const falta = margen === null ? SIN_LEER : miles(Math.abs(margen));
      return `Los créditos de Pollar están por debajo del piso. Quedan ${miles(e.creditos)} y el piso es ${miles(e.piso)}, así que faltan ${falta}. El portero ya no acepta canjes de cupones nuevos.`;
    },
    hacer: () => "Cargá créditos en el panel de Pollar ahora. Cuánto cargar está en la hoja de operación (docs/operacion.md), en Antes del evento.",
  },
  "creditos-bajos": {
    asunto: () => "Créditos de Pollar bajos: cargá hoy",
    gravedad: () => 50,
    frase: (_c, e) => `Los créditos de Pollar están cerca del piso. Quedan ${miles(e.creditos)} y el piso es ${miles(e.piso)}, así que sobran ${miles(margenDe(e))}. El aviso salta con menos de 1.000 de margen.`,
    hacer: () => "Cargá créditos en el panel de Pollar hoy, antes de que bajen del piso. Cuánto cargar está en la hoja de operación (docs/operacion.md).",
  },
  "creditos-sin-leer": {
    asunto: () => "No se pueden leer los créditos de Pollar",
    gravedad: () => 60,
    frase: () => "El portero no pudo leer cuántos créditos quedan en Pollar.",
    hacer: () => "Esperá unos minutos y mirá el estado a mano. Si sigue sin leerse, avisá a Pollar. Mientras tanto los canjes nuevos se pausan solos.",
  },
  "patrocinadora-casi-sin-saldo": {
    asunto: () => "A la cuenta que paga casi no le queda saldo",
    gravedad: () => 95,
    frase: (_c, e) => `A la cuenta que paga las comisiones le quedan ${xlm(e.balanceStroops)}. El aviso salta por debajo de ${xlm(e.saldoAlertaStroops)} y ahora queda menos de la mitad.`,
    hacer: () => "Cargala ya desde la cuenta fría, en un tramo de 20 a 40 XLM. Sin saldo no se puede sellar ni sortear.",
  },
  "patrocinadora-baja": {
    asunto: (clave) => (sufijo(clave) === "saldo-no-leido" ? "No se puede leer el saldo de la cuenta que paga" : "La cuenta que paga tiene poco saldo"),
    gravedad: () => 70,
    frase: (clave, e) =>
      sufijo(clave) === "saldo-no-leido"
        ? "No se pudo leer el saldo de la cuenta que paga las comisiones."
        : `La cuenta que paga las comisiones tiene ${xlm(e.balanceStroops)}, por debajo de los ${xlm(e.saldoAlertaStroops)} que pide el aviso.`,
    hacer: (clave) =>
      sufijo(clave) === "saldo-no-leido" ? "Mirá el estado a mano. Si el saldo está bien, esperá a la próxima vuelta." : "Cargala desde la cuenta fría, en un tramo de 20 a 40 XLM.",
  },
  "altas-pausadas": {
    asunto: () => "Las altas están pausadas",
    gravedad: () => 40,
    frase: () => "Las altas de cuentas nuevas están pausadas a mano. Nadie puede canjear un cupón nuevo.",
    hacer: () => "Si las pausaste a propósito, no hagas nada. Si no, reanudalas con el comando de la hoja de operación (docs/operacion.md).",
  },
  "firmas-sin-explicar": {
    asunto: () => "Cobros de Pollar sin explicar",
    gravedad: (clave) => 60 + Math.min(tramoDeFirmas(clave), 200) / 10,
    frase: (clave, e) =>
      `En el último día hay ${listaLlena(e) ? "al menos " : ""}${miles(e.firmasSinExplicar)} cobros de Pollar que el portero no puede explicar. ${
        tramoDeFirmas(clave) >= 200 ? "Son muchísimos. " : tramoDeFirmas(clave) >= 50 ? "Son varias veces el tope. " : ""
      }Alguien podría estar usando cuentas de Google por fuera del sitio.`,
    hacer: (clave) => `${tramoDeFirmas(clave) >= 200 ? "Es urgente. " : ""}Pausá las altas y mirá el estado a mano. Los pasos están en la hoja de operación (docs/operacion.md).`,
  },
  "firmas-sin-comparar": {
    asunto: () => "No se pueden comparar los cobros de Pollar",
    gravedad: () => 30,
    frase: () => "No se pudieron comparar los cobros de Pollar con los del portero.",
    hacer: () => "Mirá el estado a mano. Si Pollar no contesta, esperá y volvé a mirar.",
  },
  "patrocinio-prendido": {
    asunto: () => "Patrocinio de la app prendido en Pollar",
    gravedad: () => 65,
    frase: (clave) => {
      const prendidos = sufijo(clave);
      return `El patrocinio de la app en Pollar no está todo apagado${prendidos ? `. Está prendido: ${prendidos.split(",").join(", ")}` : ""}.`;
    },
    hacer: () => "Apagalo en el panel de Pollar. Mientras esté prendido gasta créditos sin que el portero lo cuente.",
  },
  "patrocinio-sin-leer": {
    asunto: () => "No se puede leer el patrocinio de Pollar",
    gravedad: () => 30,
    frase: () => "No se pudo leer el patrocinio de la app en Pollar.",
    hacer: () => "Mirá el estado a mano y revisá el patrocinio en el panel de Pollar.",
  },
  "no-es-mainnet": {
    asunto: () => "El vigilante mira el portero equivocado",
    gravedad: () => 85,
    frase: (_c, e) =>
      `El portero que contesta no es el de producción. Dice ser: ${typeof e.red === "string" ? textoLimpio(e.red, 30) : SIN_LEER}.`,
    hacer: (_c, c) => `Revisá la variable PORTERO_URL del vigilante (hoy mira ${c.portero}). Está en el README del vigilante.`,
  },
  "respuesta-invalida": {
    asunto: () => "El portero contesta algo que no se entiende",
    gravedad: () => 75,
    frase: () => "El portero contestó algo que no se entiende.",
    hacer: () => "Mirá el estado a mano y el registro del Worker del portero.",
  },
  "sin-lectura": {
    asunto: () => "El portero no contesta",
    gravedad: () => 92,
    frase: () => "El portero no contestó en las últimas dos vueltas, unos 20 minutos. Nadie puede sellar con la cuenta de Google hasta que vuelva.",
    hacer: () => "Mirá el panel de Cloudflare: Workers, tinkazo-patrocinio-mainnet, y su registro. Si Cloudflare tiene una falla, esperá. Lo sellado no se pierde.",
  },
  "vigilante-sin-clave": {
    asunto: () => "Al vigilante le falta la clave del portero",
    gravedad: () => 88,
    frase: () => "El vigilante no puede entrar al portero: no tiene la clave de operar o el portero ya no la acepta. Mientras tanto no mira nada.",
    hacer: () => "Cargá de nuevo la clave de operar del portero en el vigilante: wrangler secret put PORTERO_ADMIN_TOKEN (pasos en el README del vigilante).",
  },
};

/** Los problemas que el vigilante sabe contar con palabras propias. */
export const CLAVES_CONOCIDAS: string[] = Object.keys(CATALOGO);

const prefijoDe = (clave: string): string => clave.split(":")[0]!;
const entradaDe = (clave: string): Entrada | undefined => CATALOGO[prefijoDe(clave)];

/** El asunto con el que sale un problema, o null si no se conoce. La hoja de operación tiene una fila por cada uno. */
export function asuntoDeClave(clave: string): string | null {
  return entradaDe(clave)?.asunto(clave) ?? null;
}

/** Cómo se dice, en el arreglo, cada grupo de problemas: lo corto para el asunto y la frase para el cuerpo. */
const ARREGLOS: Record<string, { corto: string; frase: string }> = {
  modo: { corto: "el portero vuelve a pagar", frase: "El portero volvió a pagar los sellos y los sorteos." },
  "portero-sin-llave": { corto: "llave del portero", frase: "El portero volvió a tener su llave." },
  creditos: { corto: "créditos de Pollar", frase: "Los créditos de Pollar volvieron a estar bien." },
  patrocinadora: { corto: "cuenta que paga", frase: "La cuenta que paga las comisiones volvió a tener saldo." },
  "altas-pausadas": { corto: "altas pausadas", frase: "Las altas ya no están pausadas." },
  firmas: { corto: "cobros sin explicar", frase: "Ya no hay cobros de Pollar sin explicar." },
  patrocinio: { corto: "patrocinio de la app", frase: "El patrocinio de la app en Pollar volvió a estar apagado." },
  "no-es-mainnet": { corto: "portero equivocado", frase: "El vigilante vuelve a mirar el portero de producción." },
  "respuesta-invalida": { corto: "respuesta del portero", frase: "El portero volvió a contestar algo que se entiende." },
  "sin-lectura": { corto: "el portero vuelve a contestar", frase: "El portero volvió a contestar." },
  "vigilante-sin-clave": { corto: "clave del vigilante", frase: "El vigilante volvió a entrar al portero." },
};

/**
 * Cuando lo único que había era que no se podía leer el modo del portero, arreglarlo es poder leerlo de nuevo: nunca
 * se supo que dejara de pagar, así que no se dice que volvió a pagar.
 */
const ARREGLO_MODO_SIN_LEER = { corto: "ya se lee si el portero paga", frase: "Ya se puede leer si el portero paga los sellos y los sorteos." };

/** Cómo se dice el arreglo de un grupo, según las claves de ese grupo que se arreglaron. */
function arregloDe(grupo: string, claves: string[]): { corto: string; frase: string } {
  if (grupo === "modo" && claves.every((clave) => sufijo(clave) === "sin-leer")) return ARREGLO_MODO_SIN_LEER;
  return ARREGLOS[grupo] ?? { corto: "un problema", frase: "Se arregló un problema." };
}

/** Los grupos de las claves que se arreglaron, sin repetir y en orden. */
function gruposArreglados(claves: string[]): Array<{ corto: string; frase: string }> {
  const porGrupo = new Map<string, string[]>();
  for (const clave of claves) {
    const grupo = grupoDeClave(clave);
    porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), clave]);
  }
  return [...porGrupo].map(([grupo, delGrupo]) => arregloDe(grupo, delGrupo));
}

// ---------- las piezas de un aviso ----------

/**
 * Si los créditos se leyeron hace más de dos minutos (con Pollar caído, el portero usa el último saldo hasta diez
 * minutos), de cuándo son. Con la hora en el futuro, sin hora o sin créditos, nada.
 */
function creditosDeAntes(e: Objeto, ahora: Date): string {
  const leidos = numero(e.creditosLeidos);
  if (leidos === null || numero(e.creditos) === null) return "";
  const edad = ahora.getTime() - leidos;
  return edad > CREDITOS_VIEJOS_MS ? ` (leídos hace ${miles(Math.floor(edad / 60_000))} minutos)` : "";
}

/** Las cifras de ahora, o que no se pudo leer. */
function cifras(c: Contexto): string[] {
  if (c.estado === null || c.estado === undefined) return ["No se pudo leer el portero, así que no hay cifras de ahora."];
  const e = objeto(c.estado);
  const patrocinio = objeto(e.patrocinioPollar);
  // Las mismas banderas, limpias y acotadas, que entran a la clave del problema.
  const prendidos = prendidosLimpios(patrocinio.prendidos).join(", ");
  const altas = e.altasPausadas === true ? "pausadas a mano" : e.altasPausadas === false ? "andando" : SIN_LEER;
  const elPatrocinio = patrocinio.esperado === true ? "todo apagado" : patrocinio.esperado === false ? `prendido: ${prendidos || "sin detalle"}` : SIN_LEER;
  const nivel = numero(e.saldoAlertaStroops) !== null ? ` (el aviso salta por debajo de ${xlm(e.saldoAlertaStroops)})` : "";
  // Si el portero paga: su modo y su llave. Sin el campo llave no se inventa que falta.
  const elPortero =
    e.modo === "portero" ? (e.llave === null ? "sin su llave, no paga" : "paga los sellos y los sorteos") : e.modo === "apagado" ? "apagado, no paga" : e.modo === "pollar" ? "devuelto a Pollar, no paga" : SIN_LEER;
  return [
    "Las cifras de ahora:",
    `- Portero: ${elPortero}`,
    `- Créditos de Pollar: ${miles(e.creditos)}${creditosDeAntes(e, c.ahora)}`,
    `- Piso: ${miles(e.piso)}`,
    `- Margen sobre el piso: ${miles(margenDe(e))}`,
    `- Saldo de la cuenta que paga: ${xlm(e.balanceStroops)}${nivel}`,
    `- Altas de cuentas nuevas: ${altas}`,
    `- Cobros de Pollar sin explicar en el último día: ${listaLlena(e) ? `al menos ${miles(e.firmasSinExplicar)} (la lista de Pollar vino llena)` : miles(e.firmasSinExplicar)}`,
    `- Patrocinio de la app en Pollar: ${elPatrocinio}`,
  ];
}

const PIE = "Aviso del vigilante de Tinkazo.";

/** Un problema con su frase y qué hacer, con la clave que dice cuál es y el texto de reserva por si no se conoce. */
function bloqueDe(clave: string, reserva: string | undefined, c: Contexto, numeroDeLista: number | null): string[] {
  const entrada = entradaDe(clave);
  const e = objeto(c.estado);
  const frase = entrada ? entrada.frase(clave, e) : reserva || `Hay un problema que el vigilante no sabe contar: ${clave}.`;
  const hacer = entrada ? entrada.hacer(clave, c) : "Mirá el estado a mano (hoja de operación, docs/operacion.md).";
  const cabeza = numeroDeLista === null ? frase : `${numeroDeLista}. ${frase}`;
  return [cabeza, `${numeroDeLista === null ? "" : "   "}Qué hacer: ${hacer}`];
}

/** Los problemas, del más grave al menos, sin perder a cuál texto de reserva corresponde cada clave. */
function ordenados(claves: string[], problemas: string[]): Array<{ clave: string; reserva: string | undefined }> {
  const pares = claves.map((clave, i) => ({ clave, reserva: problemas[i] }));
  const peso = (clave: string) => entradaDe(clave)?.gravedad(clave) ?? 10;
  return pares.map((p, i) => ({ p, i })).sort((a, b) => peso(b.p.clave) - peso(a.p.clave) || a.i - b.i).map(({ p }) => p);
}

function asuntoDeProblemas(lista: Array<{ clave: string }>): string {
  const primero = lista[0];
  if (!primero) return "El portero tiene un problema";
  const base = entradaDe(primero.clave)?.asunto(primero.clave) ?? "El portero tiene un problema";
  return lista.length > 1 ? `${base} y ${lista.length - 1} más` : base;
}

function listaDeProblemas(lista: Array<{ clave: string; reserva: string | undefined }>, c: Contexto): string[] {
  const salida: string[] = [];
  lista.forEach((p, i) => {
    salida.push(...bloqueDe(p.clave, p.reserva, c, lista.length === 1 ? null : i + 1));
    if (i < lista.length - 1) salida.push("");
  });
  return salida;
}

// ---------- los avisos ----------

export interface DatosDeAlerta {
  claves: string[];
  /** Los textos del guion de revisión, uno por clave y en el mismo orden: son la reserva para una clave nueva. */
  problemas: string[];
  recordatorio: boolean;
  /** Lo que se arregló en esta misma vuelta. */
  arreglados: string[];
  /** Lo que ya estaba avisado y sigue: se nombra al final, sin repetir qué hacer. */
  siguen: string[];
}

/** Un problema nuevo, uno que empeoró, o el recordatorio de uno que sigue pasadas 23 horas. */
export function mensajeDeAlerta(a: DatosDeAlerta, c: Contexto): Mensaje {
  const lista = ordenados(a.claves, a.problemas);
  const base = asuntoDeProblemas(lista);
  const n = lista.length;
  const texto: string[] = [n === 1 ? "Hay 1 problema con el portero." : `Hay ${n} problemas con el portero.`];
  if (a.recordatorio) texto.push("Es un recordatorio: pasaron más de 23 horas desde el último aviso y esto sigue sin arreglar.");
  texto.push("", ...listaDeProblemas(lista, c));
  if (a.siguen.length > 0) {
    texto.push("", "Además sigue sin arreglar:");
    for (const p of ordenados(a.siguen, [])) texto.push(`- ${bloqueDe(p.clave, p.reserva, c, null)[0]}`);
  }
  if (a.arreglados.length > 0) texto.push("", `Se arregló: ${gruposArreglados(a.arreglados).map((g) => g.frase).join(" ")}`);
  texto.push("", ...cifras(c), "", horaDeBolivia(c.ahora), PIE);
  return { asunto: a.recordatorio ? `Sigue: ${base}` : base, texto: texto.join("\n") };
}

export interface DatosDeArreglo {
  arreglados: string[];
  /** Lo que sigue sin arreglar. */
  siguen: string[];
}

/** Un problema que se arregló: un aviso corto. */
export function mensajeDeArreglo(a: DatosDeArreglo, c: Contexto): Mensaje {
  const grupos = gruposArreglados(a.arreglados);
  const cortos = grupos.map((g) => g.corto);
  // En la pantalla bloqueada entra poco: hasta dos nombres, y si son más, el primero y cuántos más.
  const nombres = cortos.length > 2 ? `${cortos[0]} y ${cortos.length - 1} más` : cortos.length === 2 ? `${cortos[0]} y ${cortos[1]}` : (cortos[0] ?? "un problema");
  const texto: string[] = ["Arreglado.", ...grupos.map((g) => `- ${g.frase}`), ""];
  if (a.siguen.length === 0) texto.push("Ya no hay problemas.");
  else {
    texto.push("Sigue sin arreglar:");
    for (const p of ordenados(a.siguen, [])) texto.push(`- ${bloqueDe(p.clave, p.reserva, c, null)[0]}`);
  }
  texto.push("", ...cifras(c), "", horaDeBolivia(c.ahora), PIE);
  return { asunto: `Arreglado: ${nombres}`, texto: texto.join("\n") };
}

export interface DatosDeResumen {
  /** Si se pudo leer al portero al armar el resumen. */
  leyo: boolean;
  claves: string[];
  problemas: string[];
  /** Cada cuántas horas sale el resumen. */
  horas: number;
}

/** El resumen: todo bien o no, con las cifras. Es la señal de vida del vigilante. */
export function mensajeDeResumen(a: DatosDeResumen, c: Contexto): Mensaje {
  const lista = ordenados(a.claves, a.problemas);
  const texto: string[] = [];
  let asunto: string;
  if (!a.leyo) {
    asunto = "Resumen del portero: no contesta";
    texto.push("El portero no contestó cuando se armó este resumen.", "", ...bloqueDe("sin-lectura", undefined, c, null).slice(1));
  } else if (lista.length === 0) {
    asunto = "Resumen del portero: todo bien";
    texto.push("Todo bien. El portero no tiene ningún problema.", "", ...cifras(c));
  } else {
    asunto = lista.length === 1 ? "Resumen del portero: hay 1 problema" : `Resumen del portero: hay ${lista.length} problemas`;
    texto.push(lista.length === 1 ? "Hay 1 problema:" : `Hay ${lista.length} problemas:`, "", ...listaDeProblemas(lista, c), "", ...cifras(c));
  }
  const cuando = a.horas === 24 ? "todos los días a las 8 de la mañana (hora de Bolivia)" : `cada ${a.horas} horas`;
  const vida = a.horas === 24 ? "Si un día no llega, el vigilante se cayó." : "Si deja de llegar a su hora, el vigilante se cayó.";
  texto.push("", `Este resumen llega ${cuando}. Es la señal de vida del vigilante. ${vida}`, "", horaDeBolivia(c.ahora), PIE);
  return { asunto, texto: texto.join("\n") };
}

/** El aviso de prueba: sirve para comprobar que el correo llega, con las cifras de ahora. */
export function mensajeDePrueba(a: { leyo: boolean }, c: Contexto): Mensaje {
  const texto = [
    "Esto es una prueba: si lo estás leyendo, el aviso llega bien.",
    "",
    ...(a.leyo ? cifras(c) : ["El portero no contestó cuando se armó la prueba, así que no hay cifras de ahora."]),
    "",
    horaDeBolivia(c.ahora),
    PIE,
  ];
  return { asunto: "Prueba del vigilante: el aviso llega", texto: texto.join("\n") };
}
