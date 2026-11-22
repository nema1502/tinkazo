import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { listaDeLaCampana } from "../../workers/sala/src/campana";
import { CABECERA_DE_CACHE, VIDA_DE_LA_CACHE_S, esCacheable } from "../../workers/sala/src/cache";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * La caché corta del borde para el momento del resultado, con una caché de mentira que vence como la de Cloudflare: lo guardado
 * vive los segundos que dice su Cache-Control, y se mira con el reloj de la prueba.
 */
const AHORA = Date.UTC(2026, 10, 22, 15, 0, 0);
const RONDA = 40_000_000;
const SORTEO = "5150";
const OTRO_ORIGEN = "https://tinkazo-prueba.vercel.app";

interface Guardado {
  respuesta: Response;
  hasta: number;
}

/** Una caché con la forma de `caches.default`: la clave es la dirección, y cada entrada vence con su `max-age`. */
function cacheFalsa() {
  const guardado = new Map<string, Guardado>();
  const puestas: string[] = [];
  const buscadas: string[] = [];
  return {
    guardado,
    puestas,
    buscadas,
    async match(clave: Request): Promise<Response | undefined> {
      buscadas.push(clave.url);
      const hay = guardado.get(clave.url);
      if (!hay || hay.hasta <= Date.now()) return undefined;
      return hay.respuesta.clone();
    },
    async put(clave: Request, respuesta: Response): Promise<void> {
      const segundos = Number(/max-age=(\d+)/u.exec(respuesta.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
      puestas.push(clave.url);
      if (segundos > 0) guardado.set(clave.url, { respuesta: respuesta.clone(), hasta: Date.now() + segundos * 1000 });
    },
  };
}

describe("la caché corta de estado y resultado", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let personas: PersonaDePrueba[];
  let cache: ReturnType<typeof cacheFalsa>;

  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
  const ver = async (ruta: string, init: { origen?: string; token?: string } = {}): Promise<{ r: Response; c: Record<string, unknown> }> => {
    const cabeceras: Record<string, string> = {};
    if (init.origen !== undefined) cabeceras.Origin = init.origen;
    if (init.token !== undefined) cabeceras.Authorization = `Bearer ${init.token}`;
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana${ruta}`, { cabeceras });
    await mundo.esperarSegundoPlano();
    return { r, c: (await r.json()) as Record<string, unknown> };
  };
  const avanzar = (ms: number): void => void vi.setSystemTime(Date.now() + ms);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    cache = cacheFalsa();
    mundo = await montarMundo();
    // El Worker mira la caché del borde en cada pedido: acá es la de mentira.
    vi.stubGlobal("caches", { default: cache });
    sala = await campanaAbierta(mundo, AHORA);
    personas = [personaDePrueba(mundo, 1), personaDePrueba(mundo, 2), personaDePrueba(mundo, 3)];
    for (const p of personas) expect((await altaDe(mundo, sala.id, p)).status).toBe(201);
    cache.puestas.length = 0;
    cache.buscadas.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("la vida de la caché es de dos segundos y se dice en la cabecera", () => {
    expect(VIDA_DE_LA_CACHE_S).toBe(2);
    expect(CABECERA_DE_CACHE).toBe("public, max-age=2");
  });

  it("el estado sin pase y sin token se guarda: el segundo pedido no llega a la sala y el tercero, pasado el tiempo, sí", async () => {
    const primero = await ver("/estado");
    expect(primero.r.status).toBe(200);
    expect(primero.r.headers.get("Cache-Control")).toBe(CABECERA_DE_CACHE);
    expect(primero.c).toMatchObject({ fase: "abierta", total: 3 });
    expect(cache.puestas).toHaveLength(1);

    // La sala cambia, pero lo guardado sigue vivo: el pedido no llega al objeto.
    const cierre = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth() });
    expect(cierre.status).toBe(204);
    const segundo = await ver("/estado");
    expect(segundo.r.headers.get("Cache-Control")).toBe(CABECERA_DE_CACHE);
    expect(segundo.c.fase).toBe("abierta");
    expect(cache.puestas).toHaveLength(1);

    avanzar(VIDA_DE_LA_CACHE_S * 1000 + 1);
    const tercero = await ver("/estado");
    expect(tercero.c.fase).toBe("cerrada");
    expect(cache.puestas).toHaveLength(2);
  });

  it("cada origen recibe sus propios permisos aunque la respuesta venga de la caché", async () => {
    const delSitio = await ver("/estado", { origen: "https://tinkazo.app" });
    expect(delSitio.r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    const dePrueba = await ver("/estado", { origen: OTRO_ORIGEN });
    expect(cache.puestas).toHaveLength(1);
    expect(dePrueba.r.headers.get("Access-Control-Allow-Origin")).toBe(OTRO_ORIGEN);
    expect(dePrueba.r.headers.get("Vary")).toBe("Origin");
    const ajeno = await ver("/estado", { origen: "https://otro-sitio.example" });
    expect(ajeno.r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    expect(ajeno.r.headers.get("Access-Control-Allow-Origin")).not.toBe("https://otro-sitio.example");
  });

  it("un pedido con pase no se guarda ni se sirve de la caché", async () => {
    const pase = "A".repeat(16);
    const conPase = await ver(`/estado?p=${pase}`);
    expect(conPase.r.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.puestas).toHaveLength(0);
    expect(cache.buscadas).toHaveLength(0);
    // Y una respuesta guardada para todos no le llega a quien trae pase.
    await ver("/estado");
    expect(cache.puestas).toHaveLength(1);
    const otraVez = await ver(`/estado?p=${pase}`);
    expect(otraVez.r.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.puestas).toHaveLength(1);
  });

  it("un pedido con el token de quien organiza no se guarda ni se sirve de la caché, y trae lo suyo", async () => {
    await ver("/estado");
    expect(cache.puestas).toHaveLength(1);
    const buscadasAntes = cache.buscadas.length;
    const suyo = await ver("/estado", { token: sala.token });
    expect(suyo.r.headers.get("Cache-Control")).toBe("no-store");
    expect(suyo.c).toMatchObject({ tuya: true });
    expect(suyo.c).toHaveProperty("vias");
    expect(cache.puestas).toHaveLength(1);
    expect(cache.buscadas).toHaveLength(buscadasAntes);
    // Y lo que está en la caché nunca trae lo que es de quien organiza.
    const publico = [...cache.guardado.values()].map((g) => g.respuesta.clone());
    for (const r of publico) {
      const texto = await r.text();
      expect(texto).not.toContain("tuya");
      expect(texto).not.toContain("vias");
    }
  });

  it("un parámetro inventado no esquiva la caché: la clave es solo el camino", async () => {
    await ver("/estado");
    await ver("/estado?x=1");
    await ver("/estado?x=2");
    expect(cache.puestas).toHaveLength(1);
    expect([...cache.guardado.keys()]).toHaveLength(1);
    expect([...cache.guardado.keys()][0]).not.toContain("?");
  });

  it("el resultado que todavía no existe no se recuerda, y aparece apenas la sala lo guarda", async () => {
    const antes = await ver("/resultado");
    expect(antes.r.status).toBe(404);
    expect(antes.c).toEqual({ error: "sin-resultado" });
    // Ni el borde ni el navegador lo guardan: quien organiza lo lee en el momento exacto en que cambia.
    expect(antes.r.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.puestas).toHaveLength(0);

    // Se cierra, se sella y se guarda el resultado.
    expect((await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth() })).status).toBe(204);
    const orden = listaDeLaCampana(personas.map((p) => p.cuenta));
    const sello = {
      listHash: Buffer.from(listHash(orden)).toString("hex"),
      count: orden.length,
      numWinners: 2,
      sorteado: false,
      organizador: null,
      ronda: RONDA,
    };
    lectura.valor = { sello, ganadores: null };
    const sellada = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "sellada", sorteo: SORTEO },
      cabeceras: auth(),
    });
    expect(sellada.status).toBe(204);
    lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
    const guardado = await mundo.pedir(`/v1/sala/${sala.id}/campana/resultado`, {
      metodo: "PUT",
      cuerpo: { sorteo: SORTEO, comprobante: "/verificar.html?x=1" },
      cabeceras: auth(),
    });
    expect(guardado.status).toBe(204);

    // La lectura que sigue al aviso de la sala ya trae el resultado, sin esperar a que venza nada.
    const despues = await ver("/resultado");
    expect(despues.r.status).toBe(200);
    expect(despues.c).toMatchObject({ sorteo: SORTEO, comprobante: "/verificar.html?x=1" });
    expect(despues.r.headers.get("Cache-Control")).toBe(CABECERA_DE_CACHE);
    expect(despues.c.ganadoras).toHaveLength(2);

    // Y el resultado guardado se sirve a todos durante dos segundos.
    const puestas = cache.puestas.length;
    const otra = await ver("/resultado", { origen: OTRO_ORIGEN });
    expect(otra.c).toEqual(despues.c);
    expect(otra.r.headers.get("Access-Control-Allow-Origin")).toBe(OTRO_ORIGEN);
    expect(cache.puestas).toHaveLength(puestas);
  });

  it("un 404 de sin-resultado que haya quedado guardado de antes tampoco se sirve", async () => {
    await ver("/estado");
    const { guardar } = await import("../../workers/sala/src/cache");
    await guardar(new URL(`https://s.tinkazo.app/v1/sala/${sala.id}/campana/resultado`), 404, { error: "sin-resultado" });
    expect(cache.puestas).toHaveLength(2);
    const r = await ver("/resultado");
    expect(r.r.status).toBe(404);
    expect(r.r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("una sala que ya no existe también se recuerda, con su 404", async () => {
    const r = await mundo.pedir("/v1/sala/NoExist1/campana/estado");
    await mundo.esperarSegundoPlano();
    expect(r.status).toBe(404);
    expect(cache.puestas).toHaveLength(1);
  });

  it("lo que no es 200 ni 404 no se guarda", async () => {
    // Una forma de pase que no es válida llega al objeto como pase vacío y no cambia nada: el estado igual se guarda sin pase.
    // Lo que importa acá es que la caché solo recibe 200 y 404.
    const { guardar } = await import("../../workers/sala/src/cache");
    await guardar(new URL("https://s.tinkazo.app/v1/sala/x/campana/estado"), 502, { error: "red" });
    await guardar(new URL("https://s.tinkazo.app/v1/sala/x/campana/estado"), 429, { error: "cupo-conexion" });
    expect(cache.puestas).toHaveLength(0);
  });

  it("con la caché rota, el Worker contesta igual, sin guardar", async () => {
    vi.stubGlobal("caches", {
      default: {
        match: async () => {
          throw new Error("caída");
        },
        put: async () => {
          throw new Error("caída");
        },
      },
    });
    const r = await ver("/estado");
    expect(r.r.status).toBe(200);
    expect(r.c).toMatchObject({ fase: "abierta", total: 3 });
  });

  it("sin caché del borde (como en Node o en un entorno que no la tiene), todo sigue como siempre", async () => {
    vi.unstubAllGlobals();
    // El proveedor de mentira se instaló como fetch global: se deja como estaba para el resto de la prueba.
    const sinCache = await montarMundo();
    const otra = await campanaAbierta(sinCache, AHORA);
    const r = await sinCache.pedir(`/v1/sala/${otra.id}/campana/estado`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ fase: "abierta", total: 0 });
  });

  it("qué se considera cacheable: ni pase ni token", () => {
    const u = (consulta: string): URL => new URL(`https://s.tinkazo.app/v1/sala/x/campana/estado${consulta}`);
    expect(esCacheable(u(""), "")).toBe(true);
    expect(esCacheable(u("?x=1"), "")).toBe(true);
    expect(esCacheable(u("?p=abc"), "")).toBe(false);
    expect(esCacheable(u(""), "T".repeat(22))).toBe(false);
  });
});
