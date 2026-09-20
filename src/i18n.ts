export type Lang = "es" | "en";

/**
 * Diccionario de la interfaz.
 *
 * Una clave puede ser texto, una lista de variantes o una función. Las listas
 * existen para el narrador de la carrera: `t()` sortea una variante en cada
 * llamada, así el relator no repite la misma frase tres veces en treinta
 * segundos. `setLang` ignora las listas al pintar los atributos `data-i`, de
 * modo que una clave con variantes no puede usarse en el markup.
 */

export interface Dict {
  [key: string]: string | string[] | ((...args: never[]) => string);
  cLead: (n: string) => string;
  cWin: (n: string) => string;
  summary: (w: string, n: number, d: string, r: number, u: string) => string;
  drawIn: (mmss: string) => string;
  tellBody: (w: string, prize: string, n: number, u: string) => string;
}

const pick = (xs: string[]): string => xs[Math.floor(Math.random() * xs.length)] ?? "";

export const T: Record<Lang, Dict> = {
  es: {
    badge: "Para el que le toca sortear",
    h1: 'Sorteos que <span class="hl">nadie puede arreglar</span>. Ni vos.',
    lead: "Pegá la lista de tu evento y sorteá en pantalla grande, con carrera de llamas o con ruleta. Al ganador lo decide un número al azar que se publica en internet a una hora fija, después de que vos cerraste la lista. Vos no lo elegís. Yo tampoco. Y cualquiera lo revisa desde su celular.",
    note: "Probalo ahora con tu lista de verdad. Es gratis y no te pido ni el correo.",
    s1t: "Traé tu lista",
    s1b: "Pegás los nombres o subís un CSV. Luma y Meetup están en camino. Tu gente no instala nada ni se crea cuenta.",
    s2t: "Congelá la lista",
    s2b: "Al congelarla, la lista queda con una huella y una hora. Si después alguien mete a su primo o saca a otro, la huella cambia y se nota. No hay cómo disimularlo.",
    s3t: "Elegí el juego y sorteá",
    s3b: "Carrera de llamas o ruleta, a pantalla completa. Cuando arranca la animación el ganador ya salió del número público. El show es show. El sorteo ya estaba hecho.",
    p1: "Participantes", p2: "Lista congelada", p3: "El sorteo",
    srcPaste: "Pegar lista", srcCsv: "Subir CSV", srcLuma: "Luma · pronto", srcMeetup: "Meetup · pronto",
    sample: "Cargar ejemplo", freeze: "Congelar lista", draw: "Lanzar el sorteo", winners: "Premios",
    gameLabel: "Juego", gameRace: "Carrera de llamas", gameStellar: "Carrera Stellar", gameWheel: "Ruleta",
    wheelCap: "La ruleta se ve linda hasta unos 24 nombres. De ahí para arriba, andá con la carrera.",
    prizeLabel: "¿Qué sorteás? (opcional)", prizePh: "Una polera, un libro, la licencia de JetBrains…",
    kEntries: "participantes", kDigest: "huella de la lista", kStatus: "estado del sorteo",
    frozenNote: "Sellaste la lista antes de que exista el número. La ronda que va a decidir todavía no nace, sale en unos segundos. De acá en adelante, agregar o sacar a alguien cambia la huella y se ve.",
    winnerLabel: "Lo que salió", verifyTitle: "Por si alguien duda",
    verifyHow: "Cualquiera puede rehacer este sorteo por su cuenta y le tiene que dar el mismo nombre. Con la huella de la lista y el número público de esa hora, no hay otro resultado posible. No hace falta que me creas. · Paso a paso: 1) abrí la ronda de quicknet y verificá su firma con la clave pública del faro · 2) randomness = sha256(firma) · 3) idx = los primeros 8 bytes de sha256(randomness ‖ list_hash ‖ contador) mod entries, salteando repetidos. El protocolo entero está en docs/protocolo.md.",
    reverify: "Rehacelo acá mismo", reverifyOk: "Lo rehicimos delante tuyo y dio el mismo nombre.",
    copySummary: "Copiar resumen", copied: "¡Copiado!",
    tellWhatsapp: "Avisarle por WhatsApp", tellEmail: "Avisarle por correo",
    tellSubject: "Ganaste el sorteo 🦙",
    tellBody: (w, prize, n, u) =>
      `¡Ganaste, ${w}! Te llevás${prize ? " " + prize : " el sorteo"}.\n\n` +
      `Saliste entre ${n} personas y nadie te eligió a dedo. La lista se cerró antes de que existiera el número que te sacó, ` +
      `y ese número lo publica un servicio de azar público que no controla nadie.\n\n` +
      `Revisalo vos mismo, te toma diez segundos: ${u}\n\n` +
      `Sorteado con Tinkazo · https://tinkazo.vercel.app`,
    qrCaption: "Apuntá el celular y revisalo vos mismo",
    nextTitle: "Lo que viene: el sorteo deja de depender de mí",
    nextBody: "En la próxima versión, la huella de la lista y la ronda que va a decidir quedan anotadas en un contrato en Stellar. El contrato verifica la firma del faro por su cuenta y se queda con el resultado. Si mañana Tinkazo desaparece, el sorteo sigue ahí y cualquiera lo rehace. Hoy, en este demo, el sellado pasa en tu navegador.",
    footL: "Tinkazo", footR: "Hecho en Bolivia por Nicolás",
    src: "fuente: pegado / csv", frozenAt: "congelada:", seed: "número público · ronda", drandLink: "ver la ronda pública ↗",
    placeholder: "Un nombre por línea…", winsPrize: "Se lleva:", skip: "Saltar",
    fetching: "Esperando el número público…",
    badSig: "La firma de esa ronda no cuadra con la clave pública de quicknet. Probá de nuevo.",
    drawIn: (mmss) => `Sortear en ${mmss}`,
    prTitle: "Precios", prNote: "Verificar es gratis siempre. Lo que se cobra es el show.",
    pr1t: "Gratis", pr1p: "$0 · y va a seguir así",
    pr1b: "Sorteá las veces que quieras, con carrera o con ruleta, con QR y prueba para rehacerlo. El código está abierto (MIT). Si no me creés, leelo.",
    pr2t: "Pro", pr2p: "US$ 5 / sorteo · pronto",
    pr2b: "Más juegos y más skins, tu logo en el estadio y sin tope de participantes. Si algo falla en pleno evento, me escribís y contesto yo.",
    pr3t: "Sponsor", pr3p: "lo paga tu sponsor · pronto",
    pr3b: "El sorteo con la marca de tu sponsor en el estadio y en la ruleta. Es el único minuto del evento en que todos miran la pantalla al mismo tiempo. Vendéselo así.",
    sealOnStellar: "Sellar en Stellar", sealed: "Sellado en Stellar", defaultMeta: "Sorteo de comunidad",
    noAnchor: "sin registrar en Stellar", onChain: "verlo en la cadena",
    txSimulating: "Armando la transacción…", txSigning: "Firmá en tu wallet…",
    txSending: "Mandando a la red…", txConfirmed: "Quedó en Stellar ·", txCost: "Te va a costar",
    "errAnchor.notFound": "El contrato no encuentra ese sorteo.",
    "errAnchor.alreadyDrawn": "Ese sorteo ya se cerró.",
    "errAnchor.tooFewEntries": "Con uno solo no hay sorteo. Metele al menos dos.",
    "errAnchor.badWinnerCount": "Esa cantidad de ganadores no va.",
    "errAnchor.roundTooSoon": "Esa ronda está demasiado cerca. Probá de nuevo.",
    "errAnchor.roundTooFar": "Esa ronda está a más de 30 días. Elegí una más cerca.",
    "errAnchor.roundNotReady": "Esa ronda todavía no se publica. Esperá unos segundos.",
    "errAnchor.invalidSignature": "El contrato rechazó la firma de la ronda.",
    "errAnchor.metaTooLong": "El nombre del premio es muy largo. Cortalo un poco.",
    "errAnchor.noFunds": "Tu cuenta no tiene XLM para pagar la transacción.",
    "errAnchor.userRejected": "Cancelaste la firma en la wallet.",
    "errAnchor.rpcDown": "No pude hablar con la red de Stellar. Probá de nuevo.",
    "errAnchor.unknown": "Falló la transacción. Probá de nuevo.",
    vVerdictPartialKicker: "La cuenta cierra",
    vVerdictPartial: "El cálculo está bien, pero falta un testigo",
    vVerdictPartialDetail: "Con esta lista y este número, el ganador es el que dice. Pero este sorteo no quedó registrado en Stellar, así que nadie más que el organizador puede confirmar que esta era la lista original. Anclarlo cuesta unos centavos y cierra ese hueco.",
    vFinish: "Finalizar el sorteo",
    vFinishNoWallet: "Para finalizarlo hace falta una wallet o estar en testnet.",
    vFinishDone: "¡Listo! Quedó registrado en la cadena.",
    vCheckWitness: "Un tercero atestigua la lista",
    vNoWitnessShort: "no, este sorteo no quedó en la cadena",
    vChecks: "Lo que se comprobó", vResult: "Quién ganó", vList: "La lista sellada",
    vHow: "Rehacelo con tus herramientas",
    vHowIntro: "No hace falta que confíes en esta página. Estos son los pasos exactos, con los valores de este sorteo:",
    vProtocol: "El protocolo completo ↗", vBack: "← Sortear con Tinkazo",
    vRound: "Ver la ronda pública ↗", vContract: "Ver el contrato ↗",
    vWorking: "Revisando el sorteo", vWorkingKicker: "Un segundo",
    vVerdictOkKicker: "Cuadra todo", vVerdictBadKicker: "Algo no cuadra",
    vVerdictOk: "El sorteo es legítimo",
    vVerdictOkDetail: "Rehicimos el sorteo desde cero acá mismo y dio el mismo nombre. La lista se selló antes de que existiera el número, así que nadie pudo elegir el resultado.",
    vVerdictOkChain: "El sorteo es legítimo y está en Stellar",
    vVerdictOkChainDetail: "Lo rehicimos acá y coincide con lo que quedó grabado en el contrato. Ese registro sigue ahí aunque Tinkazo desaparezca, y cualquiera puede leerlo.",
    vVerdictBad: "Este sorteo no cuadra",
    vCannotFinish: "No pude terminar de revisar",
    vNoProof: "Este enlace no trae un sorteo",
    vNoProofDetail: "Pedile a quien organizó el sorteo el enlace completo, con todo lo que viene después del numeral.",
    vCheckList: "La lista y su huella", vCheckRound: "La firma de la ronda",
    vCheckSeed: "La semilla sale de la firma", vCheckWinner: "El ganador recomputado",
    vCheckChain: "El registro en Stellar",
    vNotDrawnYet: "todavía no se sorteó en la cadena",
    vChainUnreachable: "no pude leer el contrato",
    vRoundUnreachable: "no pude traer la ronda del faro",
    vListChanged: "La lista de este enlace no es la que se selló. Alguien la cambió después.",
    vBadSignature: "La firma de la ronda no verifica contra la clave pública del faro.",
    vMismatch: "El ganador recomputado no coincide con el que quedó registrado.",
    shareProof: "Compartir comprobante", proofCopied: "¡Enlace copiado!",
    connectWallet: "Conectar wallet", disconnect: "Salir", cancel: "Cancelar", connecting: "Conectando…",
    connectTitle: "¿Quién organiza?",
    connectLead: "Conectá una cuenta y el sorteo queda grabado en Stellar",
    freighterHint: "La wallet del navegador. Firmás vos, nadie más.",
    freighterInstall: "No la tenés instalada. Bajala de freighter.app ↗",
    googleWallet: "Entrar con Google",
    googleHint: "Sin instalar nada. Tu cuenta de Stellar la maneja Pollar.",
    guestWallet: "Cuenta de prueba",
    guestHint: "El navegador te arma una cuenta de testnet y le pone fondos. No instalás nada.",
    guestReady: "Cuenta de prueba lista y con fondos en testnet.",
    guestTestnetOnly: "La cuenta de prueba solo vive en testnet.",
    walletRejected: "Cancelaste la conexión en la wallet.",
    walletUnknown: "No pude conectar la wallet. Probá de nuevo.",
    friendbotFailed: "No pude ponerle fondos a la cuenta de prueba. Probá en un ratito.",
    wrongNetwork: "Tu wallet está en otra red. Pasala a {red} para sellar.",
    drandDown: "No llego a drand. Revisá tu conexión.",
    cReady: ["¡Llamas a sus puestos!", "¡Se acomodan las llamas!", "¡Silencio, que arranca esto!", "¡Miren la pantalla, señores!"],
    cReadyStellar: ["¡Cohetes en la rampa!", "¡Motores encendidos!", "¡Cuenta regresiva, señores!", "¡Agárrense que despegan!"],
    cStart: ["¡ARRANCA LA CARRERA!", "¡Y SALIERON!", "¡ALLÁ VAN!", "¡EMPEZÓ ESTO!"],
    cLast: ["¡ÚLTIMA RECTA!", "¡LOS ÚLTIMOS METROS!", "¡SE DEFINE ACÁ!", "¡NO RESPIRA NADIE!"],
    cLead: (n) => pick([`¡${n} toma la punta!`, `¡Se le va ${n}!`, `¡${n} al frente, señores!`, `¡Ahora manda ${n}!`, `¡${n} los pasa a todos!`]),
    cWin: (n) => pick([`¡GANA ${n}!`, `¡SE LO LLEVA ${n}!`, `¡Y ES ${n}, SEÑORES!`, `¡${n}, ESE ES EL TINKAZO!`]),
    summary: (w, n, d, r, u) =>
      `Tinkazo · sorteo verificable (protocolo v2)\nGanador(es): ${w}\nEntries: ${n}\nlist_hash: ${d}\nRonda quicknet: ${r} → ${u}\nRehacelo: docs/protocolo.md §5`,
  },
  en: {
    badge: "For whoever has to run the raffle",
    h1: 'Raffles <span class="hl">nobody can rig</span>. Not even you.',
    lead: "Paste your attendee list and draw it on the big screen, llama race or roulette. The winner comes out of a random number published on the internet at a fixed time, after you locked the list. You don't pick it. I don't either. And anyone can check it from their phone.",
    note: "Try it right now with your real list. It's free and I don't even ask for your email.",
    s1t: "Bring your list",
    s1b: "Paste the names or upload a CSV. Luma and Meetup are on the way. Your people install nothing and sign up for nothing.",
    s2t: "Freeze the list",
    s2b: "Freezing stamps the list with a fingerprint and a time. If someone slips in a friend or drops a name later, the fingerprint changes and everybody sees it. There's no hiding it.",
    s3t: "Pick a game and draw",
    s3b: "Llama race or roulette, fullscreen. By the time the animation starts, the public number already picked the winner. The show is the show. The draw was done before it.",
    p1: "Participants", p2: "Frozen list", p3: "The draw",
    srcPaste: "Paste list", srcCsv: "Upload CSV", srcLuma: "Luma · soon", srcMeetup: "Meetup · soon",
    sample: "Load sample", freeze: "Freeze list", draw: "Run the draw", winners: "Prizes",
    gameLabel: "Game", gameRace: "Llama race", gameStellar: "Stellar race", gameWheel: "Roulette",
    wheelCap: "The wheel looks great up to about 24 names. Past that, run the race.",
    prizeLabel: "What are you giving away? (optional)", prizePh: "A t-shirt, a book, that JetBrains license…",
    kEntries: "entries", kDigest: "list fingerprint", kStatus: "raffle status",
    frozenNote: "You sealed the list before the number existed. The round that decides this hasn't been published yet, it lands in a few seconds. From here on, adding or removing anyone changes the fingerprint and it shows.",
    winnerLabel: "What came out", verifyTitle: "In case anyone doubts it",
    verifyHow: "Anyone can run this draw again on their own and has to land on the same name. With the list fingerprint and the public number from that minute, no other result is possible. You don't have to take my word for it. · Step by step: 1) open the quicknet round and check its signature against the beacon's public key · 2) randomness = sha256(signature) · 3) idx = first 8 bytes of sha256(randomness ‖ list_hash ‖ counter) mod entries, skipping repeats. Whole protocol in docs/protocolo.md.",
    reverify: "Run it again right here", reverifyOk: "Ran it again in front of you. Same name.",
    copySummary: "Copy summary", copied: "Copied!",
    tellWhatsapp: "Tell them on WhatsApp", tellEmail: "Tell them by email",
    tellSubject: "You won the raffle 🦙",
    tellBody: (w, prize, n, u) =>
      `You won, ${w}! You're taking home${prize ? " " + prize : " the raffle"}.\n\n` +
      `You came out of ${n} people and nobody hand-picked you. The list was locked before the number that drew you existed, ` +
      `and that number is published by a public randomness beacon nobody controls.\n\n` +
      `Check it yourself, it takes ten seconds: ${u}\n\n` +
      `Drawn with Tinkazo · https://tinkazo.vercel.app`,
    qrCaption: "Point your phone at it and check for yourself",
    nextTitle: "What's next: the draw stops depending on me",
    nextBody: "In the next version, the list fingerprint and the round that will decide go into a Stellar contract. The contract checks the beacon signature on its own and keeps the result. If Tinkazo disappears tomorrow, the draw is still there and anyone can run it again. Today, in this demo, the sealing happens in your browser.",
    footL: "Tinkazo", footR: "Built in Bolivia by Nicolás",
    src: "source: paste / csv", frozenAt: "frozen:", seed: "public number · round", drandLink: "see the public round ↗",
    placeholder: "One name per line…", winsPrize: "Takes home:", skip: "Skip",
    fetching: "Waiting for the public number…",
    badSig: "That round's signature doesn't check out against quicknet's public key. Try again.",
    drawIn: (mmss) => `Draw in ${mmss}`,
    prTitle: "Pricing", prNote: "Verifying is always free. What costs money is the show.",
    pr1t: "Free", pr1p: "$0 · and it stays that way",
    pr1b: "Draw as many times as you want, race or roulette, with a QR and a proof anyone can rerun. The code is open (MIT). If you don't believe me, read it.",
    pr2t: "Pro", pr2p: "US$ 5 / raffle · soon",
    pr2b: "More games and more skins, your logo in the stadium, no cap on participants. If something breaks mid-event, you write and I answer.",
    pr3t: "Sponsor", pr3p: "your sponsor pays · soon",
    pr3b: "The raffle wearing your sponsor's brand, in the stadium and on the wheel. It's the one minute of the event when everyone looks at the screen at once. Sell it to them like that.",
    sealOnStellar: "Seal on Stellar", sealed: "Sealed on Stellar", defaultMeta: "Community raffle",
    noAnchor: "not recorded on Stellar", onChain: "see it on chain",
    txSimulating: "Building the transaction…", txSigning: "Sign in your wallet…",
    txSending: "Sending it to the network…", txConfirmed: "It's on Stellar ·", txCost: "It will cost you",
    "errAnchor.notFound": "The contract can't find that raffle.",
    "errAnchor.alreadyDrawn": "That raffle is already closed.",
    "errAnchor.tooFewEntries": "One name is not a raffle. Add at least two.",
    "errAnchor.badWinnerCount": "That number of winners doesn't work.",
    "errAnchor.roundTooSoon": "That round is too close. Try again.",
    "errAnchor.roundTooFar": "That round is more than 30 days out. Pick a closer one.",
    "errAnchor.roundNotReady": "That round isn't published yet. Wait a few seconds.",
    "errAnchor.invalidSignature": "The contract rejected the round signature.",
    "errAnchor.metaTooLong": "The prize name is too long. Trim it a bit.",
    "errAnchor.noFunds": "Your account has no XLM to pay for the transaction.",
    "errAnchor.userRejected": "You cancelled the signature in the wallet.",
    "errAnchor.rpcDown": "Couldn't reach the Stellar network. Try again.",
    "errAnchor.unknown": "The transaction failed. Try again.",
    vVerdictPartialKicker: "The math adds up",
    vVerdictPartial: "The math is right, but there's no witness",
    vVerdictPartialDetail: "With this list and this number, the winner is the one shown. But this raffle was not recorded on Stellar, so nobody other than the organizer can confirm this was the original list. Anchoring it costs a few cents and closes that gap.",
    vFinish: "Finish the raffle",
    vFinishNoWallet: "Finishing it needs a wallet, or being on testnet.",
    vFinishDone: "Done! It is recorded on chain.",
    vCheckWitness: "A third party vouches for the list",
    vNoWitnessShort: "no, this raffle is not on chain",
    vChecks: "What was checked", vResult: "Who won", vList: "The sealed list",
    vHow: "Run it again with your own tools",
    vHowIntro: "You don't have to trust this page. These are the exact steps, with this raffle's values:",
    vProtocol: "The whole protocol ↗", vBack: "← Run a raffle with Tinkazo",
    vRound: "See the public round ↗", vContract: "See the contract ↗",
    vWorking: "Checking the raffle", vWorkingKicker: "One second",
    vVerdictOkKicker: "It all adds up", vVerdictBadKicker: "Something doesn't add up",
    vVerdictOk: "This raffle is legit",
    vVerdictOkDetail: "We ran the draw again from scratch right here and got the same name. The list was sealed before the number existed, so nobody could pick the result.",
    vVerdictOkChain: "This raffle is legit and it's on Stellar",
    vVerdictOkChainDetail: "We ran it again here and it matches what the contract recorded. That record stays there even if Tinkazo disappears, and anyone can read it.",
    vVerdictBad: "This raffle doesn't add up",
    vCannotFinish: "Couldn't finish checking",
    vNoProof: "This link carries no raffle",
    vNoProofDetail: "Ask whoever ran the raffle for the full link, including everything after the hash sign.",
    vCheckList: "The list and its fingerprint", vCheckRound: "The round signature",
    vCheckSeed: "The seed comes from the signature", vCheckWinner: "The recomputed winner",
    vCheckChain: "The record on Stellar",
    vNotDrawnYet: "not drawn on chain yet",
    vChainUnreachable: "couldn't read the contract",
    vRoundUnreachable: "couldn't fetch the beacon round",
    vListChanged: "The list in this link is not the one that was sealed. Someone changed it afterwards.",
    vBadSignature: "The round signature doesn't verify against the beacon's public key.",
    vMismatch: "The recomputed winner doesn't match the one on record.",
    shareProof: "Share proof", proofCopied: "Link copied!",
    connectWallet: "Connect wallet", disconnect: "Sign out", cancel: "Cancel", connecting: "Connecting…",
    connectTitle: "Who's running this?",
    connectLead: "Connect an account and the draw gets recorded on Stellar",
    freighterHint: "The browser wallet. You sign, nobody else.",
    freighterInstall: "You don't have it installed. Get it at freighter.app ↗",
    googleWallet: "Sign in with Google",
    googleHint: "Nothing to install. Pollar manages your Stellar account.",
    guestWallet: "Test account",
    guestHint: "The browser makes you a testnet account and funds it. Nothing to install.",
    guestReady: "Test account ready and funded on testnet.",
    guestTestnetOnly: "The test account only lives on testnet.",
    walletRejected: "You cancelled the connection in the wallet.",
    walletUnknown: "Couldn't connect the wallet. Try again.",
    friendbotFailed: "Couldn't fund the test account. Try again in a minute.",
    wrongNetwork: "Your wallet is on another network. Switch it to {red} to seal.",
    drandDown: "Can't reach drand. Check your connection.",
    cReady: ["Llamas on your marks!", "Llamas lining up!", "Quiet down, here we go!", "Eyes on the screen, people!"],
    cReadyStellar: ["Rockets on the launchpad!", "Engines lit!", "Countdown, people!", "Hold on, they're lifting off!"],
    cStart: ["AND THEY'RE OFF!", "HERE WE GO!", "THERE THEY GO!", "GO GO GO!"],
    cLast: ["FINAL STRETCH!", "LAST FEW METERS!", "IT'S DECIDED RIGHT HERE!", "NOBODY IS BREATHING!"],
    cLead: (n) => pick([`${n} takes the lead!`, `${n} is gone!`, `${n} out in front!`, `${n} pushes past everyone!`, `It's ${n} now!`]),
    cWin: (n) => pick([`${n} WINS!`, `${n} TAKES IT ALL!`, `AND IT'S ${n}, PEOPLE!`, `${n}, THAT'S THE TINKAZO!`]),
    summary: (w, n, d, r, u) =>
      `Tinkazo · verifiable raffle (protocol v2)\nWinner(s): ${w}\nEntries: ${n}\nlist_hash: ${d}\nquicknet round: ${r} → ${u}\nRun it again: docs/protocolo.md §5`,
  },
};

let current: Lang = "es";
const listeners: Array<(l: Lang) => void> = [];

export const getLang = (): Lang => current;

/** Cadena traducida. Si la clave tiene variantes, sortea una. */
export function t(key: string): string {
  const v = T[current][key];
  if (Array.isArray(v)) return pick(v);
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
  // Las claves con variantes se saltan: el markup nunca las usa.
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
