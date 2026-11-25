import { describe, expect, it } from "vitest";
import type { Lang } from "../idioma";
import { ESTADOS, estadoInicial, pantallaDe, type Aparato, type EntornoInicial, type Estado } from "./estados";
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

  it("esperar el desbloqueo nunca pasa de 65 s, y entrar da 20 s más para el índice", () => {
    expect(pantallaDe("mira-crear", { aparato: "cel" }, "es").topeMs).toBe(65_000);
    expect(pantallaDe("mira-sellar", { aparato: "cel" }, "es").topeMs).toBe(65_000);
    expect(pantallaDe("entrando", { aparato: "cel" }, "es").topeMs).toBe(85_000);
    expect(pantallaDe("cargando", { aparato: "cel" }, "es").topeMs).toBe(15_000);
    expect(pantallaDe("armando", { aparato: "cel" }, "es").topeMs).toBe(90_000);
    expect(pantallaDe("sellando", { aparato: "cel" }, "es").topeMs).toBe(90_000);
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
});
