#!/usr/bin/env node
/**
 * Las capturas del proyector del stand de campaña (residual T3 del issue #179,
 * `odd/tasks/capturas-179b.md`): 1366x768 y 1920x1080, oscuro y claro, con una
 * campaña de verdad — y los estados del celular en su tamaño de celular, en los
 * dos temas. El resultado queda en `docs/capturas-campana/`, con la nota de qué
 * es cada imagen en `docs/capturas-campana/readme.md`.
 *
 *   CHROME=/tmp/chrome-wrapper.sh node scripts/captura-campana.mjs
 *   CHROME=/tmp/chrome-wrapper.sh node scripts/captura-campana.mjs --salida=docs/capturas-campana
 *
 * Cómo está armado el montaje (lo más liviano que muestra contenido real, sin
 * tocar `src/` ni `workers/` desde acá):
 *
 *   - El Worker de salas de verdad (`workers/sala/src/index.ts`) corre dentro de
 *     este guion de Node, montado como lo monta `scripts/carga-altas.mjs`
 *     (rama guido/carga-179): un cargador de módulos con dos puentes
 *     (`cloudflare:workers` sale de `src/sala/cloudflare-falso.ts` y los `.ts`
 *     se transforman con el binding de rolldown que trae vite), un SQLite en
 *     memoria por objeto y el proveedor de cuentas (Pollar) como un `fetch` de
 *     mentira. La campaña sale de `POST /v1/campana` firmado con la llave de
 *     prueba, con la forma completa de `src/campana/ejemplo.ts` (la que usa el
 *     mundo del stand de campaña, `src/ui/stand-campana-mundo.test.ts`), su logo
 *     real y `organizadora`; arranca con la fase abierta. Nada de las reglas se
 *     reimplementa: todo lo que la sala contesta salió del Worker.
 *   - Sin red: en vez de `wrangler dev`, un servidor HTTP pequeño sirve la app
 *     de desarrollo de vite (in-process, `middlewareMode`, con el `vite.config.ts`
 *     del checkout) y un middleware suyo despacha `/v1/*` al `fetch` del Worker.
 *     Todo queda en el mismo origen, así que el navegador no necesita CORS y el
 *     servidor no escribe nada del repo.
 *   - El proyector: la página de montaje (`/__montaje-campana`, servida por este
 *     guion) baja los módulos de verdad con vite (`/src/ui/stand-campana.ts`,
 *     `/src/ui/stand-campana-pantalla.ts` y `/src/ui/qr.ts`) y arma el stand con
 *     las mismas dependencias inyectadas del mundo de pruebas, salvo dos que en
 *     un navegador sin billetera no pueden ser las de verdad: la cuenta
 *     conectada (la organizadora de la campaña de prueba) y su saldo en la red
 *     (el que la comprobación espera). El modelo corre entero: comprobación,
 *     clave del QR guardada en `localStorage`, pase de la sala, lectura de la
 *     lista cada 5 s, descifrado con la clave del QR y «Para revisar». La lista
 *     se llena con altas reales que este guion le manda al Worker como las manda
 *     un celular (sesión del proveedor simulado y `cifrarEquipo` con la clave
 *     que la pantalla generó, `src/equipos/datos.ts`).
 *   - El celular: los estados documentados de la página (`participar.html?
 *     demo=campana&estado=...`, las dependencias locales de
 *     `src/campana/demostracion.ts`: la campaña de ejemplo, sin red, sin Google
 *     y sin recuerdos). A 360x844 con `deviceScaleFactor: 2`, como el celular de
 *     `scripts/probar-sala.mjs`, en los dos temas.
 *   - El estilo del proyector (`src/ui/stand-campana.css`) tiene el fondo claro
 *     fijo por diseño: sus cuatro capturas son de los dos tamaños y las dos
 *     etiquetas de tema, y la pantalla es la misma; la nota del readme lo dice.
 *
 * Verificación del guion: cada captura sale solo si la página anduvo sin
 * excepciones ni errores de consola — los junta `scripts/lib/browser.mjs` por
 * pestaña — y si el proyector tiene a la vista todo lo que tiene que mostrar
 * (logo, premio, hora de cierre, cuántas van, QR dibujado, lista y «Para
 * revisar»). Si algo falta, el guion falla y no escribe la imagen.
 */

/* ------------------------------------------------------------------ arranque */

import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import http from "node:http";
import { readFileSync, mkdirSync, statSync } from "node:fs";

const args = process.argv.slice(2);
/** El valor de una bandera, como `--salida=docs/capturas-campana`. `null` si la bandera no vino. */
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
const SALIDA = opt("salida", "docs/capturas-campana");

/** La raíz del checkout, como ruta de archivo: de acá salen las rutas que puenten los hooks. */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const IMPRIMIR = process.stdout.write.bind(process.stdout);
const registrar = (linea = "") => IMPRIMIR(`${linea}\n`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Los hooks del cargador de módulos de `scripts/carga-altas.mjs`, tal cual: los
 * dos puentes del Worker (`cloudflare:workers` → `src/sala/cloudflare-falso.ts`;
 * los `.ts` y los imports relativos sin `.ts` con el binding de rolldown) y los
 * `.json` sin `with { type: "json" }` (solo `src/stellar/deployments.json`).
 */
const hooks = `
import { pathToFileURL } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const RAIZ = ${JSON.stringify(RAIZ)};
const RAIZURL = pathToFileURL(RAIZ).href;

async function bindingDe() {
  const req = createRequire(join(RAIZ, "scripts", "captura-campana.mjs"));
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
      // En Node no hay import.meta.env: lo que inyecta vite acá va por el global (vite.config.ts deja VITE_STELLAR_NETWORK vacío).
      const conEnv = codigo.split("import.meta.env").join("(globalThis.importMetaEnv ?? {})");
      const r = await binding.transform(url.split("/").pop(), conEnv, { lang: "ts" });
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

// El env que inyecta vite en el navegador, vacío en Node salvo lo que el config del checkout fija (ver vite.config.ts).
globalThis.importMetaEnv = { VITE_STELLAR_NETWORK: "", VITE_CAMPANAS: "1" };

/* --------------------------------------------------------- el Worker en Node */

const { DatabaseSync } = await import("node:sqlite");
const { ed25519 } = await import("@noble/curves/ed25519.js");
const { Keypair } = await import("@stellar/stellar-sdk/base");
const { cifrarEquipo } = await import(pathToFileURL(RAIZ + "src/equipos/datos.ts").href);
const worker = await import(pathToFileURL(RAIZ + "workers/sala/src/index.ts").href);

const APP_DE_PRUEBA = "app_mainnet_inventada";
const ORIGEN_DEL_SITIO = "https://tinkazo.app";
const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** El fetch de verdad, guardado antes de poner el proveedor de mentira en el global. */
const fetchDeVerdad = globalThis.fetch;

/** El estado de un objeto de sala: un SQLite en memoria, igual que en `mundo-sala.ts`. */
function estadoFalso() {
  let db = new DatabaseSync(":memory:");
  let alarma = null;
  return {
    storage: {
      sql: {
        exec(consulta, ...parametros) {
          // El Worker consulta la tabla antes de que exista la primera vez (lo ve `dato()` con su try); lo deja pasar.
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

/**
 * El proveedor de cuentas de mentira de `mundo-sala.ts`: solo contesta lo de
 * `/v3/` (sus sesiones); cualquier otro fetch — por ejemplo el de DevTools al
 * Chrome — va al `fetch` de verdad.
 */
const proveedor = {
  sesiones: new Map(),
  llamadas: {},
};
// El mínimo de la API de Cloudflare que pide el constructor del objeto, como lo piden las pruebas (`mundo-sala.ts`).
// El `ping`/`pong` es lo que el Worker le pasa acá: `ctx.setWebSocketAutoResponse(new Pair(...))`.
globalThis.WebSocketRequestResponsePair = class {
  constructor() {}
};
const respuesta = (estado, cuerpo) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (!u.pathname.startsWith("/v3/")) return fetchDeVerdad(url, init);
  proveedor.llamadas[u.pathname] = (proveedor.llamadas[u.pathname] ?? 0) + 1;
  if (u.pathname === "/v3/tokens/verify") {
    const token = String(JSON.parse(String(init?.body)).token);
    const sesion = proveedor.sesiones.get(token);
    if (!sesion) return respuesta(401, { code: "SDK_AUTH_INVALID_TOKEN", success: false });
    return respuesta(200, {
      code: "SERVER_TOKEN_VERIFIED",
      success: true,
      content: {
        userId: sesion.usuario,
        applicationId: APP_DE_PRUEBA,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        network: "mainnet",
        wallet: sesion.cuenta,
        profile: {},
        authProvider: "google",
      },
    });
  }
  return respuesta(404, { code: "NOT_FOUND", success: false });
};

/** Una persona de la sala: sesión en el proveedor simulado, cuenta de Stellar y llave de su celular. */
function personaDePrueba(n) {
  const usuario = `captura${n}`;
  const token = `tok_${usuario}_${"x".repeat(24)}`;
  const cuenta = Keypair.random().publicKey();
  proveedor.sesiones.set(token, { usuario, cuenta });
  return { usuario, token, cuenta, llave: `llave${n}`.padEnd(22, "x") };
}

/** El env de la sala local: llave de campañas de prueba y el pase sin plazos de espera (PASE=0), como en carga-altas. */
const pendientes = [];
const ctx = { waitUntil: (p) => void pendientes.push(p) };
const llavePrivada = ed25519.utils.randomSecretKey();
const operadora = Keypair.random().publicKey();
const env = {
  VIDA_PRUEBA_MS: "600000",
  LLAVE_CAMPANAS_PRUEBA: hex(ed25519.getPublicKey(llavePrivada)),
  POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000",
  POLLAR_APP_ID: APP_DE_PRUEBA,
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

/** Un pedido con la forma que usa el organismo: el Worker contesta con su `fetch` y el segundo plano queda esperado. */
async function pedir(ruta, init = {}) {
  const cuerpo = init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo);
  const cabeceras = { Origin: ORIGEN_DEL_SITIO, ...init.cabeceras };
  if (cuerpo !== undefined) cabeceras["Content-Length"] = String(Buffer.byteLength(cuerpo));
  const pedido = new Request(`http://127.0.0.1:8792${ruta}`, {
    method: init.metodo ?? (cuerpo === undefined ? "GET" : "POST"),
    headers: cabeceras,
    ...(cuerpo === undefined ? {} : { body: cuerpo }),
  });
  const r = await worker.default.fetch(pedido, env, ctx);
  const devuelto = r.clone();
  await r.text();
  while (pendientes.length > 0) await Promise.allSettled(pendientes.splice(0));
  return devuelto;
}

/* ------------------------------------------------- la campaña de la sala de prueba */

/** El archivo firmado de la campaña: la forma de `campanaDeEjemplo` (la que usa el mundo del stand), con el logo del sitio y la organizadora. */
const AHORA = Date.now();
const logoBase64 = readFileSync(join(RAIZ, "public/icon-96.png")).toString("base64");
const archivo = {
  v: 1,
  evento: "feria-del-libro",
  red: "testnet",
  estado: "abierta",
  lugar: { es: "Hackathon", en: "Hackathon" },
  empresa: { nombre: "Alcancía Andina", logo: { tipo: "image/png", datos: logoBase64 }, color: "verde" },
  zona: "America/La_Paz",
  premios: ["400000000", "200000000"],
  abre_ms: AHORA - 60 * 60 * 1000,
  cierra_ms: AHORA + 3 * 60 * 60 * 1000,
  sorteo_ms: AHORA + 4 * 60 * 60 * 1000,
  recibir_hasta_ms: AHORA + 180 * 24 * 60 * 60 * 1000,
  entrada: "google",
  pasos: [
    { tipo: "instagram", url: "https://www.instagram.com/", texto: { es: "", en: "" } },
    { tipo: "tiktok", url: "https://www.tiktok.com/", texto: { es: "", en: "" } },
    { tipo: "x", url: "https://x.com/", texto: { es: "", en: "" } },
  ],
  bases: {
    es: "Participar es gratis y no hace falta comprar nada. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
    en:
      "Taking part is free and you don't need to buy anything. " +
      "Following Alcancía Andina on social media is a request and doesn't change who wins.",
  },
  anotadas: 0,
  contrato: null,
  promo: null,
  comprobante: null,
  organizadora: operadora,
};
const firmaDe = (datos) =>
  Buffer.from(ed25519.sign(new TextEncoder().encode(JSON.stringify(datos)), llavePrivada)).toString("base64url");
const creada = await pedir("/v1/campana", { cuerpo: { texto: JSON.stringify(archivo), firma: firmaDe(archivo) } });
if (creada.status !== 201) {
  const det = await creada.json().catch(() => "(sin cuerpo)");
  throw new Error(`la campaña de prueba no se creó: ${creada.status} ${JSON.stringify(det)}`);
}
const { id: salaId, token: tokenDeLaSala } = await creada.json();
const abierta = await pedir(`/v1/sala/${salaId}/campana/fase`, {
  metodo: "PUT",
  cuerpo: { fase: "abierta" },
  cabeceras: { Authorization: `Bearer ${tokenDeLaSala}` },
});
if (abierta.status !== 204) throw new Error(`la campaña de prueba no abrió: ${abierta.status}`);
registrar(`servicio: Worker local montado en Node, sala ${salaId}, fase abierta`);

/* ----------------------------------------------------------- el servidor de la app */

/**
 * El puente que el navegador ve: la app de desarrollo de vite en el mismo
 * proceso y con el `vite.config.ts` del checkout, más un middleware que
 * despacha `/v1/*` al `fetch` del Worker. Nada sale del repo ni toca `src/`.
 */
process.env.VITE_CAMPANAS = "1";
const { createServer: crearVite } = await import("vite");
const puente = {
  name: "salas-de-prueba",
  configureServer(server) {
    // Antes de los middlewares internos de vite: la página de montaje y lo de `/v1/` son de acá.
    server.middlewares.use((req, res, next) => {
      if ((req.url ?? "").split("?")[0] !== "/__montaje-campana") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(htmlDeMontaje());
    });
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/v1/")) return next();
      try {
        const cuerpo = await new Promise((acepta) => {
          const partes = [];
          req.on("data", (p) => partes.push(p));
          req.on("end", () => acepta(partes.length === 0 ? undefined : Buffer.concat(partes)));
        });
        const origen = `http://127.0.0.1:8792${req.url}`;
        const cabeceras = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string" && !["host", "connection", "content-length", "keep-alive", "transfer-encoding"].includes(k)) {
            cabeceras[k] = v;
          }
        }
        if (cuerpo !== undefined) cabeceras["content-length"] = String(cuerpo.length);
        const r = await worker.default.fetch(
          new Request(origen, {
            method: req.method,
            headers: cabeceras,
            ...(cuerpo === undefined ? {} : { body: cuerpo }),
          }),
          env,
          ctx,
        );
        const caminos = [...pendientes];
        pendientes.length = 0;
        await Promise.allSettled(caminos);
        res.statusCode = r.status;
        for (const [k, v] of r.headers) res.setHeader(k, v);
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.statusCode = 500;
        res.end(`puente: ${e.message}`);
      }
    });
  },
};
const vite = await crearVite({
  root: RAIZ,
  logLevel: "error",
  server: { port: 0, strictPort: false, middlewareMode: true },
  plugins: [puente],
});
const servidorHttp = http.createServer(vite.middlewares);
await new Promise((r) => servidorHttp.listen(0, "127.0.0.1", r));
const puertoApp = servidorHttp.address().port;
const BASE = `http://localhost:${puertoApp}`;
registrar(`app: vite de desarrollo con el puente de salas en ${BASE}`);
const pruebaPuente = await fetchDeVerdad(`${BASE}/v1/sala/${salaId}/campana`)
  .then(async (r) => `${r.status} ${(await r.text()).slice(0, 80)}`)
  .catch((e) => `falló: ${e.message}`);
registrar(`puente: GET /campana → ${pruebaPuente}`);

/* -------------------------------------------------- la página de montaje del proyector */

const ORG = operadora;
/** El HTML de montaje; el `%FOLIO%` lo repone cada pedido: recarga nueva, folio nuevo. */
const SALUDO_DEL_STAND = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>montaje del stand</title>
</head><body>
<script type="module">
const tema = new URLSearchParams(location.search).get("tema") ?? "dark";
document.documentElement.dataset.theme = tema;
const org = %ORG%;
const enlaces = %ENLACES%;
window.__folio = %FOLIO%;
window.__montaje = "cargando";
window.__pedidos = [];
const fetchSinParche = window.fetch;
window.fetch = (...a) =>
  fetchSinParche(...a).then(
    (r) => {
      window.__pedidos.push(a[0] + " → " + r.status);
      return r;
    },
    (e) => {
      window.__pedidos.push(a[0] + " → " + e.message);
      throw e;
    },
  );
try {
  const { crearStandDeCampana } = await import("/src/ui/stand-campana.ts");
  const { crearPantallaDeCampana } = await import("/src/ui/stand-campana-pantalla.ts");
  const { TEXTOS_STAND_CAMPANA } = await import("/src/ui/stand-campana-textos.ts");
  const { pintarQr } = await import("/src/ui/qr.ts");
  const idioma = () => "es";
  const tx = (clave) => TEXTOS_STAND_CAMPANA.es[clave] ?? "";
  const stand = crearStandDeCampana(enlaces, {
    ahora: () => Date.now(),
    cada: (f, ms) => {
      const id = window.setInterval(f, ms);
      return () => window.clearInterval(id);
    },
    qr: async (img, enlace, lado) => { await pintarQr(img, enlace, lado); },
    // En el stand de verdad estas dos salen de la billetera conectada y del saldo de la red; acá
    // son las del mundo de pruebas: la organizadora de la campaña y un saldo con que cubra el premio.
    cuenta: () => org,
    saldo: async () => ({ tipo: "ok", saldo: BigInt("10000000000") }),
    idioma,
    tx,
    almacen: localStorage,
    origen: () => location.origin,
    servicio: "",
    notificar: (aviso) => pantalla.pintar(aviso),
  });
  const pantalla = crearPantallaDeCampana({
    tx,
    idioma,
    qr: async (img, enlace, lado) => { await pintarQr(img, enlace, lado); },
    alQuitar: (n, motivo) => void stand.quitar(n, motivo),
    alCerrar: () => void stand.cerrar(),
  });
  stand.repintar();
  addEventListener("pagehide", () => stand.parar());
  document.body.append(pantalla.raiz);
  window.__stand = stand;
  window.__montaje = "listo";
} catch (e) {
  window.__montajeError = String(e && e.stack ? e.stack : e);
}
</script>
</body></html>`;
/** El HTML de montaje de este pedido: cada carga (la primera y cada recarga) lleva un folio que no se repite. */
const htmlDeMontaje = () =>
  SALUDO_DEL_STAND.replaceAll("%ORG%", JSON.stringify(ORG))
    .replaceAll("%ENLACES%", JSON.stringify({ evento: archivo.evento, sala: salaId, token: tokenDeLaSala }))
    .replaceAll("%FOLIO%", JSON.stringify(`f${Date.now()}-${Math.floor(Math.random() * 1e9)}`));

/* ------------------------------------------------------------- el navegador */

const { launch, sleep } = await import("./lib/browser.mjs");
const navegador = await launch({ port: Number(process.env.CDP_PORT || 9731), width: 1920, height: 1080 });

const imagenes = [];
const errores = [];
/** Anota un error de página (excepción o consola) para el veredicto del final. */
const errorDe = (de, pagina) => errores.push(...[...pagina.exceptions, ...pagina.consoleErrors].map((e) => `${de}: ${e}`));
const escribir = async (nombre, pagina) => {
  mkdirSync(SALIDA, { recursive: true });
  await pagina.screenshot(join(RAIZ, SALIDA, nombre));
  const tamano = statSync(join(RAIZ, SALIDA, nombre)).size;
  imagenes.push({ nombre, tamano });
  registrar(`captura: ${SALIDA}/${nombre} (${tamano} bytes)`);
};

try {
  /* ------------------------------------------------------- el proyector (el stand) */

  const proyector = await navegador.open("about:blank");
  await proyector.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await proyector.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await proyector.send("Page.navigate", { url: `${BASE}/__montaje-campana?tema=dark` });
  const listo = (extra = "true") =>
    proyector.waitFor(`window.__montaje === 'listo' && ${extra}`, 40000);
  const primeraVista = await listo(`!document.querySelector('.scp-izq').hidden`);
  if (!primeraVista.ok) {
    const falloTexto = await proyector.eval("(document.querySelector('.scp-fallo')?.textContent ?? '') + ' | ' + 'pedidos: ' + (window.__pedidos ?? []).join(' ; ') + ' | ' + (window.__montajeError ?? '')");
    throw new Error(`el proyector no abrió: ${falloTexto}`);
  }
  const clave = await proyector.eval(`window.__stand.clave()`);
  if (!clave || !/^[A-Za-z0-9_-]{22}$/u.test(clave)) throw new Error(`el stand sin clave del QR: ${clave}`);
  registrar(`stand: abierto, clave del QR de ${clave.length} caracteres`);

  // El contenido real: altas como las manda un celular, con la clave que la pantalla del proyector generó.
  const NOMBRES = [
    "Mariela Quispe",
    "Pedro Vergara",
    "Rosario Ayala",
    "Tomás Nuñez",
    "Ana Pérez",
    "Luis Mamani",
    "Ana Pérez",       // repetido, de otro celular: queda «Para revisar»
    "Hijo de P u t a", // lo mira el filtro: queda «Para revisar»
  ];
  let n = 0;
  for (const nombre of NOMBRES) {
    n += 1;
    const persona = personaDePrueba(n);
    const d = await cifrarEquipo(clave, { nombre, integrantes: [] });
    const r = await pedir(`/v1/sala/${salaId}/campana/alta`, {
      cuerpo: { token: persona.token, d, llave: persona.llave },
      cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
    });
    const codigo = r.status;
    const cuerpo = JSON.stringify(await r.json().catch(() => null));
    if (codigo !== 201) throw new Error(`el alta de «${nombre}» contestó ${codigo} ${cuerpo}`);
    registrar(`alta ${n}: «${nombre}» → ${codigo}`);
  }

  // El proyector lee cada 5 s: a la vista todo lo que tiene que mostrar antes de cada captura.
  const llena = await proyector.waitFor(
    `document.querySelectorAll('.scp-lista li').length >= 6 && document.querySelectorAll('.scp-revisar li').length >= 2`,
    20000,
  );
  if (!llena.ok) {
    const vista = await proyector.eval(`JSON.stringify({
      lista: document.querySelectorAll('.scp-lista li').length,
      revisar: document.querySelectorAll('.scp-revisar li').length,
      texto: document.querySelector('.scp').innerText.slice(0, 200),
    })`);
    throw new Error(`la lista del proyector no quedó a la vista: ${vista}`);
  }
  const comprobaciones = await proyector.eval(`JSON.stringify({
    titulo: document.querySelector('.scp-titulo').textContent,
    logo: !document.querySelector('.scp-logo').hidden && document.querySelector('.scp-logo').naturalWidth > 0,
    premio: document.querySelector('.scp-premio').textContent.length,
    cierre: document.querySelector('.scp-cierre').textContent.length,
    van: document.querySelector('.scp-van').textContent,
    qr: document.querySelector('.scp-qr-img') !== null && document.querySelector('.scp-qr-img').naturalWidth > 0,
    escena: document.querySelectorAll('.scp-lista li').length,
    revisar: document.querySelectorAll('.scp-revisar li').length,
    fallo: document.querySelector('.scp-fallo').hidden,
  })`);
  const vista = JSON.parse(comprobaciones);
  const detalles = [
    `titulo «${vista.titulo}»`,
    `logo ${vista.logo}`,
    `premio ${vista.premio} letras`,
    `cierre ${vista.cierre} letras`,
    `«${vista.van}»`,
    `QR ${vista.qr}`,
    `${vista.escena} en lista`,
    `${vista.revisar} en Para revisar`,
    `sin fallo ${vista.fallo}`,
  ];
  const entera = vista.logo && vista.qr && vista.premio > 0 && vista.cierre > 0 && vista.escena >= 6 && vista.revisar >= 2 && vista.fallo;
  registrar(`proyector: ${detalles.join(", ")}`);
  if (!entera) throw new Error(`el proyector quedó incompleto: ${detalles.join(", ")}`);

  // Los cuatro tamaños y temas. La pantalla del proyector tiene el claro fijo por diseño; las dos etiquetas de tema quedan porque así lo pide la tarea.
  for (const v of [
    { ancho: 1366, alto: 768 },
    { ancho: 1920, alto: 1080 },
  ]) {
    for (const tema of ["dark", "light"]) {
      await proyector.send("Emulation.setDeviceMetricsOverride", { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: false });
      await proyector.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: tema }] });
      // El folio dice cuándo la recarga trajo un documento nuevo (cada carga tiene uno distinto).
      const folioViejo = await proyector.eval("window.__folio");
      await proyector.send("Page.reload");
      if (!(await proyector.waitFor(
        `window.__montaje === 'listo' && window.__folio !== ${JSON.stringify(folioViejo)} && document.querySelectorAll('.scp-lista li').length >= 6 && document.querySelectorAll('.scp-revisar li').length >= 2 && document.querySelector('.scp-qr-img').naturalWidth > 0`,
        40000,
      )).ok) {
        throw new Error(`el proyector ${v.ancho}x${v.alto} (${tema}) no volvió a quedar a la vista`);
      }
      await sleep(300);
      await escribir(`proyector-${v.ancho}x${v.alto}-${tema}.png`, proyector);
    }
  }
  errorDe("proyector", proyector);

  /* --------------------------------------------- el celular (los estados de la página) */

  // Los estados documentados de `src/campana/demostracion.ts`: la campaña de ejemplo, sin red y sin recuerdos.
  const ESTADOS = [
    { estado: "hola", archivo: "celular-entrada" },
    { estado: "adentro", archivo: "celular-adentro" },
    { estado: "lista", archivo: "celular-lista" },
    { estado: "cerrada", archivo: "celular-cerrada" },
    { estado: "ganaste", archivo: "celular-ganaste" },
  ];
  for (const { estado, archivo: nombre } of ESTADOS) {
    for (const tema of ["dark", "light"]) {
      const cel = await navegador.open("about:blank");
      try {
        await cel.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 844, deviceScaleFactor: 2, mobile: true });
        await cel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: tema }] });
        await cel.send("Page.navigate", { url: `${BASE}/participar.html?lang=es&theme=${tema}&demo=campana&estado=${estado}` });
        const pintada = await cel.waitFor(
          `[...document.querySelectorAll('.cmp section')].some((s) => !s.hidden && s.textContent.trim().length > 0)`,
          20000,
        );
        if (!pintada.ok) throw new Error(`el celular no pintó el estado ${estado} (${tema})`);
        // La etiqueta «Demo» de la cabecera la pone la página al reconocer ?demo=campana: en la captura estorba
        // (el readme lo dice) y no es parte del estado.
        await cel.eval("document.getElementById('cmp-ejemplo').hidden = true");
        await sleep(600);
        await escribir(`${nombre}-${tema}.png`, cel);
        errorDe(`celular ${estado}`, cel);
      } finally {
        await cel.send("Page.close").catch(() => undefined);
      }
    }
  }
} finally {
  await navegador.close();
  await vite.close().catch(() => undefined);
  servidorHttp.close();
  while (pendientes.length > 0) await Promise.allSettled(pendientes.splice(0));
}

/* ---------------------------------------------------------------- el veredicto */

registrar(``);
registrar(`— capturas —`);
for (const imagen of imagenes) registrar(`  ${SALIDA}/${imagen.nombre} (${imagen.tamano} bytes)`);
const chicas = imagenes.filter((i) => i.tamano < 15_000);
if (chicas.length > 0) throw new Error(`capturas sospechosamente chicas: ${chicas.map((c) => c.nombre).join(", ")}`);
if (errores.length > 0) {
  registrar(``);
  registrar(`ERRORES de consola o excepciones:`);
  for (const e of errores.slice(0, 10)) registrar(`  ${e}`);
  process.exitCode = 1;
} else {
  registrar(``);
  registrar(`sin excepciones ni errores de consola en todas las páginas capturadas`);
}
registrar(``);
registrar(`ultima linea: el JSON con la lista de archivos`);
IMPRIMIR(
  JSON.stringify({ guion: "captura-campana", salida: SALIDA, campañas: { evento: archivo.evento, sala: salaId }, imagenes, errores }) +
    "\n",
);
