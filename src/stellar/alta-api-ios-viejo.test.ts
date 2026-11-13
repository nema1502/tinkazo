import { describe, expect, it } from "vitest";
import { CLAVES_DE_MOTIVO, canjear, estado, type OpcionesDeAlta } from "./alta-api";

/**
 * Los iPhone que siguen con un iOS anterior al 15.4 no tienen `Object.hasOwn`. El camino del cupón (leer el acceso y
 * canjear) no puede depender de eso: un no del portero se dice con su propio texto, como en producción, y no como si no
 * hubiera servicio. Se compara cada motivo con `Object.hasOwn` y sin él: tiene que dar lo mismo.
 *
 * Sin `Object.hasOwn` no se usa nada de Vitest (ni `vi.fn` ni `expect`), porque podrían pedirlo por dentro: el fetch y su
 * respuesta son de mentira y a mano, y se afirma después de devolverlo a su lugar.
 */

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const CODIGO = "K7M29QXA4HTR";

/** Lo que contesta el portero: un estado HTTP y un cuerpo. Solo lo que `alta-api.ts` lee de la respuesta. */
const fetchQueContesta = (status: number, cuerpo: unknown): typeof fetch =>
  (async () => ({ status, json: async () => cuerpo }) as unknown as Response) as unknown as typeof fetch;

/** Los motivos del portero, más los nombres que tiene cualquier objeto (no son motivos), y la sesión vencida sin motivo. */
const CASOS: { status: number; cuerpo: unknown }[] = [
  ...Object.keys(CLAVES_DE_MOTIVO).map((motivo) => ({ status: 409, cuerpo: { motivo } })),
  ...["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"].map((motivo) => ({ status: 400, cuerpo: { motivo } })),
  { status: 404, cuerpo: { motivo: "cupon-no-existe" } },
  { status: 410, cuerpo: { motivo: "vencido", vence: Date.UTC(2026, 11, 14, 3, 59) } },
  { status: 429, cuerpo: { motivo: "intentos", reintentarEn: Date.UTC(2026, 10, 14, 15, 5) } },
  { status: 401, cuerpo: {} },
  { status: 500, cuerpo: null },
];

/** Lo que dice el camino del cupón ante cada caso: el acceso y el canje. Si algo lanza, el error queda en su lugar. */
async function lecturas(): Promise<unknown[]> {
  const salida: unknown[] = [];
  for (const c of CASOS) {
    const o: OpcionesDeAlta = { url: URL, fetch: fetchQueContesta(c.status, c.cuerpo), idioma: "es", ahora: () => Date.UTC(2026, 10, 14, 15) };
    for (const pedir of [() => estado(TOKEN, o), () => canjear(TOKEN, CODIGO, o)]) {
      try {
        salida.push(await pedir());
      } catch (e) {
        salida.push({ lanzo: String(e) });
      }
    }
  }
  return salida;
}

describe("el camino del cupón en un iOS sin Object.hasOwn", () => {
  it("cada no del portero se dice igual que con Object.hasOwn, sin lanzar", async () => {
    const con = await lecturas();
    const original = Object.hasOwn;
    let sin: unknown[];
    try {
      delete (Object as { hasOwn?: unknown }).hasOwn;
      sin = await lecturas();
    } finally {
      Object.defineProperty(Object, "hasOwn", { value: original, configurable: true, writable: true, enumerable: false });
    }
    expect(typeof Object.hasOwn).toBe("function");
    expect(sin).toEqual(con);
    // Y lo de producción: el cupón que no existe tiene su texto, y la sesión vencida pide entrar de nuevo.
    expect(con).toContainEqual(expect.objectContaining({ ok: false, motivo: "cupon-no-existe", clave: "altaErrNoExiste" }));
    expect(con).toContainEqual(expect.objectContaining({ ok: false, motivo: "sesion", clave: "clErrSesion" }));
    // Lo que se llama igual que algo de todos los objetos no es un motivo: el texto de siempre de sin servicio.
    expect(con).toContainEqual(expect.objectContaining({ ok: false, motivo: "constructor", clave: "altaErrServicio" }));
  });
});
