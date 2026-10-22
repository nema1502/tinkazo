/**
 * Que nadie pueda falsificar un "verificado" (22 de octubre de 2026).
 *
 * Abre verificar.html y evento.html con comprobantes inventados y exige que
 * ninguno salga en verde. Y, del otro lado, que los de verdad sigan en verde:
 * si la verificación se pone tan estricta que rechaza lo legítimo, también falla.
 *
 * Los casos:
 * - Un contrato ajeno. `CDIBBDOR…JUU3` es un contrato de prueba en testnet, de
 *   unas 60 líneas, con la misma interfaz de lectura que el de Tinkazo: devuelve
 *   lo que su dueño le cargó. Tiene cargado un "sorteo #278" inventado, con doce
 *   nombres de prueba, una ronda real de drand y el ganador que eligió quien lo
 *   armó (el orden de la lista se acomodó para que saliera "Prueba Falsa 07").
 *   Hasta el arreglo, verificar.html lo pintaba "El sorteo cuadra y está en
 *   Stellar". No hace falta que ese contrato siga vivo: la página lo tiene que
 *   rechazar sin preguntarle nada a la red.
 * - Un ancla inventada en evento: el mismo sorteo, y otro que dice ser el #278
 *   del contrato de verdad con una lista que nunca se selló. evento.html no leía
 *   la cadena: con red, contrato y número le alcanzaba para el verde.
 * - De control: el sorteo #165 del contrato de testnet (la lista de ejemplo,
 *   sellado y sorteado el 4 de octubre de 2026 por la QA de flujo), que tiene que
 *   seguir en verde, y uno sin anclar, que tiene que seguir en amarillo.
 *
 * Testnet se borra entera el 16 de diciembre de 2026: desde entonces el #165 ya
 * no se puede leer y su caso pasa a "no está en la cadena". Ese día hay que
 * cambiarlo por un sorteo del contrato nuevo.
 *
 * Uso:
 *   pnpm build && pnpm preview &
 *   CDP_PORT=9721 node scripts/check-verificacion.mjs --base http://localhost:4173
 *   node scripts/check-verificacion.mjs --solo V1,E2   # algunos casos
 */

import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = opt("--base", "http://localhost:4173");
const solo = opt("--solo", "")
  .split(",")
  .filter(Boolean);

/** El comprobante tal como va después del `#`: sin comprimir, que la página también lo lee. */
const frag = (obj) => "r" + Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

// Una ronda real de quicknet y su firma (docs/vectors.json).
const RONDA = 32254977;
const FIRMA = "a77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac";

const CONTRATO_AJENO = "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3";
const CONTRATO_TESTNET = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
/** El contrato de testnet reemplazado el 16 de septiembre: dio un solo número, y sigue abierto. */
const CONTRATO_ANTERIOR = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
/** El título de un evento lo escribe quien arma el enlace. */
const TITULO_TRAMPA = "✅ Todo cuadra · Los sorteos cuadran";

/** El sorteo inventado: la lista, rotada para que gane el que eligió quien lo armó. */
const FALSOS = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4].map((n) => `Prueba Falsa ${String(n).padStart(2, "0")}`);
const FALSO = {
  v: 2,
  names: FALSOS,
  round: RONDA,
  signature: FIRMA,
  prize: "Un auto 0 km",
  sealedAt: 1_789_568_250,
  net: "testnet",
  contract: CONTRATO_AJENO,
  id: "278",
};

/** La lista de ejemplo del sitio (src/state.ts, SAMPLE). */
const EJEMPLO = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

/** El #165 de testnet, de verdad: lo selló y lo sorteó la QA de flujo el 4 de octubre de 2026. */
const LEGITIMO = {
  v: 2,
  names: EJEMPLO,
  round: 32769771,
  sealedAt: 1_791_112_632,
  prize: "Sorteo de demostración, con la lista de ejemplo",
  signature: "a578000ca42ffb367a21ff44fdde5e232b163afe064013242da2238110e550fbb90cb58eb747d0db00a2bfea3272f21c",
  net: "testnet",
  contract: CONTRATO_TESTNET,
  id: "165",
};

/** Sin anclar: la lista de ejemplo con la ronda de los vectores. */
const LIBRE = { v: 2, names: EJEMPLO, round: RONDA, signature: FIRMA };

const sinAncla = (p) => {
  const { net: _n, contract: _c, id: _i, ...resto } = p;
  return resto;
};

// Los ganadores por nombre, como los lleva el enlace de evento: los rehace la
// página, así que tienen que ser los que da la selección de cada uno.
const GANA_FALSO = ["Prueba Falsa 07"];
const GANA_165 = ["Ana Vargas"];
const GANA_LIBRE = ["Ana Vargas"];

const evento = (titulo, sorteos) => frag({ v: 1, kind: "evento", titulo, sorteos });

const CASOS = [
  {
    id: "V1",
    que: "verificar: un contrato ajeno con un sorteo inventado",
    url: `/verificar.html#${frag(FALSO)}`,
    espera: "bad",
  },
  {
    id: "V2",
    que: "verificar: el #165 de testnet, de verdad",
    url: `/verificar.html#${frag(LEGITIMO)}`,
    espera: "ok",
  },
  {
    id: "V3",
    que: "verificar: sin anclar",
    url: `/verificar.html#${frag(LIBRE)}`,
    espera: "partial",
  },
  {
    id: "V4",
    que: "verificar: el #165 con otra red",
    url: `/verificar.html#${frag({ ...LEGITIMO, net: "mainnet" })}`,
    espera: "bad",
  },
  {
    id: "V5",
    que: "verificar: una lista inventada con el número de un sorteo de verdad y la cadena cortada (sin tarjeta de ganador)",
    url: `/verificar.html#${frag({ ...FALSO, contract: CONTRATO_TESTNET, id: "165" })}`,
    bloquear: ["*soroban-testnet.stellar.org*"],
    espera: "working",
    sinTarjeta: true,
  },
  {
    id: "V6",
    que: "verificar: un sorteo nuevo en el contrato anterior, que sigue abierto",
    url: `/verificar.html#${frag({ ...FALSO, contract: CONTRATO_ANTERIOR, id: "2" })}`,
    espera: "bad",
    sinTarjeta: true,
  },
  {
    id: "E1",
    que: "evento: un ancla en un contrato ajeno",
    url: `/evento.html#${evento("Evento de prueba", [{ ...FALSO, ganadores: GANA_FALSO }])}`,
    espera: "bad",
  },
  {
    id: "E2",
    que: "evento: el #278 del contrato de verdad, con una lista que nunca se selló",
    url: `/evento.html#${evento("Evento de prueba", [{ ...FALSO, contract: CONTRATO_TESTNET, ganadores: GANA_FALSO }])}`,
    espera: "bad",
  },
  {
    id: "E3",
    que: "evento: el #165 de testnet, de verdad",
    url: `/evento.html#${evento("Evento de prueba", [{ ...LEGITIMO, ganadores: GANA_165 }])}`,
    espera: "ok",
  },
  {
    id: "E4",
    que: "evento: uno sin anclar",
    url: `/evento.html#${evento("Evento de prueba", [{ ...sinAncla(LIBRE), ganadores: GANA_LIBRE }])}`,
    espera: "partial",
  },
  {
    id: "E5",
    que: "evento: el #165 tres veces, como si fueran tres premios",
    url: `/evento.html#${evento("Fiesta: 3 premios", [1, 2, 3].map(() => ({ ...LEGITIMO, ganadores: GANA_165 })))}`,
    espera: "bad",
  },
  {
    id: "E6",
    que: "evento: un título que dice que todo cuadra no es el titular de la página",
    url: `/evento.html#${evento(TITULO_TRAMPA, [{ ...FALSO, ganadores: GANA_FALSO }])}`,
    espera: "bad",
    titularNoEs: TITULO_TRAMPA,
  },
];

/** El veredicto de la página, cuando terminó de revisar: su clase y el titular. */
async function veredicto(cdp, pagina) {
  const caja = pagina === "verificar" ? "verdict" : "ev-veredicto";
  const titulo = pagina === "verificar" ? "verdict-title" : "ev-veredicto-t";
  // verificar deja "working" también cuando no pudo leer la cadena: lo que
  // dice que terminó es que el titular ya no es el de "revisando". En evento,
  // que la caja tenga un veredicto: al abrir no tiene ninguno, y "sin working"
  // daba por terminado lo que todavía no había empezado.
  const listo =
    pagina === "verificar"
      ? `(() => { const t = document.getElementById("${titulo}")?.textContent ?? ""; return t && !/^(Revisando el sorteo|Checking the draw)$/.test(t.trim()); })()`
      : `/\\b(ok|partial|bad)\\b/.test(document.getElementById("${caja}")?.className ?? "")`;
  const r = await cdp.waitFor(listo, 60_000);
  // Un respiro: lo que llega después (los otros sellos) no cambia el veredicto, pero que se asiente.
  await sleep(500);
  const clase = await cdp.eval(`document.getElementById("${caja}")?.className ?? ""`);
  const texto = await cdp.eval(`document.getElementById("${titulo}")?.textContent ?? ""`);
  const estado = /\bok\b/.test(clase) ? "ok" : /\bpartial\b/.test(clase) ? "partial" : /\bbad\b/.test(clase) ? "bad" : "working";
  return { estado, texto: texto.trim(), aTiempo: r.ok };
}

const casos = solo.length ? CASOS.filter((c) => solo.includes(c.id)) : CASOS;
const browser = await launch({ width: 1280, height: 900 });
let fallas = 0;
try {
  for (const c of casos) {
    // Con `bloquear`, la pestaña nace sin acceso a esas direcciones: la red del evento cortada.
    const cdp = await browser.open("about:blank");
    if (c.bloquear) {
      await cdp.send("Network.enable");
      await cdp.send("Network.setBlockedURLs", { urls: c.bloquear });
    }
    await cdp.send("Page.navigate", { url: `${base}${c.url}` });
    const pagina = c.url.startsWith("/verificar") ? "verificar" : "evento";
    const v = await veredicto(cdp, pagina);
    const problemas = [];
    if (v.estado !== c.espera) problemas.push(`dio ${v.estado}, se esperaba ${c.espera}`);
    // Nunca una tarjeta de ganador (que se comparte sola) en lo que no se pudo atestiguar.
    if (c.sinTarjeta && (await cdp.eval(`getComputedStyle(document.getElementById("sec-result")).display !== "none"`))) {
      problemas.push("muestra la tarjeta del ganador");
    }
    if (c.titularNoEs && (await cdp.eval(`document.querySelector("h1")?.textContent ?? ""`)).includes(c.titularNoEs)) {
      problemas.push("el título del enlace es el titular de la página");
    }
    if (problemas.length) fallas++;
    console.log(`${problemas.length ? "FALLA" : "ok  "} ${c.id} ${c.que}: ${problemas.length ? problemas.join("; ") : `dio ${v.estado}`}${v.aTiempo ? "" : " (sin terminar)"} · «${v.texto}»`);
    await cdp.send("Page.close").catch(() => {});
  }
} finally {
  await browser.close();
}
console.log(fallas ? `\n${fallas} caso(s) no dan lo que tienen que dar.` : "\nTodos los casos dan lo que tienen que dar.");
process.exit(fallas ? 1 : 0);
