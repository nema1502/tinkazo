import "./styles.css";
import { $, esc } from "./dom";
import { setLang, t } from "./i18n";
import { avatar } from "./state";
import { canonicalList, listHash } from "./protocol/canonical";
import {
  QUICKNET,
  bytesToHex,
  fetchRound,
  hexToBytes,
  randomnessOf,
  roundTime,
  roundUrl,
  verifyRound,
} from "./protocol/drand";
import { select } from "./protocol/select";
import { decodeProof, isAnchored, type Proof } from "./protocol/proof";

/**
 * Página de verificación.
 *
 * Solo lectura y sin wallet. Toma el comprobante del fragmento de la URL,
 * rehace el sorteo desde cero y compara. Si el sorteo está anclado, lee el
 * registro del contrato y comprueba que coincida con lo recomputado.
 *
 * Todo pasa en el navegador de quien abre el enlace. Los nombres no viajan a
 * ningún servidor: el fragmento de una URL no se envía.
 */

type State = "ok" | "bad" | "pending" | "working";

interface Check {
  key: string;
  state: State;
  detail?: string;
}

const checks: Check[] = [];

function paint(): void {
  $("checks").innerHTML = checks
    .map(
      (c) =>
        `<li class="check ${c.state}"><b>${esc(t(c.key))}</b>${
          c.detail ? `<span class="mono">${esc(c.detail)}</span>` : ""
        }</li>`,
    )
    .join("");
}

function set(key: string, state: State, detail?: string): void {
  const found = checks.find((c) => c.key === key);
  if (found) {
    found.state = state;
    if (detail !== undefined) found.detail = detail;
  } else {
    checks.push({ key, state, ...(detail !== undefined ? { detail } : {}) });
  }
  paint();
}

/**
 * Tres veredictos, no dos.
 *
 * `ok` solo cuando algo externo atestigua la lista: el contrato guarda su
 * huella, así que cambiar un nombre se detecta. En modo libre el comprobante
 * trae la lista y la firma juntas, de modo que recomputar siempre cierra: lo
 * honesto es decir que la cuenta está bien pero que nadie atestigua que esa
 * fuera la lista original. Eso es `partial`, y es justo lo que compra anclar.
 */
function verdict(state: "ok" | "partial" | "bad" | "working", titleKey: string, detail: string): void {
  const box = $("verdict");
  box.className = `verdict ${state}`;
  $("verdict-kicker").textContent = t(
    state === "ok"
      ? "vVerdictOkKicker"
      : state === "partial"
        ? "vVerdictPartialKicker"
        : state === "bad"
          ? "vVerdictBadKicker"
          : "vWorkingKicker",
  );
  $("verdict-title").textContent = t(titleKey);
  $("verdict-detail").textContent = detail;
}

function fail(messageKey: string, detail = ""): void {
  verdict("bad", messageKey, detail);
}

async function main(): Promise<void> {
  setLang(location.search.includes("lang=en") || navigator.language.startsWith("en") ? "en" : "es");
  $("l-es").addEventListener("click", () => {
    setLang("es");
    paint();
  });
  $("l-en").addEventListener("click", () => {
    setLang("en");
    paint();
  });

  let proof: Proof;
  try {
    proof = await decodeProof(location.hash);
  } catch {
    fail("vNoProof", t("vNoProofDetail"));
    return;
  }

  verdict("working", "vWorking", "");
  renderList(proof);

  // ---------------------------------------------------- 1. la lista y su huella
  set("vCheckList", "working");
  const names = canonicalList(proof.names.join("\n"));
  const hash = bytesToHex(listHash(names));
  const sameList = names.length === proof.names.length;
  set("vCheckList", sameList ? "ok" : "bad", `${names.length} · ${hash.slice(0, 16)}…`);
  $("v-hash").textContent = `list_hash = ${hash}`;

  // ------------------------------------------------- 2. la ronda y su firma
  set("vCheckRound", "working");
  let signature = proof.signature ?? null;
  let onChain: { winners: number[]; randomness: string; listHash: string; count: number } | null = null;

  if (isAnchored(proof)) {
    set("vCheckChain", "working");
    try {
      onChain = await readFromChain(proof);
      if (!onChain) {
        set("vCheckChain", "pending", t("vNotDrawnYet"));
      } else {
        set("vCheckChain", "ok", `#${proof.id} · ${proof.net}`);
      }
    } catch {
      set("vCheckChain", "bad", t("vChainUnreachable"));
    }
  }

  if (!signature) {
    try {
      signature = (await fetchRound(proof.round, { attempts: 6, delayMs: 1500 })).signature;
    } catch {
      set("vCheckRound", "bad", t("vRoundUnreachable"));
      fail("vCannotFinish", t("vRoundUnreachable"));
      return;
    }
  }

  const sigOk = verifyRound(proof.round, signature);
  set("vCheckRound", sigOk ? "ok" : "bad", `${proof.round} · ${signature.slice(0, 16)}…`);

  // ------------------------------------------------------------ 3. la semilla
  const randomness = bytesToHex(randomnessOf(signature));
  set("vCheckSeed", "ok", randomness.slice(0, 24) + "…");

  // --------------------------------------------- 4. el ganador, recomputado
  const k = onChain ? onChain.winners.length : 1;
  const winners = select(hexToBytes(randomness), hexToBytes(hash), names.length, Math.min(k, names.length));
  const matches = onChain ? JSON.stringify(winners) === JSON.stringify(onChain.winners) : true;
  const hashMatches = onChain ? onChain.listHash === hash : true;
  set("vCheckWinner", matches && hashMatches ? "ok" : "bad", winners.map((i) => names[i]).join(", "));

  renderResult(proof, names, winners, signature, randomness, !!onChain);
  renderSteps(proof, hash, randomness, names.length, winners);

  const allOk = sameList && sigOk && matches && hashMatches;
  if (!allOk) {
    fail("vVerdictBad", t(!hashMatches ? "vListChanged" : !sigOk ? "vBadSignature" : "vMismatch"));
    return;
  }
  if (onChain) {
    verdict("ok", "vVerdictOkChain", t("vVerdictOkChainDetail"));
  } else {
    // Sin registro externo, la cuenta cierra pero la lista no está atestiguada.
    set("vCheckWitness", "pending", t("vNoWitnessShort"));
    verdict("partial", "vVerdictPartial", t("vVerdictPartialDetail"));
  }
}

/** Lee el sello y el registro del contrato. Carga el SDK solo si hace falta. */
async function readFromChain(
  proof: Proof,
): Promise<{ winners: number[]; randomness: string; listHash: string; count: number } | null> {
  const { contract, rpc } = await import("@stellar/stellar-sdk");
  const passphrase =
    proof.net === "mainnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015";
  const rpcUrl =
    proof.net === "mainnet" ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org";
  void rpc;
  const client = await contract.Client.from({
    contractId: proof.contract as string,
    networkPassphrase: passphrase,
    rpcUrl,
  });
  const id = BigInt(proof.id as string);
  const raffle = (await (client as never as { get_raffle(a: { raffle_id: bigint }): Promise<{ result: unknown }> }).get_raffle({ raffle_id: id })).result as
    | { list_hash: Uint8Array; count: number }
    | undefined;
  if (!raffle) throw new Error("raffle-not-found");
  const draw = (await (client as never as { get_draw(a: { raffle_id: bigint }): Promise<{ result: unknown }> }).get_draw({ raffle_id: id })).result as
    | { winners: number[]; randomness: Uint8Array }
    | undefined;
  if (!draw) return null;
  return {
    winners: [...draw.winners],
    randomness: bytesToHex(new Uint8Array(draw.randomness)),
    listHash: bytesToHex(new Uint8Array(raffle.list_hash)),
    count: raffle.count,
  };
}

function renderList(proof: Proof): void {
  $("v-count").textContent = `${proof.names.length} ${t("kEntries")}`;
  $("v-names").innerHTML = proof.names
    .map((n) => `<i><img src="${avatar(n, 44)}" alt="" loading="lazy" />${esc(n)}</i>`)
    .join("");
  $("v-net").textContent = isAnchored(proof) ? `${proof.net} · #${proof.id}` : t("noAnchor");
}

function renderResult(
  proof: Proof,
  names: string[],
  winners: number[],
  signature: string,
  randomness: string,
  fromChain: boolean,
): void {
  $("sec-result").style.display = "block";
  $("v-round").textContent = `${t("seed")} ${proof.round}`;
  $("v-winners").innerHTML = winners
    .map((i) => {
      const name = names[i] ?? "";
      return `<div class="winner-card">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name">${esc(name)}</p>
          ${proof.prize ? `<p class="winner-prize">${esc(t("winsPrize"))} ${esc(proof.prize)}</p>` : ""}
        </div>
      </div>`;
    })
    .join(" ");
  $("v-proof").textContent =
    `round=${proof.round} · signature=${signature.slice(0, 20)}… · randomness=${randomness.slice(0, 20)}… · winners=[${winners.join(",")}]${fromChain ? " · on-chain ✓" : ""}`;
  $<HTMLAnchorElement>("v-drand").href = roundUrl(proof.round);
  if (isAnchored(proof)) {
    const a = $<HTMLAnchorElement>("v-contract");
    a.style.display = "inline-block";
    a.href = `https://stellar.expert/explorer/${proof.net === "mainnet" ? "public" : "testnet"}/contract/${proof.contract}`;
  }
}

/** Los pasos con los valores concretos, para rehacerlo con otras herramientas. */
function renderSteps(
  proof: Proof,
  hash: string,
  randomness: string,
  count: number,
  winners: number[],
): void {
  $("v-steps").textContent = [
    `# 1. la huella de la lista (los nombres unidos por saltos de línea)`,
    `printf '%s' "$(cat lista.txt)" | sha256sum`,
    `  → ${hash}`,
    ``,
    `# 2. la firma de la ronda, del faro público`,
    `curl ${QUICKNET.relays[0]}/v2/chains/${QUICKNET.chainHash}/rounds/${proof.round}`,
    `  publicada el ${new Date(roundTime(proof.round) * 1000).toISOString()}`,
    ``,
    `# 3. la semilla sale de la firma`,
    `randomness = sha256(firma)`,
    `  → ${randomness}`,
    ``,
    `# 4. el ganador, con contador desde 0 y salteando repetidos`,
    `idx = be64(sha256(randomness ‖ list_hash ‖ be32(contador))[0..8]) mod ${count}`,
    `  → [${winners.join(", ")}]`,
  ].join("\n");
}

void main();
