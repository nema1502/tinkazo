import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montarMundo } from "../../../src/sala/mundo-sala";

vi.mock("cloudflare:workers", async () => await import("../../../src/sala/cloudflare-falso"));

/**
 * El perfil de quien se anota con Google, con el Worker de la sala entero en Node: dónde vive la tabla y cuándo el alta de
 * una campaña de personas guarda el correo, el nombre y la foto. Nada llama a Google ni al proveedor de cuentas de verdad.
 */
const AHORA = Date.UTC(2026, 10, 27, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const sub = (n: number): string => `10000000000000000000${n}`;
const correo = (n: number): string => `persona${n}@example.org`;
const foto = (n: number): string => `https://fotos.example.org/a/persona${n}=s96-c`;

const COLUMNAS = ["id", "correo", "nombre", "foto", "primera_ms", "ultima_ms", "veces"];

/** El objeto de cupos visto por lo único que le pide el alta para un perfil. */
interface CuposConPerfiles {
  guardarPerfil(perfil: { id: string; correo: string; nombre: string; foto: string }): Promise<{ nueva: boolean }>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la tabla de perfiles en el objeto de cupos", () => {
  it("nace con el objeto, vacía, con los interruptores como estén", async () => {
    const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, PERFILES: "1" }];
    for (const extra of interruptores) {
      const mundo = await montarMundo(extra);
      const columnas = mundo.ejecutar("cupos", "SELECT name FROM pragma_table_info('perfiles')").map((c) => c.name);
      expect(columnas, JSON.stringify(extra)).toEqual(COLUMNAS);
      expect(mundo.ejecutar("cupos", "SELECT COUNT(*) AS c FROM perfiles")).toEqual([{ c: 0 }]);
    }
  });

  it("el objeto guarda un perfil con la hora de su reloj y dice si la persona es nueva", async () => {
    const mundo = await montarMundo();
    const cupos = mundo.cupos() as unknown as CuposConPerfiles;
    const ana = { id: `google:${sub(1)}`, correo: correo(1), nombre: "Ana de Prueba", foto: foto(1) };
    expect(await cupos.guardarPerfil(ana)).toEqual({ nueva: true });
    vi.setSystemTime(AHORA + 60_000);
    expect(await cupos.guardarPerfil({ ...ana, nombre: "Ana" })).toEqual({ nueva: false });
    expect(mundo.ejecutar("cupos", "SELECT * FROM perfiles")).toEqual([
      { ...ana, nombre: "Ana", primera_ms: AHORA, ultima_ms: AHORA + 60_000, veces: 2 },
    ]);
  });
});
