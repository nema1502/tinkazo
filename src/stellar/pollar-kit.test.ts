import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La activación de la cuenta en modo Oficial (`activarCuenta` en `wallet-pollar.ts`) se apoya en cómo hace las cosas el
 * kit de Pollar 0.12.0: `refresh` reconstruye el pedido, `verify` arma la propuesta que se estampa, `relay` firma con la
 * llave de este navegador exactamente ese cuerpo, `recognizedSetupRequest` lee la transacción por su lado, y
 * `revokeDevice` y `recovery.status` dicen y cambian qué navegadores tiene la cuenta. Si el kit cambia de versión, la
 * regla puede seguir pasando y aprobar otra cosa: esta prueba obliga a releerlo antes.
 */

const QUE_RELEER =
  "Cambió la versión de @pollar/core. Antes de subirla, releer en node_modules/@pollar/core/dist/index.mjs: " +
  "verify, relay, refresh, settle, get, approve, recognizedSetupRequest, revokeDevice y recovery.status, y comparar con " +
  "la sección 5 del diseño de «Dejá tu cuenta lista» (la regla de la firma) y con motivoContraLaActivacion y propuestaEsLaNuestra.";

describe("el kit de Pollar que la activación de la cuenta da por sabido", () => {
  it("es la versión 0.12.0", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "node_modules/@pollar/core/package.json"), "utf8")) as { version: string };
    expect(pkg.version, QUE_RELEER).toBe("0.12.0");
  });

  it("exporta su propio lector de pedidos de preparación y los métodos de la co-firma que se usan", async () => {
    const kit = await import("@pollar/core");
    expect(typeof kit.recognizedSetupRequest, QUE_RELEER).toBe("function");
    const proto = kit.CosignManager.prototype as unknown as Record<string, unknown>;
    for (const m of ["pending", "get", "refresh", "verify", "relay", "settle", "devices", "revokeDevice", "publicKeyHex"]) {
      expect(typeof proto[m], `${m}: ${QUE_RELEER}`).toBe("function");
    }
  });
});
