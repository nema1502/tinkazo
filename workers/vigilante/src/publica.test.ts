// Las rutas del vigilante: la pública (GET /, que dice si sigue vivo y nada más) y la de prueba (POST /prueba, con el
// derivado de la clave de operar). Con el KV, el correo y el portero de mentira: ninguna prueba toca una red de verdad.
import { describe, expect, it } from "vitest";
import { BOT, CHAT, CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, DESTINO, T0, estadoBien, mundoFalso } from "./mundo-falso";
import { servir } from "./publica";

const BASE = "https://vigilante.tinkazo.app";
const pedir = (m: ReturnType<typeof mundoFalso>, ruta: string, init: RequestInit = {}) => servir(new Request(`${BASE}${ruta}`, init), m.env, m.dep);

describe("GET /: está vivo", () => {
  it("antes de la primera vuelta no hay hora ni vuelta buena", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    const r = await pedir(m, "/");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
  });

  it("después de una vuelta dice la hora y que salió bien, y no dice nada más", async () => {
    const m = mundoFalso();
    await m.vuelta();
    const r = await pedir(m, "/");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(JSON.stringify({ servicio: "tinkazo-vigilante", ultimaVuelta: new Date(T0).toISOString(), salioBien: true }));
  });

  it("si la última vuelta no pudo mirar al portero, dice que no salió bien", async () => {
    const m = mundoFalso();
    m.portero.falla = "red";
    await m.vuelta();
    const j = (await (await pedir(m, "/")).json()) as Record<string, unknown>;
    expect(j.salioBien).toBe(false);
    expect(j.ultimaVuelta).toBe(new Date(T0).toISOString());
  });

  it("no deja ver nada privado: ni cifras, ni problemas, ni direcciones, ni claves, ni el portero", async () => {
    const m = mundoFalso({ estado: estadoBien({ creditos: 2400, margen: 400, altasPausadas: true, balanceStroops: "253000000" }), conTelegram: true });
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    await m.vuelta();
    // Ahora el KV tiene claves de problemas, un aviso pendiente con cifras y el resumen de la ranura.
    const guardado = [...m.libro.datos.values()].join("\n");
    expect(guardado).toContain("2.400");
    const r = await pedir(m, "/");
    const cuerpo = await r.text();
    const cabeceras = JSON.stringify([...r.headers.entries()]);
    const visible = `${cuerpo}\n${cabeceras}`;
    for (const secreto of [CLAVE_DE_OPERAR, DESTINO, BOT, CHAT, "2.400", "2400", "253", "25,3", "creditos", "altas", "pendientes", "claves", "pm.tinkazo.app", "Bearer", "XLM"]) {
      expect(visible, secreto).not.toContain(secreto);
    }
    expect(Object.keys(JSON.parse(cuerpo) as object).sort()).toEqual(["salioBien", "servicio", "ultimaVuelta"]);
  });

  it("no se guarda en ninguna caché y no se indexa", async () => {
    const m = mundoFalso();
    const r = await pedir(m, "/");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(r.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("con el KV roto o con lo guardado roto, contesta lo mismo que si no hubiera vuelta", async () => {
    const m = mundoFalso();
    m.libro.fallaLectura = true;
    expect(await (await pedir(m, "/")).json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
    const n = mundoFalso();
    n.libro.datos.set("memoria", "{roto");
    expect(await (await pedir(n, "/")).json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
  });

  it("HEAD contesta sin cuerpo; otros métodos, 405; otras rutas, 404", async () => {
    const m = mundoFalso();
    const head = await pedir(m, "/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const metodo of ["POST", "PUT", "DELETE"]) {
      const r = await pedir(m, "/", { method: metodo });
      expect(r.status, metodo).toBe(405);
      expect(r.headers.get("Allow")).toBe("GET, HEAD");
    }
    for (const ruta of ["/estado", "/memoria", "/v1/patrocinio/estado", "/index.html", "/robots.txt"]) {
      expect((await pedir(m, ruta)).status, ruta).toBe(404);
    }
  });

  it("leerla no escribe nada ni llama al portero", async () => {
    const m = mundoFalso();
    await pedir(m, "/");
    expect(m.libro.escrituras).toBe(0);
    expect(m.portero.llamadas).toEqual([]);
    expect(m.correo.intentos).toBe(0);
  });
});

describe("POST /prueba: forzar un aviso", () => {
  const con = (token?: string): RequestInit => ({ method: "POST", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });

  it("sin la clave de operar no hace nada: 401", async () => {
    const m = mundoFalso();
    const r = await pedir(m, "/prueba", con());
    expect(r.status).toBe(401);
    expect(m.correo.intentos).toBe(0);
    expect(m.portero.llamadas).toEqual([]);
  });

  it("con una clave que no es: 403, y tampoco manda nada", async () => {
    const m = mundoFalso();
    for (const mala of ["otra-clave", CLAVE_DE_OPERAR, `${CLAVE_DE_PRUEBA}x`, CLAVE_DE_PRUEBA.slice(0, -1), CLAVE_DE_PRUEBA.toUpperCase(), ""]) {
      const r = await pedir(m, "/prueba", { method: "POST", headers: { Authorization: `Bearer ${mala}` } });
      expect(r.status, mala).toBe(mala === "" ? 401 : 403);
    }
    expect(m.correo.intentos).toBe(0);
  });

  it("sin la clave cargada en el vigilante, la ruta no existe: 503", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: undefined } });
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(503);
    expect(m.correo.intentos).toBe(0);
  });

  it("con la clave manda un aviso de prueba por el correo, con las cifras de ahora, y lo cuenta", async () => {
    const m = mundoFalso();
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ correo: "enviado", telegram: "apagado" });
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toBe("Prueba del vigilante: el aviso llega");
    expect(m.correo.enviados[0]!.text).toContain("9.000");
    expect(m.correo.enviados[0]!.to).toEqual([DESTINO]);
  });

  it("no toca lo recordado: una prueba no cambia lo que ya se avisó ni lo que viene", async () => {
    const m = mundoFalso({ estado: estadoBien({ creditos: 2400, margen: 400 }) });
    await m.vuelta();
    const antes = m.libro.datos.get("memoria");
    const escrituras = m.libro.escrituras;
    await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(m.libro.datos.get("memoria")).toBe(antes);
    expect(m.libro.escrituras).toBe(escrituras);
  });

  it("también por Telegram si está prendido", async () => {
    const m = mundoFalso({ conTelegram: true });
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(await r.json()).toEqual({ correo: "enviado", telegram: "enviado" });
    expect(m.telegram.llamadas).toHaveLength(1);
  });

  it("si el correo falla dice por qué (el código de Cloudflare) y contesta 502", async () => {
    const m = mundoFalso();
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ correo: "error", codigo: "E_RECIPIENT_NOT_ALLOWED", telegram: "apagado" });
  });

  it("si no hay a quién avisar, lo dice", async () => {
    const m = mundoFalso({ env: { AVISAR_A: undefined } });
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ correo: "sin-configurar", telegram: "apagado" });
  });

  it("si el portero no contesta, el aviso de prueba igual sale y lo dice", async () => {
    const m = mundoFalso();
    m.portero.falla = "red";
    const r = await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA));
    expect(r.status).toBe(200);
    expect(m.correo.enviados[0]!.text).toMatch(/no contestó/i);
  });

  it("la respuesta no repite ninguna dirección ni clave", async () => {
    const m = mundoFalso({ conTelegram: true });
    m.correo.falla = "E_DELIVERY_FAILED";
    m.correo.send = async () => {
      throw Object.assign(new Error(`falló para ${DESTINO}`), { code: "E_DELIVERY_FAILED" });
    };
    const cuerpo = await (await pedir(m, "/prueba", con(CLAVE_DE_PRUEBA))).text();
    for (const secreto of [DESTINO, CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, BOT, CHAT]) expect(cuerpo, secreto).not.toContain(secreto);
  });

  it("solo acepta POST", async () => {
    const m = mundoFalso();
    const r = await pedir(m, "/prueba", { headers: { Authorization: `Bearer ${CLAVE_DE_PRUEBA}` } });
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("POST");
  });
});
