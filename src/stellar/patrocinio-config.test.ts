import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTERO_POR_DEFECTO, configDelPortero } from "./patrocinio-config";

describe("configDelPortero", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("la variable de cada red manda, sin la barra del final, solo en su red", () => {
    expect(configDelPortero({ variableMainnet: "https://oficial.example/", host: "localhost", red: "mainnet" })).toEqual({ url: "https://oficial.example", porDefecto: false });
    expect(configDelPortero({ variableTestnet: "  https://prueba.example//  ", host: "tinkazo.app", red: "testnet" })).toEqual({ url: "https://prueba.example", porDefecto: false });
  });
  it("la variable de una red nunca vale para la otra", () => {
    expect(configDelPortero({ variableTestnet: "https://prueba.example", variableLegacy: "", host: "localhost", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
    expect(configDelPortero({ variableMainnet: "https://oficial.example", variableLegacy: "", host: "localhost", red: "testnet" })).toEqual({ url: null, porDefecto: false });
  });
  it("sin variable, tinkazo.app y www.tinkazo.app en Prueba usan el portero por defecto", () => {
    expect(PORTERO_POR_DEFECTO).toBe("https://p.tinkazo.app");
    for (const host of ["tinkazo.app", "www.tinkazo.app", "TINKAZO.APP"]) expect(configDelPortero({ variableTestnet: "", variableLegacy: "", host, red: "testnet" })).toEqual({ url: PORTERO_POR_DEFECTO, porDefecto: true });
  });
  it("sin variable, en ningún otro sitio hay portero", () => {
    for (const host of ["localhost", "127.0.0.1", "tinkazo.vercel.app", "tinkazo-git-rama-x.vercel.app", "evil-tinkazo.app", "tinkazo.app.evil.com", "p.tinkazo.app", "tinkazo.com", ""]) {
      expect(configDelPortero({ variableTestnet: "", variableLegacy: "", host, red: "testnet" })).toEqual({ url: null, porDefecto: false });
    }
  });
  it("sin variable, en Oficial no se usa el portero de Prueba", () => {
    expect(configDelPortero({ variableMainnet: "", variableLegacy: "", host: "tinkazo.app", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
  });
});

describe("la variable vieja como respaldo en Prueba", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("solo la vieja en Prueba vale, como antes", () => {
    expect(configDelPortero({ variableTestnet: "", variableLegacy: "https://vieja.example/", host: "localhost", red: "testnet" })).toEqual({ url: "https://vieja.example", porDefecto: false });
  });

  it("la vieja y la nueva de Prueba: manda la nueva", () => {
    expect(configDelPortero({ variableTestnet: "https://nueva.example", variableLegacy: "https://vieja.example", host: "localhost", red: "testnet" })).toEqual({ url: "https://nueva.example", porDefecto: false });
  });

  it("solo la vieja en Oficial no vale", () => {
    expect(configDelPortero({ variableMainnet: "", variableLegacy: "https://vieja.example", host: "localhost", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
    expect(configDelPortero({ variableMainnet: "", variableTestnet: "https://prueba.example", variableLegacy: "https://vieja.example", host: "localhost", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
  });

  it("lee la variable vieja del build cuando no está la nueva", () => {
    vi.stubEnv("VITE_PATROCINIO_URL_TESTNET", "");
    vi.stubEnv("VITE_PATROCINIO_URL", "https://vieja-del-build.example/");
    expect(configDelPortero({ host: "localhost", red: "testnet" })).toEqual({ url: "https://vieja-del-build.example", porDefecto: false });
  });

  it("la vieja del build tampoco abre nada en Oficial", () => {
    vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", "");
    vi.stubEnv("VITE_PATROCINIO_URL", "https://vieja-del-build.example/");
    expect(configDelPortero({ host: "localhost", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
  });

  it("sin ninguna variable, como antes de esta rama", () => {
    expect(configDelPortero({ variableTestnet: "", variableLegacy: "", host: "tinkazo.app", red: "testnet" })).toEqual({ url: PORTERO_POR_DEFECTO, porDefecto: true });
    expect(configDelPortero({ variableTestnet: "", variableLegacy: "", host: "localhost", red: "testnet" })).toEqual({ url: null, porDefecto: false });
    expect(configDelPortero({ variableMainnet: "", variableLegacy: "", host: "tinkazo.app", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
  });

  it("con las variables de hoy se comporta idéntico a origin/main en Prueba", () => {
    // Lo que hacía origin/main:src/stellar/patrocinio-config.ts, copiado acá para fijarlo.
    const configAnterior = (e: { variable?: string; host?: string; red?: string }): { url: string | null; porDefecto: boolean } => {
      const crudo = e.variable ?? "";
      const puesta = String(crudo).trim().replace(/\/+$/, "");
      if (puesta) return { url: puesta, porDefecto: false };
      const host = (e.host ?? "").trim().toLowerCase();
      const red = e.red ?? "testnet";
      if (red === "testnet" && ["tinkazo.app", "www.tinkazo.app"].includes(host)) return { url: PORTERO_POR_DEFECTO, porDefecto: true };
      return { url: null, porDefecto: false };
    };
    const casos: Array<{ variable: string; host: string }> = [
      { variable: "https://portero-produccion.example/", host: "tinkazo.app" },
      { variable: "https://portero-produccion.example/", host: "localhost" },
      { variable: "", host: "tinkazo.app" },
      { variable: "", host: "www.tinkazo.app" },
      { variable: "", host: "localhost" },
      { variable: "", host: "tinkazo-git-rama-x.vercel.app" },
      { variable: "  https://portero-produccion.example//  ", host: "tinkazo.app" },
    ];
    for (const { variable, host } of casos) {
      expect(configDelPortero({ variableTestnet: "", variableLegacy: variable, host, red: "testnet" }), `${variable} en ${host}`).toEqual(configAnterior({ variable, host, red: "testnet" }));
    }
  });
});
