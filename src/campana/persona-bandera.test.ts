import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anotarseSinBilleteraActivo,
  claveConPerfil,
  clienteDeGoogleDelSitio,
  guardarPerfilActivo,
  permisoDePerfil,
} from "./persona-bandera";

describe("las banderas de anotarse sin billetera", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin pasarle nada leen las dos variables de construcción por su nombre", () => {
    expect(anotarseSinBilleteraActivo()).toBe(false);
    expect(clienteDeGoogleDelSitio()).toBeNull();
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "cliente.apps.example.org");
    expect(anotarseSinBilleteraActivo()).toBe(true);
    expect(clienteDeGoogleDelSitio()).toBe("cliente.apps.example.org");
  });

  it("nacen apagadas", () => {
    expect(anotarseSinBilleteraActivo({})).toBe(false);
    expect(clienteDeGoogleDelSitio({})).toBeNull();
  });

  it("solo el 1 exacto prende el interruptor", () => {
    expect(anotarseSinBilleteraActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBe(true);
    for (const valor of ["", "0", "true", "si", " 1", "1 ", 1, true, null, undefined]) {
      expect(anotarseSinBilleteraActivo({ VITE_ANOTARSE_SIN_BILLETERA: valor }), String(valor)).toBe(false);
    }
  });

  it("el cliente de Google solo sale con el interruptor y con un identificador", () => {
    const cliente = "cliente.apps.example.org";
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: cliente })).toBe(cliente);
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: `  ${cliente}  ` })).toBe(cliente);
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: "" })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: "   " })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: 7 })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "0", VITE_GOOGLE_CLIENT_ID: cliente })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_GOOGLE_CLIENT_ID: cliente })).toBeNull();
  });
});

describe("la bandera de guardar el perfil de quien se anota", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("nace apagada", () => {
    expect(guardarPerfilActivo({})).toBe(false);
    expect(guardarPerfilActivo()).toBe(false);
  });

  it("pide los dos interruptores: anotarse sin billetera y el suyo", () => {
    expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "1" })).toBe(true);
    // Sin anotarse sin billetera no hay a quién guardarle nada, aunque el suyo esté en 1.
    expect(guardarPerfilActivo({ VITE_GUARDAR_PERFIL: "1" })).toBe(false);
    expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "0", VITE_GUARDAR_PERFIL: "1" })).toBe(false);
    expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "true", VITE_GUARDAR_PERFIL: "1" })).toBe(false);
    // Con anotarse sin billetera y sin el suyo, la página queda como hasta hoy.
    expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBe(false);
  });

  it("solo el 1 exacto la prende", () => {
    for (const valor of ["", "0", "true", "si", " 1", "1 ", "01", 1, true, null, undefined]) {
      expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: valor }), String(valor)).toBe(false);
    }
  });

  it("sin pasarle nada lee su variable de construcción por su nombre", () => {
    vi.stubEnv("VITE_GUARDAR_PERFIL", "1");
    expect(guardarPerfilActivo()).toBe(false);
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    expect(guardarPerfilActivo()).toBe(true);
    vi.stubEnv("VITE_GUARDAR_PERFIL", "0");
    expect(guardarPerfilActivo()).toBe(false);
  });

  it("el permiso del alta es true con la bandera prendida y queda sin definir apagada, para que no viaje", () => {
    expect(permisoDePerfil({})).toBeUndefined();
    expect(permisoDePerfil({ VITE_GUARDAR_PERFIL: "1" })).toBeUndefined();
    expect(permisoDePerfil({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "1" })).toBe(true);
    expect(permisoDePerfil()).toBeUndefined();
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GUARDAR_PERFIL", "1");
    expect(permisoDePerfil()).toBe(true);
  });

  it("cambia solo las dos claves del texto de siempre por las del perfil, y solo con las dos banderas prendidas", () => {
    const prendido = { VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "1" };
    expect(claveConPerfil("cpEntrarNotaPersona", {})).toBe("cpEntrarNotaPersona");
    expect(claveConPerfil("cpQueGuardamosPersona", {})).toBe("cpQueGuardamosPersona");
    expect(claveConPerfil("cpEntrarNotaPersona", { VITE_GUARDAR_PERFIL: "1" })).toBe("cpEntrarNotaPersona");
    expect(claveConPerfil("cpEntrarNotaPersona", prendido)).toBe("cpEntrarNotaPerfil");
    expect(claveConPerfil("cpQueGuardamosPersona", prendido)).toBe("cpQueGuardamosPerfil");
    // Las demás claves, incluidas las de las campañas de cuentas, no cambian con ninguna combinación.
    for (const clave of ["cpEntrarNota", "cpQueGuardamos", "cpTitulo", "constructor", ""]) {
      expect(claveConPerfil(clave, prendido), clave).toBe(clave);
      expect(claveConPerfil(clave, {}), clave).toBe(clave);
    }
    // Sin pasarle nada lee la variable de construcción, como la bandera.
    expect(claveConPerfil("cpEntrarNotaPersona")).toBe("cpEntrarNotaPersona");
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GUARDAR_PERFIL", "1");
    expect(claveConPerfil("cpEntrarNotaPersona")).toBe("cpEntrarNotaPerfil");
  });

  it("no cambia lo que dicen las otras dos banderas", () => {
    const cliente = "cliente.apps.example.org";
    const con = { VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: cliente, VITE_GUARDAR_PERFIL: "1" };
    const sin = { VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: cliente };
    expect(anotarseSinBilleteraActivo(con)).toBe(anotarseSinBilleteraActivo(sin));
    expect(clienteDeGoogleDelSitio(con)).toBe(clienteDeGoogleDelSitio(sin));
    // No hace falta el identificador de cliente para decir si se guarda: sin él la página de personas ni abre.
    expect(guardarPerfilActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "1" })).toBe(true);
  });
});
