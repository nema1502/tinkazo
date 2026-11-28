import { describe, expect, it } from "vitest";
import type { Lang } from "../idioma";
import { escaparHtml, ESTADOS, estadoInicial, pantallaDe, type Aparato, type DatosDeLaPantalla, type EntornoInicial, type Estado } from "./estados";
import { TEXTOS, type ClaveDePrueba } from "./textos";

// Comillas angulares, punto y coma, rayas largas, punto medio y flechas, por su código para no escribirlos.
const PROHIBIDOS = new RegExp(`[;${String.fromCharCode(171, 187, 8212, 8211, 183, 8594, 8592)}]`);
const LENGUAS: Lang[] = ["es", "en"];
const APARATOS: Aparato[] = ["cel", "compu"];

describe("los textos de la prueba", () => {
  it("las dos lenguas tienen las mismas claves y ninguna está vacía", () => {
    const es = Object.keys(TEXTOS.es).sort();
    const en = Object.keys(TEXTOS.en).sort();
    expect(en).toEqual(es);
    for (const l of LENGUAS) for (const k of es) expect(TEXTOS[l][k as ClaveDePrueba].trim().length, `${l}.${k}`).toBeGreaterThan(1);
  });

  it("no hay comillas angulares, punto y coma, rayas largas, punto medio ni flechas", () => {
    for (const l of LENGUAS) {
      for (const [k, v] of Object.entries(TEXTOS[l])) {
        expect(v, `${l}.${k}`).not.toMatch(PROHIBIDOS);
      }
    }
  });

  it("nada habla de rifas, loterías, boletos ni apuestas", () => {
    for (const l of LENGUAS) {
      for (const [k, v] of Object.entries(TEXTOS[l])) {
        expect(v, `${l}.${k}`).not.toMatch(/rifa|loter[ií]a|boleto|apuesta|raffle|ticket|bet\b/i);
      }
    }
  });

  it("huella (o fingerprint) va siempre junto a cara (o face), nunca sola", () => {
    for (const [k, v] of Object.entries(TEXTOS.es)) if (/huella/i.test(v)) expect(v, k).toMatch(/cara/i);
    for (const [k, v] of Object.entries(TEXTOS.en)) if (/fingerprint/i.test(v)) expect(v, k).toMatch(/face/i);
  });

  it("las líneas con strong solo traen el nombre de un botón o de la llave", () => {
    for (const l of LENGUAS) {
      for (const [k, v] of Object.entries(TEXTOS[l])) {
        if (!v.includes("<")) continue;
        expect(v.replace(/<strong>[^<]+<\/strong>/g, ""), `${l}.${k}`).not.toContain("<");
      }
    }
  });
});

describe("las pantallas", () => {
  const todas = (): Array<{ estado: Estado; lang: Lang; aparato: Aparato; p: ReturnType<typeof pantallaDe> }> => {
    const out = [];
    for (const estado of ESTADOS) for (const lang of LENGUAS) for (const aparato of APARATOS) out.push({ estado, lang, aparato, p: pantallaDe(estado, { aparato, ganador: "Nora" }, lang) });
    return out;
  };

  it("todo estado tiene pantalla, con título y línea, en las dos lenguas y los dos aparatos", () => {
    for (const { estado, lang, aparato, p } of todas()) {
      expect(p.titulo.trim().length, `${estado} ${lang} ${aparato}`).toBeGreaterThan(1);
      expect(p.linea.trim().length, `${estado} ${lang} ${aparato}`).toBeGreaterThan(1);
    }
  });

  it("como mucho un botón principal, y el secundario nunca viene solo salvo al esperar el sorteo o ver el comprobante", () => {
    for (const { estado, p } of todas()) {
      if (p.secundario && !p.principal) expect(["esperando"]).toContain(estado);
    }
  });

  it("toda espera sin botón principal tiene un tope de tiempo o un enlace para salir", () => {
    for (const { estado, p } of todas()) {
      if (p.principal) continue;
      expect(p.topeMs !== undefined || p.secundario !== undefined, estado).toBe(true);
    }
  });

  it("ni el título ni la línea ni los botones dicen red, firma, transacción, hash, XLM ni bytes", () => {
    for (const { estado, lang, p } of todas()) {
      const visible = [p.titulo, p.linea, p.principal?.texto ?? "", p.secundario?.texto ?? ""].join(" | ");
      const prohibidas = lang === "es" ? /\b(XLM|red|firma|firmas|transacci[oó]n|hash|drand|bytes?)\b/i : /\b(XLM|network|signature|transaction|hash|drand|bytes?)\b/i;
      expect(visible, `${estado} ${lang}`).not.toMatch(prohibidas);
    }
  });

  it("la pantalla de mirar el aparato nombra el teléfono en el celular y la pantalla en la compu", () => {
    expect(pantallaDe("mira-crear", { aparato: "cel" }, "es").titulo).toBe("Mirá tu teléfono");
    expect(pantallaDe("mira-crear", { aparato: "compu" }, "es").titulo).toBe("Mirá tu pantalla");
    expect(pantallaDe("mira-sellar", { aparato: "cel" }, "en").titulo).toBe("Check your phone");
    expect(pantallaDe("entrando", { aparato: "compu" }, "en").titulo).toBe("Check your screen");
  });

  it("el inicio cambia de línea con el aparato: la clave en el celular, el PIN en la compu", () => {
    expect(pantallaDe("inicio", { aparato: "cel" }, "es").linea).toContain("tu clave");
    expect(pantallaDe("inicio", { aparato: "compu" }, "es").linea).toContain("PIN");
    expect(pantallaDe("inicio", { aparato: "cel" }, "en").linea).toContain("screen lock");
  });

  it("la pantalla final dice quién ganó", () => {
    expect(pantallaDe("listo", { aparato: "cel", ganador: "Nora" }, "es").titulo).toBe("Salió Nora");
    expect(pantallaDe("listo", { aparato: "cel", ganador: "Nora" }, "en").titulo).toBe("Nora was drawn");
  });

  it("si la llave no se usó, el inicio y la cuenta lista lo dicen, y las demás pantallas no cambian", () => {
    expect(pantallaDe("inicio", { aparato: "cel", cancelada: true }, "es").linea).toBe(TEXTOS.es.canceladaLinea);
    expect(pantallaDe("cuenta-lista", { aparato: "cel", cancelada: true }, "en").linea).toBe(TEXTOS.en.canceladaLinea);
    expect(pantallaDe("sellando", { aparato: "cel", cancelada: true }, "es").linea).toBe(TEXTOS.es.sellandoLinea);
  });

  it("esperar el desbloqueo nunca pasa de 65 s, y buscar la cuenta da 30 s más", () => {
    expect(pantallaDe("mira-crear", { aparato: "cel" }, "es").topeMs).toBe(65_000);
    expect(pantallaDe("mira-sellar", { aparato: "cel" }, "es").topeMs).toBe(65_000);
    expect(pantallaDe("entrando", { aparato: "cel" }, "es").topeMs).toBe(65_000);
    expect(pantallaDe("buscando", { aparato: "cel" }, "es").topeMs).toBe(30_000);
    expect(pantallaDe("cargando", { aparato: "cel" }, "es").topeMs).toBe(15_000);
    expect(pantallaDe("armando", { aparato: "cel" }, "es").topeMs).toBe(90_000);
    expect(pantallaDe("sellando", { aparato: "cel" }, "es").topeMs).toBe(90_000);
  });

  it("las pantallas de entrar desde otro aparato dicen lo que pasó, en las dos lenguas, con un botón principal", () => {
    expect(pantallaDe("buscando", { aparato: "cel" }, "es")).toMatchObject({ titulo: "Buscando tu cuenta", linea: "Tarda unos segundos." });
    expect(pantallaDe("buscando", { aparato: "cel" }, "en").titulo).toBe("Finding your account");
    expect(pantallaDe("buscando", { aparato: "cel" }, "es").principal).toBeUndefined();
    for (const lang of LENGUAS) {
      expect(pantallaDe("sin-cuenta", { aparato: "cel" }, lang).principal?.accion).toBe("reintentar-entrar");
      expect(pantallaDe("sin-cuenta", { aparato: "cel" }, lang).secundario?.accion).toBe("crear-otra");
      expect(pantallaDe("vencida", { aparato: "cel" }, lang).principal?.accion).toBe("crear-otra");
      expect(pantallaDe("vencida", { aparato: "cel" }, lang).secundario).toBeUndefined();
      expect(pantallaDe("no-se-comprobo", { aparato: "cel" }, lang).principal?.accion).toBe("crear-otra");
      expect(pantallaDe("no-aparece", { aparato: "cel" }, lang).principal?.accion).toBe("reintentar-entrar");
    }
    expect(pantallaDe("vencida", { aparato: "cel" }, "es").titulo).toBe("Esta cuenta de prueba ya terminó");
    expect(pantallaDe("no-se-comprobo", { aparato: "cel" }, "en").titulo).toBe("We couldn't check this account");
  });

  it("la línea de no encontrar la cuenta ya no habla de esperar al índice", () => {
    for (const lang of LENGUAS) expect(TEXTOS[lang].noApareceLinea).not.toMatch(/minutos|minutes|índice|index/i);
  });
});

describe("las pantallas de recibir y mandar monedas de prueba", () => {
  const P = (estado: Estado, datos: Partial<DatosDeLaPantalla> = {}, lang: Lang = "es"): ReturnType<typeof pantallaDe> => pantallaDe(estado, { aparato: "cel", ...datos }, lang);
  const DIRECCION = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";

  it("ningún texto deja un hueco sin llenar, con o sin datos, en las dos lenguas y los dos aparatos", () => {
    const conDatos: Partial<DatosDeLaPantalla> = { monto: "100000000", fin: "WQ4N", direccion: DIRECCION, nota: "1234567890", recibido: true, destinoDelEnlace: true, notaEnvio: "confirmada" };
    for (const estado of ESTADOS) {
      for (const lang of LENGUAS) {
        for (const aparato of APARATOS) {
          for (const datos of [{}, conDatos]) {
            const p = pantallaDe(estado, { aparato, ...datos }, lang);
            const visible = [p.titulo, p.linea, p.principal?.texto ?? "", p.secundario?.texto ?? ""].join(" | ");
            expect(visible, `${estado} ${lang} ${aparato}`).not.toMatch(/[{}]/);
          }
        }
      }
    }
  });

  it("el inicio del modo premio dice cuántas monedas llegan y que no hay sorteo, y cambia con el aparato", () => {
    expect(P("premio-inicio").linea).toContain("10 monedas de prueba, sin sorteo");
    expect(P("premio-inicio").linea).toContain("tu clave");
    expect(pantallaDe("premio-inicio", { aparato: "compu" }, "es").linea).toContain("PIN");
    expect(P("premio-inicio", {}, "en").linea).toContain("10 test coins arrive, no draw involved");
    expect(P("premio-inicio").principal?.accion).toBe("crear");
    expect(P("premio-inicio").secundario?.accion).toBe("ya-tengo");
    expect(P("premio-inicio", { cancelada: true }).linea).toBe(TEXTOS.es.canceladaLinea);
  });

  it("recibir y mandar esperan como mucho 90 s, y esperar el desbloqueo de mandar 65 s", () => {
    expect(P("recibiendo").topeMs).toBe(90_000);
    expect(P("enviando").topeMs).toBe(90_000);
    expect(P("mira-mandar").topeMs).toBe(65_000);
    expect(P("mira-mandar").titulo).toBe("Mirá tu teléfono");
    expect(pantallaDe("mira-mandar", { aparato: "compu" }, "en").titulo).toBe("Check your screen");
    expect(P("mira-mandar", { monto: "25000000" }).linea).toBe("Tu llave aprueba mandar 2,5 monedas de prueba.");
    expect(P("mira-mandar", { monto: "100000000", destinoDelEnlace: true, direccion: "GABCDEFGH" }).linea).toBe("Tu llave aprueba mandar 10 monedas de prueba a GABC DEFG H.");
  });

  it("la pantalla con las monedas dice si llegaron recién o si se leyeron, con el monto", () => {
    expect(P("premio-listo", { monto: "100000000", recibido: true }).titulo).toBe("Te llegaron 10 monedas de prueba");
    expect(P("premio-listo", { monto: "100000000", recibido: false }).titulo).toBe("Tenés 10 monedas de prueba");
    expect(P("premio-listo", { monto: "100000000", recibido: true }, "en").titulo).toBe("10 test coins arrived");
    expect(P("premio-listo", { monto: "30000000" }, "en").titulo).toBe("You have 3 test coins");
    expect(P("premio-listo", { monto: "100000000", recibido: true }).principal?.accion).toBe("mandar");
    expect(P("premio-listo", { recibido: true, cancelada: true }).linea).toBe(TEXTOS.es.canceladaLinea);
  });

  it("la línea de la pantalla con las monedas nombra el destino: el de la página, el del enlace, y el del enlace con nota", () => {
    expect(P("premio-listo", { recibido: true }).linea).toContain("La arma esta página");
    const enlace = P("premio-listo", { recibido: true, destinoDelEnlace: true, direccion: DIRECCION });
    expect(enlace.linea).toContain("GAAH 4OT3 6RRC");
    expect(enlace.linea).not.toContain("con la nota");
    const conNota = P("premio-listo", { recibido: true, destinoDelEnlace: true, direccion: DIRECCION, nota: "99" });
    expect(conNota.linea).toContain("con la nota 99");
  });

  it("al mandar, la línea final cuenta lo que se leyó de la nota y solo eso", () => {
    const base = { monto: "100000000", fin: "WQ4N", nota: "1234567890" };
    expect(P("enviado", { ...base, notaEnvio: "confirmada" }).linea).toBe("Llegaron 10 monedas de prueba a la cuenta que termina en WQ4N, con la nota 1234567890.");
    expect(P("enviado", { ...base, notaEnvio: "no-pedida" }).linea).toBe("Llegaron 10 monedas de prueba a la cuenta que termina en WQ4N.");
    expect(P("enviado", { ...base, notaEnvio: "sin-dato" }).linea).toContain("No pudimos confirmar la nota");
    expect(P("enviado", { ...base, notaEnvio: "distinta" }).linea).toContain("no con la nota pedida");
    expect(P("enviado", { ...base, notaEnvio: "confirmada" }, "en").linea).toBe("10 test coins reached the account ending in WQ4N, with the note 1234567890.");
    expect(P("enviado", base).principal?.accion).toBe("costos");
    expect(P("enviado", base).secundario?.accion).toBe("crear-otra");
  });

  it("sin monedas tiene dos líneas, según el registro del aparato, y siempre una salida", () => {
    expect(P("sin-monedas").linea).toBe(TEXTOS.es.sinMonedasLinea);
    expect(P("sin-monedas", { yaEnviadas: true }).linea).toBe(TEXTOS.es.sinMonedasLineaEnviadas);
    expect(P("sin-monedas").principal?.accion).toBe("crear-otra");
  });

  it("las pantallas de salida llevan al botón correcto", () => {
    for (const e of ["pide-nota", "no-recibe", "enlace-mal"] as const) expect(P(e).principal?.accion, e).toBe("sin-destino");
    for (const e of ["no-se-envio", "no-llego-premio", "saldo-sin-leer"] as const) expect(P(e).principal?.accion, e).toBe("reintentar");
  });

  it("los textos nunca prometen un ganador ni hablan de exchanges", () => {
    for (const l of LENGUAS) {
      for (const [k, v] of Object.entries(TEXTOS[l])) {
        if (!/^(premio|recibiendo|enviando|enviado|pideNota|noRecibe|noSeEnvio|noLlegoPremio|sinMonedas|saldoSinLeer|enlaceMal|costosRecibir|costosMandar|miraMandar)/.test(k)) continue;
        expect(v, `${l}.${k}`).not.toMatch(/ganaste|you won|exchange|binance/i);
      }
    }
  });

  it("un dato de afuera entra escapado en las líneas", () => {
    const p = P("premio-listo", { recibido: true, destinoDelEnlace: true, direccion: "<b>x</b>&" });
    expect(p.linea).not.toContain("<b>");
    expect(p.linea).toContain("&lt;b&gt;");
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("con qué pantalla abre la página", () => {
  const base: EntornoInicial = { host: "localhost", hayPasskeys: true, enApp: false, conBloqueo: true, punteroGrueso: false, hayLlaveLocal: false, selloPendiente: false };
  const con = (c: Partial<EntornoInicial>): Estado => estadoInicial({ ...base, ...c });

  it("el camino normal abre en el inicio", () => {
    expect(con({})).toBe("inicio");
  });

  it("un anfitrión fuera de la lista abre en no-es-aca, pase lo que pase", () => {
    expect(con({ host: "tinkazo.app", selloPendiente: true })).toBe("no-es-aca");
    expect(con({ host: "tinkazo.vercel.app" })).toBe("no-es-aca");
  });

  it("con un sello pendiente vuelve a esperar el sorteo", () => {
    expect(con({ selloPendiente: true, hayLlaveLocal: true })).toBe("esperando");
  });

  it("sin passkeys, en una app o sin bloqueo en el celular abre el aviso que corresponde", () => {
    expect(con({ hayPasskeys: false })).toBe("sin-llaves");
    expect(con({ enApp: true })).toBe("en-app");
    expect(con({ punteroGrueso: true, conBloqueo: false })).toBe("sin-bloqueo");
    expect(con({ punteroGrueso: false, conBloqueo: false })).toBe("inicio");
    expect(con({ punteroGrueso: true, conBloqueo: null })).toBe("inicio");
  });

  it("con una llave en este aparato ofrece usarla", () => {
    expect(con({ hayLlaveLocal: true })).toBe("ya-hay-llave");
  });

  it("el modo premio abre en su propio inicio, y sin él todo sigue igual", () => {
    expect(con({ modoPremio: true })).toBe("premio-inicio");
    expect(con({ modoPremio: true, hayLlaveLocal: true })).toBe("ya-hay-llave");
    expect(con({ modoPremio: true, hayPasskeys: false })).toBe("sin-llaves");
    expect(con({ modoPremio: true, host: "tinkazo.app" })).toBe("no-es-aca");
    expect(con({ modoPremio: false })).toBe("inicio");
  });

  it("con dinero mandado y sin confirmar, el modo premio abre en el aviso de que tarda", () => {
    expect(con({ modoPremio: true, pendienteDeDinero: true })).toBe("lento");
    expect(con({ modoPremio: true, pendienteDeDinero: true, hayLlaveLocal: true })).toBe("lento");
    expect(con({ modoPremio: false, pendienteDeDinero: true })).toBe("inicio");
    expect(con({ modoPremio: true, pendienteDeDinero: true, host: "tinkazo.vercel.app" })).toBe("no-es-aca");
  });

  it("un sello pendiente da esperando solo fuera del modo premio", () => {
    expect(con({ selloPendiente: true })).toBe("esperando");
    expect(con({ selloPendiente: true, modoPremio: true })).toBe("premio-inicio");
  });
});
