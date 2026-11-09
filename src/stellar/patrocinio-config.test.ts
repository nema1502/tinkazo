import { describe, expect, it } from "vitest";
import { PORTERO_POR_DEFECTO, configDelPortero } from "./patrocinio-config";

describe("configDelPortero", () => {
  it("la variable manda, sin la barra del final, en cualquier sitio y red", () => {
    expect(configDelPortero({ variable: "https://otro.example/", host: "localhost", red: "mainnet" })).toEqual({ url: "https://otro.example", porDefecto: false });
    expect(configDelPortero({ variable: "  https://otro.example//  ", host: "tinkazo.app", red: "testnet" })).toEqual({ url: "https://otro.example", porDefecto: false });
  });
  it("sin variable, tinkazo.app y www.tinkazo.app en testnet usan el portero por defecto", () => {
    expect(PORTERO_POR_DEFECTO).toBe("https://p.tinkazo.app");
    for (const host of ["tinkazo.app", "www.tinkazo.app", "TINKAZO.APP"]) expect(configDelPortero({ variable: "", host, red: "testnet" })).toEqual({ url: PORTERO_POR_DEFECTO, porDefecto: true });
  });
  it("sin variable, en ningún otro sitio hay portero", () => {
    for (const host of ["localhost", "127.0.0.1", "tinkazo.vercel.app", "tinkazo-git-rama-x.vercel.app", "evil-tinkazo.app", "tinkazo.app.evil.com", "p.tinkazo.app", "tinkazo.com", ""]) {
      expect(configDelPortero({ variable: "", host, red: "testnet" })).toEqual({ url: null, porDefecto: false });
    }
  });
  it("sin variable, en mainnet no se usa el portero de testnet", () => {
    expect(configDelPortero({ variable: "", host: "tinkazo.app", red: "mainnet" })).toEqual({ url: null, porDefecto: false });
  });
});
