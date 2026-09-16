import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";

/** Una línea por participante; solo la primera columna de un CSV. */
export function parseNames(): string[] {
  return $<HTMLTextAreaElement>("ta")
    .value.split(/\r?\n/)
    .map((l) => (l.split(",")[0] ?? "").trim())
    .filter((l) => l.length > 1);
}

export function renderNames(): void {
  const names = parseNames();
  $("names").innerHTML = names
    .map((n) => `<i><img src="${avatar(n, 44)}" alt="" loading="lazy" />${esc(n)}</i>`)
    .join("");
  $<HTMLButtonElement>("btn-freeze").disabled = names.length < 2 || !!app.frozen;
}

export function loadSample(): void {
  $<HTMLTextAreaElement>("ta").value = SAMPLE.join("\n");
  renderNames();
}

export function bindParticipants(): void {
  $("ta").addEventListener("input", renderNames);
  $<HTMLInputElement>("csv").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
      $<HTMLTextAreaElement>("ta").value = await f.text();
      renderNames();
    }
  });
}
