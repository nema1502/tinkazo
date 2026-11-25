import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { conTope, correrConPlazo, crearComprobadorDeRutas, describirGraficos, problemaAlTerminar, problemaDeTemaEIdioma, problemaDelDocumento, recorrerVistas, vigilarDocumentos } from "./vistas-pagina.mjs";
import { validarVistas } from "./vistas.mjs";

const BASE = "http://localhost:4173";
const PORTADA = "<html>portada</html>";

/** Un servidor de mentira: cada camino tiene su estado y su texto. Lo que no está, devuelve la portada (como la vista previa). */
function servidor(paginas = {}, { sinRespaldo = false } = {}) {
  const pedidos = [];
  const buscar = async (url) => {
    pedidos.push(url);
    const camino = new URL(url).pathname;
    const p = camino === "/" ? { estado: 200, texto: PORTADA } : paginas[camino] ?? (sinRespaldo ? { estado: 404, texto: "no hay" } : { estado: 200, texto: PORTADA });
    return { status: p.estado, ok: p.estado >= 200 && p.estado < 300, text: async () => p.texto };
  };
  return { buscar, pedidos };
}

describe("crearComprobadorDeRutas: una ruta mal escrita no saca la portada", () => {
  const comprobar = (srv, ruta) => crearComprobadorDeRutas(BASE, srv.buscar)(ruta);

  it("la portada y su consulta pasan sin pedir nada de más", async () => {
    const srv = servidor();
    expect(await comprobar(srv, "/?demo=wheel&lead=3")).toBe("");
    expect(await comprobar(srv, "/index.html")).toBe("");
    expect(srv.pedidos).toEqual([]);
  });

  it("una página que existe pasa", async () => {
    const srv = servidor({ "/seguridad.html": { estado: 200, texto: "<html>seguridad</html>" } });
    expect(await comprobar(srv, "/seguridad.html")).toBe("");
    expect(await comprobar(srv, "/seguridad.html?lang=en#arriba")).toBe("");
  });

  it("una ruta sin .html que el servidor contesta con la portada se rechaza", async () => {
    const srv = servidor({ "/seguridad.html": { estado: 200, texto: "<html>seguridad</html>" } });
    const motivo = await comprobar(srv, "/seguridad");
    expect(motivo).toContain("/seguridad");
    expect(motivo).toMatch(/portada/);
  });

  it("un camino que el servidor contesta con error se rechaza con su estado", async () => {
    const srv = servidor({}, { sinRespaldo: true });
    expect(await comprobar(srv, "/no-esta.html")).toMatch(/404.*\/no-esta\.html/);
  });

  it("pide el camino sin la consulta ni el fragmento, que pueden traer claves", async () => {
    const srv = servidor({ "/c.html": { estado: 200, texto: "<html>c</html>" } });
    await comprobar(srv, "/c.html?clave=secreta#otra");
    expect(srv.pedidos.filter((p) => p.includes("c.html"))).toEqual([`${BASE}/c.html`]);
  });

  it("la portada se pide una sola vez aunque haya muchas rutas", async () => {
    const srv = servidor({ "/a.html": { estado: 200, texto: "a" }, "/b.html": { estado: 200, texto: "b" } });
    const c = crearComprobadorDeRutas(BASE, srv.buscar);
    await c("/a.html");
    await c("/b.html");
    expect(srv.pedidos.filter((p) => p === `${BASE}/`)).toHaveLength(1);
  });
});

describe("problemaDelDocumento: el estado y el camino de lo que cargó", () => {
  const ok = (url = `${BASE}/seguridad.html`) => ({ estado: 200, direccion: url });

  it("un documento con 200 en el camino pedido está bien", () => {
    expect(problemaDelDocumento({ respuestas: [ok()], caminoPedido: "/seguridad.html", caminoCargado: "/seguridad.html" })).toBe("");
  });

  it("la portada pedida como / o como /index.html es lo mismo", () => {
    expect(problemaDelDocumento({ respuestas: [ok(`${BASE}/`)], caminoPedido: "/", caminoCargado: "/index.html" })).toBe("");
  });

  it("un estado que no es 2xx falla y lo nombra", () => {
    const r = [{ estado: 404, direccion: `${BASE}/nada.html` }];
    expect(problemaDelDocumento({ respuestas: r, caminoPedido: "/nada.html", caminoCargado: "/nada.html" })).toMatch(/404.*\/nada\.html/);
    expect(problemaDelDocumento({ respuestas: [{ estado: 500, direccion: `${BASE}/` }], caminoPedido: "/" })).toMatch(/500/);
  });

  it("un camino final distinto del pedido falla", () => {
    expect(problemaDelDocumento({ respuestas: [ok()], caminoPedido: "/seguridad.html", caminoCargado: "/" })).toMatch(/\/seguridad\.html.*terminó en \//);
  });

  it("sin ninguna respuesta no se puede afirmar que salió bien", () => {
    expect(problemaDelDocumento({ respuestas: [], caminoPedido: "/", caminoCargado: "/" })).toMatch(/no pude comprobar/);
  });

  it("sin camino cargado (al final de los pasos) solo mira los estados", () => {
    expect(problemaDelDocumento({ respuestas: [ok(), ok(`${BASE}/juegos.html`)], caminoPedido: "/seguridad.html" })).toBe("");
  });
});

describe("vigilarDocumentos: los estados de los documentos de la pestaña principal", () => {
  function paginaFalsa() {
    const ws = new EventTarget();
    const p = {
      ws,
      enviados: [],
      async send(metodo) {
        p.enviados.push(metodo);
        if (metodo === "Page.getFrameTree") return { frameTree: { frame: { id: "PRINCIPAL" } } };
        return {};
      },
      llega(parametros) {
        ws.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify({ method: "Network.responseReceived", params: parametros }) }));
      },
    };
    return p;
  }
  const respuesta = (url, status, extra = {}) => ({ type: "Document", frameId: "PRINCIPAL", response: { url, status }, ...extra });

  it("guarda solo los documentos del marco principal, sin la consulta", async () => {
    const page = paginaFalsa();
    const docs = await vigilarDocumentos(page);
    expect(page.enviados).toContain("Network.enable");
    page.llega(respuesta(`${BASE}/seguridad.html?clave=secreta#x`, 200));
    page.llega(respuesta(`${BASE}/hijo.html`, 404, { frameId: "HIJO" }));
    page.llega(respuesta(`${BASE}/logo.png`, 200, { type: "Image" }));
    expect(docs.respuestas).toEqual([{ estado: 200, direccion: `${BASE}/seguridad.html` }]);
    expect(docs.ultimo()).toEqual({ estado: 200, direccion: `${BASE}/seguridad.html` });
  });

  it("ignora los mensajes que no son suyos", async () => {
    const page = paginaFalsa();
    const docs = await vigilarDocumentos(page);
    page.ws.dispatchEvent(Object.assign(new Event("message"), { data: "no es json" }));
    expect(docs.respuestas).toEqual([]);
    expect(docs.ultimo()).toBeNull();
  });
});

describe("problemaDeTemaEIdioma: la página salió como se pidió", () => {
  const leido = { tema: "dark", idioma: "es" };

  it("sin pedir nada, no hay nada que comparar", () => {
    expect(problemaDeTemaEIdioma({ tema: null, idioma: null }, leido)).toBe("");
  });

  it("lo pedido y lo leído coinciden", () => {
    expect(problemaDeTemaEIdioma({ tema: "dark", idioma: "es" }, leido)).toBe("");
  });

  it("un tema distinto falla y dice los dos", () => {
    const m = problemaDeTemaEIdioma({ tema: "light", idioma: null }, leido);
    expect(m).toContain("light");
    expect(m).toContain("dark");
    expect(m).toMatch(/tema/);
  });

  it("un idioma distinto, o ninguno, falla", () => {
    expect(problemaDeTemaEIdioma({ tema: null, idioma: "en" }, leido)).toMatch(/idioma.*en.*es/);
    expect(problemaDeTemaEIdioma({ tema: null, idioma: "en" }, { tema: "dark", idioma: "" })).toMatch(/idioma/);
  });
});

describe("describirGraficos: con qué se dibujó la página", () => {
  it("sin webgl2 lo dice", () => {
    expect(describirGraficos({ webgl2: false, renderizador: null })).toEqual({ webgl2: false, renderizador: null, porSoftware: null });
  });

  it("un dibujo por software se marca como tal", () => {
    expect(describirGraficos({ webgl2: true, renderizador: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" }).porSoftware).toBe(true);
    expect(describirGraficos({ webgl2: true, renderizador: "llvmpipe (LLVM 15.0.7, 256 bits)" }).porSoftware).toBe(true);
  });

  it("una placa de video de verdad no", () => {
    expect(describirGraficos({ webgl2: true, renderizador: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)" }).porSoftware).toBe(false);
  });

  it("con webgl2 pero sin saber la placa, no afirma nada", () => {
    expect(describirGraficos({ webgl2: true, renderizador: null }).porSoftware).toBeNull();
  });
});

describe("correrConPlazo: una vista que se pasó no puede terminar bien después", () => {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  it("si termina a tiempo devuelve lo que anotó", async () => {
    const r = await correrConPlazo(async (datos) => {
      datos.ok = true;
      datos.archivo = "a.png";
    }, 500, "tarde");
    expect(r).toMatchObject({ ok: true, error: null, datos: { ok: true, archivo: "a.png" } });
  });

  it("si se pasa, falla con el motivo y lo que escriba después se ignora", async () => {
    let anotadoTarde = false;
    let vigenteAlFinal = null;
    let datosDelTrabajo;
    const r = await correrConPlazo(async (datos, vigente) => {
      datosDelTrabajo = datos;
      datos.direccionFinal = "http://localhost:4173/";
      await dormir(120);
      vigenteAlFinal = vigente();
      datos.ok = true;
      datos.archivo = "tarde.png";
      anotadoTarde = true;
    }, 30, "la vista tardó más de la cuenta");
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe("la vista tardó más de la cuenta");
    expect(r.datos).toEqual({ direccionFinal: "http://localhost:4173/" });
    await dormir(200);
    expect(anotadoTarde).toBe(true);
    expect(vigenteAlFinal).toBe(false);
    expect(r.datos.ok).toBeUndefined();
    expect(datosDelTrabajo.ok).toBe(true);
  });

  it("un error del trabajo sale como error y deja lo anotado hasta ahí", async () => {
    const r = await correrConPlazo(async (datos) => {
      datos.imagenesEnLaFoto = 3;
      throw new Error("paso 1 (clic): #x está apagado");
    }, 500, "tarde");
    expect(r.ok).toBe(false);
    expect(r.error.message).toContain("está apagado");
    expect(r.datos).toEqual({ imagenesEnLaFoto: 3 });
  });

  it("el trabajo que falla después del plazo no deja un rechazo sin atender", async () => {
    const sueltos = [];
    const oyente = (e) => sueltos.push(e);
    process.on("unhandledRejection", oyente);
    try {
      await correrConPlazo(async () => {
        await dormir(60);
        throw new Error("tarde y mal");
      }, 10, "plazo");
      await dormir(150);
    } finally {
      process.off("unhandledRejection", oyente);
    }
    expect(sueltos).toEqual([]);
  });
});

describe("conTope", () => {
  it("falla si tarda más y no deja el reloj vivo", async () => {
    await expect(conTope(new Promise(() => undefined), 20)).rejects.toThrow(/no contestó/);
    await expect(conTope(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe("recorrerVistas: el informe trae una fila por cada vista pedida", () => {
  const vistas = ["a", "b", "c", "d"].map((nombre) => ({ nombre }));
  const sinHacer = (v, motivo) => ({ nombre: v.nombre, ok: false, sinHacer: true, error: `no se hizo: ${motivo}` });
  const siempre = () => ({ hacer: true, plazoMs: 1000, porElTotal: false });

  async function correr(capturar, extra = {}) {
    const filas = [];
    await recorrerVistas({ vistas, capturar, sinHacer, planear: siempre, motivoDelTotal: "se acabó el tiempo total", ahora: () => 0, alTerminar: (f) => filas.push(f), ...extra });
    return filas;
  }

  it("con todo bien, una fila por vista y en orden", async () => {
    const filas = await correr(async (v) => ({ nombre: v.nombre, ok: true }));
    expect(filas.map((f) => f.nombre)).toEqual(["a", "b", "c", "d"]);
    expect(filas.every((f) => f.ok)).toBe(true);
  });

  it("si no se puede abrir la pestaña, esa vista queda con su error y las que faltan como no hechas con ese motivo", async () => {
    const filas = await correr(async (v) => {
      if (v.nombre === "b") throw new Error("no contestó en 30 s");
      return { nombre: v.nombre, ok: true };
    });
    expect(filas).toHaveLength(4);
    expect(filas[0].ok).toBe(true);
    expect(filas[1]).toMatchObject({ nombre: "b", ok: false });
    expect(filas[1].error).toContain("no contestó en 30 s");
    for (const f of filas.slice(2)) {
      expect(f).toMatchObject({ ok: false, sinHacer: true });
      expect(f.error).toContain("no contestó en 30 s");
    }
  });

  it("una vista que avisa que el navegador ya no contesta corta a las demás", async () => {
    const filas = await correr(async (v) => (v.nombre === "a" ? { nombre: "a", ok: false, error: "x", navegadorCaido: true } : { nombre: v.nombre, ok: true }));
    expect(filas).toHaveLength(4);
    expect(filas[0].ok).toBe(false);
    expect(filas.slice(1).every((f) => f.sinHacer)).toBe(true);
    expect(filas[1].error).toMatch(/navegador/);
  });

  it("una vista que falla por su cuenta no corta a las demás", async () => {
    const filas = await correr(async (v) => ({ nombre: v.nombre, ok: v.nombre !== "b", error: v.nombre === "b" ? "mala" : null }));
    expect(filas.map((f) => f.ok)).toEqual([true, false, true, true]);
    expect(filas.some((f) => f.sinHacer)).toBe(false);
  });

  it("si se acabó el tiempo total, las que faltan quedan marcadas con ese motivo", async () => {
    let reloj = 0;
    const filas = await correr(
      async (v) => {
        reloj += 100;
        return { nombre: v.nombre, ok: true };
      },
      { ahora: () => reloj, planear: (gastado) => (gastado >= 200 ? { hacer: false, plazoMs: 0, porElTotal: true } : siempre()) },
    );
    expect(filas.map((f) => f.ok)).toEqual([true, true, false, false]);
    expect(filas[2].error).toContain("se acabó el tiempo total");
  });

  it("si el navegador ni arrancó, todas quedan marcadas con el motivo", async () => {
    let llamadas = 0;
    const filas = await correr(async () => ++llamadas, { sinNavegador: "no encontré Chrome" });
    expect(llamadas).toBe(0);
    expect(filas).toHaveLength(4);
    expect(filas.every((f) => f.sinHacer && f.error.includes("no encontré Chrome"))).toBe(true);
  });

  it("al plan le llega lo gastado hasta ahora y a la captura, su plazo", async () => {
    const vistos = [];
    await correr(async (v, plan) => (vistos.push(plan), { nombre: v.nombre, ok: true }), { planear: () => ({ hacer: true, plazoMs: 777, porElTotal: false }) });
    expect(vistos[0]).toEqual({ hacer: true, plazoMs: 777, porElTotal: false });
  });
});

describe("crearComprobadorDeRutas: sin poder comprobar, no da la ruta por buena", () => {
  const rapido = { intentos: 3, pausaMs: 0 };
  const pagina = { "/seguridad.html": { estado: 200, texto: "<html>seguridad</html>" } };

  it("si el servidor no contesta ninguna vez, la vista falla diciendo que no pudo comprobar", async () => {
    const c = crearComprobadorDeRutas(
      BASE,
      async () => {
        throw new Error("ECONNREFUSED");
      },
      rapido,
    );
    const motivo = await c("/seguridad.html");
    expect(motivo).toMatch(/no pude comprobar/);
    expect(motivo).toContain("/seguridad.html");
    expect(motivo).toContain("ECONNREFUSED");
  });

  it("un fallo suelto se reintenta y la ruta buena pasa", async () => {
    const srv = servidor(pagina);
    let llamadas = 0;
    const buscar = async (url, opciones) => {
      if (new URL(url).pathname === "/seguridad.html" && ++llamadas === 1) throw new Error("se cortó");
      return srv.buscar(url, opciones);
    };
    expect(await crearComprobadorDeRutas(BASE, buscar, rapido)("/seguridad.html")).toBe("");
    expect(llamadas).toBe(2);
  });

  it("un fallo suelto no deja pasar la ruta mal escrita: reintenta y la rechaza", async () => {
    const srv = servidor(pagina);
    let llamadas = 0;
    const buscar = async (url, opciones) => {
      if (new URL(url).pathname === "/seguridad" && ++llamadas === 1) throw new Error("se cortó");
      return srv.buscar(url, opciones);
    };
    expect(await crearComprobadorDeRutas(BASE, buscar, rapido)("/seguridad")).toMatch(/portada/);
  });

  it("si la portada no se puede leer, la vista falla y la siguiente lo vuelve a intentar", async () => {
    const srv = servidor(pagina);
    let portadaCaida = true;
    const buscar = async (url, opciones) => {
      if (new URL(url).pathname === "/" && portadaCaida) throw new Error("la portada no contesta");
      return srv.buscar(url, opciones);
    };
    const c = crearComprobadorDeRutas(BASE, buscar, rapido);
    expect(await c("/seguridad.html")).toMatch(/no pude comprobar.*portada/s);
    portadaCaida = false;
    expect(await c("/seguridad.html")).toBe("");
    expect(await c("/seguridad")).toMatch(/portada/);
  });

  it("una portada que contesta con error no sirve para comparar: no se da por buena la ruta", async () => {
    const buscar = async (url) => {
      const camino = new URL(url).pathname;
      return camino === "/" ? { status: 503, ok: false, text: async () => "" } : { status: 200, ok: true, text: async () => "" };
    };
    expect(await crearComprobadorDeRutas(BASE, buscar, rapido)("/seguridad.html")).toMatch(/no pude comprobar.*503/s);
  });
});

describe("problemaAlTerminar: la página terminó donde se pidió, con el estado y el tema pedidos", () => {
  const ok = (url = `${BASE}/seguridad.html`) => ({ estado: 200, direccion: url });
  const leido = { camino: "/seguridad.html", tema: "dark", idioma: "es" };
  const base = { respuestas: [ok()], caminoPedido: "/seguridad.html", terminaEn: null, estado: leido, pedido: { tema: null, idioma: null } };

  it("una vista que termina donde se pidió está bien", () => {
    expect(problemaAlTerminar(base)).toBe("");
  });

  it("una vista que después de los pasos terminó en otra página falla y lo dice", () => {
    const m = problemaAlTerminar({ ...base, estado: { ...leido, camino: "/" } });
    expect(m).toContain("/seguridad.html");
    expect(m).toMatch(/terminó en \//);
  });

  it("si se pidió terminar en otra página a propósito, vale esa y no la de la ruta", () => {
    const e = { ...base, caminoPedido: "/", terminaEn: "/juegos.html", respuestas: [ok(`${BASE}/`), ok(`${BASE}/juegos.html`)] };
    expect(problemaAlTerminar({ ...e, estado: { ...leido, camino: "/juegos.html" } })).toBe("");
    expect(problemaAlTerminar({ ...e, estado: { ...leido, camino: "/" } })).toMatch(/juegos\.html/);
  });

  it("sin camino leído no se afirma nada", () => {
    expect(problemaAlTerminar({ ...base, estado: { tema: "dark", idioma: "es" } })).toMatch(/camino/);
  });

  it("un documento con error sigue fallando, y el tema y el idioma también", () => {
    expect(problemaAlTerminar({ ...base, respuestas: [{ estado: 404, direccion: `${BASE}/x.html` }] })).toMatch(/404/);
    expect(problemaAlTerminar({ ...base, pedido: { tema: "light", idioma: null } })).toMatch(/tema/);
    expect(problemaAlTerminar({ ...base, pedido: { tema: null, idioma: "en" } })).toMatch(/idioma/);
  });

  it("el guion lo usa al terminar los pasos y ya no llama a la comprobación sin camino", () => {
    const guion = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "capturar-vistas.mjs"), "utf8");
    expect(guion).toContain("problemaAlTerminar(");
    expect(guion).not.toMatch(/problemaDelDocumento\(\{ respuestas: documentos\.respuestas, caminoPedido \}\)/);
  });
});

describe("terminaEn: la página donde la vista tiene que terminar si navega a propósito", () => {
  const vista = (extra = {}) => ({ nombre: "a", ruta: "/", ...extra });

  it("vale un camino del sitio y sale en la vista validada", () => {
    const { vistas, errores } = validarVistas([vista({ terminaEn: "/juegos.html" })]);
    expect(errores).toEqual([]);
    expect(vistas[0].terminaEn).toBe("/juegos.html");
  });

  it("sin él queda en null", () => {
    expect(validarVistas([vista()]).vistas[0].terminaEn).toBeNull();
  });

  it("rechaza otro sitio, una consulta o un fragmento", () => {
    for (const t of ["https://example.org/", "//example.org/", "juegos.html", "/juegos.html?x=1", "/juegos.html#a", 3]) {
      expect(validarVistas([vista({ terminaEn: t })]).errores[0], String(t)).toContain('"terminaEn"');
    }
  });
});
