// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "../stellar/pollar-falso";

/**
 * El paso «Dejá tu cuenta lista» con la billetera de verdad y un kit simulado que hace lo mismo que `@pollar/core`
 * 0.12.0: cada vez que lee los pedidos pendientes, vuelve a avisar la co-firma a todos los oyentes, aunque nada haya
 * cambiado (`_noteCosignRequest`). Como el paso vuelve a leer con cada aviso, eso era un bucle de lecturas a Pollar
 * mientras la cuenta nueva esperaba en «Activar mi cuenta»: unas tres por segundo, sin fin, y con cada una se repintaba
 * todo. El sábado eran unos 16 celulares detrás del mismo wifi.
 */

const h = await vi.hoisted(async () => (await import("../stellar/pollar-falso")).estadoPollarFalso());

vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("../stellar/pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet } = await import("../stellar/wallet-pollar");
const { abrirCuentaLista, aceptarClicsDePrueba, cuentaListaAbierta } = await import("./cuenta-lista");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const pedidoDeCrear = { id: "pedido-1", kind: "TX", network: "STELLAR", status: "PENDING", intent: "account_create", operation: "create_account", account: P, signWith: P, activityId: "act-1" };

const salidas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() });

beforeEach(async () => {
  aceptarClicsDePrueba(true);
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  document.body.innerHTML = `<main id="pagina"><button id="btn-freeze">Sellar la lista</button></main>`;
  h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
  pollarWallet.address = P;
  h.impl.pending = async () => [{ ...pedidoDeCrear }];
  h.impl.publicKeyHex = async () => "02aa11";
  h.impl["recovery.status"] = async () => ({ required: true, configured: false, subOrgId: "s", email: { address: null, verified: false }, passkeys: [], devices: [{ apiKeyId: "k0", name: "n", publicKey: "02aa11", createdAt: "" }] });
  // El cliente se arma con el reloj de verdad (bajar el kit no es un temporizador); después, el reloj falso.
  await pollarWallet.estadoOficial(false);
  h.llamadas = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  document.querySelector<HTMLButtonElement>('[data-salida="cerrar-sesion"]')?.dispatchEvent(new MouseEvent("click"));
  await vi.advanceTimersByTimeAsync(10);
  expect(cuentaListaAbierta()).toBe(false);
  aceptarClicsDePrueba(false);
  vi.useRealTimers();
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("el paso no golpea a Pollar mientras la activación espera", () => {
  it("con el pedido de crear la cuenta pendiente, en 5 segundos lee los pendientes dos veces como mucho", async () => {
    void abrirCuentaLista(pollarWallet, salidas(), { para: "entrada", celular: false, inicial: { activacion: "falta" } });
    expect(cuentaListaAbierta()).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    const pendientes = h.llamadas.filter((n) => n === "pending").length;
    expect(pendientes).toBeGreaterThanOrEqual(1);
    expect(pendientes).toBeLessThanOrEqual(2);
    // Y sigue esperando el toque: leer nunca vota.
    expect(h.llamadas.filter((n) => ["approve", "relay", "refresh"].includes(n))).toEqual([]);
  });

  it("un cambio de verdad en los pedidos (otra pestaña lo aprobó) sí se vuelve a leer", async () => {
    void abrirCuentaLista(pollarWallet, salidas(), { para: "entrada", celular: false, inicial: { activacion: "falta" } });
    await vi.advanceTimersByTimeAsync(2_000);
    const antes = h.llamadas.filter((n) => n === "pending").length;
    h.impl.pending = async () => [];
    for (const cb of [...h.oyentes.cofirma]) cb({ pending: [], lastResolved: { ...pedidoDeCrear, status: "APPROVED" } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.llamadas.filter((n) => n === "pending").length).toBe(antes + 1);
  });
});
