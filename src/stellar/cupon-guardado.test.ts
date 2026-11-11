import { describe, expect, it } from "vitest";
import { CLAVE_CUPON, type AlmacenDeCupon, cuponDelFragmento, cuponGuardado, cuponParaMostrar, direccionSinCupon, enlaceConCupon, guardarCupon, olvidarCupon } from "./cupon-guardado";

const alm = (): AlmacenDeCupon & { datos: Map<string, string> } => {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  };
};

describe("cuponDelFragmento", () => {
  it("lee el código de #cupon= y lo normaliza", () => {
    expect(cuponDelFragmento("#cupon=K7M29QXA4HTR")).toEqual({ hay: true, codigo: "K7M29QXA4HTR" });
    expect(cuponDelFragmento("#cupon=k7m2-9qxa-4htr")).toEqual({ hay: true, codigo: "K7M29QXA4HTR" });
    expect(cuponDelFragmento("#cupon=K7M2%209QXA%204HTR")).toEqual({ hay: true, codigo: "K7M29QXA4HTR" });
    expect(cuponDelFragmento("#sortear&cupon=OIL0-1234-5678")).toEqual({ hay: true, codigo: "011012345678" });
  });
  it("uno mal formado se nota, pero no da código", () => {
    for (const mal of ["#cupon=", "#cupon=K7M2", "#cupon=K7M29QXA4HTU", "#cupon=%E0%A4%A", "#cupon=K7M2_9QXA_4HTR", "#cupon"]) {
      expect(cuponDelFragmento(mal), mal).toEqual({ hay: true, codigo: null });
    }
  });
  it("sin cupón en el fragmento, nada", () => {
    for (const x of ["", "#", "#sortear", "#portada", "#otro=K7M29QXA4HTR"]) expect(cuponDelFragmento(x), x).toEqual({ hay: false, codigo: null });
  });
});

describe("direccionSinCupon", () => {
  it("saca solo el cupón y deja el resto", () => {
    expect(direccionSinCupon("/", "?red=oficial", "#cupon=K7M29QXA4HTR")).toBe("/?red=oficial");
    expect(direccionSinCupon("/", "", "#sortear&cupon=K7M29QXA4HTR")).toBe("/#sortear");
    expect(direccionSinCupon("/", "?lang=en", "#cupon=zzz&sortear")).toBe("/?lang=en#sortear");
    expect(direccionSinCupon("/", "", "#CUPON=K7M29QXA4HTR")).toBe("/");
  });
});

describe("guardar, leer y olvidar", () => {
  it("guarda solo el código normalizado y lo entrega igual", () => {
    const a = alm();
    expect(guardarCupon("k7m2-9qxa-4htr", a)).toBe(true);
    expect(a.datos.get(CLAVE_CUPON)).toBe("K7M29QXA4HTR");
    expect(cuponGuardado(a)).toBe("K7M29QXA4HTR");
    expect(cuponParaMostrar(a)).toBe("K7M2-9QXA-4HTR");
  });
  it("uno mal formado no se guarda y no pisa el que había", () => {
    const a = alm();
    expect(guardarCupon("K7M29QXA4HTR", a)).toBe(true);
    for (const mal of ["", "K7M2", "K7M29QXA4HTU", null, 42, "https://tinkazo.app/#cupon=K7M29QXA4HTR"]) expect(guardarCupon(mal, a), String(mal)).toBe(false);
    expect(cuponGuardado(a)).toBe("K7M29QXA4HTR");
  });
  it("lo que alguien escribió a mano en el almacén y no es un cupón no se entrega", () => {
    const a = alm();
    a.setItem(CLAVE_CUPON, "<script>");
    expect(cuponGuardado(a)).toBeNull();
  });
  it("olvidar lo borra", () => {
    const a = alm();
    guardarCupon("K7M29QXA4HTR", a);
    olvidarCupon(a);
    expect(cuponGuardado(a)).toBeNull();
  });
  it("sin almacén, o con uno que lanza, nada se rompe y nada se guarda", () => {
    expect(guardarCupon("K7M29QXA4HTR", null)).toBe(false);
    expect(cuponGuardado(null)).toBeNull();
    const bloqueado = (): never => {
      throw new Error("bloqueado");
    };
    const roto: AlmacenDeCupon = { getItem: bloqueado, setItem: bloqueado, removeItem: bloqueado };
    expect(guardarCupon("K7M29QXA4HTR", roto)).toBe(false);
    expect(cuponGuardado(roto)).toBeNull();
    expect(() => olvidarCupon(roto)).not.toThrow();
  });
  it("el enlace para copiar lleva el código en el fragmento", () => {
    expect(enlaceConCupon("https://tinkazo.app", "/", "?red=oficial", "K7M29QXA4HTR")).toBe("https://tinkazo.app/?red=oficial#cupon=K7M29QXA4HTR");
  });
});
