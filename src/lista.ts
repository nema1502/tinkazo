import "./pagina";
import { $, esc } from "./dom";
import { onLangChange, texto as t } from "./idioma";
import { GRUPOS, grupoDe } from "./games/grupos";
import { canonicalList, listHash } from "./protocol/canonical";
import { bytesToHex } from "./protocol/quicknet";
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

/**
 * La cabina de cada uno en el teleférico: su grupo automático y el color de su
 * línea (sección 7.7 del plan de juegos). Sale del orden de la lista, así que
 * no cambia el sello.
 */
/** Los nombres de las diez líneas. Las claves van entre comillas para que el build las lleve a esta página. */
const LINEAS = ["teleLinea0", "teleLinea1", "teleLinea2", "teleLinea3", "teleLinea4", "teleLinea5", "teleLinea6", "teleLinea7", "teleLinea8", "teleLinea9"];

function cabinaDe(i: number): string {
  const g = grupoDe(i, names.length);
  return t("listaCabina").replace("{g}", GRUPOS[g]?.nombre ?? "").replace("{l}", t(LINEAS[g] ?? "teleLinea0"));
}

function pintar(): void {
  const rep = repetidos(names);
  const hash = bytesToHex(listHash(names));
  $("l-count").textContent = t("salaN").replace("{n}", String(names.length));
  $("l-huella").textContent = hash.slice(0, 12) + "…";
  $("l-lista").innerHTML = names
    .map((n, i) => `<li data-p="${i + 1}"${rep.has(i) ? ' class="rep"' : ""}>${esc(n)}${rep.has(i) ? ` <em>${esc(t("salaRep"))}</em>` : ""}<small class="cabina" style="display:block;opacity:.75">${esc(cabinaDe(i))}</small></li>`)
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

/**
 * Desde la lista ya sellada (`?sellada=1`, lo agrega "Mostrar la lista a la
 * sala" durante la espera): es la misma lista, pero "antes de sellar" ya no es
 * cierto. Cada uno se busca igual; lo que cambia es que ya no se puede arreglar.
 */
function sellada(): void {
  if (new URLSearchParams(location.search).get("sellada") !== "1") return;
  for (const [sel, clave] of [[".hero .sticker", "salaTSellada"], [".hero .lead", "listaNotaSellada"]] as const) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    el.dataset.i = clave;
    el.textContent = t(clave);
  }
}

async function main(): Promise<void> {
  sellada();
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
