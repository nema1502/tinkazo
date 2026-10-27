import { describe, expect, it } from "vitest";
import { CLAVES_DE_VIA, MARCA_INGRESAR, claveDelAviso, debeAvisar, esCorreo, estadoCuenta, inicialDe, nombreCorto, ocultarCorreo, tituloDelChip, viaDe, viaDeLaSesionGuardada, type SesionVista } from "./cuenta-estado";

/**
 * La cuenta, siempre a la vista (26 de octubre de 2026): los tres estados de la cabecera, el nombre sin el correo
 * y el recordatorio de una sola vez. Sin DOM: lo dibuja `cuenta-chip.ts`.
 */

const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const google: SesionVista = { label: "Google", address: DIR, name: "Lucía Elena Flores Quispe", avatar: "https://lh3.googleusercontent.com/a/x", mail: "lucia@gmail.com" };

describe("los tres estados de la cabecera", () => {
  it("sin cuenta y sin nada en marcha, 'Entrar'", () => {
    expect(estadoCuenta({ sesion: null, retomando: false, conectando: false })).toEqual({ estado: "fuera" });
  });

  it("mientras Google abre su ventana, 'Conectando…'", () => {
    expect(estadoCuenta({ sesion: null, retomando: false, conectando: true })).toEqual({ estado: "conectando" });
  });

  it("mientras vuelve la sesión guardada, 'Retomando…': no se ofrece entrar de nuevo", () => {
    expect(estadoCuenta({ sesion: null, retomando: true, conectando: false })).toEqual({ estado: "retomando" });
  });

  it("si la persona toca 'Entrar' mientras se retoma, manda lo que ya está haciendo: conectando", () => {
    expect(estadoCuenta({ sesion: null, retomando: true, conectando: true }).estado).toBe("conectando");
  });

  it("con una sesión, dentro: aunque la otra vía de retomar todavía no haya terminado", () => {
    const e = estadoCuenta({ sesion: google, retomando: true, conectando: true });
    expect(e.estado).toBe("dentro");
  });

  it("dentro con Google: el nombre de pila, la foto, la vía y la dirección", () => {
    expect(estadoCuenta({ sesion: google, retomando: false, conectando: false })).toEqual({
      estado: "dentro",
      via: "google",
      nombre: "Lucía",
      inicial: "L",
      foto: "https://lh3.googleusercontent.com/a/x",
      direccion: DIR,
    });
  });

  it("dentro con la cuenta de prueba y con Freighter: sin nombre y sin letra, la cara es el dibujo de la casa", () => {
    const prueba = estadoCuenta({ sesion: { label: "Cuenta de prueba", address: DIR }, retomando: false, conectando: false });
    expect(prueba).toMatchObject({ estado: "dentro", via: "prueba", nombre: "", inicial: "", foto: "" });
    const freighter = estadoCuenta({ sesion: { label: "Freighter", address: DIR }, retomando: false, conectando: false });
    expect(freighter).toMatchObject({ estado: "dentro", via: "freighter", nombre: "", inicial: "" });
  });
});

describe("la vía por la etiqueta de la cuenta", () => {
  it("Google, correo, Freighter y la cuenta de prueba", () => {
    expect(viaDe("Google")).toBe("google");
    expect(viaDe("Email")).toBe("email");
    expect(viaDe("Freighter")).toBe("freighter");
    expect(viaDe("Cuenta de prueba")).toBe("prueba");
  });

  it("cada vía tiene su frase larga y su corta, y las claves no se repiten por error", () => {
    for (const v of ["google", "email", "freighter", "prueba"] as const) {
      expect(CLAVES_DE_VIA[v].larga).toMatch(/^cuentaVia/);
      expect(CLAVES_DE_VIA[v].corta).toMatch(/^cuentaVia/);
    }
    expect(CLAVES_DE_VIA.google.larga).not.toBe(CLAVES_DE_VIA.email.larga);
  });
});

describe("la vía de la sesión guardada, para las páginas de lectura (sin cargar ninguna billetera)", () => {
  it("la cuenta de prueba, Freighter y Google", () => {
    expect(viaDeLaSesionGuardada("guest", null)).toBe("prueba");
    expect(viaDeLaSesionGuardada("freighter", null)).toBe("freighter");
    expect(viaDeLaSesionGuardada("google", "google")).toBe("google");
    expect(viaDeLaSesionGuardada("google", "1")).toBe("google");
    expect(viaDeLaSesionGuardada("google", null)).toBe("google");
  });

  it("el correo también se guarda como \"google\": lo distingue la marca de Pollar", () => {
    expect(viaDeLaSesionGuardada("google", "email")).toBe("email");
  });

  it("sin sesión guardada, ninguna: la cabecera dice \"Entrar\"", () => {
    expect(viaDeLaSesionGuardada(null, null)).toBeNull();
    expect(viaDeLaSesionGuardada(null, "google")).toBeNull();
    expect(viaDeLaSesionGuardada("otra", null)).toBeNull();
  });

  it("la marca de \"quiero entrar\" es la de siempre: la escribe la cabecera de lectura y la lee la herramienta", () => {
    expect(MARCA_INGRESAR).toBe("tinkazo.ingresar");
  });
});

describe("el nombre, nunca el correo", () => {
  it("el nombre de pila, de un nombre largo", () => {
    expect(nombreCorto("Lucía Elena Flores Quispe")).toBe("Lucía");
    expect(nombreCorto("  Ana   María ")).toBe("Ana");
    expect(nombreCorto("Fabiola")).toBe("Fabiola");
  });

  it("un correo no es un nombre: Pollar lo pone cuando la cuenta no trae uno", () => {
    expect(nombreCorto("lucia@gmail.com")).toBe("");
    expect(nombreCorto("  lucia@gmail.com ")).toBe("");
    expect(nombreCorto("")).toBe("");
    expect(nombreCorto(undefined)).toBe("");
  });

  it("qué es un correo", () => {
    expect(esCorreo("a@b.co")).toBe(true);
    expect(esCorreo("Lucía Flores")).toBe(false);
    expect(esCorreo("@gmail.com")).toBe(false);
    expect(esCorreo("a@b")).toBe(false);
  });

  it("con un correo en el nombre, la cabecera no lo muestra: dice la vía", () => {
    const e = estadoCuenta({ sesion: { label: "Email", address: DIR, name: "lucia@gmail.com", mail: "lucia@gmail.com" }, retomando: false, conectando: false });
    expect(e).toMatchObject({ estado: "dentro", via: "email", nombre: "", inicial: "L" });
    if (e.estado === "dentro") expect(tituloDelChip(e)).toEqual({ tipo: "tuCuenta", texto: "" });
  });
});

describe("el correo tapado, para el panel", () => {
  it("la primera letra, tres puntos y el dominio", () => {
    expect(ocultarCorreo("lucia@gmail.com")).toBe("l•••@gmail.com");
    expect(ocultarCorreo("Ñandú@correo.bo")).toBe("Ñ•••@correo.bo");
  });

  it("lo que no es un correo no se muestra", () => {
    expect(ocultarCorreo("Lucía")).toBe("");
    expect(ocultarCorreo("")).toBe("");
    expect(ocultarCorreo(undefined)).toBe("");
  });

  it("nunca deja el correo entero", () => {
    expect(ocultarCorreo("lucia@gmail.com")).not.toContain("lucia");
  });
});

describe("la letra de la cara", () => {
  it("la inicial del nombre; sin nombre, la del correo; sin nada, vacía", () => {
    expect(inicialDe("lucía")).toBe("L");
    expect(inicialDe("", "maria@correo.bo")).toBe("M");
    expect(inicialDe("juan@correo.bo", "juan@correo.bo")).toBe("J");
    expect(inicialDe("", "")).toBe("");
    expect(inicialDe(undefined)).toBe("");
  });

  it("un nombre que empieza con un emoji o un símbolo toma la primera letra", () => {
    expect(inicialDe("🌸 Ana")).toBe("A");
  });
});

describe("qué se lee como nombre en la cabecera", () => {
  const dentro = (s: SesionVista): Extract<ReturnType<typeof estadoCuenta>, { estado: "dentro" }> => {
    const e = estadoCuenta({ sesion: s, retomando: false, conectando: false });
    if (e.estado !== "dentro") throw new Error("no está dentro");
    return e;
  };

  it("con nombre, el nombre de pila", () => {
    expect(tituloDelChip(dentro(google))).toEqual({ tipo: "nombre", texto: "Lucía" });
  });

  it("Google sin el perfil todavía (llega tarde tras recargar): 'Tu cuenta', nunca la dirección", () => {
    expect(tituloDelChip(dentro({ label: "Google", address: DIR }))).toEqual({ tipo: "tuCuenta", texto: "" });
  });

  it("la cuenta de prueba se llama por su vía, y Freighter por su dirección corta", () => {
    expect(tituloDelChip(dentro({ label: "Cuenta de prueba", address: DIR }))).toEqual({ tipo: "via", texto: "" });
    expect(tituloDelChip(dentro({ label: "Freighter", address: DIR }))).toEqual({ tipo: "direccion", texto: "GDVZ…5ZLE" });
  });
});

describe("la línea que dice qué pasó al entrar", () => {
  const dentro = (s: SesionVista) => estadoCuenta({ sesion: s, retomando: false, conectando: false }) as Extract<ReturnType<typeof estadoCuenta>, { estado: "dentro" }>;

  it("Google con nombre dice quién; sin nombre, solo con qué", () => {
    expect(claveDelAviso(dentro(google))).toBe("cuentaAvisoGoogle");
    expect(claveDelAviso(dentro({ label: "Google", address: DIR }))).toBe("cuentaAvisoGoogleSin");
  });

  it("correo, Freighter y la cuenta de prueba, cada uno la suya", () => {
    expect(claveDelAviso(dentro({ label: "Email", address: DIR }))).toBe("cuentaAvisoCorreo");
    expect(claveDelAviso(dentro({ label: "Freighter", address: DIR }))).toBe("cuentaAvisoFreighter");
    expect(claveDelAviso(dentro({ label: "Cuenta de prueba", address: DIR }))).toBe("cuentaAvisoPrueba");
  });
});

describe("el recordatorio de crear la cuenta, una sola vez y sin molestar", () => {
  const base = { enEnsayoODemo: true, conSesion: false, yaSeAviso: false, esteAviso: false, sellada: false, ventanaAbierta: false };

  it("en el ensayo o la demo, sin cuenta y con la lista a mano, se avisa", () => {
    expect(debeAvisar(base)).toBe(true);
  });

  it("nunca fuera del ensayo y la demo: un sorteo de verdad ya pide la cuenta", () => {
    expect(debeAvisar({ ...base, enEnsayoODemo: false })).toBe(false);
  });

  it("nunca con una cuenta abierta", () => {
    expect(debeAvisar({ ...base, conSesion: true })).toBe(false);
  });

  it("nunca entre el sello y el último resultado: la sala mira el sorteo", () => {
    expect(debeAvisar({ ...base, sellada: true })).toBe(false);
    expect(debeAvisar({ ...base, sellada: true, esteAviso: true })).toBe(false);
  });

  it("nunca encima de una ventana abierta", () => {
    expect(debeAvisar({ ...base, ventanaAbierta: true })).toBe(false);
    expect(debeAvisar({ ...base, ventanaAbierta: true, esteAviso: true })).toBe(false);
  });

  it("una sola vez por sesión: si ya se mostró en otra visita, no vuelve", () => {
    expect(debeAvisar({ ...base, yaSeAviso: true })).toBe(false);
  });

  it("pero mientras se está mostrando, se queda (la vez es la visita entera hasta sellar)", () => {
    expect(debeAvisar({ ...base, yaSeAviso: true, esteAviso: true })).toBe(true);
  });
});
