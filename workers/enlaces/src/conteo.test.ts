import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { CONTRACT_ERRORS } from "../../../src/stellar/errores";
import {
  ERRORES,
  EVENTOS,
  type Evento,
  MAX_CUERPO,
  OFICIALES,
  claveDeProps,
  claveDeRef,
  contratoOficial,
  filaDe,
  grupoDeIp,
  rangoDeDias,
  tamanoDe,
  validarConteo,
  validarRef,
} from "./conteo";

/** El contrato vigente de testnet, leído de src/stellar/deployments.json y no copiado: así no caduca cuando se reemplaza. */
const CONTRATO = deployments.testnet.contractId;
const REF = { net: "testnet", contract: CONTRATO, id: "278" } as const;
const NOMBRES = Object.keys(EVENTOS) as Evento[];

/** Un conteo válido de cada evento: el primer valor de cada propiedad que va siempre, y la referencia si la pide. */
function ejemplo(e: Evento): Record<string, unknown> {
  const regla = EVENTOS[e];
  const p = Object.fromEntries(Object.entries(regla.p).map(([k, v]) => [k, v[0]]));
  return { e, ...(Object.keys(p).length ? { p } : {}), ...(regla.ref === "siempre" ? { ref: REF } : {}) };
}

describe("la lista cerrada del contador", () => {
  it("acepta un conteo de cada evento", () => {
    for (const e of NOMBRES) expect(validarConteo(ejemplo(e)), e).toMatchObject({ ok: true, conteo: { e } });
  });

  it("acepta cada valor de cada propiedad, también las que pueden faltar", () => {
    for (const e of NOMBRES) {
      const regla = EVENTOS[e];
      for (const [k, valores] of [...Object.entries(regla.p), ...Object.entries(regla.o)]) {
        for (const v of valores) {
          const base = ejemplo(e);
          const r = validarConteo({ ...base, p: { ...(base.p as object), [k]: v } });
          expect(r.ok, `${e}.${k}=${v}`).toBe(true);
        }
      }
    }
  });

  it("la referencia va donde puede ir, y en verificar va siempre", () => {
    expect(validarConteo({ e: "share", p: { channel: "copy" } }).ok).toBe(true);
    expect(validarConteo({ e: "share", p: { channel: "copy" }, ref: REF }).ok).toBe(true);
    expect(validarConteo({ e: "proof_open", p: { via: "qr" }, ref: REF }).ok).toBe(true);
    expect(validarConteo({ e: "proof_open", p: { via: "long" } }).ok).toBe(true);
    expect(validarConteo({ e: "proof_verdict", p: { verdict: "green" } })).toEqual({ ok: false, motivo: "ref" });
    for (const e of NOMBRES.filter((x) => EVENTOS[x].ref === "no")) {
      expect(validarConteo({ ...ejemplo(e), ref: REF }), e).toEqual({ ok: false, motivo: "ref" });
    }
  });

  it("rechaza todo lo que no está en la lista", () => {
    const casos: Array<[unknown, string]> = [
      [null, "cuerpo"],
      [[], "cuerpo"],
      ["seal_sent", "cuerpo"],
      [{ e: "inventado" }, "evento"],
      [{ e: "toString" }, "evento"],
      [{ e: "__proto__" }, "evento"],
      [{ p: { network: "testnet" } }, "evento"],
      [{ e: "list_shown", nombre: "Ana Quispe" }, "campo"],
      [{ e: "list_shown", dia: "2026-10-22" }, "campo"],
      [{ e: "seal_sent", p: { network: "testnet", nombre: "Ana Quispe" } }, "prop"],
      [{ e: "seal_sent", p: { network: "testnet", cuenta: "GABC" } }, "prop"],
      [{ e: "seal_sent", p: { network: "futurenet" } }, "valor"],
      [{ e: "seal_sent", p: { network: 1 } }, "valor"],
      [{ e: "seal_failed", p: { network: "testnet", error: "Error(Contract, #5) at 12:03" } }, "valor"],
      [{ e: "list_ready", p: { source: "paste", size: "17" } }, "valor"],
      [{ e: "seal_failed", p: { network: "testnet" } }, "falta"],
      [{ e: "list_ready", p: { source: "paste" } }, "falta"],
      [{ e: "list_shown", p: [] }, "props"],
      [{ e: "list_shown", p: "x" }, "props"],
      [JSON.parse('{"e":"list_shown","p":{"__proto__":"x"}}'), "prop"],
      [{ e: "share", p: { channel: "copy" }, ref: { ...REF, contract: "GA" + "A".repeat(54) } }, "ref"],
    ];
    for (const [x, motivo] of casos) expect(validarConteo(x), JSON.stringify(x)).toEqual({ ok: false, motivo });
  });

  it("una referencia es red, contrato y número bien formados, y nada más", () => {
    expect(validarRef(REF)).toEqual(REF);
    expect(validarRef({ ...REF, id: "18446744073709551615" })).not.toBeNull();
    // Con un contrato oficial en mainnet (cuando se despliegue y se vuelva a desplegar el Worker).
    const conMainnet = { mainnet: [CONTRATO], testnet: [] };
    expect(validarRef({ ...REF, net: "mainnet" }, conMainnet)).toEqual({ ...REF, net: "mainnet" });
    expect(validarRef(REF, conMainnet)).toBeNull();
    for (const malo of [
      { ...REF, net: "futurenet" },
      { ...REF, contract: CONTRATO.toLowerCase() },
      { ...REF, contract: "G" + CONTRATO.slice(1) },
      { ...REF, contract: CONTRATO.slice(0, 55) },
      { ...REF, id: "0" },
      { ...REF, id: "0278" },
      { ...REF, id: "18446744073709551616" },
      { ...REF, id: 278 },
      { ...REF, cuenta: "GABC" },
      { net: REF.net, contract: REF.contract },
      [REF.net, REF.contract, REF.id],
      null,
    ]) {
      expect(validarRef(malo), JSON.stringify(malo)).toBeNull();
    }
  });

  it("solo cuenta sorteos de los contratos oficiales de deployments.json", () => {
    expect(OFICIALES.testnet).toContain(CONTRATO);
    expect(contratoOficial(REF)).toBe(true);
    // Un contrato bien formado que no es el nuestro: un enlace fabricado no suma.
    const ajeno = { ...REF, contract: "C" + "A".repeat(55) };
    expect(contratoOficial(ajeno)).toBe(false);
    expect(validarRef(ajeno)).toBeNull();
    expect(validarConteo({ e: "proof_verdict", p: { verdict: "green" }, ref: ajeno })).toEqual({ ok: false, motivo: "ref" });
    // En mainnet todavía no hay contrato: nada de mainnet con referencia entra hasta desplegarlo.
    expect(OFICIALES.mainnet).toEqual([]);
    expect(validarRef({ ...REF, net: "mainnet" })).toBeNull();
  });

  it("el tope por dirección agrupa IPv6 por /64", () => {
    expect(grupoDeIp("190.181.10.20")).toBe("190.181.10.20");
    expect(grupoDeIp("::ffff:190.181.10.20")).toBe("190.181.10.20");
    expect(grupoDeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::/64");
    expect(grupoDeIp("2001:0DB8:85A3:08D3:ffff::1")).toBe("2001:db8:85a3:8d3::/64");
    expect(grupoDeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(grupoDeIp("2001:db8:0:0:abcd::9")).toBe(grupoDeIp("2001:db8::1"));
    expect(grupoDeIp("2001:db8:0:1::1")).not.toBe(grupoDeIp("2001:db8::1"));
    expect(grupoDeIp("sin-ip")).toBe("sin-ip");
  });

  it("ningún valor es texto libre: palabras cortas de una lista", () => {
    for (const e of NOMBRES) {
      expect(e).toMatch(/^[a-z_]+$/);
      const regla = EVENTOS[e];
      for (const [k, valores] of [...Object.entries(regla.p), ...Object.entries(regla.o)]) {
        expect(k).toMatch(/^[a-z]+$/);
        for (const v of valores) expect(v, `${e}.${k}`).toMatch(/^[A-Za-z0-9_+-]{1,20}$/);
      }
    }
  });

  it("tiene todas las claves de error de errores.ts", () => {
    for (const v of Object.values(CONTRACT_ERRORS)) expect(ERRORES).toContain(v);
    // Las que devuelve `errorKey` a mano: las líneas con `return` de su cuerpo.
    const fuente = readFileSync(new URL("../../../src/stellar/errores.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const desde = fuente.indexOf("export function errorKey");
    const cuerpo = fuente.slice(desde, fuente.indexOf("\n}\n", desde));
    expect(desde).toBeGreaterThan(0);
    expect(cuerpo).not.toContain("esSinSaldo");
    const devueltas = cuerpo
      .split("\n")
      .filter((l) => /\breturn\b/.test(l))
      .flatMap((l) => [...l.matchAll(/"(\w+)"/g)].map((m) => m[1] as string));
    expect(devueltas.length).toBeGreaterThan(8);
    for (const k of devueltas) expect(ERRORES, k).toContain(k);
  });

  it("el conteo más largo posible entra en el tope", () => {
    const largo = Math.max(
      ...NOMBRES.flatMap((e) => {
        const regla = EVENTOS[e];
        const p = Object.fromEntries(
          [...Object.entries(regla.p), ...Object.entries(regla.o)].map(([k, v]) => [k, [...v].sort((a, b) => b.length - a.length)[0]]),
        );
        const ref = regla.ref === "no" ? {} : { ref: { net: "mainnet", contract: CONTRATO, id: "18446744073709551615" } };
        return [JSON.stringify({ e, p, ...ref }).length];
      }),
    );
    expect(largo).toBeLessThan(MAX_CUERPO / 2);
  });
});

describe("lo que se guarda y lo que se publica", () => {
  it("las propiedades se guardan con las claves en orden", () => {
    expect(claveDeProps({ source: "csv", size: "2-9" })).toBe('{"size":"2-9","source":"csv"}');
    expect(claveDeProps({ size: "2-9", source: "csv" })).toBe('{"size":"2-9","source":"csv"}');
    expect(claveDeProps({})).toBe("{}");
  });

  it("la referencia se guarda como red:contrato:número, o vacía", () => {
    expect(claveDeRef(REF)).toBe(`testnet:${CONTRATO}:278`);
    expect(claveDeRef(null)).toBe("");
  });

  it("una fila guardada vuelve como se publica: día, evento, propiedades, sorteo y cuántas veces", () => {
    expect(filaDe({ dia: "2026-10-22", e: "proof_verdict", p: claveDeProps({ verdict: "green" }), ref: claveDeRef(REF), n: 3 })).toEqual({
      dia: "2026-10-22",
      e: "proof_verdict",
      p: { verdict: "green" },
      ref: REF,
      n: 3,
    });
    const sin = filaDe({ dia: "2026-10-22", e: "list_shown", p: "{}", ref: "", n: 1 });
    expect(sin).toEqual({ dia: "2026-10-22", e: "list_shown", p: {}, n: 1 });
    expect("ref" in sin).toBe(false);
  });
});

describe("los tramos de tamaño de una lista", () => {
  it("nunca la cantidad exacta", () => {
    expect([0, 1, Number.NaN].map(tamanoDe)).toEqual([null, null, null]);
    expect([2, 9, 10, 49, 50, 199, 200, 5000].map(tamanoDe)).toEqual(["2-9", "2-9", "10-49", "10-49", "50-199", "50-199", "200+", "200+"]);
  });
});

describe("los días de una consulta", () => {
  const ahora = Date.parse("2026-10-22T15:00:00Z");

  it("sin nada, los 30 días que terminan hoy (UTC)", () => {
    expect(rangoDeDias(null, null, ahora)).toEqual({ desde: "2026-09-23", hasta: "2026-10-22" });
    expect(rangoDeDias(null, "2026-10-01", ahora)).toEqual({ desde: "2026-09-02", hasta: "2026-10-01" });
  });

  it("de un día a otro, hasta 92 días", () => {
    expect(rangoDeDias("2026-10-22", "2026-10-22", ahora)).toEqual({ desde: "2026-10-22", hasta: "2026-10-22" });
    expect(rangoDeDias("2026-07-23", "2026-10-22", ahora)).toEqual({ desde: "2026-07-23", hasta: "2026-10-22" });
    expect(rangoDeDias("2026-07-22", "2026-10-22", ahora)).toBeNull();
  });

  it("rechaza lo que no es un día, o al revés", () => {
    for (const [d, h] of [
      ["2026-10-22", "2026-10-01"],
      ["2026-02-30", "2026-03-01"],
      ["22-10-2026", null],
      [null, "hoy"],
      ["2026-10-01T00:00:00Z", null],
    ] as Array<[string | null, string | null]>) {
      expect(rangoDeDias(d, h, ahora), `${d} ${h}`).toBeNull();
    }
  });
});
