// POST /prueba: un enfriamiento de 60 segundos entre pruebas, y los secretos se comparan sin los espacios ni el salto de
// línea de los extremos (un secreto cargado con un salto de línea al final tiene que andar).
import { beforeEach, describe, expect, it } from "vitest";
import { BOT, CHAT, CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, PORTERO, estadoBien, mundoFalso } from "./mundo-falso";
import { ESPERA_PRUEBA_MS, olvidarPrueba, servir } from "./publica";

const BASE = "https://vigilante.tinkazo.app";
const con = (token?: string): RequestInit => ({ method: "POST", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
const pedir = (m: ReturnType<typeof mundoFalso>, init: RequestInit) => servir(new Request(`${BASE}/prueba`, init), m.env, m.dep);

beforeEach(() => olvidarPrueba());

describe("el enfriamiento entre pruebas", () => {
  it("son 60 segundos", () => {
    expect(ESPERA_PRUEBA_MS).toBe(60_000);
  });

  it("una segunda prueba enseguida no manda nada y dice cuánto esperar", async () => {
    const m = mundoFalso();
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
    expect(m.correo.enviados).toHaveLength(1);
    const r = await pedir(m, con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("60");
    expect(await r.json()).toEqual({ motivo: "espera", segundos: 60 });
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("dice cuántos segundos faltan, redondeando para arriba", async () => {
    const m = mundoFalso();
    await pedir(m, con(CLAVE_DE_PRUEBA));
    m.avanzar(20_500);
    const r = await pedir(m, con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { segundos: number }).segundos).toBe(40);
    expect(r.headers.get("Retry-After")).toBe("40");
  });

  it("pasados los 60 segundos deja probar otra vez", async () => {
    const m = mundoFalso();
    await pedir(m, con(CLAVE_DE_PRUEBA));
    m.avanzar(ESPERA_PRUEBA_MS - 1);
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(429);
    m.avanzar(1);
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("cuenta también si la prueba falló: no se insiste contra un correo roto", async () => {
    const m = mundoFalso();
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(502);
    m.correo.falla = null;
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(429);
    expect(m.correo.intentos).toBe(1);
  });

  it("los pedidos sin clave o con una clave mala no arrancan el enfriamiento", async () => {
    const m = mundoFalso();
    expect((await pedir(m, con())).status).toBe(401);
    expect((await pedir(m, con("otra-clave"))).status).toBe(403);
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
  });

  it("una prueba sin a quién avisar tampoco arranca el enfriamiento", async () => {
    const m = mundoFalso({ env: { AVISAR_A: undefined } });
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(409);
    m.env.AVISAR_A = "dueno@example.org";
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
  });

  it("el tope es de cada instancia del Worker: una instancia nueva, o un despliegue, deja probar enseguida", async () => {
    // Es un límite a propósito, no un error: es un resguardo contra un descuido, y lo que cuida la ruta es la clave.
    const m = mundoFalso();
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(429);
    olvidarPrueba();
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("la respuesta de espera no lleva nada privado", async () => {
    const m = mundoFalso({ conTelegram: true });
    await pedir(m, con(CLAVE_DE_PRUEBA));
    const cuerpo = await (await pedir(m, con(CLAVE_DE_PRUEBA))).text();
    for (const secreto of [CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, BOT, CHAT]) expect(cuerpo, secreto).not.toContain(secreto);
  });
});

describe("los secretos cargados con espacios o un salto de línea al final", () => {
  it("la clave de operar cargada con un salto de línea sigue sirviendo para /prueba (el derivado sale de la clave sin el salto)", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: `${CLAVE_DE_OPERAR}\n` } });
    const r = await pedir(m, con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(200);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("y también con espacios, y si el pedido trae la clave con un salto o un espacio de más", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: `  ${CLAVE_DE_OPERAR} \r\n` } });
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(200);
    olvidarPrueba();
    expect((await pedir(m, { method: "POST", headers: { Authorization: `Bearer ${CLAVE_DE_PRUEBA}   ` } })).status).toBe(200);
  });

  it("una clave de solo espacios es como no tener clave: la ruta no existe", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: " \n " } });
    expect((await pedir(m, con(CLAVE_DE_PRUEBA))).status).toBe(503);
  });

  it("al portero le llega la clave sin el salto de línea (con él, la cabecera no es válida)", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: `${CLAVE_DE_OPERAR}\n` } });
    const r = await m.vuelta();
    expect(r.salioBien).toBe(true);
    expect(m.portero.llamadas).toEqual([{ url: `${PORTERO}/v1/patrocinio/estado`, autorizacion: `Bearer ${CLAVE_DE_OPERAR}`, metodo: "GET" }]);
  });

  it("sin clave de verdad (solo espacios) la vuelta avisa que falta, como si no estuviera", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: "  \n" } });
    await m.vuelta();
    expect(m.portero.llamadas).toEqual([]);
    expect(m.correo.avisos[0]!.subject).toMatch(/falta la clave/i);
  });

  it("el bot y el chat de Telegram cargados con un salto de línea al final también sirven", async () => {
    const m = mundoFalso({ estado: estadoBien({ altasPausadas: true }), env: { TELEGRAM_BOT_TOKEN: `${BOT}\n`, TELEGRAM_CHAT_ID: `${CHAT}\n` } });
    await m.vuelta();
    expect(m.telegram.llamadas).toHaveLength(1);
    expect(m.telegram.llamadas[0]!.url).toBe(`https://api.telegram.org/bot${BOT}/sendMessage`);
    expect(m.telegram.llamadas[0]!.cuerpo.chat_id).toBe(CHAT);
  });

  it("la dirección de aviso cargada con un salto de línea al final también sirve", async () => {
    const m = mundoFalso({ env: { AVISAR_A: "dueno@example.org\n" } });
    await pedir(m, con(CLAVE_DE_PRUEBA));
    expect(m.correo.enviados[0]!.to).toEqual(["dueno@example.org"]);
  });
});
