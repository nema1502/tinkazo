import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const EVENTO = "https://gdg.community.dev/events/details/google-gdg-tarija-presents-devfest-tarija-2026/";

describe("el DevFest Tarija en la página de marca", () => {
  it("el mensaje para WhatsApp dice fecha, lugar y el enlace para reservar, en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) {
      const m = String(T[l].maDfWaMsg);
      expect(m, l).toContain(EVENTO);
      expect(m, l).toContain("UPDS");
      expect(m, l).toMatch(/28/);
      expect(m, l).not.toContain("·");
    }
  });

  it("el botón de WhatsApp funciona sin JavaScript, con el mensaje en español ya escrito", () => {
    const html = readFileSync("marca.html", "utf8");
    const href = html.match(/id="df-wa" href="([^"]+)"/)?.[1] ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(String(T.es.maDfWaMsg));
  });
});
