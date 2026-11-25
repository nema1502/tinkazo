import { describe, expect, it } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import { leerCampana, type Campana } from "./modelo";

const AHORA = Date.UTC(2026, 10, 15, 18, 0);
const FUERA_DE_FECHA = 8_640_000_000_000_001;

const base = (): Record<string, unknown> => ({
  v: 1,
  evento: "e7k2m9",
  red: "testnet",
  estado: "abierta",
  empresa: { nombre: "Empresa de ejemplo", logo: null, color: "verde" },
  lugar: { es: "Evento de ejemplo", en: "Sample event" },
  zona: "America/La_Paz",
  premios: ["400000000"],
  abre_ms: 1764331200000,
  cierra_ms: 1764356400000,
  sorteo_ms: 1764365400000,
  recibir_hasta_ms: 1779917400000,
  entrada: "google",
  pasos: [],
  bases: { es: "Bases", en: "Rules" },
  anotadas: 37,
  contrato: null,
  promo: null,
  comprobante: null,
});

function campo(cambio: Record<string, unknown>): string {
  const lectura = leerCampana({ ...base(), ...cambio });
  if (lectura.ok) throw new Error("se esperaba un error");
  return lectura.campo;
}

function acepta(cambio: Record<string, unknown>): boolean {
  return leerCampana({ ...base(), ...cambio }).ok;
}

function entradaDeEjemplo(campana: Campana): Record<string, unknown> {
  return {
    ...campana,
    premios: campana.premios.map((premio) => premio.toString()),
    abre_ms: campana.abreMs,
    cierra_ms: campana.cierraMs,
    sorteo_ms: campana.sorteoMs,
    recibir_hasta_ms: campana.recibirHastaMs,
  };
}

function pasoDeTexto(longitud: number): Record<string, unknown> {
  return {
    tipo: "texto",
    url: null,
    texto: { es: "a".repeat(longitud), en: "Text" },
  };
}

describe("leerCampana", () => {
  it("acepta la campaña de ejemplo completa con un reloj fijo", () => {
    const ejemplo = campanaDeEjemplo(AHORA);
    const lectura = leerCampana(entradaDeEjemplo(ejemplo));
    expect(lectura.ok).toBe(true);
    if (lectura.ok) {
      expect(lectura.campana).toEqual({
        ...ejemplo,
        pasos: [
          {
            tipo: "instagram",
            url: "https://www.instagram.com/",
            texto: { es: "Seguir en Instagram", en: "Follow on Instagram" },
          },
          {
            tipo: "tiktok",
            url: "https://www.tiktok.com/",
            texto: { es: "Seguir en TikTok", en: "Follow on TikTok" },
          },
          {
            tipo: "x",
            url: "https://x.com/",
            texto: { es: "Seguir en X", en: "Follow on X" },
          },
        ],
      });
    }
  });

  it("rechaza una versión distinta", () => {
    expect(campo({ v: 2 })).toBe("v");
  });

  it("rechaza un evento con mayúsculas", () => {
    expect(campo({ evento: "Mal" })).toBe("evento");
  });

  it("rechaza un evento de dos caracteres", () => {
    expect(campo({ evento: "a1" })).toBe("evento");
  });

  it("acepta un evento de tres caracteres", () => {
    expect(acepta({ evento: "a1b" })).toBe(true);
  });

  it("acepta un evento de cuarenta caracteres", () => {
    expect(acepta({ evento: "a".repeat(40) })).toBe(true);
  });

  it("rechaza un evento de cuarenta y un caracteres", () => {
    expect(campo({ evento: "a".repeat(41) })).toBe("evento");
  });

  it("rechaza un evento que empieza con guion", () => {
    expect(campo({ evento: "-a1" })).toBe("evento");
  });

  it("rechaza una red desconocida", () => {
    expect(campo({ red: "privada" })).toBe("red");
  });

  it("rechaza una red distinta de la configurada en la página", () => {
    expect(campo({ red: "mainnet" })).toBe("red");
  });

  it("rechaza un estado desconocido", () => {
    expect(campo({ estado: "nuevo" })).toBe("estado");
  });

  it("rechaza un nombre vacío", () => {
    const empresa = { nombre: "", logo: null, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.nombre");
  });

  it("rechaza un nombre con espacios a los costados", () => {
    const empresa = { nombre: " Empresa ", logo: null, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.nombre");
  });

  it("rechaza un nombre con un carácter invisible", () => {
    const empresa = { nombre: "Empresa\u200B", logo: null, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.nombre");
  });

  it("rechaza un nombre de cuarenta y un caracteres", () => {
    const empresa = { nombre: "a".repeat(41), logo: null, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.nombre");
  });

  it("rechaza un logo de otro tipo", () => {
    const logo = { tipo: "image/gif", datos: "AAAA" };
    const empresa = { nombre: "Empresa", logo, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.logo");
  });

  it("rechaza un logo con base64 mal formado", () => {
    const logo = { tipo: "image/png", datos: "****" };
    const empresa = { nombre: "Empresa", logo, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.logo");
  });

  it("rechaza un logo de más de 40 KB", () => {
    const logo = { tipo: "image/png", datos: "A".repeat(54_616) };
    const empresa = { nombre: "Empresa", logo, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.logo");
  });

  it("rechaza una cadena de logo que supera el máximo de base64", () => {
    const logo = { tipo: "image/png", datos: "A".repeat(54_617) };
    const empresa = { nombre: "Empresa", logo, color: "verde" };
    expect(campo({ empresa })).toBe("empresa.logo");
  });

  it("acepta un logo de exactamente 40 KB", () => {
    const logo = { tipo: "image/png", datos: `${"A".repeat(54_614)}==` };
    const empresa = { nombre: "Empresa", logo, color: "verde" };
    expect(acepta({ empresa })).toBe(true);
  });

  it("rechaza el lugar en inglés vacío", () => {
    expect(campo({ lugar: { es: "Lugar", en: "" } })).toBe("lugar");
  });

  it("rechaza el lugar en español de más de 60 caracteres", () => {
    expect(campo({ lugar: { es: "a".repeat(61), en: "Place" } })).toBe("lugar");
  });

  it("rechaza un control de dirección en el lugar", () => {
    expect(campo({ lugar: { es: "Lugar\u202E", en: "Place" } })).toBe("lugar");
  });

  it("rechaza una zona inventada", () => {
    expect(campo({ zona: "Zona/Inventada" })).toBe("zona");
  });

  it("rechaza premios vacíos", () => {
    expect(campo({ premios: [] })).toBe("premios");
  });

  it("rechaza once premios", () => {
    expect(campo({ premios: Array.from({ length: 11 }, () => "100000") })).toBe("premios");
  });

  it("acepta diez premios", () => {
    expect(acepta({ premios: Array.from({ length: 10 }, () => "100000") })).toBe(true);
  });

  it("rechaza un premio de menos de un centavo, que no se puede mostrar sin inflarlo", () => {
    expect(campo({ premios: ["99999"] })).toBe("premios");
  });

  it("acepta un premio de un centavo exacto", () => {
    expect(acepta({ premios: ["100000"] })).toBe(true);
  });

  it("rechaza un premio con letras", () => {
    expect(campo({ premios: ["12a"] })).toBe("premios");
  });

  it("rechaza un premio de más de dieciséis dígitos", () => {
    expect(campo({ premios: ["1".repeat(17)] })).toBe("premios");
  });

  it("acepta un premio de dieciséis dígitos", () => {
    expect(acepta({ premios: ["9".repeat(16)] })).toBe(true);
  });

  it("rechaza un premio en cero", () => {
    expect(campo({ premios: ["0"] })).toBe("premios");
  });

  it("rechaza abre_ms no entero", () => {
    expect(campo({ abre_ms: 1.5 })).toBe("abre_ms");
  });

  it("rechaza cierra_ms no entero", () => {
    expect(campo({ cierra_ms: 1.5 })).toBe("cierra_ms");
  });

  it("rechaza sorteo_ms no entero", () => {
    expect(campo({ sorteo_ms: 1.5 })).toBe("sorteo_ms");
  });

  it("rechaza recibir_hasta_ms no entero", () => {
    expect(campo({ recibir_hasta_ms: 1.5 })).toBe("recibir_hasta_ms");
  });

  it("rechaza abre_ms negativo", () => {
    expect(campo({ abre_ms: -1 })).toBe("abre_ms");
  });

  it("rechaza cierra_ms negativo", () => {
    expect(campo({ cierra_ms: -1 })).toBe("cierra_ms");
  });

  it("rechaza sorteo_ms negativo", () => {
    expect(campo({ sorteo_ms: -1 })).toBe("sorteo_ms");
  });

  it("rechaza recibir_hasta_ms negativo", () => {
    expect(campo({ recibir_hasta_ms: -1 })).toBe("recibir_hasta_ms");
  });

  it("rechaza abre_ms por encima del máximo de una fecha", () => {
    expect(campo({ abre_ms: FUERA_DE_FECHA })).toBe("abre_ms");
  });

  it("rechaza cierra_ms por encima del máximo de una fecha", () => {
    expect(campo({ cierra_ms: FUERA_DE_FECHA })).toBe("cierra_ms");
  });

  it("rechaza sorteo_ms por encima del máximo de una fecha", () => {
    expect(campo({ sorteo_ms: FUERA_DE_FECHA })).toBe("sorteo_ms");
  });

  it("rechaza recibir_hasta_ms por encima del máximo de una fecha", () => {
    expect(campo({ recibir_hasta_ms: FUERA_DE_FECHA })).toBe("recibir_hasta_ms");
  });

  it("rechaza horas desordenadas", () => {
    expect(campo({ cierra_ms: 1 })).toBe("horas");
  });

  it("acepta que el cierre y el sorteo sean a la misma hora", () => {
    const datos = base();
    expect(acepta({ sorteo_ms: datos.cierra_ms })).toBe(true);
  });

  it("rechaza que el sorteo y el fin del plazo sean a la misma hora", () => {
    const datos = base();
    expect(campo({ sorteo_ms: datos.recibir_hasta_ms })).toBe("horas");
  });

  it("rechaza una entrada desconocida", () => {
    expect(campo({ entrada: "correo" })).toBe("entrada");
  });

  it("rechaza nueve pasos", () => {
    const pasos = Array.from({ length: 9 }, () => pasoDeTexto(5));
    expect(campo({ pasos })).toBe("pasos");
  });

  it("acepta ocho pasos", () => {
    const pasos = Array.from({ length: 8 }, () => pasoDeTexto(5));
    expect(acepta({ pasos })).toBe(true);
  });

  it("rechaza un texto de paso de 121 caracteres", () => {
    expect(campo({ pasos: [pasoDeTexto(121)] })).toBe("pasos.texto");
  });

  it("acepta un texto de paso de 120 caracteres", () => {
    expect(acepta({ pasos: [pasoDeTexto(120)] })).toBe(true);
  });

  it("rechaza un salto de línea en el texto de un paso", () => {
    const paso = { tipo: "texto", url: null, texto: { es: "Una\nlínea", en: "Text" } };
    expect(campo({ pasos: [paso] })).toBe("pasos.texto");
  });

  it("rechaza un texto de paso vacío cuando el paso es solo texto", () => {
    const paso = { tipo: "texto", url: null, texto: { es: "", en: "Texto" } };
    expect(campo({ pasos: [paso] })).toBe("pasos.texto");
  });

  it("rechaza un paso con enlace que no tiene dirección", () => {
    const paso = { tipo: "instagram", url: null, texto: { es: "Seguir", en: "Follow" } };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("rechaza un enlace con usuario", () => {
    const paso = {
      tipo: "instagram",
      url: "https://alguien@instagram.com/x",
      texto: { es: "Seguir", en: "Follow" },
    };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("rechaza un enlace de otra red social", () => {
    const paso = { tipo: "instagram", url: "https://tiktok.com/x", texto: { es: "Seguir", en: "Follow" } };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("rechaza un enlace sin HTTPS", () => {
    const paso = { tipo: "enlace", url: "http://example.org", texto: { es: "Mirá", en: "See" } };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("rechaza una dirección con puerto", () => {
    const paso = {
      tipo: "instagram",
      url: "https://instagram.com:8443/ejemplo",
      texto: { es: "Seguir", en: "Follow" },
    };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("guarda la dirección normalizada y sin caracteres de control", () => {
    const paso = {
      tipo: "instagram",
      url: "https://www.instagram.com/\tejemplo",
      texto: { es: "Seguir", en: "Follow" },
    };
    const lectura = leerCampana({ ...base(), pasos: [paso] });
    expect(lectura.ok && lectura.campana.pasos[0]?.url).toBe("https://www.instagram.com/ejemplo");
  });

  it("rechaza un paso de texto con enlace", () => {
    const paso = {
      tipo: "texto",
      url: "https://example.org",
      texto: { es: "Texto", en: "Text" },
    };
    expect(campo({ pasos: [paso] })).toBe("pasos.url");
  });

  it("rechaza bases vacías", () => {
    expect(campo({ bases: { es: "", en: "Rules" } })).toBe("bases");
  });

  it("rechaza bases de más de 6000 caracteres", () => {
    expect(campo({ bases: { es: "a".repeat(6001), en: "Rules" } })).toBe("bases");
  });

  it("acepta bases de 6000 caracteres", () => {
    expect(acepta({ bases: { es: "a".repeat(6000), en: "Rules" } })).toBe(true);
  });

  it("rechaza un carácter invisible en las bases", () => {
    expect(campo({ bases: { es: "Bases\u200B", en: "Rules" } })).toBe("bases");
  });

  it("permite saltos de línea y tabulaciones en las bases", () => {
    expect(acepta({ bases: { es: "Primera línea\n\tSegunda", en: "First line\n\tSecond" } })).toBe(true);
  });

  it("rechaza una cantidad de anotadas negativa", () => {
    expect(campo({ anotadas: -1 })).toBe("anotadas");
  });

  it("rechaza una cantidad de anotadas no entera", () => {
    expect(campo({ anotadas: 1.5 })).toBe("anotadas");
  });

  it("rechaza una cantidad de anotadas que no es un entero seguro", () => {
    expect(campo({ anotadas: Number.MAX_SAFE_INTEGER + 1 })).toBe("anotadas");
  });

  it("rechaza una promoción con letras", () => {
    expect(campo({ promo: "12a" })).toBe("promo");
  });

  it("rechaza un contrato de 55 caracteres", () => {
    expect(campo({ contrato: `C${"A".repeat(54)}` })).toBe("contrato");
  });

  it("rechaza un contrato de 57 caracteres", () => {
    expect(campo({ contrato: `C${"A".repeat(56)}` })).toBe("contrato");
  });

  it("rechaza un contrato que no empieza con C", () => {
    expect(campo({ contrato: "A".repeat(56) })).toBe("contrato");
  });

  it("rechaza un contrato con caracteres fuera de base32", () => {
    expect(campo({ contrato: `C${"0".repeat(55)}` })).toBe("contrato");
  });

  it("rechaza un comprobante de otro sitio", () => {
    expect(campo({ comprobante: "https://example.org/verificar.html" })).toBe("comprobante");
  });

  it("rechaza un comprobante con otro prefijo local", () => {
    expect(campo({ comprobante: "/otra.html?origen=/verificar.html" })).toBe("comprobante");
  });

  it("acepta un color desconocido como color nulo", () => {
    const empresa = { nombre: "Empresa de ejemplo", logo: null, color: "rosa" };
    const lectura = leerCampana({ ...base(), empresa });
    expect(lectura.ok && lectura.campana.empresa.color).toBeNull();
  });

  it("devuelve una lectura pura sin envolverla en una promesa", () => {
    expect(leerCampana(base())).toHaveProperty("ok", true);
  });
});

describe("leerCampana: la identidad de quien se anota", () => {
  it("una campaña de siempre no trae el campo y la lectura no suma ninguna clave", () => {
    const lectura = leerCampana(base());
    expect(lectura.ok).toBe(true);
    if (lectura.ok) expect("identidad" in lectura.campana).toBe(false);
  });

  it("identidad cuenta es la de siempre y tampoco deja clave", () => {
    const lectura = leerCampana({ ...base(), identidad: "cuenta" });
    expect(lectura.ok).toBe(true);
    if (lectura.ok) expect("identidad" in lectura.campana).toBe(false);
  });

  it("identidad persona se lee y queda en la campaña", () => {
    const lectura = leerCampana({ ...base(), identidad: "persona" });
    expect(lectura.ok).toBe(true);
    if (lectura.ok) expect(lectura.campana.identidad).toBe("persona");
  });

  it("cualquier otro valor rechaza la campaña con el campo identidad", () => {
    for (const valor of ["Persona", "personas", "", null, 1, true, {}, []]) {
      expect(campo({ identidad: valor }), String(valor)).toBe("identidad");
    }
  });

  it("lo demás de la campaña se lee igual con o sin el campo", () => {
    const sin = leerCampana(base());
    const con = leerCampana({ ...base(), identidad: "persona" });
    if (!sin.ok || !con.ok) throw new Error("se esperaba una lectura buena");
    const { identidad: _identidad, ...resto } = con.campana;
    expect(resto).toEqual(sin.campana);
  });
});
