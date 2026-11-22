/**
 * El correo de bienvenida como texto, sin red: las palabras en los dos idiomas, el nombre limpio y escapado, la fecha y
 * los sorteos que salen de la configuración, lo que el correo no lleva nunca y el mensajero con un enlace de envío de
 * mentira que anota lo que recibe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { leerConfig } from "./config";
import {
  ENLACE_OFICIAL,
  type EnlaceDeCorreo,
  NOMBRE_DEL_REMITENTE,
  TOPE_ENVIO_MS,
  esCorreo,
  fechaDelCorreo,
  limpiarTexto,
  mensajeroDeCloudflare,
  textoDeBienvenida,
  venceDelRegalo,
} from "./correo-bienvenida";

const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
/** Inventados: ni la dirección ni el remitente existen. */
const PARA = "persona@correo.test";
const DE = "remitente@correo.test";
const DATOS = { nombre: "Quinua", sorteos: 3, vence: venceDelRegalo(T0, 60) };

/** El texto que se ve en el HTML: sin etiquetas, sin estilos y con las entidades de vuelta. */
const visible = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/u, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");

/** Un enlace de envío de mentira: anota cada mensaje y hace lo que diga la prueba. */
function enlaceDeMentira(hacer: () => Promise<unknown> = async () => ({})) {
  const mandados: unknown[] = [];
  const enlace: EnlaceDeCorreo = {
    send: async (m) => {
      mandados.push(m);
      return hacer();
    },
  };
  return { enlace, mandados };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("las palabras", () => {
  it("en español: el saludo, los sorteos con su fecha, el enlace al sitio y las dos líneas chicas", () => {
    const c = textoDeBienvenida("es", DATOS);
    expect(c.asunto).toBe("Tu cuenta oficial de Tinkazo está lista");
    expect(c.texto).toBe(
      [
        "Hola Quinua.",
        "",
        "Tu cuenta oficial está lista. Tenés 3 sorteos gratis hasta el 20 de enero de 2027.",
        "",
        "Organizar mi primer sorteo:",
        ENLACE_OFICIAL,
        "",
        "Participar y comprobar es gratis, siempre.",
        "",
        "Si no fuiste vos, ignorá este correo.",
      ].join("\n"),
    );
    expect(c.html).toContain('<html lang="es">');
    expect(visible(c.html)).toContain("Organizar mi primer sorteo");
  });

  it("en inglés: las mismas partes, con draw", () => {
    const c = textoDeBienvenida("en", DATOS);
    expect(c.asunto).toBe("Your Tinkazo Live account is ready");
    expect(c.texto).toBe(
      [
        "Hi Quinua.",
        "",
        "Your Live account is ready. You have 3 free draws until January 20, 2027.",
        "",
        "Run my first draw:",
        ENLACE_OFICIAL,
        "",
        "Taking part and checking are always free.",
        "",
        "If this wasn't you, ignore this email.",
      ].join("\n"),
    );
    expect(c.html).toContain('<html lang="en">');
  });

  it("sin idioma van los dos en el mismo correo, el español primero, y cada tarjeta con su idioma", () => {
    const c = textoDeBienvenida(null, DATOS);
    expect(c.asunto).toBe("Tu cuenta oficial de Tinkazo está lista / Your Tinkazo Live account is ready");
    expect(c.texto).toBe(`${textoDeBienvenida("es", DATOS).texto}\n\n------\n\n${textoDeBienvenida("en", DATOS).texto}`);
    const es = c.html.indexOf('<div lang="es"');
    const en = c.html.indexOf('<div lang="en"');
    expect(es).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(es);
  });

  it("con un solo sorteo la frase va en singular", () => {
    expect(textoDeBienvenida("es", { ...DATOS, sorteos: 1 }).texto).toContain("Tenés 1 sorteo gratis hasta");
    expect(textoDeBienvenida("en", { ...DATOS, sorteos: 1 }).texto).toContain("You have 1 free draw until");
  });
});

describe("el nombre", () => {
  it("sin nombre el saludo va solo: Hola. y Hi.", () => {
    for (const nombre of [null, "", "   ", "​"]) {
      expect(textoDeBienvenida("es", { ...DATOS, nombre }).texto.split("\n")[0]).toBe("Hola.");
      expect(textoDeBienvenida("en", { ...DATOS, nombre }).texto.split("\n")[0]).toBe("Hi.");
    }
  });

  it("un nombre con saltos de línea, invisibles o HTML sale en una línea, limpio y escapado", () => {
    const c = textoDeBienvenida("es", { ...DATOS, nombre: 'Qui‮nua\r\nBcc <b onclick="x">' });
    const saludo = c.texto.split("\n")[0];
    expect(saludo).toBe('Hola Quinua Bcc <b onclick="x">.');
    expect(c.html).not.toContain("<b onclick");
    expect(c.html).toContain("&lt;b onclick=&quot;x&quot;&gt;");
    expect(c.texto).not.toContain("\r");
    expect(c.texto).not.toContain("‮");
  });

  it("el nombre se corta a 40 caracteres", () => {
    const c = textoDeBienvenida("es", { ...DATOS, nombre: "a".repeat(80) });
    expect(c.texto.split("\n")[0]).toBe(`Hola ${"a".repeat(40)}.`);
  });

  it("el asunto nunca lleva el nombre", () => {
    for (const idioma of ["es", "en", null] as const) {
      expect(textoDeBienvenida(idioma, DATOS).asunto).not.toContain("Quinua");
      expect(textoDeBienvenida(idioma, DATOS).html).toContain(`<title>${textoDeBienvenida(idioma, { ...DATOS, nombre: null }).asunto}</title>`);
    }
  });
});

describe("lo que sale de la configuración", () => {
  it("la fecha sale de los días del regalo, en la zona de Bolivia", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", BIENVENIDA_DIAS: "30" });
    const vence = venceDelRegalo(T0, cfg.bienvenidaDias);
    expect(vence).toBe(T0 + 30 * 86_400_000);
    expect(textoDeBienvenida("es", { ...DATOS, vence }).texto).toContain("hasta el 21 de diciembre de 2026.");
    // Las 2 de la mañana en UTC todavía son el día anterior en Bolivia.
    expect(fechaDelCorreo(Date.UTC(2027, 0, 1, 2, 0, 0), "es")).toBe("31 de diciembre de 2026");
    expect(fechaDelCorreo(Date.UTC(2027, 0, 1, 2, 0, 0), "en")).toBe("December 31, 2026");
  });

  it("el número de sorteos sale de la configuración", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", BIENVENIDA_SORTEOS: "5" });
    expect(textoDeBienvenida("es", { ...DATOS, sorteos: cfg.bienvenidaSorteos }).texto).toContain("Tenés 5 sorteos gratis");
    expect(textoDeBienvenida("en", { ...DATOS, sorteos: cfg.bienvenidaSorteos }).texto).toContain("You have 5 free draws");
  });
});

describe("lo que el correo no lleva nunca", () => {
  it("ninguna imagen, fuente ni dirección de afuera: el único enlace es la entrada al sitio", () => {
    for (const idioma of ["es", "en", null] as const) {
      const { html, texto } = textoDeBienvenida(idioma, DATOS);
      expect(html).not.toMatch(/<img|<link|<script|url\(|@import|<iframe/iu);
      const enlaces = [...`${html}\n${texto}`.matchAll(/https?:\/\/[^\s"'<]+/gu)].map((m) => m[0].replace(/&amp;/gu, "&"));
      expect(enlaces.length).toBeGreaterThan(0);
      expect(new Set(enlaces)).toEqual(new Set([ENLACE_OFICIAL]));
    }
  });

  it("ningún texto con punto y coma, exclamaciones, comillas angulares, raya larga ni punto medio", () => {
    for (const idioma of ["es", "en", null] as const) {
      const c = textoDeBienvenida(idioma, DATOS);
      for (const t of [c.asunto, c.texto, visible(c.html)]) expect(t).not.toMatch(/[;!¡«»—·]/u);
    }
  });

  it("ninguna palabra de juegos de azar ni de técnica, en ningún idioma", () => {
    const prohibidas = /raffle|lottery|ticket|\bbet\b|rifa|loter[ií]a|boleto|apuesta|blockchain|stellar|wallet|billetera|token|hash/iu;
    for (const idioma of ["es", "en", null] as const) {
      const c = textoDeBienvenida(idioma, DATOS);
      for (const t of [c.asunto, c.texto, visible(c.html)]) expect(t).not.toMatch(prohibidas);
    }
  });
});

describe("las direcciones y los textos de la ficha", () => {
  it("una dirección con coma, espacio, salto de línea o dos destinatarios no es un correo", () => {
    expect(esCorreo(PARA)).toBe(true);
    const malas = ["a,b@correo.test", "a b@correo.test", "a@correo.test\nBcc: b@correo.test", "a@correo.test,b@correo.test", ".a@correo.test"];
    for (const mala of [...malas, "a..b@correo.test", 5, null]) expect(esCorreo(mala)).toBe(false);
  });

  it("limpiarTexto deja una sola línea visible, con su tope", () => {
    expect(limpiarTexto("  uno\n\tdos​  tres  ", 40)).toBe("uno dos tres");
    expect(limpiarTexto("abcdef", 3)).toBe("abc");
    expect(limpiarTexto(42, 3)).toBe("");
  });
});

describe("el mensajero", () => {
  it("manda con el enlace de envío: la persona, el remitente con su nombre, el asunto, los dos cuerpos y la respuesta al remitente", async () => {
    const { enlace, mandados } = enlaceDeMentira();
    const c = textoDeBienvenida("es", DATOS);
    expect(await mensajeroDeCloudflare(enlace, DE).mandar(PARA, c)).toEqual({ ok: true });
    const esperado = { to: PARA, from: { email: DE, name: NOMBRE_DEL_REMITENTE }, subject: c.asunto, text: c.texto, html: c.html, replyTo: DE };
    expect(mandados).toEqual([esperado]);
  });

  it("un error de Cloudflare deja solo su código fijo, nunca el mensaje con la dirección", async () => {
    const fallo = Object.assign(new Error(`no se pudo mandar a ${PARA}`), { code: "E_DAILY_LIMIT_EXCEEDED" });
    const { enlace } = enlaceDeMentira(async () => Promise.reject(fallo));
    const r = await mensajeroDeCloudflare(enlace, DE).mandar(PARA, textoDeBienvenida("es", DATOS));
    expect(r).toEqual({ ok: false, codigo: "E_DAILY_LIMIT_EXCEEDED" });
    expect(JSON.stringify(r)).not.toContain(PARA);
  });

  it("un error sin código con forma de código queda como error", async () => {
    const { enlace } = enlaceDeMentira(async () => Promise.reject(Object.assign(new Error("x"), { code: `E_${PARA}` })));
    expect(await mensajeroDeCloudflare(enlace, DE).mandar(PARA, textoDeBienvenida("es", DATOS))).toEqual({ ok: false, codigo: "error" });
  });

  it("un envío que nunca termina vuelve como tiempo al pasar su tope", async () => {
    vi.useFakeTimers();
    const { enlace } = enlaceDeMentira(() => new Promise(() => {}));
    const r = mensajeroDeCloudflare(enlace, DE).mandar(PARA, textoDeBienvenida("es", DATOS));
    await vi.advanceTimersByTimeAsync(TOPE_ENVIO_MS);
    expect(await r).toEqual({ ok: false, codigo: "tiempo" });
  });
});
