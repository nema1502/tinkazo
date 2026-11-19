// POST /prueba no recibe la clave de operar: recibe un derivado de ella, el HMAC-SHA-256 de un texto fijo con la clave
// como llave, en hexadecimal minúsculo. La clave de operar ya no viaja hasta el vigilante, y del derivado no se saca la
// clave. El Worker lo calcula con WebCrypto y la herramienta de quien opera con Node: un vector fijo los mantiene iguales.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, mundoFalso } from "./mundo-falso";
import { CONTEXTO_PRUEBA, claveDePrueba, olvidarPrueba, servir } from "./publica";

const BASE = "https://vigilante.tinkazo.app";
const pedir = (m: ReturnType<typeof mundoFalso>, token: string) =>
  servir(new Request(`${BASE}/prueba`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }), m.env, m.dep);
const comoNode = (clave: string, contexto = CONTEXTO_PRUEBA) => createHmac("sha256", clave.trim()).update(contexto).digest("hex");

beforeEach(() => olvidarPrueba());

describe("el derivado de la clave de operar", () => {
  it("el texto fijo lleva versión", () => {
    expect(CONTEXTO_PRUEBA).toBe("tinkazo-vigilante/prueba/v1");
  });

  it("un vector fijo: el Worker y la herramienta de quien opera calculan lo mismo", async () => {
    expect(await claveDePrueba(CLAVE_DE_OPERAR)).toBe("fb9ced9a3f7eae327b7486d533fabe0f0d973d00b095c9f683a667a3ffde746b");
    expect(CLAVE_DE_PRUEBA).toBe("fb9ced9a3f7eae327b7486d533fabe0f0d973d00b095c9f683a667a3ffde746b");
    const otra = "otra-clave-de-ejemplo-de-32-letras";
    expect(otra.length).toBeGreaterThanOrEqual(32);
    expect(await claveDePrueba(otra)).toBe(comoNode(otra));
  });

  it("son 64 caracteres hexadecimales en minúscula, y nunca la clave ni un pedazo de ella", async () => {
    const d = await claveDePrueba(CLAVE_DE_OPERAR);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toBe(CLAVE_DE_OPERAR);
    expect(d).not.toContain(CLAVE_DE_OPERAR.slice(0, 8));
  });
});

describe("POST /prueba con el derivado", () => {
  it("la clave de operar cruda ya no sirve: 403, sin correo y sin pedirle nada al portero", async () => {
    const m = mundoFalso();
    const r = await pedir(m, CLAVE_DE_OPERAR);
    expect(r.status).toBe(403);
    expect(m.correo.intentos).toBe(0);
    expect(m.portero.llamadas).toEqual([]);
  });

  it("el derivado correcto manda el correo de prueba", async () => {
    const m = mundoFalso();
    const r = await pedir(m, CLAVE_DE_PRUEBA);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ correo: "enviado", telegram: "apagado" });
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("con la clave cargada con espacios o un salto de línea, sirve el derivado de la clave sin ellos", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: ` ${CLAVE_DE_OPERAR} \r\n` } });
    expect((await pedir(m, comoNode(` ${CLAVE_DE_OPERAR}\n`))).status).toBe(200);
  });

  it("lo que no es exactamente el derivado da 403 y no arranca el enfriamiento", async () => {
    const m = mundoFalso();
    const malos = [
      CLAVE_DE_PRUEBA.toUpperCase(),
      CLAVE_DE_PRUEBA.slice(0, 63),
      `${CLAVE_DE_PRUEBA}0`,
      comoNode(CLAVE_DE_OPERAR, "tinkazo-vigilante/prueba/v2"),
      comoNode(`${CLAVE_DE_OPERAR}x`),
      createHmac("sha256", CLAVE_DE_OPERAR).update(CONTEXTO_PRUEBA).digest("base64"),
    ];
    for (const malo of malos) expect((await pedir(m, malo)).status, malo).toBe(403);
    expect(m.correo.intentos).toBe(0);
    // Ninguno arrancó el enfriamiento: el bueno pasa enseguida.
    expect((await pedir(m, CLAVE_DE_PRUEBA)).status).toBe(200);
  });

  it("al portero le sigue llegando la clave de operar, no el derivado: la necesita para leer el estado", async () => {
    const m = mundoFalso();
    await pedir(m, CLAVE_DE_PRUEBA);
    expect(m.portero.llamadas.map((l) => l.autorizacion)).toEqual([`Bearer ${CLAVE_DE_OPERAR}`]);
  });
});
