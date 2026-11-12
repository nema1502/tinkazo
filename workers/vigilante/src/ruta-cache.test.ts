// GET / es público: cualquiera puede pedirlo. Para que una lluvia de pedidos casi nunca llegue al KV, lo que lee se
// guarda en memoria del Worker por 60 segundos. Una vuelta nueva se ve enseguida.
import { beforeEach, describe, expect, it } from "vitest";
import { mundoFalso } from "./mundo-falso";
import { CACHE_RUTA_MS, olvidarMemoriaDeLaRuta } from "./memoria-ruta";
import { servir } from "./publica";

const BASE = "https://vigilante.tinkazo.app";
const pedir = (m: ReturnType<typeof mundoFalso>) => servir(new Request(`${BASE}/`), m.env, m.dep);

beforeEach(() => olvidarMemoriaDeLaRuta());

describe("GET /: la memoria de 60 segundos", () => {
  it("el tiempo de guardado es de 60 segundos", () => {
    expect(CACHE_RUTA_MS).toBe(60_000);
  });

  it("cien pedidos seguidos leen el KV una sola vez", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    const antes = m.libro.lecturas;
    for (let i = 0; i < 100; i++) {
      const r = await pedir(m);
      expect(r.status).toBe(200);
    }
    expect(m.libro.lecturas - antes).toBe(1);
  });

  it("los pedidos que llegan a la vez comparten una sola lectura", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    const antes = m.libro.lecturas;
    const respuestas = await Promise.all(Array.from({ length: 50 }, () => pedir(m)));
    expect(respuestas.every((r) => r.status === 200)).toBe(true);
    expect(m.libro.lecturas - antes).toBe(1);
  });

  it("contesta lo mismo con la memoria que sin ella", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    const primero = await (await pedir(m)).text();
    const segundo = await (await pedir(m)).text();
    expect(segundo).toBe(primero);
    expect(JSON.parse(primero)).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: new Date(m.reloj.ahora).toISOString(), salioBien: true });
  });

  it("pasados los 60 segundos vuelve a leer el KV", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    await pedir(m);
    const antes = m.libro.lecturas;
    m.avanzar(CACHE_RUTA_MS - 1000);
    await pedir(m);
    expect(m.libro.lecturas - antes).toBe(0);
    m.avanzar(2000);
    await pedir(m);
    expect(m.libro.lecturas - antes).toBe(1);
  });

  it("una vuelta nueva se ve enseguida, sin esperar a que venza", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    const viejo = ((await (await pedir(m)).json()) as { ultimaVuelta: string }).ultimaVuelta;
    // Cinco segundos después, mucho antes de que venza el minuto guardado.
    m.avanzar(5_000);
    await m.vuelta();
    const nuevo = ((await (await pedir(m)).json()) as { ultimaVuelta: string }).ultimaVuelta;
    expect(Date.parse(nuevo) - Date.parse(viejo)).toBe(5_000);
  });

  it("también guarda que todavía no hubo ninguna vuelta", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    const antes = m.libro.lecturas;
    for (let i = 0; i < 20; i++) expect(await (await pedir(m)).json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
    expect(m.libro.lecturas - antes).toBe(1);
  });

  it("si el KV no se puede leer, la ruta contesta como sin vuelta y no se cae", async () => {
    const m = mundoFalso();
    await m.vuelta();
    olvidarMemoriaDeLaRuta();
    m.libro.fallaLectura = true;
    const r = await pedir(m);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
  });

  it("HEAD no necesita leer nada", async () => {
    const m = mundoFalso();
    olvidarMemoriaDeLaRuta();
    const antes = m.libro.lecturas;
    const r = await servir(new Request(`${BASE}/`, { method: "HEAD" }), m.env, m.dep);
    expect(r.status).toBe(200);
    expect(m.libro.lecturas - antes).toBe(0);
  });
});
