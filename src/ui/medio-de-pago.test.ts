import { describe, expect, it, vi } from "vitest";
import { CLAVE_DEL_MEDIO, type CompraQrDelServidor, type Medio, ZONA_DE_BOLIVIA, leerMedio, medioDeEstaCuenta, medioPorDefecto, recordarMedio, zonaHoraria } from "./medio-de-pago";

/** Cómo se deduce el camino de pago: un caso por cada renglón de la deducción, y lo que puede fallar al leer. */

const PUEDE: CompraQrDelServidor = { puede: true, motivo: null };
const no = (motivo: string | null): CompraQrDelServidor => ({ puede: false, motivo });
const ZONAS = [ZONA_DE_BOLIVIA, "America/Santiago", "Europe/Berlin", null] as const;
const ELEGIDOS: (Medio | null)[] = ["qr", "app", null];
const SERVIDORES: (CompraQrDelServidor | null | undefined)[] = [PUEDE, no("fuera-del-piloto"), no("compras-cerradas"), no("fondeo-diferido"), no("tope-del-dia"), no("sin-lugar"), no("ya-tiene-acceso"), no("compra-en-curso"), no("algo-nuevo"), no(null), null, undefined];

function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: vi.fn((k: string) => datos.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void datos.set(k, v)),
  };
}

describe("la deducción, renglón por renglón", () => {
  it("1. sin la compra con QR en el build, siempre otra app y sin enlace, sea lo que sea lo demás", () => {
    for (const servidor of SERVIDORES) for (const elegido of ELEGIDOS) for (const zona of ZONAS) expect(medioPorDefecto({ enElBuild: false, servidor, elegido, zona }), JSON.stringify({ servidor, elegido, zona })).toEqual({ medio: "app", cambio: false });
  });

  it("2. fuera del piloto, con la compra con QR cerrada o con el fondeo diferido: como si el QR no existiera, también para quien eligió el QR", () => {
    for (const motivo of ["fuera-del-piloto", "compras-cerradas", "fondeo-diferido"]) {
      for (const elegido of ELEGIDOS) for (const zona of ZONAS) expect(medioPorDefecto({ enElBuild: true, servidor: no(motivo), elegido, zona }), motivo).toEqual({ medio: "app", cambio: false });
      // Aunque el servidor diga que puede, uno de estos motivos cierra.
      expect(medioPorDefecto({ enElBuild: true, servidor: { puede: true, motivo }, elegido: "qr", zona: ZONA_DE_BOLIVIA })).toEqual({ medio: "app", cambio: false });
    }
  });

  it("2. sin lo que dice el servidor, o con un no que no conocemos: lo más cerrado", () => {
    for (const servidor of [null, undefined, no("algo-nuevo"), no(null)]) expect(medioPorDefecto({ enElBuild: true, servidor, elegido: "qr", zona: ZONA_DE_BOLIVIA }), JSON.stringify(servidor)).toEqual({ medio: "app", cambio: false });
  });

  it("3. lo que eligió la persona en este navegador, con enlace", () => {
    for (const zona of ZONAS) {
      expect(medioPorDefecto({ enElBuild: true, servidor: PUEDE, elegido: "app", zona })).toEqual({ medio: "app", cambio: true });
      expect(medioPorDefecto({ enElBuild: true, servidor: PUEDE, elegido: "qr", zona })).toEqual({ medio: "qr", cambio: true });
    }
  });

  it("4. con la zona horaria de Bolivia, el QR con enlace", () => {
    expect(medioPorDefecto({ enElBuild: true, servidor: PUEDE, elegido: null, zona: "America/La_Paz" })).toEqual({ medio: "qr", cambio: true });
  });

  it("5. con cualquier otra zona, o sin zona, otra app con enlace", () => {
    for (const zona of ["America/Santiago", "America/Lima", "Europe/Berlin", "UTC", "", null]) expect(medioPorDefecto({ enElBuild: true, servidor: PUEDE, elegido: null, zona }), String(zona)).toEqual({ medio: "app", cambio: true });
  });

  it("el cupo del día no entra en la deducción: quien está en Bolivia sigue en el camino del QR", () => {
    for (const motivo of ["tope-del-dia", "sin-lugar", "ya-tiene-acceso", "compra-en-curso"]) {
      expect(medioPorDefecto({ enElBuild: true, servidor: no(motivo), elegido: null, zona: ZONA_DE_BOLIVIA }), motivo).toEqual({ medio: "qr", cambio: true });
      expect(medioPorDefecto({ enElBuild: true, servidor: no(motivo), elegido: null, zona: "Europe/Berlin" }), motivo).toEqual({ medio: "app", cambio: true });
    }
  });

  it("vale el primer renglón que se cumple, en todas las combinaciones", () => {
    for (const enElBuild of [true, false]) for (const servidor of SERVIDORES) for (const elegido of ELEGIDOS) for (const zona of ZONAS) {
      const d = medioPorDefecto({ enElBuild, servidor, elegido, zona });
      const motivo = servidor?.motivo ?? "";
      const renglon2 = !servidor || ["fuera-del-piloto", "compras-cerradas", "fondeo-diferido"].includes(motivo) || (!servidor.puede && !["tope-del-dia", "sin-lugar", "ya-tiene-acceso", "compra-en-curso"].includes(motivo));
      const esperado = !enElBuild || renglon2 ? { medio: "app", cambio: false } : elegido ? { medio: elegido, cambio: true } : zona === ZONA_DE_BOLIVIA ? { medio: "qr", cambio: true } : { medio: "app", cambio: true };
      expect(d, JSON.stringify({ enElBuild, servidor, elegido, zona })).toEqual(esperado);
    }
  });
});

describe("leer y recordar en este navegador", () => {
  it("recordar guarda solo lo que se elige, y leer lo devuelve", () => {
    const a = almacen();
    expect(leerMedio(a)).toBeNull();
    recordarMedio("app", a);
    expect(a.datos.get(CLAVE_DEL_MEDIO)).toBe("app");
    expect(leerMedio(a)).toBe("app");
    recordarMedio("qr", a);
    expect(leerMedio(a)).toBe("qr");
  });

  it("un valor que no es qr ni app no cuenta", () => {
    for (const v of ["QR", "banco", "", "1", "null"]) expect(leerMedio(almacen({ [CLAVE_DEL_MEDIO]: v })), v).toBeNull();
  });

  it("el almacenamiento roto, o que no existe, no rompe nada", () => {
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); } };
    expect(leerMedio(roto)).toBeNull();
    expect(() => recordarMedio("qr", roto)).not.toThrow();
    expect(leerMedio(null)).toBeNull();
    expect(() => recordarMedio("app", null)).not.toThrow();
    expect(medioDeEstaCuenta(PUEDE, { enElBuild: true, almacen: roto, zona: ZONA_DE_BOLIVIA })).toEqual({ medio: "qr", cambio: true });
  });

  it("la zona horaria que tira error, o que no viene, se lee como sin zona", () => {
    expect(zonaHoraria(() => { throw new RangeError("sin Intl"); })).toBeNull();
    expect(zonaHoraria(() => undefined)).toBeNull();
    expect(zonaHoraria(() => "")).toBeNull();
    expect(zonaHoraria(() => "America/La_Paz")).toBe("America/La_Paz");
    expect(medioDeEstaCuenta(PUEDE, { enElBuild: true, almacen: null, zona: zonaHoraria(() => { throw new Error("x"); }) })).toEqual({ medio: "app", cambio: true });
  });

  it("la deducción nunca se guarda sola: deducir no escribe nada", () => {
    for (const zona of ZONAS) for (const servidor of SERVIDORES) {
      const a = almacen();
      medioDeEstaCuenta(servidor, { enElBuild: true, almacen: a, zona });
      expect(a.setItem).not.toHaveBeenCalled();
    }
  });

  it("deducir lee lo que eligió la persona antes que la zona", () => {
    expect(medioDeEstaCuenta(PUEDE, { enElBuild: true, almacen: almacen({ [CLAVE_DEL_MEDIO]: "app" }), zona: ZONA_DE_BOLIVIA })).toEqual({ medio: "app", cambio: true });
    expect(medioDeEstaCuenta(PUEDE, { enElBuild: true, almacen: almacen({ [CLAVE_DEL_MEDIO]: "qr" }), zona: "Europe/Berlin" })).toEqual({ medio: "qr", cambio: true });
  });

  it("en este build (Prueba y sin variables) la compra con QR no está: otra app y sin enlace", () => {
    expect(medioDeEstaCuenta(PUEDE, { almacen: almacen({ [CLAVE_DEL_MEDIO]: "qr" }), zona: ZONA_DE_BOLIVIA })).toEqual({ medio: "app", cambio: false });
  });
});
