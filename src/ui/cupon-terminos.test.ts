import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { T } from "../i18n";

it("los términos describen la llegada, el canje aceptado y el paso a Prueba sin cambiar la privacidad del conteo", () => {
  const disclosures = {
    es: [
      "llegar con un cupón",
      "si el cupón llegó en Oficial o dentro de una app",
      "abrirlo, que se acepte el canje de un cupón, activar la cuenta, protegerla, dejarla lista y pasar a Prueba",
      "con unos pocos datos de una lista cerrada",
      "Nunca nombres, la lista, tu cuenta ni la hora: se guarda solo el total de cada día, y esos totales son públicos.",
      "Esto también pasa por Cloudflare, y la dirección IP solo sirve para el mismo tope por hora, sin guardarse.",
      "Si tu navegador pide que no te sigan, tampoco lo contamos.",
    ],
    en: [
      "arriving with a coupon",
      "whether the coupon arrived in Live mode or inside an app",
      "opening it, having a coupon redemption accepted, activating the account, protecting it, getting it ready and switching to Test",
      "with a few details from a closed list",
      "Never names, the list, your account or the time: only each day's total is kept, and those totals are public.",
      "This also goes through Cloudflare, and the IP address is only used for the same hourly cap, without being stored.",
      "If your browser asks not to be tracked, we don't count this either.",
    ],
  };
  for (const language of ["es", "en"] as const) {
    for (const disclosure of disclosures[language]) {
      expect.soft(T[language].tmMore2, `${language}: ${disclosure}`).toContain(disclosure);
    }
  }
  const html = readFileSync(new URL("../../terminos.html", import.meta.url), "utf8");
  const fallback = /<li data-i="tmMore2">([^<]*)<\/li>/u.exec(html)?.[1];
  expect(fallback, "el respaldo público coincide con el diccionario en español").toBe(T.es.tmMore2);
});
