import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { canonicalList } from "../protocol/canonical";

/** Lista canónica a partir del textarea (protocolo §1). */
export function parseNames(): string[] {
  return canonicalList($<HTMLTextAreaElement>("ta").value);
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
