import "./pagina";
import { $, esc } from "./dom";
import { onLangChange, t } from "./i18n";
import { canonicalList, listHash } from "./protocol/canonical";
import { bytesToHex } from "./protocol/drand";
import { decodePreview } from "./protocol/proof";
import { buscar, repetidos, vecesExacto } from "./buscar";

/**
 * La lista para revisar antes de sellar, en el celular de cada participante.
 *
 * Llega desde el QR que el proyector muestra con "Mostrar la lista a la sala".
 * La lista viaja en el fragmento del enlace, así que no pasa por ningún
 * servidor. Cada uno se busca: si falta o está dos veces, lo dice antes del
 * sello, que es cuando todavía se puede arreglar.
 */
let names: string[] = [];

function pintar(): void {
  const rep = repetidos(names);
  const hash = bytesToHex(listHash(names));
  $("l-count").textContent = t("salaN").replace("{n}", String(names.length));
  $("l-huella").textContent = hash.slice(0, 12) + "…";
  $("l-lista").innerHTML = names
    .map((n, i) => `<li data-p="${i + 1}"${rep.has(i) ? ' class="rep"' : ""}>${esc(n)}${rep.has(i) ? ` <em>${esc(t("salaRep"))}</em>` : ""}</li>`)
    .join("");
  buscarAhora();
}

function buscarAhora(): void {
  const q = $<HTMLInputElement>("l-buscar").value;
  const out = $("l-buscar-out");
  const puestos = buscar(names, q);
  document.querySelectorAll("#l-lista li.match").forEach((li) => li.classList.remove("match"));
  if (!q.trim()) {
    out.textContent = "";
    return;
  }
  for (const p of puestos) document.querySelector(`#l-lista li[data-p="${p}"]`)?.classList.add("match");
  if (puestos.length === 0) {
    out.textContent = t("buscateNada");
    return;
  }
  let texto =
    puestos.length === 1
      ? t("buscateUno").replace("{p}", String(puestos[0])).replace("{n}", String(names.length))
      : t("buscateVarios").replace("{k}", String(puestos.length)).replace("{p}", puestos.slice(0, 12).join(", "));
  const exacto = vecesExacto(names, q);
  if (exacto > 1) texto += t("buscateDos").replace("{k}", String(exacto));
  out.textContent = texto;
  document.querySelector(`#l-lista li[data-p="${puestos[0]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function main(): Promise<void> {
  try {
    const p = await decodePreview(location.hash);
    names = canonicalList(p.names.join("\n"));
    if (p.prize) {
      $("l-premio").textContent = p.prize;
      $("l-premio-row").style.display = "block";
    }
    $("l-ok").style.display = "block";
    pintar();
    $<HTMLInputElement>("l-buscar").addEventListener("input", buscarAhora);
    onLangChange(pintar);
  } catch {
    $("l-error").style.display = "block";
  }
}

void main();
