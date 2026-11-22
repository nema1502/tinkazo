import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { destinoDeRecibir } from "../campana/recibir";
import {
  avisarPorCorreo,
  correoDeLaCuenta,
  correoPrendido,
  datosDeLaCampana,
  enlaceDeRecibir,
  escaparHtml,
  esCorreo,
  limpiarTexto,
  llamarAlProveedor,
  marcaDeCorreoPrendida,
  mensajeroDeCloudflare,
  premioDelPuesto,
  textoDelCorreo,
  versionDelCorreo,
  type EnlaceDeCorreo,
  type Llamar,
  type Mensajero,
} from "../../workers/sala/src/correo";

const CUENTA = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const ENLACE = "https://tinkazo.app/?red=oficial&premio=1";
/** El mismo enlace como lo escribe el HTML: el signo & va escapado. */
const ENLACE_HTML = "https://tinkazo.app/?red=oficial&amp;premio=1";

/** Una respuesta del proveedor de cuentas con estas filas, como la mide la búsqueda de usuarios. */
const lista = (items: unknown[]): Response =>
  new Response(JSON.stringify({ code: "SERVER_SDK_USERS_LIST", success: true, content: { items } }), { status: 200 });

/** Una fila de usuario con su billetera, correo y nombre. */
const fila = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "u1",
  first_name: "Ana",
  last_name: "Quispe",
  email: "ana@example.org",
  wallet_public_key: CUENTA,
  ...extra,
});

/** Un proveedor que contesta siempre lo mismo y anota lo que le pidieron. */
function proveedor(items: unknown[]): { llamar: Llamar; pedidos: string[] } {
  const pedidos: string[] = [];
  return {
    pedidos,
    llamar: async (ruta) => {
      pedidos.push(ruta);
      return lista(items);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("buscar el correo de una cuenta ganadora", () => {
  it("con cero filas no hay correo y queda solo un código", async () => {
    const registrar = vi.fn();
    expect(await correoDeLaCuenta(CUENTA, proveedor([]).llamar, registrar)).toBeNull();
    expect(registrar).toHaveBeenCalledWith("correo-busqueda", { codigo: "sin-fila" });
  });

  it("con una fila exacta devuelve su correo, su nombre y el español por defecto", async () => {
    const r = await correoDeLaCuenta(CUENTA, proveedor([fila()]).llamar);
    expect(r).toEqual({ correo: "ana@example.org", nombre: "Ana", idioma: "es" });
  });

  it("pide la búsqueda por la cuenta, con limit 200", async () => {
    const p = proveedor([fila()]);
    await correoDeLaCuenta(CUENTA, p.llamar);
    expect(p.pedidos).toEqual([`/v3/users?q=${CUENTA}&limit=200`]);
  });

  it("una fila con la billetera de Stellar en la lista y otra cadena como principal sirve", async () => {
    const lista = [
      { chain: "SOLANA", public_key: "5UfDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { chain: "STELLAR", network: "mainnet", public_key: CUENTA },
    ];
    const principalAjena = fila({ wallet_public_key: "0x1111111111111111111111111111111111111111", wallets: lista });
    expect((await correoDeLaCuenta(CUENTA, proveedor([principalAjena]).llamar))?.correo).toBe("ana@example.org");
    const sinPrincipal = fila({ wallet_public_key: null, wallets: lista });
    expect((await correoDeLaCuenta(CUENTA, proveedor([sinPrincipal]).llamar))?.correo).toBe("ana@example.org");
  });

  it("una cuenta que solo está en una billetera de otra cadena no sirve", async () => {
    const registrar = vi.fn();
    const deOtraCadena = fila({ wallet_public_key: null, wallets: [{ chain: "POLYGON", public_key: CUENTA }] });
    expect(await correoDeLaCuenta(CUENTA, proveedor([deOtraCadena]).llamar, registrar)).toBeNull();
    expect(registrar).toHaveBeenCalledWith("correo-busqueda", { codigo: "sin-fila" });
    const vacia = fila({ wallet_public_key: null, wallets: [] });
    expect(await correoDeLaCuenta(CUENTA, proveedor([vacia]).llamar)).toBeNull();
  });

  it("una fila que solo coincide por un pedazo de la cuenta no sirve", async () => {
    const parecida = fila({ wallet_public_key: `${CUENTA.slice(0, 40)}${OTRA.slice(40)}`, email: "otra@example.org" });
    expect(await correoDeLaCuenta(CUENTA, proveedor([parecida]).llamar)).toBeNull();
  });

  it("entre una fila de otra cuenta y la exacta, se queda con la exacta", async () => {
    const ajena = fila({ wallet_public_key: OTRA, email: "otra@example.org" });
    const r = await correoDeLaCuenta(CUENTA, proveedor([ajena, fila()]).llamar);
    expect(r?.correo).toBe("ana@example.org");
  });

  it("con dos filas exactas no elige ninguna", async () => {
    const registrar = vi.fn();
    const dos = [fila(), fila({ id: "u2", email: "otra@example.org" })];
    expect(await correoDeLaCuenta(CUENTA, proveedor(dos).llamar, registrar)).toBeNull();
    expect(registrar).toHaveBeenCalledWith("correo-busqueda", { codigo: "filas-repetidas" });
  });

  it("una fila sin correo da null", async () => {
    expect(await correoDeLaCuenta(CUENTA, proveedor([fila({ email: undefined })]).llamar)).toBeNull();
    expect(await correoDeLaCuenta(CUENTA, proveedor([fila({ email: null })]).llamar)).toBeNull();
    expect(await correoDeLaCuenta(CUENTA, proveedor([fila({ email: 42 })]).llamar)).toBeNull();
  });

  it("un correo con forma rara da null", async () => {
    const raros = [
      "ana",
      "ana@",
      "@example.org",
      "ana@example",
      "ana @example.org",
      "ana@example.org\nBcc: otra@example.org",
      "ana@example.org, otra@example.org",
      "<ana@example.org>",
      "Ana <ana@example.org>",
      "ana@@example.org",
      ".ana@example.org",
      "an..a@example.org",
      `${"a".repeat(65)}@example.org`,
    ];
    for (const correo of raros) {
      expect(await correoDeLaCuenta(CUENTA, proveedor([fila({ email: correo })]).llamar), correo).toBeNull();
    }
  });

  it("sin nombre en la fila, el nombre es null, y no usa el apellido", async () => {
    const r = await correoDeLaCuenta(CUENTA, proveedor([fila({ first_name: "", last_name: "Quispe" })]).llamar);
    expect(r).toEqual({ correo: "ana@example.org", nombre: null, idioma: "es" });
  });

  it("limpia el nombre de saltos y de caracteres invisibles", async () => {
    const r = await correoDeLaCuenta(CUENTA, proveedor([fila({ first_name: "  An\u200Ba\r\nQ  " })]).llamar);
    expect(r?.nombre).toBe("Ana Q");
  });

  it("el idioma es inglés solo si la fila lo dice de forma clara", async () => {
    expect((await correoDeLaCuenta(CUENTA, proveedor([fila({ locale: "en-US" })]).llamar))?.idioma).toBe("en");
    expect((await correoDeLaCuenta(CUENTA, proveedor([fila({ language: "en" })]).llamar))?.idioma).toBe("en");
    expect((await correoDeLaCuenta(CUENTA, proveedor([fila({ language: "english please" })]).llamar))?.idioma).toBe("es");
    expect((await correoDeLaCuenta(CUENTA, proveedor([fila({ locale: "es-BO" })]).llamar))?.idioma).toBe("es");
  });

  it("una respuesta que no es 200, rota o con otra forma da null y deja solo un código", async () => {
    const casos: [string, () => Promise<Response>][] = [
      ["estado", async () => new Response("{}", { status: 503 })],
      ["forma", async () => new Response("no es json", { status: 200 })],
      ["forma", async () => new Response(JSON.stringify({ success: false }), { status: 200 })],
      ["forma", async () => new Response(JSON.stringify({ success: true, code: "OTRO", content: { items: [] } }), { status: 200 })],
      ["red", async () => Promise.reject(new Error("sin red"))],
    ];
    for (const [codigo, llamar] of casos) {
      const registrar = vi.fn();
      expect(await correoDeLaCuenta(CUENTA, llamar, registrar)).toBeNull();
      expect(registrar).toHaveBeenCalledWith("correo-busqueda", { codigo });
    }
  });

  it("una cuenta que no es de Stellar no llama a nadie", async () => {
    const p = proveedor([fila()]);
    expect(await correoDeLaCuenta("G123", p.llamar)).toBeNull();
    expect(await correoDeLaCuenta(`${CUENTA}&limit=1`, p.llamar)).toBeNull();
    expect(p.pedidos).toEqual([]);
  });

  it("el correo, el nombre y la cuenta no aparecen en la consola ni en lo que se registra", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const registrar = vi.fn();
    await correoDeLaCuenta(CUENTA, proveedor([fila()]).llamar, registrar);
    await correoDeLaCuenta(CUENTA, proveedor([fila(), fila()]).llamar, registrar);
    await correoDeLaCuenta(CUENTA, proveedor([fila({ email: "mal" })]).llamar, registrar);
    const todo = JSON.stringify([registrar.mock.calls, ...consola.map((c) => c.mock.calls)]);
    expect(todo).not.toContain("ana@example.org");
    expect(todo).not.toContain("Ana");
    expect(todo).not.toContain(CUENTA);
  });
});

describe("el pedido al proveedor de cuentas", () => {
  it("lleva la llave en su cabecera, va solo al servidor fijo y devuelve el cuerpo", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => lista([fila()]));
    const llamar = llamarAlProveedor("sec_mainnet_prueba_inventada_0000000000", f);
    const res = await llamar(`/v3/users?q=${CUENTA}&limit=200`);
    expect(res.status).toBe(200);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(`https://server.api.pollar.xyz/v3/users?q=${CUENTA}&limit=200`);
    expect(new Headers(init?.headers).get("x-pollar-api-key")).toBe("sec_mainnet_prueba_inventada_0000000000");
    expect(init?.redirect).toBe("manual");
  });

  it("si el proveedor no contesta a tiempo, aborta el pedido y lanza", async () => {
    const f = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolver, rechazar) => {
          init?.signal?.addEventListener("abort", () => rechazar(new Error("abortado")));
        }),
    );
    const llamar = llamarAlProveedor("sec_mainnet_prueba_inventada_0000000000", f, 20);
    await expect(llamar(`/v3/users?q=${CUENTA}&limit=200`)).rejects.toThrow("abortado");
    expect(f.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("una ruta que apunta a otro servidor no sale", async () => {
    const f = vi.fn(async () => lista([]));
    const llamar = llamarAlProveedor("sec_mainnet_prueba_inventada_0000000000", f);
    await expect(llamar("//otro.example.org/v3/users")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

/**
 * Los textos del pedido y la ayuda, escritos otra vez a mano acá: si alguien cambia el correo, esta prueba lo avisa. La versión A
 * es la que es cierta siempre (la cuenta reconoce el navegador y no el aparato). La B es cierta solo si la cuenta quedó protegida
 * y el correo es el de la sesión. Son los de la sección 4.4 del diseño del celular.
 */
const PEDIDO_A = {
  es: "Para recibirlo, abrí este enlace en el mismo celular o compu, y en el mismo navegador, donde te anotaste. Entrá con la misma cuenta de Google:",
  en: "To receive it, open this link on the same phone or computer, and in the same browser, where you signed up. Sign in with the same Google account:",
};
const AYUDA_A = {
  es: "Si no podés abrirlo ahí, respondé este correo.",
  en: "If you can't open it there, reply to this email.",
};
const PEDIDO_B = {
  es: "Para recibirlo, abrí este enlace desde cualquier celular o compu y entrá con la misma cuenta de Google con la que te anotaste:",
  en: "To receive it, open this link on any phone or computer and sign in with the same Google account you signed up with:",
};
const AYUDA_B = {
  es: "Si entrás desde otro lado, te llega un código a este correo para confirmar que sos vos.",
  en: "If it's a different one, a code will come to this email to confirm it's you.",
};

describe("el texto del correo", () => {
  const datos = { nombre: "Ana", premio: "400 dólares digitales", empresa: "Empresa de ejemplo", enlace: ENLACE };

  it("en español con nombre", () => {
    const c = textoDelCorreo("es", datos);
    expect(c.asunto).toBe("Ganaste el sorteo de Empresa de ejemplo");
    expect(c.texto).toBe(
      [
        "Hola Ana.",
        "",
        "Ganaste 400 dólares digitales en el sorteo de Empresa de ejemplo.",
        "",
        PEDIDO_A.es,
        ENLACE,
        "",
        AYUDA_A.es,
        "",
        "Recibir tu premio es gratis. Tinkazo nunca te pide una contraseña ni un pago.",
      ].join("\n"),
    );
  });

  it("la versión B, con el correo confirmado, cambia el pedido y la ayuda y nada más", () => {
    for (const idioma of ["es", "en"] as const) {
      const a = textoDelCorreo(idioma, datos);
      const b = textoDelCorreo(idioma, { ...datos, confirmo: true });
      expect(b.texto).toBe(a.texto.replace(PEDIDO_A[idioma], PEDIDO_B[idioma]).replace(AYUDA_A[idioma], AYUDA_B[idioma]));
      expect(b.texto).toContain(PEDIDO_B[idioma]);
      expect(b.texto).toContain(AYUDA_B[idioma]);
      expect(b.texto).not.toContain(PEDIDO_A[idioma]);
      expect(b.texto).not.toContain(AYUDA_A[idioma]);
      expect(b.asunto).toBe(a.asunto);
    }
  });

  it("sin la marca, o con ella en falso, sale la versión A, que es cierta siempre", () => {
    for (const confirmo of [undefined, false]) {
      const c = textoDelCorreo("es", { ...datos, ...(confirmo === undefined ? {} : { confirmo }) });
      expect(c.texto).toContain(PEDIDO_A.es);
      expect(c.texto).toContain(AYUDA_A.es);
    }
  });

  it("la ayuda va entre el enlace y el cierre, en el texto plano y en el HTML, en las dos versiones", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const confirmo of [false, true]) {
        const c = textoDelCorreo(idioma, { ...datos, confirmo });
        const ayuda = (confirmo ? AYUDA_B : AYUDA_A)[idioma];
        const cierre = idioma === "es" ? "Recibir tu premio es gratis." : "Receiving your prize is free.";
        const plano = c.texto;
        expect(plano.indexOf(ENLACE)).toBeLessThan(plano.indexOf(ayuda));
        expect(plano.indexOf(ayuda)).toBeLessThan(plano.indexOf(cierre));
        expect(plano).toContain([ENLACE, "", ayuda, "", cierre].join("\n"));
        const html = c.html.replaceAll("&#39;", "'");
        expect(html.indexOf(`>${ENLACE_HTML}</a>`)).toBeLessThan(html.indexOf(ayuda));
        expect(html.indexOf(ayuda)).toBeLessThan(html.indexOf(cierre));
        // La ayuda es un párrafo chico aparte, con el mismo estilo del enlace en texto.
        expect(html).toContain(`<p style="font-size:14px;line-height:1.5;margin:0 0 16px;">${ayuda}</p>`);
      }
    }
  });

  it("las dos versiones no llevan punto y coma, comillas angulares, rayas largas, flechas, punto medio ni direcciones escritas", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const confirmo of [false, true]) {
        const c = textoDelCorreo(idioma, { ...datos, nombre: null, confirmo });
        const fijo = [c.asunto, c.texto].join("\n");
        expect(fijo).not.toMatch(/[;!¡«»—–→←·<>]/u);
        // "Respondé este correo" llega a la casilla de contacto: no se escribe ninguna dirección en el texto.
        expect(fijo.replace(ENLACE, "")).not.toMatch(/@/u);
        expect(fijo).not.toMatch(/(?:rifa|loter|raffle|ticket|boleto|apuesta)/iu);
      }
    }
  });

  it("en español sin nombre empieza con Hola", () => {
    const c = textoDelCorreo("es", { ...datos, nombre: null });
    expect(c.texto.startsWith("Hola.\n\nGanaste")).toBe(true);
  });

  it("en inglés con nombre", () => {
    const c = textoDelCorreo("en", { ...datos, premio: "400 digital dollars" });
    expect(c.asunto).toBe("You won the Empresa de ejemplo draw");
    expect(c.texto).toBe(
      [
        "Hi Ana.",
        "",
        "You won 400 digital dollars in the Empresa de ejemplo draw.",
        "",
        PEDIDO_A.en,
        ENLACE,
        "",
        AYUDA_A.en,
        "",
        "Receiving your prize is free. Tinkazo never asks you for a password or a payment.",
      ].join("\n"),
    );
  });

  it("en inglés sin nombre empieza con Hi", () => {
    expect(textoDelCorreo("en", { ...datos, nombre: null }).texto.startsWith("Hi.\n\nYou won")).toBe(true);
  });

  it("lo fijo no lleva punto y coma, exclamaciones, comillas angulares ni raya larga", () => {
    for (const idioma of ["es", "en"] as const) {
      const c = textoDelCorreo(idioma, { ...datos, nombre: null });
      const fijo = `${c.asunto}\n${c.texto}`;
      expect(fijo).not.toMatch(/[;!¡«»—·<>]/u);
    }
  });

  it("el enlace va en el texto y, entero y como botón, en el HTML", () => {
    const c = textoDelCorreo("es", datos);
    expect(c.texto).toContain(`\n${ENLACE}\n`);
    expect(c.html.split(`href="${ENLACE_HTML}"`).length - 1).toBe(2);
    expect(c.html).toContain(`>${ENLACE_HTML}</a>`);
    expect(c.html).not.toContain("participar.html");
    expect(c.html).toContain('lang="es"');
    expect(c.html).not.toMatch(/<img|<script|<link|url\(|@import/iu);
  });

  it("el nombre, la empresa y el premio se escapan en el HTML", () => {
    const sucio = { nombre: '<b onclick="x">Ana</b>', premio: "5 & 6 <i>", empresa: "A&B <script>alert(1)</script> \"C\" 'D'", enlace: ENLACE };
    const c = textoDelCorreo("es", sucio);
    expect(c.html).not.toContain("<script");
    expect(c.html).not.toContain("<b onclick");
    expect(c.html).not.toContain("<i>");
    expect(c.html).toContain("&lt;b onclick=&quot;x&quot;&gt;Ana&lt;/b&gt;");
    expect(c.html).toContain("A&amp;B &lt;script&gt;alert(1)&lt;/script&gt; &quot;C&quot; &#39;D&#39;");
    expect(c.html).toContain("5 &amp; 6 &lt;i&gt;");
  });

  it("el asunto no lleva saltos de línea ni invisibles aunque la empresa los traiga", () => {
    const c = textoDelCorreo("es", { ...datos, empresa: "Empresa\r\nBcc: otra@example.org\u2028\u0085\u200B\u202E ejemplo\t!" });
    expect(c.asunto).not.toMatch(/[\r\n\u2028\u2029\u0085\u200B\u202E\t]/u);
    expect(c.asunto).toBe("Ganaste el sorteo de Empresa Bcc: otra@example.org ejemplo !");
  });

  it("un signo de dólar en el nombre no se interpreta como un reemplazo", () => {
    const c = textoDelCorreo("es", { ...datos, nombre: "Ana $& $1", empresa: "Casa $$" });
    expect(c.texto).toContain("Hola Ana $& $1.");
    expect(c.asunto).toBe("Ganaste el sorteo de Casa $$");
  });

  it("sin nombre de empresa usa Tinkazo, y un nombre larguísimo se corta", () => {
    expect(textoDelCorreo("es", { ...datos, empresa: "" }).asunto).toBe("Ganaste el sorteo de Tinkazo");
    expect(textoDelCorreo("es", { ...datos, empresa: "x".repeat(500) }).asunto.length).toBeLessThan(100);
  });

  it("el enlace de una campaña de la red principal es la entrada de quien ganó en Oficial", () => {
    expect(enlaceDeRecibir("mainnet")).toBe("https://tinkazo.app/?red=oficial&premio=1");
  });

  it("el enlace de una campaña de prueba es la entrada de quien ganó en Prueba", () => {
    expect(enlaceDeRecibir("testnet")).toBe("https://tinkazo.app/?red=prueba&premio=1");
  });

  it("el enlace del correo es el mismo destino que Recibir mi premio del celular", () => {
    expect(enlaceDeRecibir("mainnet")).toBe(`https://tinkazo.app${destinoDeRecibir("mainnet")}`);
    expect(enlaceDeRecibir("testnet")).toBe(`https://tinkazo.app${destinoDeRecibir("testnet")}`);
  });

  it("el enlace no lleva sala, evento, pase, clave ni datos de la persona", () => {
    for (const red of ["mainnet", "testnet"] as const) {
      const consulta = new URL(enlaceDeRecibir(red)).searchParams;
      expect([...consulta.keys()].sort()).toEqual(["premio", "red"]);
    }
  });
});

describe("el premio, el escape y la limpieza", () => {
  it("con montos iguales, ese monto; con montos distintos, el de su puesto", () => {
    expect(premioDelPuesto(["400000000", "400000000"], 1, "es")).toBe("40 dólares digitales");
    expect(premioDelPuesto(["400000000", "200000000"], 1, "en")).toBe("20 digital dollars");
    expect(premioDelPuesto(["400000000", "200000000"], 0, "es")).toBe("40 dólares digitales");
    expect(premioDelPuesto(["400000000"], 5, "es")).toBe("40 dólares digitales");
  });

  it("sin un monto legible no promete una cifra", () => {
    expect(premioDelPuesto([], 0, "es")).toBe("tu premio");
    expect(premioDelPuesto(["abc"], 0, "en")).toBe("your prize");
  });

  it("escapa los cinco signos y limpia los espacios", () => {
    expect(escaparHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(limpiarTexto("  a \n\t b  ", 10)).toBe("a b");
    expect(limpiarTexto(12, 10)).toBe("");
    expect(limpiarTexto("abcdef", 3)).toBe("abc");
  });

  it("reconoce correos y descarta lo que no lo es", () => {
    expect(esCorreo("ana.q+sorteo@example.org")).toBe(true);
    expect(esCorreo("ana@sub.example.org")).toBe(true);
    expect(esCorreo("ana")).toBe(false);
    expect(esCorreo(null)).toBe(false);
  });
});

describe("el mensajero de Cloudflare", () => {
  const contenido = { asunto: "Asunto", texto: "Texto", html: "<p>Texto</p>" };

  it("arma el remitente como objeto, responde a la dirección fija y da true", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }));
    const m = mensajeroDeCloudflare({ send } as EnlaceDeCorreo, "sorteos@example.org");
    expect(await m.mandar("ana@example.org", contenido)).toBe(true);
    expect(send).toHaveBeenCalledWith({
      to: "ana@example.org",
      from: { email: "sorteos@example.org", name: "Tinkazo" },
      subject: "Asunto",
      text: "Texto",
      html: "<p>Texto</p>",
      replyTo: "hola@tinkazo.app",
    });
  });

  it("con un error que trae code da false y registra solo el código", async () => {
    const registrar = vi.fn();
    const error = Object.assign(new Error("no se pudo mandar a ana@example.org"), { code: "E_SENDER_DOMAIN_NOT_AVAILABLE" });
    const m = mensajeroDeCloudflare({ send: async () => Promise.reject(error) }, "sorteos@example.org", registrar);
    expect(await m.mandar("ana@example.org", contenido)).toBe(false);
    expect(registrar.mock.calls).toEqual([["correo-envio", { codigo: "E_SENDER_DOMAIN_NOT_AVAILABLE" }]]);
    expect(JSON.stringify(registrar.mock.calls)).not.toContain("ana@example.org");
  });

  it("con un error sin código, o con un código raro, registra error", async () => {
    const registrar = vi.fn();
    const sin = mensajeroDeCloudflare({ send: async () => Promise.reject(new TypeError("forma")) }, "sorteos@example.org", registrar);
    expect(await sin.mandar("ana@example.org", contenido)).toBe(false);
    const raro = mensajeroDeCloudflare(
      { send: async () => Promise.reject(Object.assign(new Error("x"), { code: "ana@example.org" })) },
      "sorteos@example.org",
      registrar,
    );
    expect(await raro.mandar("ana@example.org", contenido)).toBe(false);
    expect(registrar.mock.calls).toEqual([
      ["correo-envio", { codigo: "error" }],
      ["correo-envio", { codigo: "error" }],
    ]);
  });

  it("si send lanza sin ser una promesa, también da false", async () => {
    const m = mensajeroDeCloudflare(
      {
        send: () => {
          throw new Error("sin forma");
        },
      },
      "sorteos@example.org",
    );
    expect(await m.mandar("ana@example.org", contenido)).toBe(false);
  });
});

describe("qué versión del correo se manda", () => {
  const enlace: EnlaceDeCorreo = { send: async () => ({}) };
  const base = { CORREO: enlace, CORREO_DE: "sorteos@example.org", CORREO_GANADORAS: "1", POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000" };

  it("solo el valor exacto 2 elige la B: sin la variable o con cualquier otro valor sale la A", () => {
    expect(versionDelCorreo({ CORREO_VERSION: "2" })).toBe("2");
    for (const valor of [undefined, "1", "0", "", "B", "true", " 2", "2 ", "22"]) {
      expect(versionDelCorreo(valor === undefined ? {} : { CORREO_VERSION: valor }), String(valor)).toBe("1");
    }
  });

  it("la marca de correo confirmado nace apagada y pide todo lo que pide el correo", () => {
    expect(marcaDeCorreoPrendida(base)).toBe(false);
    expect(marcaDeCorreoPrendida({ ...base, CORREO_MARCA: "0" })).toBe(false);
    expect(marcaDeCorreoPrendida({ ...base, CORREO_MARCA: "true" })).toBe(false);
    expect(marcaDeCorreoPrendida({ ...base, CORREO_MARCA: "1" })).toBe(true);
    expect(marcaDeCorreoPrendida({ ...base, CORREO_MARCA: "1", CORREO_GANADORAS: "0" })).toBe(false);
    expect(marcaDeCorreoPrendida({ ...base, CORREO_MARCA: "1", CORREO: undefined })).toBe(false);
  });
});

describe("cuándo está prendido el correo", () => {
  const enlace: EnlaceDeCorreo = { send: async () => ({}) };
  const base = { CORREO: enlace, CORREO_DE: "sorteos@example.org", CORREO_GANADORAS: "1", POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000" };

  it("con todo puesto, sí", () => {
    expect(correoPrendido(base)).toBe(true);
  });

  it("cualquier cosa que falte lo apaga", () => {
    expect(correoPrendido({ ...base, CORREO_GANADORAS: "0" })).toBe(false);
    expect(correoPrendido({ ...base, CORREO_GANADORAS: undefined })).toBe(false);
    expect(correoPrendido({ ...base, CORREO_GANADORAS: "true" })).toBe(false);
    expect(correoPrendido({ ...base, CORREO: undefined })).toBe(false);
    expect(correoPrendido({ ...base, CORREO_DE: undefined })).toBe(false);
    expect(correoPrendido({ ...base, CORREO_DE: "no es un correo" })).toBe(false);
    expect(correoPrendido({ ...base, POLLAR_SECRETO: undefined })).toBe(false);
  });
});

describe("lo que se lee de la campaña firmada", () => {
  it("saca el nombre de la empresa y los montos", () => {
    const texto = JSON.stringify({ empresa: { nombre: "  Empresa\nde ejemplo " }, premios: ["400000000", 5, "200000000"] });
    expect(datosDeLaCampana(texto)).toEqual({ empresa: "Empresa de ejemplo", premios: ["400000000", "200000000"] });
  });

  it("sin texto, con un texto roto o sin esos campos queda vacío", () => {
    expect(datosDeLaCampana(null)).toEqual({ empresa: "", premios: [] });
    expect(datosDeLaCampana("no es json")).toEqual({ empresa: "", premios: [] });
    expect(datosDeLaCampana("{}")).toEqual({ empresa: "", premios: [] });
  });
});

describe("avisar a varias cuentas", () => {
  const aviso = {
    cuentas: [
      { cuenta: CUENTA, puesto: 0 },
      { cuenta: OTRA, puesto: 1 },
    ],
    empresa: "Empresa de ejemplo",
    premios: ["400000000", "200000000"],
  };

  /** Un proveedor con una fila por cuenta. */
  const proveedorDeDos = (filas: Record<string, unknown>): Llamar => async (ruta) => {
    const q = new URL(`https://x.example${ruta}`).searchParams.get("q") ?? "";
    return lista(filas[q] === undefined ? [] : [filas[q]]);
  };

  it("sigue con la segunda aunque la primera no tenga correo, y cuenta lo que salió", async () => {
    const mandados: string[] = [];
    const mensajero: Mensajero = { mandar: async (para) => (mandados.push(para), true) };
    const llamar = proveedorDeDos({ [OTRA]: fila({ wallet_public_key: OTRA, email: "nora@example.org", first_name: "Nora" }) });
    expect(await avisarPorCorreo({ aviso, enlace: ENLACE, llamar, mensajero })).toBe(1);
    expect(mandados).toEqual(["nora@example.org"]);
  });

  it("el correo lleva el premio del puesto de cada una y su idioma", async () => {
    const enviados: { para: string; texto: string; asunto: string }[] = [];
    const mensajero: Mensajero = {
      mandar: async (para, c) => (enviados.push({ para, texto: c.texto, asunto: c.asunto }), true),
    };
    const llamar = proveedorDeDos({
      [CUENTA]: fila(),
      [OTRA]: fila({ wallet_public_key: OTRA, email: "nora@example.org", first_name: "Nora", locale: "en" }),
    });
    expect(await avisarPorCorreo({ aviso, enlace: ENLACE, llamar, mensajero })).toBe(2);
    expect(enviados[0]?.texto).toContain("Ganaste 40 dólares digitales");
    expect(enviados[1]?.texto).toContain("You won 20 digital dollars");
    expect(enviados[1]?.asunto).toBe("You won the Empresa de ejemplo draw");
  });

  it("si el envío falla o lanza, sigue con la otra y no lanza", async () => {
    let n = 0;
    const mensajero: Mensajero = {
      mandar: async () => {
        n += 1;
        if (n === 1) throw new Error("se cayó");
        return false;
      },
    };
    const llamar = proveedorDeDos({
      [CUENTA]: fila(),
      [OTRA]: fila({ wallet_public_key: OTRA, email: "nora@example.org" }),
    });
    expect(await avisarPorCorreo({ aviso, enlace: ENLACE, llamar, mensajero })).toBe(0);
    expect(n).toBe(2);
  });
});

describe("avisar con un proveedor lento", () => {
  /** Diez cuentas con puestos distintos. */
  const cuentas = Array.from({ length: 10 }, (_, i) => ({ cuenta: Keypair.random().publicKey(), puesto: i }));
  const aviso = { cuentas, empresa: "Empresa de ejemplo", premios: ["400000000"] };

  /** La cuenta que se pidió en la ruta de la búsqueda. */
  const pedida = (ruta: string): string => new URL(`https://x.example${ruta}`).searchParams.get("q") ?? "";

  /** Un proveedor que tarda `ms` en contestar y responde con una fila de la cuenta que se le pidió. */
  const lento = (ms: number): Llamar => async (ruta) => {
    const q = pedida(ruta);
    await new Promise((resolver) => setTimeout(resolver, ms));
    return lista([fila({ wallet_public_key: q })]);
  };

  const mandador = (mandados: string[]): Mensajero => ({ mandar: async (para) => (mandados.push(para), true) });

  /** Corre el aviso con el reloj de la prueba y lo da por terminado cuando el reloj ya no tiene nada pendiente. */
  async function correr(pedido: Parameters<typeof avisarPorCorreo>[0]): Promise<{ enviados: number; transcurrido: number }> {
    const inicio = Date.now();
    const promesa = avisarPorCorreo(pedido);
    await vi.advanceTimersByTimeAsync(120_000);
    const enviados = await promesa;
    return { enviados, transcurrido: Date.now() - inicio };
  }

  afterEach(() => vi.useRealTimers());

  it("diez cuentas con un proveedor de 5 segundos terminan en dos tandas y no en diez", async () => {
    vi.useFakeTimers();
    const mandados: string[] = [];
    const terminadas: string[] = [];
    const inicio = Date.now();
    let fin = inicio;
    const promesa = avisarPorCorreo({
      aviso,
      enlace: ENLACE,
      llamar: lento(5_000),
      mensajero: { mandar: async (para) => ((fin = Date.now()), mandados.push(para), true) },
      terminada: async (c) => void terminadas.push(c),
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await promesa).toBe(10);
    expect(mandados).toHaveLength(10);
    expect(terminadas.sort()).toEqual(cuentas.map((c) => c.cuenta).sort());
    expect(fin - inicio).toBeLessThanOrEqual(10_000);
  });

  it("pasado el presupuesto no empieza cuentas nuevas y esas quedan sin marcar", async () => {
    vi.useFakeTimers();
    const terminadas: string[] = [];
    const registrar = vi.fn();
    const { enviados } = await correr({
      aviso,
      enlace: ENLACE,
      llamar: lento(11_000),
      mensajero: mandador([]),
      terminada: async (c) => void terminadas.push(c),
      topeCuentaMs: 60_000,
      registrar,
    });
    expect(enviados).toBe(5);
    expect(terminadas).toHaveLength(5);
    expect(registrar).toHaveBeenCalledWith("correo-fin", { cuentas: 10, enviados: 5, intentadas: 5 });
  });

  it("una cuenta que no contesta se da por intentada al vencer su tope y las demás siguen", async () => {
    vi.useFakeTimers();
    const colgada = cuentas[0]?.cuenta ?? "";
    const llamar: Llamar = async (ruta) => {
      const q = pedida(ruta);
      if (q === colgada) return new Promise<Response>(() => {});
      return lista([fila({ wallet_public_key: q })]);
    };
    const terminadas: string[] = [];
    const registrar = vi.fn();
    const { enviados } = await correr({
      aviso,
      enlace: ENLACE,
      llamar,
      mensajero: mandador([]),
      terminada: async (c) => void terminadas.push(c),
      topeCuentaMs: 3_000,
      registrar,
    });
    expect(enviados).toBe(9);
    expect(terminadas).toContain(colgada);
    expect(terminadas).toHaveLength(10);
    expect(registrar).toHaveBeenCalledWith("correo-envio", { codigo: "tiempo" });
  });

  it("si dejar la marca falla, sigue con las demás y no lanza", async () => {
    vi.useFakeTimers();
    const registrar = vi.fn();
    const { enviados } = await correr({
      aviso,
      enlace: ENLACE,
      llamar: lento(10),
      mensajero: mandador([]),
      terminada: async () => Promise.reject(new Error("sin marca")),
      registrar,
    });
    expect(enviados).toBe(10);
    expect(registrar).toHaveBeenCalledWith("correo-envio", { codigo: "marca" });
  });
});
