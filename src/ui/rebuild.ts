import { esc } from "../dom";
import { t } from "../i18n";
import { canonicalList, listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/drand";
import { PROOF_VERSION, proofUrl } from "../protocol/proof";
import { network } from "../stellar/config";
import type { Entry } from "./history";

/**
 * Rearmar el comprobante de un sorteo que este equipo no conoce.
 *
 * El historial trae de la cadena los sorteos que la cuenta ancló en otro
 * equipo, pero ahí no hay comprobante: los nombres nunca suben a la cadena,
 * solo su huella. Si la organizadora todavía tiene la lista, con pegarla
 * alcanza para volver a armarlo, porque el comprobante es la lista más lo que
 * ya está en el contrato.
 *
 * Y la huella hace de prueba: si la lista pegada no es la que se selló, no
 * coincide y no se arma nada. No se puede rearmar el comprobante de otro
 * sorteo ni con una lista parecida.
 */

export type Rearmado =
  | { ok: true; url: string }
  | { ok: false; motivo: "cantidad"; cuantos: number }
  | { ok: false; motivo: "huella" };

export async function rearmar(entry: Entry, texto: string, base?: string): Promise<Rearmado> {
  const names = canonicalList(texto);
  if (names.length !== entry.count) {
    return { ok: false, motivo: "cantidad", cuantos: names.length };
  }
  if (bytesToHex(listHash(names)) !== entry.listHash) {
    return { ok: false, motivo: "huella" };
  }
  const proof = {
    v: PROOF_VERSION,
    names,
    round: entry.round,
    prize: entry.prize,
    sealedAt: entry.sealedAt,
    ...(network.contractId && entry.id
      ? { net: network.name, contract: network.contractId, id: entry.id }
      : {}),
  };
  const url = base ? await proofUrl(proof, base) : await proofUrl(proof);
  return { ok: true, url };
}

/** El texto del error, para no repetir la traducción en la pantalla. */
export function motivoTexto(r: Rearmado, esperados: number): string {
  if (r.ok) return "";
  return r.motivo === "cantidad"
    ? t("histRebuildCount").replace("{n}", String(r.cuantos)).replace("{m}", String(esperados))
    : t("histRebuildBad");
}

/* ----------------------------------------------------------------- pantalla */

export function abrirRearmado(entry: Entry): void {
  const back = document.createElement("div");
  back.className = "modal-back";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.innerHTML =
    `<h3>${esc(t("histRebuildTitle"))}</h3>` +
    `<p class="note">${esc(t("histRebuildNote"))}</p>` +
    `<p class="note"><b>#${esc(entry.id ?? "")}</b> · ${entry.count} ${esc(t("histPeople"))}` +
    `${entry.prize ? ` · ${esc(entry.prize)}` : ""}</p>` +
    `<textarea class="rearmar-ta" rows="7" spellcheck="false"></textarea>` +
    `<p class="rearmar-out note"></p>` +
    `<div class="row"></div>`;
  const ta = card.querySelector<HTMLTextAreaElement>(".rearmar-ta")!;
  const salida = card.querySelector<HTMLParagraphElement>(".rearmar-out")!;
  const fila = card.querySelector<HTMLDivElement>(".row")!;

  const cerrar = (): void => {
    document.removeEventListener("keydown", alTeclado, true);
    back.remove();
  };
  const alTeclado = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };

  const boton = document.createElement("button");
  boton.className = "mini solid";
  boton.textContent = t("histRebuildGo");
  boton.addEventListener("click", () => {
    void (async () => {
      boton.disabled = true;
      const r = await rearmar(entry, ta.value);
      boton.disabled = false;
      if (!r.ok) {
        salida.innerHTML = `<b>${esc(motivoTexto(r, entry.count))}</b>`;
        return;
      }
      salida.innerHTML =
        `${esc(t("histRebuildOk"))} <a href="${esc(r.url)}" target="_blank" rel="noopener">` +
        `${esc(t("histProof"))} ↗</a>`;
    })();
  });
  const cancelar = document.createElement("button");
  cancelar.className = "mini";
  cancelar.textContent = t("cancel");
  cancelar.addEventListener("click", cerrar);
  fila.append(boton, cancelar);

  back.appendChild(card);
  back.addEventListener("click", (e) => {
    if (e.target === back) cerrar();
  });
  document.addEventListener("keydown", alTeclado, true);
  document.body.appendChild(back);
  ta.focus();
}
