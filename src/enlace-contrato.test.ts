// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deployments from "./stellar/deployments.json";
import { enlazarContrato } from "./enlace-contrato";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");

/** Una entrada de mainnet inventada, con la forma de la real. La dirección son 32 bytes en cero: nunca un contrato real. */
const ENTRADA_SIMULADA = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  deployedAt: "2026-01-01",
  wasmSha256: "0".repeat(64),
  maxWinners: 300,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  anteriores: [],
};

const HREF_PRUEBA = `https://stellar.expert/explorer/testnet/contract/${deployments.testnet.contractId}`;

describe("el enlace al contrato de Cómo funciona sigue el modo de la pestaña", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.doUnmock("./stellar/deployments.json");
    vi.resetModules();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("como-funciona.html marca un solo enlace, y su href de respaldo es el contrato de la red de prueba", () => {
    const doc = new DOMParser().parseFromString(leer("como-funciona.html"), "text/html");
    const enlaces = doc.querySelectorAll<HTMLAnchorElement>("a[data-contrato]");
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]?.getAttribute("href")).toBe(HREF_PRUEBA);
  });

  it("con la lista de hoy y sin ?red=, el enlace queda igual al del HTML", async () => {
    const { contractUrl, network } = await import("./stellar/config");
    expect(network.contractId).toBe(deployments.testnet.contractId);
    expect(contractUrl()).toBe(HREF_PRUEBA);
    document.body.innerHTML = `<a data-contrato href="${HREF_PRUEBA}">contrato</a>`;
    expect(enlazarContrato(document, contractUrl())).toBe(1);
    expect(document.querySelector("a")?.getAttribute("href")).toBe(HREF_PRUEBA);
  });

  it("con contrato en la red principal (simulado) y Oficial guardado en la pestaña, el enlace va al contrato de la red principal", async () => {
    sessionStorage.setItem("tinkazo.red", "oficial");
    vi.stubGlobal("location", { href: "/como-funciona.html", hostname: "localhost", search: "", pathname: "/como-funciona.html" });
    vi.resetModules();
    vi.doMock("./stellar/deployments.json", () => ({ default: { ...deployments, mainnet: ENTRADA_SIMULADA } }));
    const config = await import("./stellar/config");
    expect(config.network.name).toBe("mainnet");
    const url = config.contractUrl();
    expect(url).toBe(`https://stellar.expert/explorer/public/contract/${ENTRADA_SIMULADA.contractId}`);
    document.body.innerHTML = `<p><a data-contrato href="${HREF_PRUEBA}">contrato</a><a href="${HREF_PRUEBA}">otro</a></p>`;
    expect(enlazarContrato(document, url)).toBe(1);
    const [marcado, otro] = Array.from(document.querySelectorAll("a"));
    expect(marcado?.getAttribute("href")).toBe(url);
    expect(otro?.getAttribute("href")).toBe(HREF_PRUEBA);
  });

  it("sin dirección no toca nada", () => {
    document.body.innerHTML = `<a data-contrato href="${HREF_PRUEBA}">contrato</a>`;
    expect(enlazarContrato(document, null)).toBe(0);
    expect(document.querySelector("a")?.getAttribute("href")).toBe(HREF_PRUEBA);
  });

  it("pagina.ts lo importa y lo llama al cargar, con el enlace del modo vigente", () => {
    // Se lee el archivo: cargar la página entera tiene efectos al importarse.
    const fuente = leer("src/pagina.ts");
    expect(fuente).toMatch(/import \{ enlazarContrato \} from "\.\/enlace-contrato";/);
    expect(fuente).toMatch(/import \{[^}]*\bcontractUrl\b[^}]*\} from "\.\/stellar\/config";/);
    expect(fuente).toMatch(/^enlazarContrato\(document, network\.contractId \? contractUrl\(\) : null\);/m);
  });
});
