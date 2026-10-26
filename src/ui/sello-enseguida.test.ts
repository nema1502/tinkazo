import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Al apretar "Sellar en Stellar", el botón dice algo enseguida.
 *
 * Medido el 21 de octubre de 2026 en la testnet con la cuenta de prueba: entre
 * el clic y "Armando la transacción…" el botón quedaba apagado y diciendo todavía
 * "Sellar en Stellar" de 0,6 a 14 s. Era el cliente del contrato, que baja la
 * interfaz del contrato de la red (anchor.ts, `clienteListo`). Desde ese día el
 * botón dice "Preparando el sello…" apenas se aprieta, y el cliente se arma de
 * antemano, al abrir la sesión (`precalentarSello`).
 */
const h = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../stellar/contract", async (orig) => {
  const real = await orig<typeof import("../stellar/contract")>();
  return { ...real, getClient: () => h.getClient() };
});

/** Una promesa que se resuelve o se rechaza a mano. */
function aMano<T>(): { p: Promise<T>; dar: (v: T) => void; fallar: (e: unknown) => void } {
  let dar!: (v: T) => void;
  let fallar!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    dar = a;
    fallar = b;
  });
  return { p, dar, fallar };
}

/** Si la promesa ya terminó, sin esperarla. */
async function termino(p: Promise<unknown>): Promise<boolean> {
  let listo = false;
  void p.then(() => (listo = true));
  await new Promise((r) => setTimeout(r, 20));
  return listo;
}

beforeEach(() => {
  vi.resetModules();
  h.getClient.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el primer paso del sello", () => {
  it("dice que se está preparando, en los dos idiomas", async () => {
    const { stepLabel } = await import("./anchor");
    expect(stepLabel("starting")).toBe("Preparando el sello…");
    expect(T.es.txStarting).toBe("Preparando el sello…");
    expect(T.en.txStarting).toBe("Getting the seal ready…");
  });

  it("se ve en la línea de estado como algo que todavía va, y saca el error de antes", async () => {
    const host = { style: { display: "none" }, className: "txstatus bad", textContent: "No pude conectarme…" };
    const quitados: string[] = [];
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id.endsWith("-detalle") ? { remove: () => quitados.push(id) } : host),
    });
    const { showTxStatus } = await import("./anchor");
    showTxStatus("seal-status", "starting");
    expect(host.textContent).toBe("Preparando el sello…");
    expect(host.className).toBe("txstatus");
    expect(host.style.display).toBe("block");
    expect(quitados).toEqual(["seal-status-detalle"]);
  });
});

describe("el cliente del contrato antes de elegir la ronda", () => {
  it("clienteListo espera al cliente que se está armando", async () => {
    const c = aMano<object>();
    h.getClient.mockReturnValue(c.p);
    const { clienteListo } = await import("./anchor");
    const listo = clienteListo();
    expect(await termino(listo)).toBe(false);
    c.dar({});
    await expect(listo).resolves.toBeUndefined();
  });

  it("si armarlo falla, no tira: lo vuelve a pedir el sello y cuenta su error como siempre", async () => {
    // El rechazo se arma al pedirlo: armado antes, quedaba sin atender mientras se bajaba `anchor` y Node lo contaba como no manejado.
    h.getClient.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const { clienteListo } = await import("./anchor");
    await expect(clienteListo()).resolves.toBeUndefined();
  });

  it("si no contesta, no espera más que el tope", async () => {
    h.getClient.mockReturnValue(new Promise(() => undefined));
    const { clienteListo } = await import("./anchor");
    const t0 = Date.now();
    await expect(clienteListo(60)).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("el tope es el de contract.ts: pasado ese tiempo, el sello pide un cliente nuevo", async () => {
    const { CLIENTE_VIEJO_MS } = await import("../stellar/contract");
    const fuente = (await import("node:fs")).readFileSync("src/ui/anchor.ts", "utf8");
    expect(fuente).toMatch(new RegExp(`const ESPERA_DEL_CLIENTE_MS = ${CLIENTE_VIEJO_MS.toLocaleString("en-US").replace(",", "_")};`));
  });

  it("precalentarSello lo arma de antemano, una vez", async () => {
    h.getClient.mockResolvedValue({});
    const { precalentarSello } = await import("./anchor");
    precalentarSello();
    await new Promise((r) => setTimeout(r, 50));
    expect(h.getClient).toHaveBeenCalledTimes(1);
  });
});

describe("el sello no espera la red para decir algo", () => {
  // freeze.ts no se puede montar sin la página: se mira el orden en su fuente.
  const fuente = async (): Promise<string> => (await import("node:fs")).readFileSync("src/ui/freeze.ts", "utf8");

  it("dice el primer paso antes de cualquier espera", async () => {
    const f = await fuente();
    const primero = f.indexOf('onStep("starting")');
    const espera = f.indexOf("await Promise.all([import(\"./sello-seguro\")");
    expect(primero).toBeGreaterThan(0);
    expect(espera).toBeGreaterThan(primero);
  });

  it("con un intento pendiente, primero averigua si entró: no espera al cliente", async () => {
    expect(await fuente()).toMatch(/if \(!previo\) await clienteListo\(\);/);
  });
});
