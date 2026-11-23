import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVAR_POR_CONEXION,
  CUENTA_POR_CONEXION,
  LISTADOS_POR_CUENTA,
  TOMAS_POR_CUENTA,
  verificarCuentaDeCampanas,
  verificarQuienOrganiza,
} from "../../workers/sala/src/activar";
import type { DepsDeCuenta, DepsDeVerificar } from "../../workers/sala/src/activar";
import {
  antesDeActivar,
  antesDeCuenta,
  contarRechazoDeActivar,
  contarRechazoDeCuenta,
  crearTablasDeActivar,
  topeDeCuenta,
} from "../../workers/sala/src/activar-cupos";
import { RECHAZOS_POR_CONEXION, RECHAZOS_POR_FICHA, VENTANA_CAMPANA_MS } from "../../workers/sala/src/campana";
import type { Ejecutar } from "../../workers/sala/src/registro";
import { montarMundo, sesionDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * La verificación de quien organiza, compartida por activar y por las rutas de Tus campañas, y los topes de esas rutas: todo
 * con un SQLite de verdad en memoria y un proveedor de cuentas de mentira que cuenta cuántas veces lo llaman.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const CUENTA = Keypair.random().publicKey();
// Las sesiones tienen la forma de las del proveedor de cuentas: un JWT de tres partes.
const TOKEN = sesionDePrueba("buena");
const TOKEN_MALO = sesionDePrueba("mala");

interface Mundillo {
  sql: Ejecutar;
  llamadas: { verificar: number; billeteraDe: number; conocida: number; antes: number; rechazo: number; tope: number };
  conocidas: Set<string>;
  sesiones: Map<string, { via: "google" | "otra" | null; cuenta: string | null }>;
  caido: boolean;
  billetera: string | null;
  deps(): DepsDeCuenta;
  depsDeActivar(): DepsDeVerificar;
}

function mundillo(): Mundillo {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
  crearTablasDeActivar(sql);
  const m: Mundillo = {
    sql,
    llamadas: { verificar: 0, billeteraDe: 0, conocida: 0, antes: 0, rechazo: 0, tope: 0 },
    conocidas: new Set(),
    sesiones: new Map([[TOKEN, { via: "google", cuenta: CUENTA }]]),
    caido: false,
    billetera: null,
    deps() {
      return {
        ip: "g1",
        ahora: AHORA,
        proveedor: {
          verificar: async (token: unknown) => {
            m.llamadas.verificar++;
            if (m.caido) return { ok: false as const, motivo: "pollar" as const };
            const s = m.sesiones.get(String(token));
            return s
              ? { ok: true as const, usuario: "u1", vence: AHORA + 3_600_000, cuenta: s.cuenta, via: s.via }
              : { ok: false as const, motivo: "sesion" as const };
          },
          billeteraDe: async () => {
            m.llamadas.billeteraDe++;
            return { ok: true as const, cuenta: m.billetera };
          },
          conocida: async (token: unknown) => {
            m.llamadas.conocida++;
            return m.conocidas.has(String(token));
          },
        },
        topes: {
          antes: async (ip, ficha, conocida) => {
            m.llamadas.antes++;
            return antesDeCuenta(sql, { grupo: ip, ficha, conocida, ahora: AHORA });
          },
          rechazo: async (ip, ficha) => {
            m.llamadas.rechazo++;
            contarRechazoDeCuenta(sql, { grupo: ip, ficha, ahora: AHORA });
          },
          tope: async (cuenta, tipo) => {
            m.llamadas.tope++;
            return topeDeCuenta(sql, { tipo, cuenta, ahora: AHORA });
          },
        },
      };
    },
    depsDeActivar() {
      const d = m.deps();
      return {
        ip: d.ip,
        proveedor: d.proveedor,
        topes: {
          antes: async (ip, ficha) => antesDeActivar(sql, { grupo: ip, ficha, ahora: AHORA }),
          rechazo: async (ip, ficha) => {
            m.llamadas.rechazo++;
            contarRechazoDeActivar(sql, { grupo: ip, ficha, ahora: AHORA });
          },
        },
      };
    },
  };
  return m;
}

let m: Mundillo;
beforeEach(() => {
  m = mundillo();
});

describe("verificarCuentaDeCampanas", () => {
  it("una sesión con forma de token y de Google da la cuenta que dice el proveedor", async () => {
    const r = await verificarCuentaDeCampanas(TOKEN, "listado", m.deps());
    expect(r).toEqual({ ok: true, cuenta: CUENTA });
    expect(m.llamadas.tope).toBe(1);
  });

  it("sin forma de token da 401 sesion sin tocar los topes ni al proveedor, y no cuenta nada", async () => {
    for (const basura of [undefined, 7, "", "corto", "con espacios " + "x".repeat(30), "a.b", "x".repeat(5000)]) {
      const r = await verificarCuentaDeCampanas(basura, "listado", m.deps());
      expect(r).toMatchObject({ ok: false, respuesta: { estado: 401, cuerpo: { error: "sesion" } } });
    }
    expect(m.llamadas).toEqual({ verificar: 0, billeteraDe: 0, conocida: 0, antes: 0, rechazo: 0, tope: 0 });
    expect(m.sql("SELECT COUNT(*) AS n FROM activar_ritmo")[0]).toEqual({ n: 0 });
    expect(m.sql("SELECT COUNT(*) AS n FROM activar_ficha")[0]).toEqual({ n: 0 });
  });

  it("sin proveedor da 503 sin-pollar antes de tocar los topes", async () => {
    const r = await verificarCuentaDeCampanas(TOKEN, "listado", { ...m.deps(), proveedor: null });
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 503, cuerpo: { error: "sin-pollar" } } });
    expect(m.llamadas.antes).toBe(0);
  });

  it("una sesión que el proveedor rechaza da 401 sesion y cuenta un rechazo", async () => {
    const r = await verificarCuentaDeCampanas(TOKEN_MALO, "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 401, cuerpo: { error: "sesion" } } });
    expect(m.llamadas.rechazo).toBe(1);
    expect(m.sql("SELECT n FROM activar_ficha")).toHaveLength(1);
    expect(m.llamadas.tope).toBe(0);
  });

  it("una ficha rechazada cinco veces ya no llega al proveedor: da 429 rechazos", async () => {
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) await verificarCuentaDeCampanas(TOKEN_MALO, "listado", m.deps());
    const antes = m.llamadas.verificar;
    const r = await verificarCuentaDeCampanas(TOKEN_MALO, "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 429, cuerpo: { error: "rechazos" } } });
    expect(m.llamadas.verificar).toBe(antes);
  });

  it("una sesión que no entró por Google da 403 no-google y cuenta un rechazo", async () => {
    m.sesiones.set(TOKEN, { via: "otra", cuenta: CUENTA });
    const r = await verificarCuentaDeCampanas(TOKEN, "toma", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 403, cuerpo: { error: "no-google" } } });
    expect(m.llamadas.rechazo).toBe(1);
    // Una sesión que no dice por dónde entró tampoco pasa: acá siempre es el modo estricto.
    m.sesiones.set(TOKEN, { via: null, cuenta: CUENTA });
    expect(await verificarCuentaDeCampanas(TOKEN, "toma", m.deps())).toMatchObject({ respuesta: { estado: 403 } });
  });

  it("un proveedor caído da 502 red y no cuenta un rechazo", async () => {
    m.caido = true;
    const r = await verificarCuentaDeCampanas(TOKEN, "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 502, cuerpo: { error: "red" } } });
    expect(m.llamadas.rechazo).toBe(0);
    expect(m.sql("SELECT n FROM activar_ficha")).toHaveLength(0);
  });

  it("una sesión sin cuenta y sin billetera da 409 sin-billetera; con billetera da esa cuenta", async () => {
    m.sesiones.set(TOKEN, { via: "google", cuenta: null });
    const r = await verificarCuentaDeCampanas(TOKEN, "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 409, cuerpo: { error: "sin-billetera" } } });
    expect(m.llamadas.billeteraDe).toBe(1);
    expect(m.llamadas.tope).toBe(0);
    m.billetera = CUENTA;
    expect(await verificarCuentaDeCampanas(TOKEN, "listado", m.deps())).toEqual({ ok: true, cuenta: CUENTA });
  });
});

describe("el ritmo de la conexión de las rutas de Tus campañas", () => {
  it("300 pedidos de una conexión pasan y el 301 da 429 cupo-conexion con el resto de la ventana", async () => {
    for (let i = 0; i < CUENTA_POR_CONEXION; i++) expect(antesDeCuenta(m.sql, { grupo: "g", ficha: `f${i}`, conocida: false, ahora: AHORA })).toEqual({ ok: true });
    const r = antesDeCuenta(m.sql, { grupo: "g", ficha: "otra", conocida: false, ahora: AHORA });
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(r.ok === false && r.esperaS).toBeGreaterThan(0);
    expect(r.ok === false && r.esperaS).toBeLessThanOrEqual(VENTANA_CAMPANA_MS / 1000);
  });

  it("no gasta el cupo de activar: el grupo es propio y el de activar queda en cero", () => {
    for (let i = 0; i < CUENTA_POR_CONEXION + 1; i++) antesDeCuenta(m.sql, { grupo: "g", ficha: `f${i}`, conocida: false, ahora: AHORA });
    expect(m.sql<{ grupo: string; n: number }>("SELECT grupo, n FROM activar_ritmo")).toEqual([{ grupo: "cuenta|g", n: CUENTA_POR_CONEXION }]);
    expect(antesDeActivar(m.sql, { grupo: "g", ficha: "una", ahora: AHORA })).toEqual({ ok: true });
    expect(ACTIVAR_POR_CONEXION).toBeLessThan(CUENTA_POR_CONEXION);
  });

  it("lo que cuenta activar tampoco gasta el cupo de las rutas nuevas", () => {
    for (let i = 0; i < ACTIVAR_POR_CONEXION; i++) antesDeActivar(m.sql, { grupo: "g", ficha: `f${i}`, ahora: AHORA });
    expect(antesDeActivar(m.sql, { grupo: "g", ficha: "mas", ahora: AHORA })).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "mas", conocida: false, ahora: AHORA })).toEqual({ ok: true });
  });

  it("una sesión conocida no suma al ritmo de la conexión ni se frena por ella", () => {
    for (let i = 0; i < CUENTA_POR_CONEXION * 2; i++) expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "f", conocida: true, ahora: AHORA })).toEqual({ ok: true });
    expect(m.sql("SELECT COUNT(*) AS n FROM activar_ritmo")[0]).toEqual({ n: 0 });
    // Con el ritmo lleno por otras sesiones, la conocida sigue pasando y la desconocida no.
    for (let i = 0; i < CUENTA_POR_CONEXION; i++) antesDeCuenta(m.sql, { grupo: "g", ficha: `n${i}`, conocida: false, ahora: AHORA });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "x", conocida: false, ahora: AHORA })).toMatchObject({ ok: false });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "x", conocida: true, ahora: AHORA })).toEqual({ ok: true });
  });

  it("a una sesión conocida sí se la frena si su ficha ya se rechazó demasiadas veces", () => {
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazoDeActivar(m.sql, { grupo: "g", ficha: "mala", ahora: AHORA });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "mala", conocida: true, ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
  });

  it("los rechazos de la conexión (300) frenan a una sesión desconocida y no a otra conexión", () => {
    for (let i = 0; i < 300; i++) contarRechazoDeCuenta(m.sql, { grupo: "g", ficha: `m${i}`, ahora: AHORA });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "nueva", conocida: false, ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
    expect(antesDeCuenta(m.sql, { grupo: "h", ficha: "nueva", conocida: false, ahora: AHORA })).toEqual({ ok: true });
  });

  it("en la ventana siguiente el contador vuelve a cero", () => {
    for (let i = 0; i < CUENTA_POR_CONEXION; i++) antesDeCuenta(m.sql, { grupo: "g", ficha: `f${i}`, conocida: false, ahora: AHORA });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "f", conocida: false, ahora: AHORA + VENTANA_CAMPANA_MS })).toEqual({ ok: true });
  });
});

describe("un vecino ruidoso en la misma conexión", () => {
  /** Un texto que pasa por token pero no es una sesión de tres partes, distinto en cada pedido. */
  const inventado = (i: number): string => `inventado${String(i).padStart(4, "0")}_${"z".repeat(24)}`;

  it("con textos inventados sin forma de sesión de tres partes no traba a la empresa ni le pregunta nada al proveedor", async () => {
    for (let i = 0; i < CUENTA_POR_CONEXION + RECHAZOS_POR_CONEXION; i++) {
      const r = await verificarCuentaDeCampanas(inventado(i), "listado", m.deps());
      expect(r).toMatchObject({ ok: false, respuesta: { estado: 401, cuerpo: { error: "sesion" } } });
    }
    expect(m.llamadas).toMatchObject({ verificar: 0, conocida: 0, antes: 0, rechazo: 0 });
    expect(m.sql("SELECT COUNT(*) AS n FROM activar_ritmo")[0]).toEqual({ n: 0 });
    expect(m.sql("SELECT COUNT(*) AS n FROM activar_rechazos")[0]).toEqual({ n: 0 });
    // La empresa, desde la misma conexión y sin su sesión en la memoria del proveedor, entra igual.
    expect(await verificarCuentaDeCampanas(TOKEN, "listado", m.deps())).toEqual({ ok: true, cuenta: CUENTA });
  });

  it("los rechazos de Tus campañas no frenan a activar, y los de activar no frenan a Tus campañas", () => {
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazoDeCuenta(m.sql, { grupo: "g", ficha: `t${i}`, ahora: AHORA });
    expect(antesDeCuenta(m.sql, { grupo: "g", ficha: "nueva", conocida: false, ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
    expect(antesDeActivar(m.sql, { grupo: "g", ficha: "nueva", ahora: AHORA })).toEqual({ ok: true });
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazoDeActivar(m.sql, { grupo: "h", ficha: `a${i}`, ahora: AHORA });
    // Activar sigue con su tope de siempre.
    expect(antesDeActivar(m.sql, { grupo: "h", ficha: "nueva", ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
    expect(antesDeCuenta(m.sql, { grupo: "h", ficha: "nueva", conocida: false, ahora: AHORA })).toEqual({ ok: true });
  });

  it("quien manda sesiones de tres partes que el proveedor rechaza sigue frenado a los 300, solo en Tus campañas", async () => {
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) {
      const r = await verificarCuentaDeCampanas(sesionDePrueba(`falsa${i}`), "listado", m.deps());
      expect(r).toMatchObject({ ok: false, respuesta: { estado: 401 } });
    }
    const verificadas = m.llamadas.verificar;
    const r = await verificarCuentaDeCampanas(sesionDePrueba("otra-falsa"), "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 429, cuerpo: { error: "rechazos" } } });
    expect(m.llamadas.verificar).toBe(verificadas);
    // Activar desde la misma conexión no quedó trabado por eso.
    expect(await verificarQuienOrganiza(TOKEN, m.depsDeActivar())).toEqual({ ok: true, cuenta: CUENTA });
  });
});

describe("el tope por cuenta", () => {
  it("el listado 31 de una cuenta en 10 minutos da 429 cupo-cuenta, y otra cuenta no se afecta", async () => {
    for (let i = 0; i < LISTADOS_POR_CUENTA; i++) expect(await verificarCuentaDeCampanas(TOKEN, "listado", m.deps())).toMatchObject({ ok: true });
    const r = await verificarCuentaDeCampanas(TOKEN, "listado", m.deps());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 429, cuerpo: { error: "cupo-cuenta" } } });
    expect(r.ok === false && r.respuesta.esperaS).toBeGreaterThan(0);
    const otra = Keypair.random().publicKey();
    m.sesiones.set(TOKEN_MALO, { via: "google", cuenta: otra });
    expect(await verificarCuentaDeCampanas(TOKEN_MALO, "listado", m.deps())).toEqual({ ok: true, cuenta: otra });
  });

  it("las tomas tienen su propio tope de 10 y no gastan el de los listados", async () => {
    for (let i = 0; i < TOMAS_POR_CUENTA; i++) expect(await verificarCuentaDeCampanas(TOKEN, "toma", m.deps())).toMatchObject({ ok: true });
    expect(await verificarCuentaDeCampanas(TOKEN, "toma", m.deps())).toMatchObject({ ok: false, respuesta: { estado: 429 } });
    expect(await verificarCuentaDeCampanas(TOKEN, "listado", m.deps())).toMatchObject({ ok: true });
  });

  it("un pedido que pasa del tope no suma, y en la ventana siguiente se vuelve a poder", () => {
    for (let i = 0; i < TOMAS_POR_CUENTA + 3; i++) topeDeCuenta(m.sql, { tipo: "toma", cuenta: CUENTA, ahora: AHORA });
    expect(m.sql("SELECT n FROM cuenta_ritmo")).toEqual([{ n: TOMAS_POR_CUENTA }]);
    expect(topeDeCuenta(m.sql, { tipo: "toma", cuenta: CUENTA, ahora: AHORA + VENTANA_CAMPANA_MS })).toEqual({ ok: true });
    expect(m.sql("SELECT COUNT(*) AS n FROM cuenta_ritmo")[0]).toEqual({ n: 1 });
  });

  it("un pedido que falla antes de la cuenta no gasta el tope de ninguna cuenta", async () => {
    await verificarCuentaDeCampanas(TOKEN_MALO, "listado", m.deps());
    expect(m.sql("SELECT COUNT(*) AS n FROM cuenta_ritmo")[0]).toEqual({ n: 0 });
  });
});

describe("verificarQuienOrganiza, el orden de siempre", () => {
  it("los topes de antes corren primero: con el ritmo lleno no se llama al proveedor", async () => {
    for (let i = 0; i < ACTIVAR_POR_CONEXION; i++) antesDeActivar(m.sql, { grupo: "g1", ficha: `f${i}`, ahora: AHORA });
    const r = await verificarQuienOrganiza(TOKEN, m.depsDeActivar());
    expect(r).toMatchObject({ ok: false, respuesta: { estado: 429, cuerpo: { error: "cupo-conexion" } } });
    expect(m.llamadas.verificar).toBe(0);
  });

  it("devuelve la cuenta, o null si no hay billetera, y deja que quien llama decida", async () => {
    expect(await verificarQuienOrganiza(TOKEN, m.depsDeActivar())).toEqual({ ok: true, cuenta: CUENTA });
    m.sesiones.set(TOKEN, { via: "google", cuenta: null });
    expect(await verificarQuienOrganiza(TOKEN, m.depsDeActivar())).toEqual({ ok: true, cuenta: null });
  });
});

describe("los métodos del objeto de cupos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cuentaAntes, cuentaRechazo y cuentaTope hablan con las mismas tablas, con la dirección y la sesión hechas huella", async () => {
    const mundo = await montarMundo();
    const cupos = mundo.cupos() as unknown as {
      cuentaAntes(ip: string, token: string, conocida: boolean): Promise<{ ok: boolean }>;
      cuentaRechazo(ip: string, token: string): Promise<void>;
      cuentaTope(cuenta: string, tipo: "listado" | "toma"): Promise<{ ok: boolean }>;
    };
    expect(await cupos.cuentaAntes("190.1.1.1", TOKEN, false)).toEqual({ ok: true });
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) await cupos.cuentaRechazo("190.1.1.1", TOKEN_MALO);
    expect(await cupos.cuentaAntes("190.1.1.1", TOKEN_MALO, false)).toMatchObject({ ok: false, motivo: "rechazos" });
    for (let i = 0; i < TOMAS_POR_CUENTA; i++) expect(await cupos.cuentaTope(CUENTA, "toma")).toEqual({ ok: true });
    expect(await cupos.cuentaTope(CUENTA, "toma")).toMatchObject({ ok: false });
  });
});
