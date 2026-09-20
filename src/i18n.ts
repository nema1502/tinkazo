export type Lang = "es" | "en";

export interface Dict {
  [key: string]: string | ((...args: never[]) => string);
  cLead: (n: string) => string;
  cWin: (n: string) => string;
  summary: (w: string, n: number, d: string, r: number, u: string) => string;
  drawIn: (mmss: string) => string;
  tellBody: (w: string, prize: string, n: number, u: string) => string;
}

export const T: Record<Lang, Dict> = {
  es: {
    badge: "Para el sorteo del meetup",
    h1: 'Sorteos que <span class="hl">no se pueden arreglar</span>.',
    lead: "Pega la lista de inscritos y sortea en pantalla grande: carrera de llamas o ruleta. Quién gana lo decide un azar público que nadie controla —ni tú—, y cualquiera puede comprobarlo después desde su celular.",
    note: "Pruébalo ahora con tu propia lista: gratis, sin cuenta y sin instalar nada.",
    s1t: "Importa participantes", s1b: "Pega la lista, sube un CSV o tráelos de Luma/Meetup. Nadie necesita wallet ni cuenta.",
    s2t: "Congela la lista", s2b: "Al congelarla, la lista queda con una huella digital única y una hora. Si después alguien agrega o quita un nombre, la huella cambia y se nota.",
    s3t: "Elige tu juego y sortea", s3b: "Carrera en pantalla completa o ruleta. El ganador se deriva de aleatoriedad pública; el juego solo lo cuenta bonito.",
    p1: "Participantes", p2: "Lista congelada", p3: "El sorteo",
    srcPaste: "Pegar lista", srcCsv: "Subir CSV", srcLuma: "Luma · pronto", srcMeetup: "Meetup · pronto",
    sample: "Cargar ejemplo", freeze: "Congelar lista", draw: "Lanzar sorteo", winners: "Premios",
    gameLabel: "Juego", gameRace: "Carrera de llamas", gameWheel: "Ruleta",
    wheelCap: "La ruleta se ve bien hasta 24 participantes; con más, la carrera es tu juego.",
    prizeLabel: "¿Qué sorteas? (opcional)", prizePh: "Ej: Licencia JetBrains, libro, entrada…",
    kEntries: "entries", kDigest: "huella de la lista", kStatus: "estado del sorteo",
    frozenNote: "La lista quedó sellada antes de que exista la semilla: la ronda objetivo del faro nace recién en unos segundos. Nadie puede agregar ni quitar participantes sin cambiar el hash.",
    winnerLabel: "Resultado", verifyTitle: "Prueba de imparcialidad",
    verifyHow: "Cualquiera puede repetir este sorteo por su cuenta: con la huella de la lista y el número público que salió a esa hora, el resultado da siempre el mismo. No hace falta creernos nada. · Paso a paso: 1) abre la ronda de quicknet y comprueba su firma con la clave pública del faro · 2) randomness = sha256(firma) · 3) idx = los primeros 8 bytes de sha256(randomness ‖ list_hash ‖ contador) mod entries, saltando repetidos. Protocolo completo en docs/protocolo.md.",
    reverify: "Recomputar aquí mismo", reverifyOk: "Verificado: el recómputo reproduce exactamente el resultado.",
    copySummary: "Copiar resumen", copied: "¡Copiado!",
    tellWhatsapp: "Avisar por WhatsApp", tellEmail: "Avisar por correo",
    tellSubject: "Ganaste el sorteo 🦙",
    tellBody: (w, prize, n, u) =>
      `¡Felicidades ${w}! Ganaste${prize ? " " + prize : " el sorteo"}.

` +
      `Fuiste elegido entre ${n} participantes por un sorteo que cualquiera puede verificar. ` +
      `La lista se selló antes de que existiera la semilla, y la semilla la publicó un faro público de aleatoriedad.

` +
      `Comprobalo vos mismo: ${u}

Sorteado con Tinkazo · https://tinkazo.vercel.app`,
    qrCaption: "Escanea y verifica la ronda desde tu celular",
    nextTitle: "Lo que viene: el sorteo queda guardado fuera de Tinkazo",
    nextBody: "En la próxima versión, el sello de la lista y una ronda futura del faro quedan registrados en un contrato en Stellar que verifica la firma del faro por sí mismo y guarda el resultado. Cualquiera podrá leerlo y recomputarlo aunque Tinkazo no esté en línea. Este demo hace el sellado en tu navegador.",
    footL: "Tinkazo", footR: "Hecho en Bolivia",
    src: "fuente: pegado / csv", frozenAt: "congelada:", seed: "semilla pública · ronda", drandLink: "ver la ronda pública ↗",
    placeholder: "Un participante por línea…", winsPrize: "Gana:", skip: "Saltar",
    fetching: "Buscando la ronda…", badSig: "La firma de la ronda no verifica contra la clave pública de quicknet. Reintenta.",
    drawIn: (mmss) => `Sortear en ${mmss}`,
    prTitle: "Precios", prNote: "La verificación nunca se cobra. Se cobra el show.",
    pr1t: "Gratis", pr1p: "$0 · para siempre", pr1b: "Sorteos verificables ilimitados, ruleta y carrera, QR de verificación y prueba recomputable. Código abierto (MIT).",
    pr2t: "Pro", pr2p: "US$ 5 / sorteo · pronto", pr2b: "Catálogo completo de juegos y skins, tu logo en el estadio, participantes ilimitados y soporte.",
    pr3t: "Sponsor", pr3p: "lo paga tu sponsor · pronto", pr3b: "Sorteo brandeado: su marca en el estadio y la ruleta, en el momento de máxima atención del evento.",
    cReady: "¡Llamas a sus puestos!", cStart: "¡ARRANCA LA CARRERA!",
    cLead: (n) => `¡${n} toma la punta!`, cLast: "¡ÚLTIMA RECTA!", cWin: (n) => `¡GANA ${n}!`,
    drandDown: "No pude alcanzar drand. Revisa tu conexión.",
    summary: (w, n, d, r, u) => `Tinkazo · sorteo verificable (protocolo v2)\nGanador(es): ${w}\nEntries: ${n}\nlist_hash: ${d}\nRonda quicknet: ${r} → ${u}\nRecomputa: docs/protocolo.md §5`,
  },
  en: {
    badge: "For your meetup raffle",
    h1: 'Raffles that <span class="hl">cannot be rigged</span>.',
    lead: "Paste your attendee list and draw on the big screen: llama race or roulette. The winner is decided by public randomness nobody controls — not even you — and anyone can check it afterwards from their phone.",
    note: "Try it now with your own list: free, no account, nothing to install.",
    s1t: "Import participants", s1b: "Paste the list, upload a CSV or bring them from Luma/Meetup. Nobody needs a wallet or an account.",
    s2t: "Freeze the list", s2b: "Once frozen, the list gets a unique fingerprint and a timestamp. If anyone adds or removes a name afterwards, the fingerprint changes and it shows.",
    s3t: "Pick your game and draw", s3b: "Fullscreen race or roulette. The winner derives from public randomness; the game just tells it beautifully.",
    p1: "Participants", p2: "Frozen list", p3: "The draw",
    srcPaste: "Paste list", srcCsv: "Upload CSV", srcLuma: "Luma · soon", srcMeetup: "Meetup · soon",
    sample: "Load sample", freeze: "Freeze list", draw: "Run the draw", winners: "Prizes",
    gameLabel: "Game", gameRace: "Llama race", gameWheel: "Roulette",
    wheelCap: "The wheel looks great up to 24 participants; beyond that, the race is your game.",
    prizeLabel: "What are you raffling? (optional)", prizePh: "E.g. JetBrains license, book, ticket…",
    kEntries: "entries", kDigest: "list fingerprint", kStatus: "raffle status",
    frozenNote: "The list was sealed before the seed exists: the beacon's target round is only born in a few seconds. Nobody can add or remove participants without changing the hash.",
    winnerLabel: "Result", verifyTitle: "Proof of fairness",
    verifyHow: "Anyone can repeat this draw on their own: with the list fingerprint and the public number published at that time, the result always comes out the same. You don't have to take our word for it. · Step by step: 1) open the quicknet round and check its signature against the beacon's public key · 2) randomness = sha256(signature) · 3) idx = first 8 bytes of sha256(randomness ‖ list_hash ‖ counter) mod entries, skipping repeats. Full protocol in docs/protocolo.md.",
    reverify: "Recompute right here", reverifyOk: "Verified: the recomputation reproduces the exact result.",
    copySummary: "Copy summary", copied: "Copied!",
    tellWhatsapp: "Tell them on WhatsApp", tellEmail: "Tell them by email",
    tellSubject: "You won the raffle 🦙",
    tellBody: (w, prize, n, u) =>
      `Congratulations ${w}! You won${prize ? " " + prize : " the raffle"}.

` +
      `You were picked from ${n} participants by a draw anyone can verify. ` +
      `The list was sealed before the seed existed, and the seed was published by a public randomness beacon.

` +
      `Check it yourself: ${u}

Drawn with Tinkazo · https://tinkazo.vercel.app`,
    qrCaption: "Scan and verify the round from your phone",
    nextTitle: "Next: the draw stored outside Tinkazo",
    nextBody: "In the next version, the list seal and a future beacon round are recorded in a Stellar contract that verifies the beacon signature itself and stores the result. Anyone will be able to read and recompute it even if Tinkazo is offline. This demo seals the list in your browser.",
    footL: "Tinkazo", footR: "Built in Bolivia",
    src: "source: paste / csv", frozenAt: "frozen:", seed: "public seed · round", drandLink: "view the public round ↗",
    placeholder: "One participant per line…", winsPrize: "Wins:", skip: "Skip",
    fetching: "Fetching the round…", badSig: "The round signature does not verify against quicknet's public key. Try again.",
    drawIn: (mmss) => `Draw in ${mmss}`,
    prTitle: "Pricing", prNote: "Verification is never charged. We charge for the show.",
    pr1t: "Free", pr1p: "$0 · forever", pr1b: "Unlimited verifiable raffles, roulette and race, verification QR and recomputable proof. Open source (MIT).",
    pr2t: "Pro", pr2p: "US$ 5 / raffle · soon", pr2b: "Full game and skin catalog, your logo in the stadium, unlimited participants and support.",
    pr3t: "Sponsor", pr3p: "your sponsor pays · soon", pr3b: "Branded raffle: their brand in the stadium and the wheel, at the event's peak-attention moment.",
    cReady: "Llamas, on your marks!", cStart: "AND THEY'RE OFF!",
    cLead: (n) => `${n} takes the lead!`, cLast: "FINAL STRETCH!", cWin: (n) => `${n} WINS!`,
    drandDown: "Couldn't reach drand. Check your connection.",
    summary: (w, n, d, r, u) => `Tinkazo · verifiable raffle (protocol v2)\nWinner(s): ${w}\nEntries: ${n}\nlist_hash: ${d}\nquicknet round: ${r} → ${u}\nRecompute: docs/protocolo.md §5`,
  },
};

let current: Lang = "es";
const listeners: Array<(l: Lang) => void> = [];

export const getLang = (): Lang => current;

/** Cadena traducida; devuelve la clave si no existe (visible, para detectarlo). */
export function t(key: string): string {
  const v = T[current][key];
  return typeof v === "string" ? v : key;
}

/** Se ejecuta después de cada cambio de idioma (textos que no viven en `data-i`). */
export function onLangChange(fn: (l: Lang) => void): void {
  listeners.push(fn);
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  document.getElementById("l-es")?.classList.toggle("on", l === "es");
  document.getElementById("l-en")?.classList.toggle("on", l === "en");
  const dict = T[l];
  document.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const v = dict[el.dataset.i ?? ""];
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i-html]").forEach((el) => {
    const v = dict[el.dataset.iHtml ?? ""];
    if (typeof v === "string") el.innerHTML = v;
  });
  document.querySelectorAll<HTMLInputElement>("[data-i-ph]").forEach((el) => {
    const v = dict[el.dataset.iPh ?? ""];
    if (typeof v === "string") el.placeholder = v;
  });
  for (const fn of listeners) fn(l);
}
