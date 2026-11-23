#!/usr/bin/env node
/**
 * Ensayo de carga de una campaña (issue #179): altas contra el servicio de
 * pruebas sin tocar nada de la app. Lo que corre acá es el Worker de verdad
 * (`workers/sala/src/index.ts`), montado como lo monta el mundo de pruebas:
 *
 *   - Un cargador de módulos de Node le hace dos puentes al Worker:
 *     `cloudflare:workers` sale de `src/sala/cloudflare-falso.ts` y los
 *     módulos de TypeScript se bajan con el transformador que trae rolldown
 *     (vite lo usa de todas formas; el guion no agrega dependencias).
 *   - El estado de los objetos lleva un SQLite en memoria y el proveedor de
 *     cuentas (Pollar) es un `fetch` de mentira con sesiones inventadas. Es la
 *     misma forma que `src/sala/mundo-sala.ts`, pero montada a mano: el
 *     mundo entero no se puede importar fuera de Vitest (sus helpers sí).
 *   - Las campañas, las personas y los cuerpos de alta salen de los helpers
 *     exportados por `src/sala/mundo-sala.ts` (campanaAbierta, personaDePrueba,
 *     altaDe), reutilizados tal cual.
 *
 * El guion solo llama a la API del servicio: cada alta pasa por el manejador
 * `fetch` del Worker con la misma forma de pedido que manda el celular real
 * (POST /v1/sala/<id>/campana/alta, con Origin del sitio y CF-Connecting-IP).
 * No toca `src/campana`, `src/ui/campana-sala.ts` ni `workers/sala`.
 *
 * Uso:
 *
 *   node scripts/carga-altas.mjs
 *   node scripts/carga-altas.mjs --altas=150 --proveedor-cae-en=100 --en-corte=5
 *   node scripts/carga-altas.mjs --espera-ms=25 --ip=190.129.10.20
 *
 *   --altas=N              cuántas altas nuevas personas (150 por defecto).
 *   --proveedor-cae-en=N   cortar el proveedor después de N altas buenas
 *                          (100 por defecto, 0 lo apaga).
 *   --en-corte=K           altas que se intentan con el proveedor caído
 *                          (5 por defecto).
 *   --espera-ms=N          pausa entre altas (25 ms por defecto: como un
 *                          recinto que entra de a poco; 0 va al toque).
 *   --ip=X                 la única conexión desde donde salen las altas
 *                          (190.129.10.20 por defecto): el servicio cuenta
 *                          por grupo de conexión, y acá es uno solo.
 *
 * Las 150 altas salen de un mismo grupo de conexión y cada una usa una sesión
 * distinta del proveedor de mentira, como harían 150 celulares distintos en el
 * evento. El nombre va cifrado con la clave del QR (`cifrarNombre`, la misma
 * forma que cifraría la página del celular) y la sesión se verifica con el
 * proveedor simulado, igual que lo haría el celular.
 *
 * Al final imprime un resumen humano y, última cosa, un solo JSON con los
 * conteos por código. La explicación de cada código y de la corrida queda en
 * `docs/carga-altas.md`.
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/* ------------------------------------------------------------------ arranque */

const args = process.argv.slice(2);
/** El valor de una bandera, como `--altas=150` o `--altas 150`. `null` si la bandera no vino. */
const valorDe = (nombre) => {
  const conIgual = args.find((a) => a === `--${nombre}` || a.startsWith(`--${nombre}=`));
  if (conIgual === undefined) return null;
  const i = args.indexOf(conIgual);
  if (conIgual.includes("=")) return conIgual.slice(conIgual.indexOf("=") + 1);
  if (i + 1 === args.length) return "";
  return args[i + 1];
};
const opt = (nombre, defecto) => {
  const valor = valorDe(nombre);
  if (valor === null) return defecto;
  if (valor === "") {
    process.stderr.write(`falta el valor de --${nombre}\n`);
    process.exit(2);
  }
  return valor;
};
const ALTAS = Math.max(1, Number(opt("altas", "150")));
const CAE_EN = Math.max(0, Number(opt("proveedor-cae-en", "100")));
const EN_CORTE = Math.max(1, Number(opt("en-corte", "5")));
const ESPERA_MS = Math.max(0, Number(opt("espera-ms", "25")));
const IP = String(opt("ip", "190.129.10.20"));

/** La raíz del checkout, como ruta de archivo: de acá salen las rutas que puenten los hooks. */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/**
 * Los hooks del cargador de módulos. Se registran con `register` y corren en
 * su propio hilo de Node; por eso van como fuente y no como archivo.
 *   - `cloudflare:workers` → `src/sala/cloudflare-falso.ts` (el DurableObject
 *     mínimo; en un Worker desplegado nunca entra).
 *   - módulos `.ts` y imports relativos sin `.ts`: se resuelven y se
 *     transforman con el binding de rolldown (el que vite ya trae instalado).
 *   - imports de `.json` sin `with { type: "json" }` (así lo escribe el
 *     worker: solo `src/stellar/deployments.json`).
 */
const hooks = `
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const RAIZ = ${JSON.stringify(RAIZ)};
const RAIZURL = pathToFileURL(RAIZ).href;

async function bindingDe() {
  const req = createRequire(join(RAIZ, "scripts", "carga-altas.mjs"));
  let rol = null;
  try {
    rol = dirname(req.resolve("rolldown/package.json"));
  } catch {
    const deVite = dirname(req.resolve("vite/package.json"));
    rol = dirname(req.resolve("rolldown/package.json", { paths: [deVite] }));
  }
  const vecino = join(dirname(rol), "@rolldown");
  for (const e of await readdir(vecino)) {
    if (!e.startsWith("binding-")) continue;
    const dir = join(vecino, e);
    try {
      const data = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      return createRequire(join(dir, "package.json"))(join(dir, data.main ?? "binding.node"));
    } catch {
      /* probar la siguiente variante del binding */
    }
  }
  throw new Error("sin el binding de rolldown");
}

const binding = await bindingDe();

export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") {
    return { shortCircuit: true, url: pathToFileURL(RAIZ + "src/sala/cloudflare-falso.ts").href };
  }
  try {
    return await next(specifier, context);
  } catch {
    if (context.parentURL && context.parentURL.startsWith("file:")) {
      for (const sufijo of [".ts", "/index.ts"]) {
        try {
          return await next(specifier + sufijo, context);
        } catch {
          /* el siguiente intento */
        }
      }
    }
    throw new Error(\`no se pudo resolver \${specifier}\`);
  }
}

export async function load(url, context, next) {
  if (url.startsWith("file:") && url.startsWith(RAIZURL)) {
    if (url.endsWith(".ts")) {
      const codigo = await readFile(new URL(url), "utf8");
      const r = await binding.transform(url.split("/").pop(), codigo, { lang: "ts" });
      if (r.code) return { format: "module", source: r.code, shortCircuit: true };
    } else if (url.endsWith(".json")) {
      const texto = await readFile(new URL(url), "utf8");
      return {
        format: "module",
        source: "export default JSON.parse(" + JSON.stringify(texto) + ");",
        shortCircuit: true,
      };
    }
  }
  const base = await next(url, context);
  return { ...base, shortCircuit: true };
}
`;
register(`data:text/javascript;base64,${Buffer.from(hooks).toString("base64")}`, {
  parentURL: pathToFileURL(join(RAIZ, "scripts/")).href,
});

/* ------------------------------------------------------------------ el log */

const IMPRIMIR = process.stdout.write.bind(process.stdout);
/**
 * El Worker escribe sus bitácoras con `console.log` de JSON de una línea: van
 * al stderr con prefijo, para que el stdout del guion quede con el relato y el
 * JSON final, limpios. Nuestro propio texto pasa entero.
 */
const consoleReal = console.log;
console.log = (texto) => {
  if (typeof texto === "string" && texto.startsWith('{"evento"')) {
    process.stderr.write(`[worker] ${texto}\n`);
    return;
  }
  consoleReal(texto);
};
const registrar = (linea = "") => IMPRIMIR(`${linea}\n`);

/* ----------------------------------------------------------- el ensayo en sí */

const inicio = Date.now();
const archivo = await import("node:url");

/** El mundo de pruebas: helpers de alta y campañas, y el módulo del Worker. */
const mundo = await import(pathToFileURL(RAIZ + "src/sala/mundo-sala.ts").href);
const worker = await import(pathToFileURL(RAIZ + "workers/sala/src/index.ts").href);
const { cifrarNombre, generarClave } = await import(pathToFileURL(RAIZ + "src/sala/cifra.ts").href);

const { DatabaseSync } = await import("node:sqlite");
const { ed25519 } = await import("@noble/curves/ed25519.js");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const respuesta = (estado, cuerpo) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

/** El estado de un objeto de sala: un SQLite en memoria, igual que en `mundo-sala.ts`. */
function estadoFalso() {
  let db = new DatabaseSync(":memory:");
  let alarma = null;
  return {
    storage: {
      sql: {
        exec(consulta, ...parametros) {
          const filas = db.prepare(consulta).all(...parametros);
          return {
            toArray: () => filas,
            one: () => {
              if (filas.length !== 1) throw new Error("se esperaba una sola fila");
              return filas[0];
            },
          };
        },
      },
      async setAlarm(ms) {
        alarma = ms;
      },
      async deleteAlarm() {
        alarma = null;
      },
      async deleteAll() {
        db.close();
        db = new DatabaseSync(":memory:");
      },
    },
    setWebSocketAutoResponse() {},
    getWebSockets: () => [],
    alarma: () => alarma,
  };
}

/** El proveedor de cuentas de mentira: una sesión nueva por persona y un `caido` que marca el corte (S2). */
const proveedor = {
  sesiones: new Map(),
  billeteras: new Map(),
  llamadas: {},
  caido: false,
  usuarios: new Map(),
  busquedas: [],
};
globalThis.WebSocketRequestResponsePair = class {};
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  proveedor.llamadas[u.pathname] = (proveedor.llamadas[u.pathname] ?? 0) + 1;
  if (proveedor.caido) return respuesta(503, { code: "DOWN", success: false });
  if (u.pathname === "/v3/tokens/verify") {
    const token = String(JSON.parse(String(init?.body)).token);
    const sesion = proveedor.sesiones.get(token);
    if (!sesion) return respuesta(401, { code: "SDK_AUTH_INVALID_TOKEN", success: false });
    const contenido = {
      userId: sesion.usuario,
      applicationId: mundo.APP_DE_PRUEBA,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      network: "mainnet",
      wallet: null,
      profile: {},
      authProvider: "google",
      ...sesion.contenido,
    };
    return respuesta(200, { code: "SERVER_TOKEN_VERIFIED", success: true, content: contenido });
  }
  if (u.pathname === "/v3/users") {
    const q = u.searchParams.get("q") ?? "";
    const cuenta = proveedor.billeteras.get(q);
    const items = cuenta === undefined ? [] : [{ id: q, wallets: cuenta ? [{ network: "STELLAR", public_key: cuenta }] : [] }];
    return respuesta(200, { code: "SERVER_SDK_USERS_LIST", success: true, content: { items } });
  }
  return respuesta(404, { code: "NOT_FOUND", success: false });
};

/** El env de la sala local: llave de campañas de prueba y el pase apagado (PASE=0). */
const pendientes = [];
const ctx = { waitUntil: (p) => void pendientes.push(p) };
const llavePrivada = ed25519.utils.randomSecretKey();
const env = {
  VIDA_PRUEBA_MS: "600000",
  LLAVE_CAMPANAS_PRUEBA: hex(ed25519.getPublicKey(llavePrivada)),
  POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000",
  POLLAR_APP_ID: mundo.APP_DE_PRUEBA,
  PASE: "0",
};

const objetos = new Map();
const espacio = (clase) => ({
  idFromName: (nombre) => `${clase}:${nombre}`,
  get: (id) => {
    let hay = objetos.get(id);
    if (!hay) {
      hay = new (clase === "sala" ? worker.Sala : worker.Cupos)(estadoFalso(), env);
      objetos.set(id, hay);
    }
    return new Proxy(hay, {
      get(destino, propiedad) {
        const valor = Reflect.get(destino, propiedad, destino);
        return typeof valor === "function" ? valor.bind(destino) : valor;
      },
    });
  },
});
env.SALA = espacio("sala");
env.CUPOS = espacio("cupos");

/** El mundo que piden los helpers de `mundo-sala.ts`: cada pedido pasa por el fetch del Worker. */
const servicio = {
  env,
  proveedor,
  llavePrivada,
  async pedir(ruta, init = {}) {
    const cuerpo = init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo);
    const cabeceras = { Origin: mundo.ORIGEN_DEL_SITIO, ...init.cabeceras };
    if (cuerpo !== undefined) cabeceras["Content-Length"] = String(Buffer.byteLength(cuerpo));
    const pedido = new Request(`${init.base ?? mundo.BASE_LOCAL}${ruta}`, {
      method: init.metodo ?? (cuerpo === undefined ? "GET" : "POST"),
      headers: cabeceras,
      ...(cuerpo === undefined ? {} : { body: cuerpo }),
    });
    return worker.default.fetch(pedido, env, ctx);
  },
  async esperarSegundoPlano() {
    while (pendientes.length > 0) await Promise.allSettled(pendientes.splice(0));
  },
};

/* ------------------------------------------------- la lectura de lo que sale */

/**
 * Qué es cada respuesta del alta, con las familias que traduce el cliente del
 * celular (`src/sala/campana.ts`): cada código cuenta aparte en el resumen.
 */
function clasificar(estado, cuerpo) {
  if (estado === 201) return "201 alta";
  if (estado === 200) return "200 ya";
  const error = typeof cuerpo?.error === "string" ? cuerpo.error : "otro";
  return `${estado} ${error}`;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ el ensayo */

const claveSala = generarClave();
const sala = await mundo.campanaAbierta(servicio, Date.now());
registrar(`servicio: worker local con proveedor simulado, sala ${sala.id}, fase abierta`);
registrar(`altas: ${ALTAS} desde la conexión ${IP} (un solo grupo de conexión), ${ESPERA_MS === 0 ? "al toque" : `de a ${ESPERA_MS} ms`}`);
registrar(``);

/** Una persona nueva con su sesión del proveedor simulado y su nombre cifrado con la clave del QR. */
const altaDePersona = async (n) => {
  const persona = mundo.personaDePrueba(servicio, n);
  const d = await cifrarNombre(claveSala, `Persona ${n} de la carga`);
  return { persona, d, respuesta: await mundo.altaDe(servicio, sala.id, persona, { cuerpo: { d }, ip: IP }) };
};

const conteo = new Map();
const anotar = (codigo) => conteo.set(codigo, (conteo.get(codigo) ?? 0) + 1);
const leerEstado = async () => (await (await servicio.pedir(`/v1/sala/${sala.id}/campana/estado`)).json()).total;

let buenas = 0;
let siguiente = 1;
/** Una alta de persona nueva, contada: el código de vuelta y cuántas altas nuevas van. */
const intentar = async () => {
  const t = Date.now();
  const { respuesta } = await altaDePersona(siguiente);
  const n = siguiente;
  siguiente += 1;
  const codigo = clasificar(respuesta.status, await respuesta.json());
  anotar(codigo);
  if (codigo === "201 alta") buenas += 1;
  registrar(`alta #${n} → ${codigo} (${Date.now() - t} ms)`);
  await dormir(ESPERA_MS);
  return codigo;
};

// Fase 1 (S1): altas de una persona nueva cada vez, hasta el punto del corte.
const hastaCorte = CAE_EN > 0 ? Math.min(CAE_EN, ALTAS) : ALTAS;
while (buenas < hastaCorte) {
  const codigo = await intentar();
  if (codigo !== "201 alta") {
    // Un tope que dispare antes del corte sería señal de algo: no se fuerza más la corrida.
    registrar(`una alta salió ${codigo} antes del corte; no se fuerza más esta fase`);
    break;
  }
}

/**
 * Fase 2 (S2): el proveedor cortado a propósito en medio de las altas. Se
 * mide lo que ve el celular (502 `pollar`, que su cliente traduce en la
 * familia `pollar` de reintentos: 5 s, 10 s, 20 s, y si el proveedor no
 * vuelve, el final `proveedor`) y lo que ve el stand (el contador de la sala,
 * que se detiene mientras el proveedor está caído y sube con los toques
 * repetidos del celular cuando vuelve).
 */
let enCorte = 0;
let vueltas = 0;
if (CAE_EN > 0 && buenas >= hastaCorte && buenas < ALTAS) {
  proveedor.caido = true;
  const totalAntes = await leerEstado();
  registrar(``);
  registrar(`— el proveedor se corta después de ${buenas} altas buenas —`);
  registrar(`lo que ve el stand antes del corte: la sala muestra ${totalAntes} anotadas`);
  const caidas = [];
  const cortadas = [];
  while (enCorte < EN_CORTE && buenas < ALTAS) {
    const t = Date.now();
    const cortada = await altaDePersona(siguiente);
    const n = siguiente;
    siguiente += 1;
    enCorte += 1;
    const codigo = clasificar(cortada.respuesta.status, await cortada.respuesta.json());
    anotar(codigo);
    caidas.push(codigo);
    cortadas.push({ n, persona: cortada.persona, d: cortada.d });
    registrar(`en corte, alta #${n} → ${codigo} (${Date.now() - t} ms)`);
    await dormir(ESPERA_MS);
  }
  const totalDurante = await leerEstado();
  registrar(`lo que ve el stand con el proveedor caído: la sala muestra ${totalDurante} (no se movió de ${totalAntes})`);
  proveedor.caido = false;
  registrar(``);
  registrar(`— el proveedor vuelve —`);
  // El toque repetido del celular repite el MISMO alta (misma sesión y mismo nombre cifrado):
  // el reintento es el mismo pedido, no una persona nueva.
  for (const cortada of cortadas) {
    const t = Date.now();
    const respuesta = await mundo.altaDe(servicio, sala.id, cortada.persona, { cuerpo: { d: cortada.d }, ip: IP });
    const codigo = clasificar(respuesta.status, await respuesta.json());
    if (codigo === "201 alta") {
      vueltas += 1;
      buenas += 1;
    }
    anotar(codigo);
    registrar(`vuelta del celular, alta #${cortada.n} → ${codigo} (${Date.now() - t} ms)`);
    await dormir(ESPERA_MS);
  }
  const totalDespues = await leerEstado();
  registrar(`lo que ve el stand cuando el proveedor vuelve: la sala muestra ${totalDespues}`);
  registrar(``);
}

// Fase 3 (S1): el resto de las altas de la carga, con el proveedor de vuelta.
while (buenas < ALTAS) {
  const codigo = await intentar();
  if (codigo !== "201 alta") registrar(`esa alta no cuenta como alta nueva`);
}

/**
 * Fase 4: sondas chicas, para que los otros códigos de la misma sala aparezcan
 * en los conteos de la corrida: el reingreso (`200 ya`) y la sala cerrada
 * (`409 cerrada`). Con PASE=0 el `409 pase` no puede aparecer; el `429 llena`
 * necesitaría 300 personas en la sala (`CAMPANA_MAX`) y el `429 rapido`
 * 300 altas por minuto, que una corrida de a una no alcanza.
 */
const sondas = { ya: 0, cerrada: 0 };
if (buenas >= 2) {
  for (const n of [1, 2]) {
    const persona = mundo.personaDePrueba(servicio, n);
    const d = await cifrarNombre(claveSala, `Persona ${n} de la carga`);
    const r = await mundo.altaDe(servicio, sala.id, persona, { cuerpo: { d }, ip: IP });
    const codigo = clasificar(r.status, await r.json());
    anotar(codigo);
    if (codigo === "200 ya") sondas.ya += 1;
    registrar(`sonda de reingreso: persona ${n} otra vez → ${codigo} (el celular dice «Listo, ya estabas»)`);
  }
}
if (buenas >= 1) {
  await servicio.pedir(`/v1/sala/${sala.id}/campana/fase`, {
    metodo: "PUT",
    cuerpo: { fase: "cerrada" },
    cabeceras: { Authorization: `Bearer ${sala.token}` },
  });
  const { respuesta } = await altaDePersona(siguiente);
  const n = siguiente;
  siguiente += 1;
  const codigo = clasificar(respuesta.status, await respuesta.json());
  anotar(codigo);
  if (codigo === "409 cerrada") sondas.cerrada += 1;
  registrar(`sonda de sala cerrada: la persona ${n} → ${codigo} (el celular dice «cerró»)`);
  await servicio.pedir(`/v1/sala/${sala.id}/campana/fase`, {
    metodo: "PUT",
    cuerpo: { fase: "abierta" },
    cabeceras: { Authorization: `Bearer ${sala.token}` },
  });
}

await servicio.esperarSegundoPlano();
const totalFinal = await leerEstado();
const duracionMs = Date.now() - inicio;

/* ------------------------------------------------------------ el resumen */

const porCodigo = Object.fromEntries([...conteo.entries()].sort());
const resumen = {
  servicio: "worker local (mundo de pruebas de src/sala/mundo-sala.ts) con proveedor de cuentas simulado",
  sala: sala.id,
  grupoDeConexion: IP,
  altasPedidas: ALTAS,
  proveedorCaeEn: CAE_EN,
  altas: {
    buenas,
    totalDeRespuestas: [...conteo.values()].reduce((a, b) => a + b, 0),
    porCodigo,
  },
  corteDeProveedor: {
    caeEn: CAE_EN,
    intentosConCorte: enCorte,
    respuestaVista: enCorte > 0 ? '502 {"error":"pollar"}' : null,
    vueltasBuenasDespuesDelCorte: vueltas,
  },
  sondas,
  totalFinalDeLaSala: totalFinal,
  duracionMs,
};
registrar(``);
registrar(`— resumen —`);
registrar(`altas buenas: ${buenas} de ${ALTAS}`);
registrar(``);
registrar(`respuestas por código:`);
for (const [codigo, n] of conteo) registrar(`  ${codigo}: ${n}`);
registrar(``);
registrar(`total que ve el stand al final: ${totalFinal}`);
registrar(`duracion: ${(duracionMs / 1000).toFixed(1)} s`);
registrar(`ultima linea: el JSON con los conteos`);
registrar(``);
consoleReal(JSON.stringify(resumen, null, 2) + "\n");

// La corrida queda coherente si: todo lo que el usuario iba a anotar está en
// sala, el corte se recupera entero y las dos sondas de reingreso contestaron
// «ya». Cualquier otra salida sale con código 1 y el detalle en el relato.
const estable =
  totalFinal === buenas && (CAE_EN === 0 ? true : vueltas === enCorte) && sondas.ya === (buenas >= 2 ? 2 : 0);
process.exitCode = estable ? 0 : 1;
