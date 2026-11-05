import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { crearRespuestas } from "./respuestas-confianza";
import { SERVICIO_CONFIANZA } from "./confianza-activacion";
import { CONTADOR } from "./contar";
import deployments from "./stellar/deployments.json";
const ref = { net: "testnet", contract: deployments.testnet.contractId, id: "278" } as const;
const url = "https://simulado.example/v1/contar";
let fetcher = vi.fn();
beforeEach(() => {
  fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "" });
  vi.stubGlobal("navigator", { doNotTrack: null });
  vi.stubGlobal("document", { prerendering: false });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it("el servicio de respuestas sigue apagado y no depende del contador del embudo", () => {
  // El contador se prende aparte (src/contar.ts); este servicio no se prende con él.
  expect(typeof CONTADOR).toBe("string"); expect(SERVICIO_CONFIANZA).toBe("");
  expect(crearRespuestas().disponible(ref)).toBe(false);
});
it.each(["yes", "no", "unsure"] as const)("solo transmite la respuesta %s y la referencia, con CORS legible", async (answer) => {
  const sender = crearRespuestas(url);
  expect(await sender.enviar(ref, answer)).toBe("recibida");
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, {
    method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ e: "proof_trust", p: { answer }, ref }),
  });
  expect(await sender.enviar(ref, answer)).toBe("recibida");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bloquea doble clic mientras espera y recuerda la confirmación en este navegador", async () => {
  let resolve!: (x: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
  const sender = crearRespuestas(url);
  const first = sender.enviar(ref, "yes");
  expect(await sender.enviar(ref, "no")).toBe("pendiente");
  resolve(new Response(null, { status: 204 }));
  expect(await first).toBe("recibida");
  const mark = vi.mocked(localStorage.setItem).mock.calls[0]!;
  vi.stubGlobal("localStorage", { getItem: () => mark[1], setItem: vi.fn() });
  expect(crearRespuestas(url).confirmada(ref)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([200, 429, 500, "perdida"])("no confirma %s ni reintenta automáticamente", async (status) => {
  if (typeof status === "number") fetcher.mockResolvedValue(new Response(null, { status }));
  else fetcher.mockRejectedValue(new Error("red"));
  const sender = crearRespuestas(url);
  expect(await sender.enviar(ref, "no")).toBe("incierta");
  expect(sender.confirmada(ref)).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await sender.enviar(ref, "no")).toBe("recibida");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("con almacenamiento inaccesible conserva la confirmación en memoria", async () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  const sender = crearRespuestas(url);
  expect(await sender.enviar(ref, "unsure")).toBe("recibida");
  expect(await sender.enviar(ref, "yes")).toBe("recibida");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("respeta privacidad, práctica, demo, host, prerender y referencia", async () => {
  const sender = crearRespuestas(url);
  for (const nav of [{ doNotTrack: "1" }, { globalPrivacyControl: true }, { webdriver: true }]) {
    vi.stubGlobal("navigator", nav);
    expect(await sender.enviar(ref, "yes")).toBe("bloqueada");
  }
  vi.stubGlobal("navigator", {});
  for (const hostname of ["localhost", "www.tinkazo.app", "preview.vercel.app"]) {
    vi.stubGlobal("location", { hostname, search: "" });
    expect(await sender.enviar(ref, "yes")).toBe("bloqueada");
  }
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "?demo=wheel" });
  expect(await sender.enviar(ref, "yes")).toBe("bloqueada");
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "" });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => k === "tinkazo.ensayo" ? "1" : null });
  expect(await sender.enviar(ref, "yes")).toBe("bloqueada");
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("document", { prerendering: true });
  expect(await sender.enviar(ref, "yes")).toBe("bloqueada");
  vi.stubGlobal("document", {});
  expect(await sender.enviar({ ...ref, id: "0" }, "yes")).toBe("bloqueada");
  expect(await crearRespuestas().enviar(ref, "yes")).toBe("bloqueada");
  expect(fetcher).not.toHaveBeenCalled();
});
