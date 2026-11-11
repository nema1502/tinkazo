/**
 * Las piezas del ensayo de la entrada de la red principal (scripts/ensayo-entrada-oficial.mjs).
 *
 * El día del despliegue, el commit agrega a src/stellar/deployments.json la entrada `mainnet`. Este
 * ensayo pone antes una entrada inventada con la misma forma, corre tipos, pruebas y build, y separa
 * los rojos que ese commit arregla copiando textos al HTML de los que no se esperan. Este archivo no
 * tiene efectos al importarse: solo datos y funciones puras (y la ruta del respaldo, fuera del repo).
 */
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/**
 * Inventada: son 32 bytes en cero (StrKey.encodeContract(Buffer.alloc(32, 0))). Tiene forma válida
 * de contrato, pero no es ningún contrato desplegado. Nunca se commitea: una prueba de guardia la busca
 * en la lista real y da rojo si aparece.
 */
export const CONTRATO_DE_ENSAYO = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

/** La huella inventada de la entrada de ensayo: 64 ceros. Ningún .wasm real tiene esta huella. */
export const HUELLA_DE_ENSAYO = "0".repeat(64);

/** La fecha de hoy en UTC, como la escribe el commit del día (AAAA-MM-DD). */
export const hoyUtc = (ahora = new Date()) => ahora.toISOString().slice(0, 10);

/**
 * La entrada de ensayo, con las siete claves del commit del día y en el mismo orden. El sha256 es
 * inventado (64 ceros) y la fecha se calcula al correr, nunca se escribe a mano.
 */
export function entradaDeEnsayo(fecha = hoyUtc()) {
  return {
    contractId: CONTRATO_DE_ENSAYO,
    deployedAt: fecha,
    wasmSha256: HUELLA_DE_ENSAYO,
    maxWinners: 300,
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    anteriores: [],
  };
}

/**
 * Si el texto de la lista trae algo de la entrada de ensayo: la dirección o la huella inventadas. Lo
 * que deja una corrida cortada, también si alguien cambió a mano solo la dirección.
 */
export const tieneEntradaDeEnsayo = (texto) => texto.includes(CONTRATO_DE_ENSAYO) || texto.includes(`"${HUELLA_DE_ENSAYO}"`);

/**
 * La fila de un contrato en la tabla de docs/deployments.md, como la escribe deploy.sh: la red, la
 * dirección entre comillas invertidas y la huella entera entre comillas invertidas. Si la celda trae
 * los 64 caracteres, tienen que ser exactamente los de la huella. Las filas viejas (las de testnet)
 * traen solo los primeros 16 y los puntos suspensivos: esas valen por el comienzo, salvo con
 * `huellaEntera`, que es lo que se le exige a la red principal. Si no está, null.
 */
export function filaDelRegistro(docs, red, contractId, wasmSha256, { huellaEntera = false } = {}) {
  const huella = String(wasmSha256 ?? "");
  const comienzo = `\`${huella.slice(0, 16)}…\``;
  return (
    String(docs)
      .split(/\r?\n/)
      .find((renglon) => {
        const c = renglon.split("|").map((s) => s.trim());
        if (c[2] !== red || c[3] !== `\`${contractId}\``) return false;
        const celda = c[4] ?? "";
        const entera = /^`([0-9a-f]{64})`/.exec(celda);
        if (entera) return entera[1] === huella;
        return !huellaEntera && celda.startsWith(comienzo);
      }) ?? null
  );
}

/** La fila que deploy.sh escribe para un contrato, con lo que la guardia compara (el resto queda como «…»). */
export const filaEsperada = (red, contractId, wasmSha256) => `| … | ${red} | \`${contractId}\` | \`${wasmSha256}\` | … |`;

/**
 * Lo que está mal en la entrada vigente de una red de src/stellar/deployments.json, comparada con lo
 * que el sitio da por bueno: dirección con forma de contrato y que no sea la del ensayo, huella de 64
 * caracteres hexadecimales que no sea la del ensayo, la frase de esa red (o ninguna: vale la de
 * siempre), un RPC de su lista (o ninguno), la fecha, y la fila de docs/deployments.md con esa
 * dirección y esa huella, que es la que deploy.sh comparó con la del release y con la del contrato en
 * la red. En la red principal la fila tiene que traer la huella entera: el sitio la compara entera y
 * un error en la cola rechazaría cada sorteo. Una lista vacía es que está bien.
 */
export function problemasDeLaEntrada(entrada, { red, passphrase, rpcs, docs, huellaEntera = red === "mainnet" }) {
  if (!entrada || typeof entrada !== "object") return [`${red}: no hay entrada`];
  const { contractId, wasmSha256, networkPassphrase, rpcUrl, deployedAt } = entrada;
  const problemas = [];
  if (!/^C[A-Z2-7]{55}$/.test(contractId ?? "")) problemas.push(`contractId no tiene forma de contrato: ${contractId}`);
  else if (contractId === CONTRATO_DE_ENSAYO) problemas.push("contractId es la dirección inventada del ensayo");
  if (!/^[0-9a-f]{64}$/.test(wasmSha256 ?? "")) problemas.push(`wasmSha256 no son 64 caracteres hexadecimales en minúscula: ${wasmSha256}`);
  else if (wasmSha256 === HUELLA_DE_ENSAYO) problemas.push("wasmSha256 es la huella inventada del ensayo (64 ceros)");
  if (networkPassphrase !== undefined && networkPassphrase !== passphrase) problemas.push(`networkPassphrase no es la de ${red}: ${networkPassphrase}`);
  if (rpcUrl !== undefined && !rpcs.includes(rpcUrl)) problemas.push(`rpcUrl no está en la lista de ${red} (${rpcs.join(", ")}): ${rpcUrl}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deployedAt ?? "") || Number.isNaN(Date.parse(deployedAt))) problemas.push(`deployedAt no es una fecha AAAA-MM-DD: ${deployedAt}`);
  if (docs !== undefined && !filaDelRegistro(docs, red, contractId, wasmSha256, { huellaEntera })) {
    problemas.push(
      `docs/deployments.md no tiene la fila de ${red} con esta dirección y ${huellaEntera ? "esta huella entera" : "esta huella"}. ` +
        `Se espera ${filaEsperada(red, contractId, wasmSha256)} (la escribe deploy.sh; si se cortó antes de registrar, se retoma con --id)`,
    );
  }
  return problemas;
}

/**
 * El texto de la lista con `mainnet` reemplazado por la entrada de ensayo. Conserva el fin de línea
 * del archivo (CRLF en una copia de Windows). Lanza si `mainnet` no es null: el ensayo nunca corre
 * sobre una lista con un contrato real.
 */
export function ponerEntradaDeEnsayo(texto, fecha = hoyUtc()) {
  const lista = JSON.parse(texto);
  if (!("mainnet" in lista)) throw new Error("la lista no tiene la clave mainnet");
  if (lista.mainnet !== null) throw new Error("la lista ya tiene una entrada en mainnet: el ensayo no se corre sobre un contrato real");
  lista.mainnet = entradaDeEnsayo(fecha);
  const salto = texto.includes("\r\n") ? "\r\n" : "\n";
  return JSON.stringify(lista, null, 2).replace(/\n/g, salto) + salto;
}

/**
 * Los rojos que el commit del día arregla copiando al HTML los textos de src/i18n-modo-oficial.ts.
 * `titulo` ausente: vale cualquier prueba de ese `describe` (es un it.each por página).
 */
export const PRUEBAS_ESPERADAS = [
  {
    archivo: "src/revision-textos.test.ts",
    describe: "revisión de redacción de los textos visibles",
    titulo: "el texto inicial de precios.html es el del diccionario",
    motivo: "precios.html trae en el HTML el texto de hoy; el día se copia el del diccionario con el modo Oficial",
  },
  {
    archivo: "src/revision-textos.test.ts",
    describe: "revisión de redacción de los textos visibles",
    titulo: "las páginas traen en el HTML el texto del diccionario de las claves que cambian con el modo Oficial",
    motivo: "las claves de src/i18n-modo-oficial.ts se copian el día al HTML de cada página (el mensaje dice cuáles)",
  },
  {
    archivo: "src/seo.test.ts",
    describe: "el texto de cada elemento de cada página es el de T.es, y cada clave tiene su versión en inglés",
    motivo: "el HTML de la página todavía trae el texto sin modo Oficial; se copia el día",
  },
  {
    archivo: "src/seo.test.ts",
    describe: "el texto escrito en las páginas nuevas y en las tarjetas es el del diccionario",
    motivo: "el HTML de la página todavía trae el texto sin modo Oficial; se copia el día (el mensaje dice la clave)",
  },
];

const aPosix = (ruta) => ruta.split(sep).join("/").replace(/\\/g, "/");

/** La ruta de un archivo del informe, relativa a la raíz y con barras. */
export function rutaRelativa(raiz, archivo) {
  const rel = relative(resolve(raiz), resolve(archivo));
  return aPosix(rel.startsWith("..") ? archivo : rel);
}

const primerRenglon = (texto) => String(texto ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
const esPorTiempo = (mensajes) => mensajes.some((m) => /timed out/i.test(String(m)));

/**
 * Separa las fallas de un informe JSON de Vitest. Cada una lleva archivo (relativo a la raíz), nombre
 * completo y el primer renglón del mensaje; las esperadas llevan además sus títulos y el mensaje sin la
 * pila (el guion lo cambia por su bloque de la salida, que dice qué página y qué clave copiar). Una falla por tiempo va a inesperadas con
 * `tiempo: true` (puede ser carga de la máquina, pero no se da por esperada), y un archivo que no
 * cargó va a inesperadas con `suite: true`.
 */
export function clasificarFallas(informe, raiz = process.cwd()) {
  const esperadas = [];
  const inesperadas = [];
  for (const archivo of informe?.testResults ?? []) {
    const rel = rutaRelativa(raiz, archivo.name ?? "");
    const pruebas = archivo.assertionResults ?? [];
    const fallas = pruebas.filter((p) => p.status === "failed");
    if (archivo.status === "failed" && fallas.length === 0) {
      inesperadas.push({ archivo: rel, nombre: "(el archivo no cargó o falló fuera de una prueba)", mensaje: primerRenglon(archivo.message), suite: true });
      continue;
    }
    for (const p of fallas) {
      const mensajes = p.failureMessages ?? [];
      const falla = { archivo: rel, nombre: p.fullName ?? p.title ?? "", mensaje: primerRenglon(mensajes[0]) };
      if (esPorTiempo(mensajes)) {
        inesperadas.push({ ...falla, tiempo: true });
        continue;
      }
      const ancestros = p.ancestorTitles ?? [];
      const esperada = PRUEBAS_ESPERADAS.find(
        (e) => e.archivo === rel && ancestros[0] === e.describe && (e.titulo === undefined || p.title === e.titulo),
      );
      if (!esperada) {
        inesperadas.push(falla);
        continue;
      }
      const sinPila = mensajes.join("\n").split(/\r?\n/).filter((l) => !/^\s+at\s/.test(l)).join("\n");
      esperadas.push({ ...falla, titulos: [...ancestros, p.title], motivo: esperada.motivo, mensajeEntero: sinPila });
    }
  }
  return { esperadas, inesperadas };
}

const sinColores = (texto) => String(texto ?? "").replace(/\x1b\[[0-9;]*m/g, "");
/** Lo que Vitest escribe cuando hubo un error fuera de una prueba: no queda como prueba roja en el informe JSON. */
const ERROR_SUELTO = /Vitest caught \d+ unhandled errors?|^\s*⎯+\s*Unhandled (?:Errors?|Rejections?)\b/im;

/**
 * La decisión del paso de pruebas, que no puede salir solo de las rojas del informe JSON: un error
 * sin atrapar no queda como prueba roja, y sin archivos Vitest igual escribe un informe vacío. Suma
 * una inesperada si hubo un error suelto (aunque haya esperadas: ahí el código 1 es el de siempre y
 * lo escondería), si no corrió ninguna prueba, si un archivo pedido con --pruebas no corrió, o si
 * Vitest salió con error sin ninguna roja que lo explique.
 */
export function decidirVitest({ codigo, informe, texto, clasificadas, pedidas = [], raiz = process.cwd() }) {
  const inesperadas = [...clasificadas.inesperadas];
  const limpio = sinColores(texto);
  const renglon = (patron) => (limpio.split(/\r?\n/).find((l) => patron.test(l)) ?? "").trim();
  const sintetica = (nombre, mensaje) => inesperadas.push({ archivo: "(vitest)", nombre, mensaje, suite: true });
  if (ERROR_SUELTO.test(limpio)) {
    sintetica("hubo un error fuera de una prueba (sin atrapar)", renglon(/unhandled/i) || "mirá la salida de Vitest");
  }
  if (informe && Number(informe.numTotalTests ?? 0) === 0) {
    sintetica("no corrió ninguna prueba", renglon(/No test files found/i) || "el informe no trae pruebas");
  }
  const corridos = (informe?.testResults ?? []).map((a) => rutaRelativa(raiz, a.name ?? ""));
  for (const pedida of pedidas) {
    const filtro = aPosix(pedida).replace(/^\.\//, "");
    if (!corridos.some((c) => c.includes(filtro))) sintetica(`no corrió ${pedida}`, "la ruta pedida con --pruebas no coincide con ningún archivo de prueba");
  }
  if (codigo !== 0 && clasificadas.esperadas.length === 0 && inesperadas.length === 0) {
    sintetica(`Vitest salió con ${codigo} sin ninguna prueba roja`, renglon(/error/i) || "mirá la salida de Vitest");
  }
  return { ...clasificadas, inesperadas };
}

/**
 * El bloque que el reportero normal de Vitest escribe para una falla: desde su renglón «FAIL  archivo > …»
 * hasta la raya siguiente. Trae lo que el informe JSON no guarda, la diferencia entre lo esperado y lo
 * recibido, que es donde está qué página y qué clave copiar. Si no lo encuentra, null.
 */
export function bloqueDelReporte(salida, archivo, titulos, maxRenglones = 40) {
  const renglones = String(salida).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  const cabecera = `FAIL  ${archivo} > ${titulos.join(" > ")}`;
  const desde = renglones.findIndex((l) => l.trim() === cabecera);
  if (desde < 0) return null;
  // Vitest junta bajo un solo error las fallas que fallan igual: sus renglones FAIL van seguidos.
  let inicio = desde + 1;
  while (inicio < renglones.length && renglones[inicio].trim().startsWith("FAIL  ")) inicio++;
  const hasta = renglones.findIndex((l, i) => i >= inicio && /^\s*⎯/.test(l));
  const bloque = renglones.slice(inicio, hasta < 0 ? undefined : hasta).join("\n").trim().split("\n");
  // Un toContain sobre una página entera la imprime completa: se corta, el resto queda en la salida.
  if (bloque.length <= maxRenglones) return bloque.join("\n");
  return [...bloque.slice(0, maxRenglones), `(… ${bloque.length - maxRenglones} renglones más en la salida de Vitest)`].join("\n");
}

/**
 * Los errores de la salida de `tsc`, en sus dos formas: `ruta(l,c): error TS1234: …` y la
 * de colores, `ruta:l:c - error TS1234: …`.
 */
export function erroresDeTsc(salida) {
  const limpio = String(salida).replace(/\x1b\[[0-9;]*m/g, "");
  const errores = [];
  for (const renglon of limpio.split(/\r?\n/)) {
    const m = renglon.match(/^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s*(.*)$/) ?? renglon.match(/^(.+?):(\d+):\d+\s+-\s+error\s+(TS\d+):\s*(.*)$/);
    if (m) errores.push({ archivo: aPosix(m[1].trim()), linea: Number(m[2]), codigo: m[3], mensaje: m[4].trim() });
  }
  return errores;
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** La carpeta base de los respaldos y del build del ensayo: en la carpeta temporal, nunca en el repo. */
export const carpetaBase = (base = process.env.TINKAZO_ENSAYO_CARPETA) => base || join(tmpdir(), "tinkazo-ensayo-oficial");

/**
 * La ruta absoluta con la que se reconoce un archivo. En Windows la misma lista llega como `c:\…` o
 * `C:\…` según desde dónde se lanzó node, y las dos son el mismo archivo: ahí se compara en minúscula.
 */
export const claveDeRuta = (ruta, plataforma = process.platform) => {
  const absoluta = resolve(ruta);
  return plataforma === "win32" ? absoluta.toLowerCase() : absoluta;
};

/** La carpeta de trabajo de un archivo: una por ruta absoluta, para que dos copias no se pisen. */
const carpetaDe = (archivo, base) => join(carpetaBase(base), sha256(claveDeRuta(archivo)).slice(0, 12));

/**
 * Dónde se guarda el respaldo de la lista mientras corre el ensayo: `deployments.json.respaldo` (los
 * bytes de antes) y `estado.json` (`{ archivo, sha256Original, pid, desde }`).
 */
export function rutaDelRespaldo(archivo, base) {
  const carpeta = join(carpetaDe(archivo, base), "respaldo");
  return { carpeta, respaldo: join(carpeta, "deployments.json.respaldo"), estado: join(carpeta, "estado.json") };
}

/** La carpeta del build del ensayo por defecto: fuera de dist/, para no dejar ahí un sitio con Oficial. */
export const rutaDelDist = (archivo, base) => join(carpetaDe(archivo, base), "dist");
