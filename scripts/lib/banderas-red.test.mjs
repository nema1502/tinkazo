// Prueba la lectura del sitio de scripts/check-banderas.mjs (scripts/lib/banderas.mjs): los reintentos,
// el tope de tiempo, los archivos que no bajan y que ningún informe lleve lo que el sitio contestó.
// La red entra por parámetro: no se llama a ningún servicio.
import { describe, expect, it } from "vitest";
import { bajarConReintentos, describirNoBajaron, leerDelSitio } from "./banderas.mjs";

/** Una respuesta de mentira de fetch. */
const respuesta = (estado, texto = "") => ({ ok: estado >= 200 && estado < 300, status: estado, text: async () => texto });

describe("bajarConReintentos", () => {
  /** Un fetch de mentira que contesta lo que diga la lista, una respuesta por llamada (la última se repite). */
  function fetchDeMentira(contestaciones) {
    const llamadas = [];
    const fetchFn = async (url, init) => {
      llamadas.push({ url, init });
      const c = contestaciones[Math.min(llamadas.length - 1, contestaciones.length - 1)];
      if (c instanceof Error) throw c;
      return c;
    };
    return { fetchFn, llamadas };
  }
  const sinEspera = () => {
    const esperas = [];
    return { esperas, dormir: async (ms) => void esperas.push(ms) };
  };

  it("a la primera: una sola llamada, sin esperar", async () => {
    const { fetchFn, llamadas } = fetchDeMentira([respuesta(200, "hola")]);
    const { dormir, esperas } = sinEspera();
    await expect(bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir })).resolves.toBe("hola");
    expect(llamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
    expect(llamadas[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("un corte y una respuesta 503 se reintentan, con una espera corta entre cada intento, y a la tercera baja", async () => {
    const { fetchFn, llamadas } = fetchDeMentira([new TypeError("fetch failed"), respuesta(503), respuesta(200, "listo")]);
    const { dormir, esperas } = sinEspera();
    await expect(bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir, esperaMs: 700 })).resolves.toBe("listo");
    expect(llamadas).toHaveLength(3);
    expect(esperas).toEqual([700, 700]);
  });

  it("si los tres intentos fallan lo da por caído y dice cuántos hizo y qué contestó el sitio", async () => {
    const { fetchFn, llamadas } = fetchDeMentira([respuesta(502)]);
    const { dormir } = sinEspera();
    await expect(bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir })).rejects.toThrow("el sitio contestó 502, en 3 intentos");
    expect(llamadas).toHaveLength(3);
  });

  it("un archivo que no termina de llegar cuenta como corte y se reintenta", async () => {
    const lento = Object.assign(new Error("agotado"), { name: "TimeoutError" });
    const { fetchFn, llamadas } = fetchDeMentira([lento, respuesta(200, "ok")]);
    await expect(bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir: async () => {} })).resolves.toBe("ok");
    expect(llamadas).toHaveLength(2);
  });

  it("el error nunca lleva lo que el sitio contestó", async () => {
    const secreto = "pub_ABCDEF1234567890SECRETO";
    const { fetchFn } = fetchDeMentira([respuesta(500, secreto)]);
    let error;
    await bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir: async () => {} }).catch((e) => (error = e));
    expect(error.message).not.toContain("SECRETO");
  });

  it("con el tiempo total vencido no pide nada y lanza SinTiempo", async () => {
    const { fetchFn, llamadas } = fetchDeMentira([respuesta(200, "x")]);
    let error;
    await bajarConReintentos("https://x.example.org/a.js", { fetchFn, limite: 1000, ahora: () => 1000 }).catch((e) => (error = e));
    expect(error.sinTiempo).toBe(true);
    expect(llamadas).toHaveLength(0);
  });

  it("no espera ni reintenta más allá del tiempo total", async () => {
    let reloj = 0;
    const { fetchFn, llamadas } = fetchDeMentira([respuesta(503)]);
    const esperas = [];
    const dormir = async (ms) => {
      esperas.push(ms);
      reloj += ms;
    };
    let error;
    await bajarConReintentos("https://x.example.org/a.js", { fetchFn, dormir, ahora: () => reloj, limite: 2000, esperaMs: 1500 }).catch((e) => (error = e));
    // El primer intento, otro tras 1500 ms, y la segunda espera ya se come el resto (500 ms): ahí se vence.
    expect(esperas).toEqual([1500, 500]);
    expect(error.sinTiempo).toBe(true);
    expect(llamadas).toHaveLength(2);
  });
});

describe("leerDelSitio", () => {
  const BASE = "https://sitio.example.org";
  const portada = (...archivos) => archivos.map((a) => `<script type="module" src="${a}"></script>`).join("");
  const CON_OBJETO = "var e={BASE_URL:`/`,VITE_PAGOS:`1`};";
  /** Un `bajar` de mentira desde un mapa dirección a texto. Una dirección con un Error lanza ese error, y una que falta da 404. */
  const desdeMapa = (mapa) => async (url) => {
    const v = mapa[url];
    if (v === undefined) throw new Error("el sitio contestó 404, en 3 intentos");
    if (v instanceof Error) throw v;
    return v;
  };

  it("junta las copias de todos los archivos de la portada", async () => {
    const bajar = desdeMapa({
      [`${BASE}/`]: portada("/assets/a.js", "/assets/b.js"),
      [`${BASE}/assets/a.js`]: CON_OBJETO,
      [`${BASE}/assets/b.js`]: "nada",
    });
    const r = await leerDelSitio({ base: BASE, bajar });
    expect(r.copias).toHaveLength(1);
    expect(r.copias[0].get("VITE_PAGOS")).toBe("1");
    expect(r.archivos).toBe(2);
    expect(r.noBajaron).toEqual([]);
    expect(r.sinTiempo).toBe(false);
  });

  it("un archivo que no baja se cuenta y se nombra, y no impide leer los otros", async () => {
    const bajar = desdeMapa({
      [`${BASE}/`]: portada("/assets/a.js", "/assets/b.js"),
      [`${BASE}/assets/a.js`]: new Error("el sitio contestó 503, en 3 intentos"),
      [`${BASE}/assets/b.js`]: CON_OBJETO,
    });
    const r = await leerDelSitio({ base: BASE, bajar });
    expect(r.copias).toHaveLength(1);
    expect(r.archivos).toBe(1);
    expect(r.noBajaron).toEqual([{ ruta: "/assets/a.js", motivo: "el sitio contestó 503, en 3 intentos" }]);
  });

  it("si ninguno baja, los nombra a todos: no se saltea ninguno en silencio", async () => {
    const bajar = desdeMapa({ [`${BASE}/`]: portada("/assets/a.js", "/assets/b.js", "/assets/c.js") });
    const r = await leerDelSitio({ base: BASE, bajar });
    expect(r.copias).toEqual([]);
    expect(r.archivos).toBe(0);
    expect(r.noBajaron.map((f) => f.ruta).sort()).toEqual(["/assets/a.js", "/assets/b.js", "/assets/c.js"]);
  });

  it("la portada que no baja lanza el error, y la que no nombra archivos también", async () => {
    await expect(leerDelSitio({ base: BASE, bajar: desdeMapa({}) })).rejects.toThrow("404");
    await expect(leerDelSitio({ base: BASE, bajar: desdeMapa({ [`${BASE}/`]: "<html></html>" }) })).rejects.toThrow("ningún archivo de código");
  });

  it("sin copia en la portada sigue los enlaces relativos, y con copia no los sigue", async () => {
    const pedidos = [];
    const mapa = {
      [`${BASE}/`]: portada("/assets/a.js"),
      [`${BASE}/assets/a.js`]: 'import("./b.js")',
      [`${BASE}/assets/b.js`]: CON_OBJETO,
    };
    const r = await leerDelSitio({ base: BASE, bajar: async (url) => (pedidos.push(url), desdeMapa(mapa)(url)) });
    expect(r.copias).toHaveLength(1);
    expect(pedidos).toContain(`${BASE}/assets/b.js`);

    const pedidos2 = [];
    const mapa2 = { ...mapa, [`${BASE}/assets/a.js`]: `${CON_OBJETO}import("./b.js")` };
    await leerDelSitio({ base: BASE, bajar: async (url) => (pedidos2.push(url), desdeMapa(mapa2)(url)) });
    expect(pedidos2).not.toContain(`${BASE}/assets/b.js`);
  });

  it("no pasa del tope de archivos ni baja dos veces el mismo", async () => {
    const mapa = { [`${BASE}/`]: portada("/assets/a.js") };
    for (let i = 0; i < 20; i++) mapa[`${BASE}/assets/${i === 0 ? "a" : `n${i}`}.js`] = `import("./n${i + 1}.js");import("./a.js")`;
    const pedidos = [];
    const r = await leerDelSitio({ base: BASE, bajar: async (url) => (pedidos.push(url), desdeMapa(mapa)(url)), maxArchivos: 5 });
    expect(pedidos.filter((u) => u.endsWith("/assets/a.js"))).toHaveLength(1);
    expect(r.archivos + r.noBajaron.length).toBeLessThanOrEqual(5);
  });

  it("baja varios a la vez, pero no más de los permitidos", async () => {
    const nombres = Array.from({ length: 12 }, (_, i) => `/assets/f${i}.js`);
    let activos = 0;
    let maximo = 0;
    const bajar = async (url) => {
      if (url === `${BASE}/`) return portada(...nombres);
      activos++;
      maximo = Math.max(maximo, activos);
      await new Promise((r) => setTimeout(r, 5));
      activos--;
      return "nada";
    };
    const r = await leerDelSitio({ base: BASE, bajar, simultaneos: 4 });
    expect(r.archivos).toBe(12);
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(4);
  });

  it("si vence el tiempo total para y dice cuáles quedaron sin pedir", async () => {
    let reloj = 0;
    const bajar = async (url) => {
      if (url === `${BASE}/`) return portada("/assets/a.js", "/assets/b.js", "/assets/c.js");
      reloj += 40;
      return "nada";
    };
    const r = await leerDelSitio({ base: BASE, bajar, simultaneos: 1, limite: 50, ahora: () => reloj });
    expect(r.sinTiempo).toBe(true);
    expect(r.archivos).toBe(2);
    expect(r.noBajaron).toEqual([{ ruta: "/assets/c.js", motivo: "no hubo tiempo para pedirlo" }]);
  });

  it("un SinTiempo de la bajada también corta la lectura", async () => {
    const bajar = async (url) => {
      if (url === `${BASE}/`) return portada("/assets/a.js");
      throw Object.assign(new Error("se acabó el tiempo total de la lectura"), { sinTiempo: true });
    };
    const r = await leerDelSitio({ base: BASE, bajar });
    expect(r.sinTiempo).toBe(true);
    expect(r.noBajaron).toHaveLength(1);
  });

  it("lo que cuenta de un archivo caído nunca trae sus parámetros", async () => {
    const bajar = desdeMapa({ [`${BASE}/`]: portada("/assets/a.js?clave=pub_SECRETO") });
    const r = await leerDelSitio({ base: BASE, bajar });
    expect(JSON.stringify(r.noBajaron)).not.toContain("SECRETO");
  });
});

describe("describirNoBajaron", () => {
  const f = (n) => ({ ruta: `/assets/${n}.js`, motivo: "el sitio contestó 503, en 3 intentos" });

  it("vacía si todos bajaron", () => {
    expect(describirNoBajaron([])).toBe("");
  });

  it("nombra hasta cinco y cuenta el resto", () => {
    expect(describirNoBajaron([f("a")])).toBe("no bajó 1 archivo de código (/assets/a.js), último motivo: el sitio contestó 503, en 3 intentos");
    const siete = describirNoBajaron(["a", "b", "c", "d", "e", "f", "g"].map(f));
    expect(siete).toContain("no bajaron 7 archivos de código");
    expect(siete).toContain("/assets/e.js y 2 más");
    expect(siete).not.toContain("/assets/f.js");
  });
});
