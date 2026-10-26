import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { T } from "../i18n";
import { type SorteoDelEvento, decodeEvento } from "../protocol/evento";
import { PROOF_VERSION, type Proof } from "../protocol/proof";
import {
  datosDeComprobante,
  fotoDeEvento,
  fotoDeSorteo,
  lineasDeEvento,
  mensajeDeEvento,
  mensajeDeSorteo,
  paqueteDeEvento,
  prepararEvento,
} from "./compartir";

/**
 * Un sorteo hecho sin sello queda marcado en todo lo que sale de la app: el mensaje, la foto, el mensaje al
 * ganador, el evento (mensaje, foto, enlace). Dice "Sin sello: no se puede comprobar." (es y en) y nunca
 * "verificable" ni "verificarlo". Sin red: solo texto y enlaces.
 */

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const enlaceEvento = "https://tinkazo.app/evento.html#rEJEMPLO";
const BASE = "https://tinkazo.app";
const PIDE_VERIFICAR = /verific|verif|nadie eligi|nobody picked|hand-picked|a dedo/i;
const lista = (lang: "es" | "en", nombres: string[]): string => new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);
const etiqueta = (lang: "es" | "en"): string => String(T[lang].redSinSelloEtiqueta);

const R = vectors.quicknet.round;
const base: Proof = { v: PROOF_VERSION, names: [...vectors.list], round: R, signature: vectors.quicknet.signature };
const sellado: SorteoDelEvento = {
  ...base,
  prize: "Polera",
  sealedAt: 1_792_500_000,
  net: "testnet",
  contract: "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH",
  id: "4",
  ganadores: ["Gabriela Flores"],
};
const sinSello: SorteoDelEvento = { ...base, prize: "Libro", sealedAt: 1_792_500_100, sinSello: true, ganadores: ["Ana"] };

describe("el mensaje de un sorteo sin sello", () => {
  const casos = [
    { ganadores: ["Ana"], premio: "Pizza" },
    { ganadores: ["Ana"], premio: "" },
    { ganadores: ["Ana", "Beto"], premio: "Pizza" },
    { ganadores: ["Ana", "Beto", "Carla"], premio: "" },
  ];
  for (const lang of ["es", "en"] as const) {
    for (const c of casos) {
      it(`${lang}: ${c.ganadores.length} ganador(es), premio "${c.premio}": igual a T.${lang}.summary, con la frase y sin prometer nada`, () => {
        const varios = c.ganadores.length > 1;
        const m = mensajeDeSorteo(lang, { ganadores: c.ganadores, total: 12, premio: c.premio, enlace, sinSello: true });
        expect(m).toBe(T[lang].summary(lista(lang, c.ganadores), 12, c.premio, enlace, varios, true));
        expect(m).toContain(etiqueta(lang));
        expect(m).toContain(enlace);
        // Sin contar el enlace, que lleva "verificar.html" en su dirección.
        expect(m.split(enlace).join("")).not.toMatch(PIDE_VERIFICAR);
        // El mensaje de un sorteo sellado, el de siempre.
        const normal = mensajeDeSorteo(lang, { ganadores: c.ganadores, total: 12, premio: c.premio, enlace });
        expect(normal).toBe(T[lang].summary(lista(lang, c.ganadores), 12, c.premio, enlace, varios));
        expect(normal).not.toContain(etiqueta(lang));
        expect(normal).toMatch(/verif/i);
      });
    }
  }

  it("es: la forma exacta", () => {
    expect(mensajeDeSorteo("es", { ganadores: ["Ana"], total: 12, premio: "", enlace, sinSello: true })).toBe(
      `Ganó Ana, entre 12 personas.\nSin sello: no se puede comprobar.\nPara ver la lista y la cuenta, entrá acá: ${enlace}\n\nSorteado con Tinkazo · https://tinkazo.app`,
    );
  });
});

describe("la foto de un sorteo sin sello", () => {
  for (const lang of ["es", "en"] as const) {
    it(`${lang}: lleva la frase y junto al QR no dice comprobarlo`, () => {
      const f = fotoDeSorteo(lang, { ganadores: ["Ana"], total: 12, premio: "", enlace, sinSello: true }, enlace);
      expect(f.lineas).toContain(etiqueta(lang));
      expect(f.escanear).toBe(T[lang].fotoEscanearSinSello);
      expect(f.sinQr).toBe(T[lang].fotoSinQrSinSello);
      expect(`${f.escanear} ${f.sinQr}`).not.toMatch(/comprob|check|verif/i);
      const normal = fotoDeSorteo(lang, { ganadores: ["Ana"], total: 12, premio: "", enlace }, enlace);
      expect(normal.lineas).not.toContain(etiqueta(lang));
      expect(normal.escanear).toBe(T[lang].fotoEscanear);
    });
  }
});

describe("desde Mis sorteos: los datos salen del comprobante", () => {
  it("con la marca y sin ancla: sin sello", () => {
    const d = datosDeComprobante({ ...base, sinSello: true }, enlace, ["Ana"]);
    expect(d.sinSello).toBe(true);
    expect(mensajeDeSorteo("es", d)).toContain("Sin sello: no se puede comprobar.");
  });
  it("sin la marca, o con un ancla (el ancla manda): el de siempre", () => {
    expect(datosDeComprobante(base, enlace, ["Ana"])).not.toHaveProperty("sinSello");
    expect(datosDeComprobante({ ...sellado, sinSello: true }, enlace, ["Ana"])).not.toHaveProperty("sinSello");
    expect(datosDeComprobante({ ...sellado, sinSello: true }, enlace, ["Ana"]).numero).toBe("4");
  });
});

describe("el mensaje al ganador de un sorteo sin sello", () => {
  it("dice que no se puede comprobar y no promete que nadie lo eligió ni que lo revise", () => {
    for (const lang of ["es", "en"] as const) {
      for (const varios of [false, true]) {
        const m = T[lang].tellBody("Ana", "una polera", 12, enlace, varios, true);
        expect(m).toContain(etiqueta(lang));
        expect(m).toContain(enlace);
        expect(m).not.toMatch(/a dedo|hand-picked|revis|check it|faro|beacon|se cerró|was locked/i);
        // El de siempre no cambió.
        expect(T[lang].tellBody("Ana", "una polera", 12, enlace, varios)).not.toContain(etiqueta(lang));
      }
    }
    expect(T.es.tellBody("Ana", "", 12, enlace, false)).toContain("nadie te eligió a dedo");
  });
});

describe("la pantalla grande", () => {
  it("tiene su texto sin sello en los dos idiomas, que no dice comprobalo", () => {
    for (const lang of ["es", "en"] as const) {
      expect(String(T[lang].pantallaQrSinSello)).not.toMatch(/comprob|check|verif/i);
      expect(String(T[lang].pantallaQrSinSello).length).toBeGreaterThan(10);
    }
  });
});

describe("evento con un sorteo sellado y uno sin sello", () => {
  const sorteos = [sellado, sinSello];

  it("los renglones: el sin sello lo dice, el sellado no", () => {
    expect(lineasDeEvento("es", sorteos)).toEqual(["Polera: Gabriela Flores", "Libro: Ana · Sin sello: no se puede comprobar."]);
    expect(lineasDeEvento("en", sorteos)).toEqual(["Polera: Gabriela Flores", "Libro: Ana · No seal: it can't be checked."]);
  });

  it("el mensaje: no dice verificable ni verificarlos, y cuenta cuántos van sin sello", () => {
    const lineas = lineasDeEvento("es", sorteos);
    const es = mensajeDeEvento("es", { titulo: "Meetup", sorteos: 2, enlaces: enlaceEvento, lineas, sinSello: 1 });
    expect(es).toBe(
      `Meetup (2 sorteos), 1 sin sello.\nPolera: Gabriela Flores\nLibro: Ana · Sin sello: no se puede comprobar.\nPara ver cada sorteo, entrá acá:\n${enlaceEvento}\n\nSorteado con Tinkazo · https://tinkazo.app`,
    );
    expect(es).not.toMatch(/verific/i);
    const en = mensajeDeEvento("en", { titulo: "Meetup", sorteos: 2, enlaces: enlaceEvento, lineas: lineasDeEvento("en", sorteos), sinSello: 1 });
    expect(en.startsWith("Meetup (2 draws), 1 without a seal.\nPolera: Gabriela Flores\nLibro: Ana · No seal: it can't be checked.\nTo see each draw, open this link:\n")).toBe(true);
    expect(en).not.toMatch(/verif/i);
  });

  it("con uno solo, sin sello: ni verificable ni verificarlo", () => {
    const m = mensajeDeEvento("es", { titulo: "Meetup", sorteos: 1, enlaces: enlaceEvento, lineas: lineasDeEvento("es", [sinSello]), sinSello: 1 });
    expect(m.startsWith("Meetup (1 sorteo), sin sello.\nLibro: Ana · Sin sello: no se puede comprobar.\nPara ver el sorteo, entrá acá:\n")).toBe(true);
    expect(m).not.toMatch(/verific/i);
    const en = mensajeDeEvento("en", { titulo: "Meetup", sorteos: 1, enlaces: enlaceEvento, lineas: lineasDeEvento("en", [sinSello]), sinSello: 1 });
    expect(en.startsWith("Meetup (1 draw), no seal.\n")).toBe(true);
    expect(en).not.toMatch(/verif/i);
  });

  it("con todos sellados el mensaje es el de siempre", () => {
    const con = mensajeDeEvento("es", { titulo: "Meetup", sorteos: 2, enlaces: enlaceEvento, lineas: ["a", "b"], sinSello: 0 });
    expect(con).toBe(mensajeDeEvento("es", { titulo: "Meetup", sorteos: 2, enlaces: enlaceEvento, lineas: ["a", "b"] }));
    expect(con).toContain("todos verificables");
  });

  it("la foto: el renglón del sin sello trae la frase, el otro no, y junto al QR no dice comprobarlo", () => {
    for (const lang of ["es", "en"] as const) {
      const f = fotoDeEvento(lang, "Meetup", sorteos, enlaceEvento);
      expect(f.filas?.map((x) => x.nota)).toEqual([undefined, etiqueta(lang)]);
      expect(f.escanear).toBe(T[lang].fotoEscanearSinSello);
      expect(f.sinQr).toBe(T[lang].fotoSinQrSinSello);
    }
    const todosSellados = fotoDeEvento("es", "Meetup", [sellado], enlaceEvento);
    expect(todosSellados.filas?.[0]).not.toHaveProperty("nota");
    expect(todosSellados.escanear).toBe(T.es.fotoEscanear);
  });

  it("el enlace del evento lleva la marca de cada sorteo, y el paquete completo lo dice", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "es", BASE);
    expect(r).not.toBeNull();
    expect(r?.mensaje).toContain("Libro: Ana · Sin sello: no se puede comprobar.");
    expect(r?.mensaje).toContain("Polera: Gabriela Flores\n");
    expect(r?.mensaje).not.toMatch(/verific/i);
    const enlaceDelEvento = r?.partes[0]?.enlace ?? "";
    const ev = await decodeEvento(enlaceDelEvento.slice(enlaceDelEvento.indexOf("#")));
    expect(ev.sorteos.map((s) => s.sinSello === true)).toEqual([false, true]);
  });

  it("preparar el evento (sin enlace corto): mensaje y foto con la marca", async () => {
    for (const lang of ["es", "en"] as const) {
      const l = await prepararEvento("Meetup", sorteos, lang, { corto: false, base: BASE });
      expect(l.mensaje).toContain(etiqueta(lang));
      expect(l.mensaje).not.toMatch(/verific|verif/i);
      expect(l.fotos[0]?.filas?.[1]?.nota).toBe(etiqueta(lang));
    }
  }, 30_000);
});
