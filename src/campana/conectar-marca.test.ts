/**
 * La marca de correo confirmado con la constante ENCENDIDA (se simula acá: en el código está apagada). Con ella, la consulta
 * propia lleva `c: true` solo cuando la página la pide, y las dependencias avisan que la sala la acepta.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFalso } from "../sala/fetch-falso";
import { campanaDeEjemplo } from "./ejemplo";
import { depsConectadas, type PiezasDelCelular } from "./conectar";

vi.mock("./marca-de-correo", () => ({ MARCA_DE_CORREO_ENCENDIDA: true }));

const CUENTA = `G${"A".repeat(55)}`;
const AHORA = 1_800_000_000_000;
const YO = { fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, anotada: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

function montar() {
  const { f, llamadas } = fetchFalso({ yo: [{ estado: 200, cuerpo: YO }] });
  const piezas: PiezasDelCelular = {
    base: {
      tx: (clave) => clave,
      idioma: () => "es",
      enApp: false,
      ahora: () => Date.now(),
      cada: () => () => undefined,
      visible: () => true,
      alVolver: () => () => undefined,
      vibrar: () => undefined,
      movimientoReducido: () => true,
    },
    campana: campanaDeEjemplo(AHORA),
    servicio: "https://servicio.example.org",
    sala: "ABCDEFGH",
    clave: "abcdefghijklmnopqrstuv",
    pase: "ABCDEFGHIJKL",
    google: {
      retomar: async () => null,
      entrar: async () => ({ cuenta: CUENTA, nombre: "Ana P." }),
      token: async () => null,
      nombreTardio: async () => null,
      sigueLaSesion: async () => false,
      salir: async () => undefined,
      renovar: () => undefined,
    },
    memoria: null,
    red: "testnet",
    enLinea: () => true,
    ir: () => undefined,
    enlace: () => "x",
    dep: { fetch: f },
  };
  return { deps: depsConectadas(piezas), llamadas };
}

const cuerpoDe = (llamadas: { init: RequestInit }[], n: number): Record<string, unknown> =>
  JSON.parse(String(llamadas[n]?.init.body)) as Record<string, unknown>;

describe("la marca de correo confirmado, encendida", () => {
  it("las dependencias dicen que la sala la acepta", () => {
    expect(montar().deps.marcaDeCorreo).toBe(true);
  });

  it("la consulta propia lleva c solo cuando la página lo pide", async () => {
    const { deps, llamadas } = montar();
    await deps.entrar();
    await deps.yo();
    await deps.yo(false);
    await deps.yo(true);
    expect(cuerpoDe(llamadas, 0)).not.toHaveProperty("c");
    expect(cuerpoDe(llamadas, 1)).not.toHaveProperty("c");
    expect(cuerpoDe(llamadas, 2)).toMatchObject({ cuenta: CUENTA, c: true });
    expect(Object.keys(cuerpoDe(llamadas, 2)).sort()).toEqual(["c", "cuenta", "llave"]);
  });
});
