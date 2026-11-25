import { describe, expect, it } from "vitest";
import {
  LIMITE_DE_LA_RED_MS,
  SIN_REPETIR_MS,
  hayLimiteDeLaRed,
  loRecordadoDelSello,
  marcarElLimiteDeLaRed,
  recordarElSello,
} from "./sello-memoria";

const AHORA = 1_800_000_000_000;
const SALA = "ABCDEFGH";

function almacenEnMemoria(): Pick<Storage, "getItem" | "setItem"> {
  const datos = new Map<string, string>();
  return {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

describe("lo que el celular recuerda de la comprobación del sello", () => {
  it("sin nada guardado no recuerda nada", () => {
    expect(loRecordadoDelSello(almacenEnMemoria(), SALA, "aaaa", AHORA)).toBeNull();
  });

  it("recuerda que la cuenta estaba, y de qué comprobación fue", () => {
    const a = almacenEnMemoria();
    recordarElSello(a, SALA, "aaaa", "esta", AHORA);
    expect(loRecordadoDelSello(a, SALA, "aaaa", AHORA + 24 * 3_600_000)).toBe("esta");
    expect(loRecordadoDelSello(a, SALA, "bbbb", AHORA)).toBeNull();
    expect(loRecordadoDelSello(a, "OTRASALA", "aaaa", AHORA)).toBeNull();
  });

  it("lo que no se pudo comprobar se recuerda solo un rato", () => {
    const a = almacenEnMemoria();
    recordarElSello(a, SALA, "aaaa", null, AHORA);
    expect(loRecordadoDelSello(a, SALA, "aaaa", AHORA + SIN_REPETIR_MS - 1)).toBe("no-se-pudo");
    expect(loRecordadoDelSello(a, SALA, "aaaa", AHORA + SIN_REPETIR_MS + 1)).toBeNull();
  });

  it("una comprobación nueva reemplaza a la anterior", () => {
    const a = almacenEnMemoria();
    recordarElSello(a, SALA, "aaaa", "esta", AHORA);
    recordarElSello(a, SALA, "bbbb", null, AHORA);
    expect(loRecordadoDelSello(a, SALA, "aaaa", AHORA)).toBeNull();
    expect(loRecordadoDelSello(a, SALA, "bbbb", AHORA)).toBe("no-se-pudo");
  });

  it("lo guardado roto o de otra forma no se toma", () => {
    const a = almacenEnMemoria();
    for (const crudo of ["no es json", "null", "[]", '{"h":"aaaa"}', '{"h":"aaaa","v":"quizás","hasta":1}', '{"h":1,"v":"esta","hasta":1}']) {
      a.setItem(`tinkazo.comprobacion.${SALA}`, crudo);
      expect(loRecordadoDelSello(a, SALA, "aaaa", AHORA), crudo).toBeNull();
    }
  });

  it("un almacén que lanza no rompe nada", () => {
    const roto: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() => recordarElSello(roto, SALA, "aaaa", "esta", AHORA)).not.toThrow();
    expect(loRecordadoDelSello(roto, SALA, "aaaa", AHORA)).toBeNull();
    expect(() => marcarElLimiteDeLaRed(roto, AHORA)).not.toThrow();
    expect(hayLimiteDeLaRed(roto, AHORA)).toBe(false);
  });
});

describe("el freno cuando la red dijo que hay demasiados pedidos", () => {
  it("frena un rato y después suelta", () => {
    const a = almacenEnMemoria();
    expect(hayLimiteDeLaRed(a, AHORA)).toBe(false);
    marcarElLimiteDeLaRed(a, AHORA);
    expect(hayLimiteDeLaRed(a, AHORA + LIMITE_DE_LA_RED_MS - 1)).toBe(true);
    expect(hayLimiteDeLaRed(a, AHORA + LIMITE_DE_LA_RED_MS + 1)).toBe(false);
  });

  it("un valor roto no frena", () => {
    const a = almacenEnMemoria();
    a.setItem("tinkazo.comprobacion.limite", "mañana");
    expect(hayLimiteDeLaRed(a, AHORA)).toBe(false);
  });

  it("un valor demasiado lejano no frena para siempre", () => {
    const a = almacenEnMemoria();
    a.setItem("tinkazo.comprobacion.limite", String(AHORA + 365 * 24 * 3_600_000));
    expect(hayLimiteDeLaRed(a, AHORA)).toBe(false);
  });
});
