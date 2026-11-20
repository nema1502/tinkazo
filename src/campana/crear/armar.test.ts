import { describe, expect, it } from "vitest";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { network } from "../../stellar/config";
import { leerCampana, type Bilingue } from "../modelo";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import {
  armarCampana,
  bytesDelPedido,
  campanaParaLaVista,
  cambioUnaActivada,
  eventoDe,
  faltaDeTamano,
  faltas,
  faltasDelPaso,
  formularioDesdeTexto,
  pasoDelFallo,
  pasoQueMasPesa,
  premiosDe,
  sigueIgualQueElFirmado,
} from "./armar";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { formularioInicial, reducir, type FormularioDeCampana, type PasoDelFormulario } from "./estado";
import { instanteDe } from "./horas";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";

function datosDeBases(f: FormularioDeCampana): DatosDeLasBases {
  return {
    marca: f.nombre.trim() || "Tu marca",
    ganan: f.ganan,
    monto: f.monto ?? 40,
    sorteoMs: instanteDe(f.fecha, f.sorteo, f.zona) ?? AHORA,
    zona: f.zona,
    conRedes: f.pasos.length > 0,
    costo: { es: null, en: null },
  };
}

const automaticas = (f: FormularioDeCampana): Bilingue => basesAutomaticas(datosDeBases(f), dic);

function lleno(): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    color: "verde",
    monto: 40,
    ganan: 3,
    fecha: "2026-11-21",
    lugar: "Hackathon",
    pasos: [
      pedido("instagram", "https://www.instagram.com/alcanciaandina"),
      pedido("texto", "", "Venir con un amigo", "Come with a friend"),
    ],
  };
}

function pedido(tipo: PasoDelFormulario["tipo"], url: string, es = "", en = ""): PasoDelFormulario {
  return { tipo, url, texto: { es, en }, editadoEs: es !== "", editadoEn: en !== "" };
}

function armar(f: FormularioDeCampana): Record<string, unknown> {
  return armarCampana(f, { bases: basesFinales(f.bases, automaticas(f)).bases });
}

describe("armarCampana", () => {
  it("con el formulario lleno el archivo pasa el validador de los dos lectores", () => {
    expect(validarCampanaParaFirmar(JSON.stringify(armar(lleno())), AHORA)).toEqual({ ok: true });
  });

  it("el archivo trae red mainnet aunque el sitio esté en otra, entrada google, estado abierta y nada en lo demás", () => {
    const a = armar(lleno());
    expect(a).toMatchObject({ v: 1, red: "mainnet", entrada: "google", estado: "abierta", anotadas: 0 });
    expect([a.contrato, a.promo, a.comprobante]).toEqual([null, null, null]);
    expect("organizadora" in a).toBe(false);
  });

  it("recibir hasta es siete días después del sorteo", () => {
    const a = armar(lleno());
    expect(a.recibir_hasta_ms).toBe((a.sorteo_ms as number) + 7 * 86_400_000);
  });

  it("las claves salen en el orden de siempre", () => {
    expect(Object.keys(armar(lleno()))).toEqual([
      "v", "evento", "red", "estado", "empresa", "lugar", "zona", "premios", "abre_ms", "cierra_ms", "sorteo_ms",
      "recibir_hasta_ms", "entrada", "pasos", "bases", "anotadas", "contrato", "promo", "comprobante",
    ]);
  });

  it("un pedido de red sale sin texto y uno escrito sin enlace", () => {
    const pasos = armar(lleno()).pasos;
    expect(pasos).toEqual([
      { tipo: "instagram", url: "https://www.instagram.com/alcanciaandina", texto: { es: "", en: "" } },
      { tipo: "texto", url: null, texto: { es: "Venir con un amigo", en: "Come with a friend" } },
    ]);
  });

  it("un pedido escrito solo en un idioma usa ese texto en el otro y pasa el validador", () => {
    const f = reducir(
      reducir({ ...lleno(), pasos: [] }, { t: "sumar-paso", tipo: "texto" }),
      { t: "paso-texto", indice: 0, idioma: "es", valor: "Subir una foto" },
    );
    const a = armar(f);
    expect(a.pasos).toEqual([{ tipo: "texto", url: null, texto: { es: "Subir una foto", en: "Subir una foto" } }]);
    expect(validarCampanaParaFirmar(JSON.stringify(a), AHORA)).toEqual({ ok: true });
  });

  it("un pedido escrito con un idioma vacío usa el otro", () => {
    const f = { ...lleno(), pasos: [pedido("texto", "", "  ", "Hello")] };
    expect(armar(f).pasos).toEqual([{ tipo: "texto", url: null, texto: { es: "Hello", en: "Hello" } }]);
  });
});

describe("el evento", () => {
  const f = lleno();

  it("el de Alcancía Andina el 21 de noviembre a las 10:00 lleva el sufijo, el día y la hora", () => {
    expect(eventoDe(f)).toBe("alcancia-andina-k3f9-2026-11-21-1000");
  });

  it("quita espacios y símbolos", () => {
    expect(eventoDe({ ...f, nombre: "¡Café & Té! 2.0" })).toBe("cafe-te-2-0-k3f9-2026-11-21-1000");
  });

  it("el de un nombre de 40 letras tiene 40 caracteres o menos y cumple la forma del modelo", () => {
    const evento = eventoDe({ ...f, nombre: "a".repeat(40) });
    expect(evento.length).toBeLessThanOrEqual(40);
    expect(evento).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u);
  });

  it("el de un nombre de una letra cumple la forma del modelo", () => {
    expect(eventoDe({ ...f, nombre: "a" })).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u);
  });

  it("el de un nombre sin letras latinas usa campana", () => {
    expect(eventoDe({ ...f, nombre: "🔥🔥" })).toBe("campana-k3f9-2026-11-21-1000");
  });

  it("dos nombres sin letras latinas el mismo día dan eventos distintos porque cada formulario trae su sufijo", () => {
    const uno = eventoDe({ ...f, nombre: "🔥", sufijo: "aaaa" });
    const otro = eventoDe({ ...f, nombre: "🎉", sufijo: "bbbb" });
    expect(uno).not.toBe(otro);
  });

  it("dos nombres largos que empiezan igual dan eventos distintos", () => {
    const largo = "Feria de la Alcancía Andina y su gente";
    expect(eventoDe({ ...f, nombre: `${largo} norte`, sufijo: "aaaa" })).not.toBe(eventoDe({ ...f, nombre: `${largo} sur`, sufijo: "bbbb" }));
  });

  it("editar el nombre no cambia el sufijo", () => {
    const editado = reducir(f, { t: "nombre", valor: "Otra marca" });
    expect(editado.sufijo).toBe("k3f9");
    expect(eventoDe(editado)).toBe("otra-marca-k3f9-2026-11-21-1000");
  });

  it("la misma marca el mismo día con otra hora da otro evento", () => {
    expect(eventoDe({ ...f, abre: "15:00" })).not.toBe(eventoDe(f));
    expect(eventoDe({ ...f, abre: "15:00" })).toBe("alcancia-andina-k3f9-2026-11-21-1500");
  });

  it("sin día termina en el sufijo", () => {
    expect(eventoDe({ ...f, fecha: "" })).toBe("alcancia-andina-k3f9");
  });

  it("el evento del archivo pasa el validador con todo tipo de nombres", () => {
    for (const nombre of ["Alcancía Andina", "¡Café & Té! 2.0", "🔥", "a", "x".repeat(40)]) {
      const a = armar({ ...f, nombre });
      expect(validarCampanaParaFirmar(JSON.stringify(a), AHORA)).toEqual({ ok: true });
    }
  });
});

describe("los premios", () => {
  it("con una persona que gana hay un premio de 400000000 para 40 dólares", () => {
    expect(premiosDe(40, 1)).toEqual(["400000000"]);
  });

  it("con 3 y con 10 personas hay 3 y 10 premios iguales", () => {
    expect(premiosDe(40, 3)).toEqual(["400000000", "400000000", "400000000"]);
    expect(premiosDe(10, 10)).toHaveLength(10);
    expect(new Set(premiosDe(10, 10)).size).toBe(1);
  });

  it("cada monto de los botones da su texto en unidades", () => {
    expect([10, 20, 40, 50, 100, 200, 500].map((m) => premiosDe(m, 1)[0])).toEqual([
      "100000000", "200000000", "400000000", "500000000", "1000000000", "2000000000", "5000000000",
    ]);
  });
});

describe("lo que falta", () => {
  const aut = automaticas(lleno());

  it("con todo lleno no falta nada", () => {
    expect(faltas(lleno(), AHORA, aut)).toEqual([]);
  });

  it("sin nombre no se descarga y lleva al paso 1", () => {
    expect(faltasDelPaso({ ...lleno(), nombre: "  " }, 1, AHORA, aut)).toEqual([{ paso: 1, clave: "ccFaltaNombre", donde: "ccp-nombre" }]);
  });

  it("sin monto lleva al paso 2", () => {
    expect(faltas({ ...lleno(), monto: null }, AHORA, aut)[0]).toMatchObject({ paso: 2, clave: "ccFaltaMonto" });
  });

  it("sin día, sin lugar o con las horas desordenadas lleva al paso 3", () => {
    expect(faltas({ ...lleno(), fecha: "" }, AHORA, aut)[0]).toMatchObject({ paso: 3, clave: "ccFaltaDia" });
    expect(faltas({ ...lleno(), lugar: "" }, AHORA, aut)[0]).toMatchObject({ paso: 3, clave: "ccFaltaLugar" });
    expect(faltas({ ...lleno(), cierra: "09:00" }, AHORA, aut)[0]).toMatchObject({ paso: 3, clave: "ccCierraLejos", donde: "ccp-cierra" });
    expect(faltas({ ...lleno(), cierra: "10:00" }, AHORA, aut)[0]).toMatchObject({ paso: 3, clave: "ccCorregiCierra" });
  });

  it("un pedido con un enlace malo o sin texto lleva al paso 4", () => {
    const malo = { ...lleno(), pasos: [pedido("instagram", "https://www.tiktok.com/@x")] };
    expect(faltas(malo, AHORA, aut)[0]).toEqual({ paso: 4, clave: "ccEnlaceOtraRed", donde: "ccp-pedido-0", valores: { red: "instagram" } });
    const vacio = { ...lleno(), pasos: [pedido("texto", "", " ")] };
    expect(faltas(vacio, AHORA, aut)[0]).toMatchObject({ paso: 4, clave: "ccFaltaPedido" });
  });

  it("un enlace corto pide copiar la dirección del perfil", () => {
    const corto = { ...lleno(), pasos: [pedido("tiktok", "https://vt.tiktok.com/abc")] };
    expect(faltas(corto, AHORA, aut)[0]).toMatchObject({ paso: 4, clave: "ccEnlaceCorto" });
  });

  it("unas bases vacías o desfasadas llevan al paso 5", () => {
    const vacias = { ...lleno(), bases: { es: " ", en: "x", moldeEs: aut.es, moldeEn: aut.en } };
    expect(faltas(vacias, AHORA, aut)[0]).toMatchObject({ paso: 5, clave: "ccFaltaBases" });
    const viejas = { ...lleno(), bases: { es: "Otro premio", en: null, moldeEs: "Con un premio viejo", moldeEn: null } };
    expect(faltas(viejas, AHORA, aut)[0]).toMatchObject({ paso: 5, clave: "ccBasesCambiaron" });
  });
});

describe("pasoDelFallo", () => {
  it("lleva cada campo del lector a su paso y lo demás al paso 6", () => {
    expect(["evento", "empresa", "empresa.logo"].map((c) => pasoDelFallo(c, false))).toEqual([1, 1, 1]);
    expect(pasoDelFallo("premios", false)).toBe(2);
    const deHoras = ["lugar", "zona", "abre_ms", "cierra_ms", "sorteo_ms", "recibir_hasta_ms", "horas"];
    expect(deHoras.map((c) => pasoDelFallo(c, false))).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(["pasos", "pasos.url", "pasos.texto"].map((c) => pasoDelFallo(c, false))).toEqual([4, 4, 4]);
    expect(pasoDelFallo("bases", false)).toBe(5);
    expect(pasoDelFallo("texto", true)).toBe(1);
    expect(pasoDelFallo("texto", false)).toBe(5);
    expect(pasoDelFallo("estado", false)).toBe(6);
  });
});

describe("el tamaño que entra en el servicio", () => {
  const logoGrande = { tipo: "image/png", datos: `${"A".repeat(54_612)}AA==` };

  it("un logo de 40.960 bytes, bases de 6.000 caracteres con tildes y ocho enlaces de 300 caracteres entran en las dos medidas", async () => {
    const enlaces = Array.from({ length: 8 }, () => ({ tipo: "enlace", url: `https://example.org/${"a".repeat(280)}`, texto: { es: "", en: "" } }));
    const empresa = { nombre: "Alcancía Andina", logo: logoGrande, color: "verde" };
    const bases = { es: "á".repeat(6000), en: "é".repeat(6000) };
    const campana = { ...armar(lleno()), empresa, pasos: enlaces, bases };
    const texto = JSON.stringify(campana);
    expect(texto.length).toBeLessThanOrEqual(80_000);
    expect(bytesDelPedido(texto)).toBeLessThanOrEqual(90_000);
    expect(await faltaDeTamano(texto, campana)).toBeNull();
  });

  it("unas bases con muchas comillas pesan más en el pedido que en el texto y no entran aunque el texto sí", async () => {
    const empresa = { nombre: "Alcancía Andina", logo: logoGrande, color: "verde" };
    const campana = { ...armar(lleno()), empresa, bases: { es: '"'.repeat(6000), en: '"'.repeat(6000) } };
    const texto = JSON.stringify(campana);
    expect(texto.length).toBeLessThanOrEqual(80_000);
    expect(bytesDelPedido(texto)).toBeGreaterThan(90_000);
    expect(await faltaDeTamano(texto, campana)).toEqual({ paso: 1, clave: "ccDemasiado" });
  });

  it("si no entra se va al paso que más pesa", () => {
    const base = armar(lleno());
    expect(pasoQueMasPesa({ ...base, pasos: [], bases: { es: "a", en: "b" }, empresa: { logo: { datos: "A".repeat(100) } } })).toBe(1);
    expect(pasoQueMasPesa({ ...base, pasos: [{ url: "x".repeat(3000) }], bases: { es: "a", en: "b" }, empresa: { logo: null } })).toBe(4);
    expect(pasoQueMasPesa({ ...base, pasos: [], bases: { es: "a".repeat(3000), en: "b" }, empresa: { logo: null } })).toBe(5);
  });
});

describe("abrir un archivo", () => {
  const abrir = (texto: string): ReturnType<typeof formularioDesdeTexto> =>
    formularioDesdeTexto(texto, { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });

  it("abrir un archivo sin firmar lo carga en los pasos", () => {
    const hecho = abrir(JSON.stringify(armar(lleno())));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    const f = hecho.formulario;
    expect([f.nombre, f.monto, f.ganan, f.fecha, f.abre, f.cierra, f.sorteo, f.zona, f.lugar]).toEqual([
      "Alcancía Andina", 40, 3, "2026-11-21", "10:00", "18:00", "18:30", LA_PAZ, "Hackathon",
    ]);
    expect(f.paso).toBe(1);
    expect(f.visitado).toBe(6);
    expect(f.sufijo).toBe("k3f9");
  });

  it("abrir un archivo firmado lo carga en los pasos y recuerda su firma", () => {
    const texto = JSON.stringify(armar(lleno()));
    const hecho = abrir(JSON.stringify({ texto, firma: "FIRMA" }));
    expect(hecho.ok).toBe(true);
    if (hecho.ok) expect(hecho.formulario.origen).toMatchObject({ firma: "FIRMA", texto });
  });

  it("abrir algo que no es una campaña no carga nada", () => {
    expect(abrir("hola").ok).toBe(false);
    expect(abrir("[]").ok).toBe(false);
    expect(abrir(JSON.stringify({ v: 1 })).ok).toBe(false);
    expect(abrir(JSON.stringify({ texto: "{", firma: "F" })).ok).toBe(false);
  });

  it("abrir un archivo y volver a armarlo da el mismo archivo", () => {
    const original = armar(lleno());
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    expect(armar(hecho.formulario)).toEqual(original);
  });

  it("abrir un archivo con bases propias las deja como editadas", () => {
    const f = lleno();
    const propias = { ...armar(f), bases: { es: "Bases mías", en: "My rules" } };
    const hecho = abrir(JSON.stringify(propias));
    if (!hecho.ok) throw new Error("no abrió");
    expect(hecho.formulario.bases.es).toBe("Bases mías");
    expect(hecho.formulario.bases.en).toBe("My rules");
    expect(armar(hecho.formulario)).toEqual(propias);
  });

  it("abrir un archivo de otra zona conserva su zona y sus horas", () => {
    const f = { ...lleno(), zona: "America/Santiago" };
    const hecho = abrir(JSON.stringify(armar(f)));
    if (!hecho.ok) throw new Error("no abrió");
    expect(hecho.formulario.zona).toBe("America/Santiago");
    expect(hecho.formulario.abre).toBe("10:00");
    expect(armar(hecho.formulario).abre_ms).toBe(armar(f).abre_ms);
  });

  it("abrir y volver a armar conserva un evento escrito a mano", () => {
    const original = { ...armar(lleno()), evento: "evento-a-mano-7" };
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    expect(armar(hecho.formulario).evento).toBe("evento-a-mano-7");
    const otroDia = reducir(hecho.formulario, { t: "fecha", valor: "2026-11-22", ahora: AHORA });
    expect(armar(otroDia).evento).not.toBe("evento-a-mano-7");
  });

  it("abrir un archivo con cuenta que sella, promo y contrato y volver a armarlo los conserva", () => {
    const cuenta = `G${"A".repeat(55)}`;
    const contrato = `C${"A".repeat(55)}`;
    const conservado = { organizadora: cuenta, promo: "12", contrato, comprobante: "/verificar.html?s=1", recibir_hasta_ms: Date.UTC(2026, 11, 31) };
    const original = { ...armar(lleno()), ...conservado };
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    const otra = armar(reducir(hecho.formulario, { t: "bases", idioma: "es", valor: "Una letra más", automaticas: automaticas(hecho.formulario) }));
    expect(otra).toMatchObject(conservado);
  });

  it("un logo jpeg se conserva al abrir y al volver a armar", () => {
    const logo = { tipo: "image/jpeg", datos: "AAAA" };
    const original = { ...armar(lleno()), empresa: { nombre: "Alcancía Andina", logo, color: "verde" } };
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    expect(hecho.formulario.logo).toEqual(logo);
    expect(armar(hecho.formulario)).toEqual(original);
  });

  it("un archivo con premios distintos abre sin monto para que el paso 2 lo pida", () => {
    const original = { ...armar(lleno()), premios: ["400000000", "500000000"] };
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    expect(hecho.formulario.monto).toBeNull();
    expect(hecho.formulario.ganan).toBe(2);
  });

  it("un archivo firmado que no cambió sigue igual que el firmado y uno cambiado no", () => {
    const original = armar(lleno());
    const hecho = abrir(JSON.stringify({ texto: JSON.stringify(original), firma: "FIRMA" }));
    if (!hecho.ok) throw new Error("no abrió");
    const f = hecho.formulario;
    expect(sigueIgualQueElFirmado(f, armar(f))).toBe(true);
    expect(cambioUnaActivada(f, armar(f))).toBe(false);
    const cambiado = reducir(f, { t: "lugar", valor: "Otro lugar" });
    expect(sigueIgualQueElFirmado(cambiado, armar(cambiado))).toBe(false);
    expect(cambioUnaActivada(cambiado, armar(cambiado))).toBe(true);
  });

  it("un archivo sin firma nunca cuenta como activado", () => {
    const hecho = abrir(JSON.stringify(armar(lleno())));
    if (!hecho.ok) throw new Error("no abrió");
    expect(cambioUnaActivada(hecho.formulario, armar(reducir(hecho.formulario, { t: "lugar", valor: "Otro" })))).toBe(false);
  });
});

describe("un archivo activado, abierto y sin tocar", () => {
  const abrir = (texto: string): ReturnType<typeof formularioDesdeTexto> =>
    formularioDesdeTexto(texto, { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });
  const abierto = (original: Record<string, unknown>, firmado = true): FormularioDeCampana => {
    const texto = JSON.stringify(original);
    const hecho = abrir(firmado ? JSON.stringify({ texto, firma: "FIRMA" }) : texto);
    if (!hecho.ok) throw new Error("no abrió");
    return hecho.formulario;
  };
  const enlaceLargo = `https://example.org/${"a".repeat(400)}`;
  const original = (): Record<string, unknown> => ({
    ...armar(lleno()),
    entrada: "google-correo",
    estado: "cerrada",
    anotadas: 12,
    lugar: { es: "Hackathon", en: "The hackathon" },
    pasos: [
      { tipo: "instagram", url: "https://www.instagram.com/alcanciaandina/?igsh=abc123&utm_source=qr#perfil", texto: { es: "", en: "" } },
      { tipo: "enlace", url: enlaceLargo, texto: { es: "Mirá esto", en: "Look at this" } },
    ],
  });

  it("vuelve a armar el mismo archivo con su entrada, su estado, sus anotadas y su lugar en inglés", () => {
    const base = original();
    expect(armar(abierto(base, false))).toEqual(base);
  });

  it("sigue igual que el firmado: no pide activarlo de nuevo", () => {
    const f = abierto(original());
    expect(sigueIgualQueElFirmado(f, armar(f))).toBe(true);
    expect(cambioUnaActivada(f, armar(f))).toBe(false);
  });

  it("conserva la entrada con correo", () => {
    expect(armar(abierto(original(), false)).entrada).toBe("google-correo");
  });

  it("conserva las direcciones como venían, con su seguimiento", () => {
    const pasos = armar(abierto(original(), false)).pasos as Array<{ url: string }>;
    expect(pasos[0]?.url).toBe("https://www.instagram.com/alcanciaandina/?igsh=abc123&utm_source=qr#perfil");
  });

  it("conserva el texto de un pedido con enlace", () => {
    const pasos = armar(abierto(original(), false)).pasos as Array<{ texto: unknown }>;
    expect(pasos[1]?.texto).toEqual({ es: "Mirá esto", en: "Look at this" });
  });

  it("al cambiar el lugar los dos idiomas pasan a decir lo nuevo", () => {
    const f = reducir(abierto(original(), false), { t: "lugar", valor: "La plaza" });
    expect(armar(f).lugar).toEqual({ es: "La plaza", en: "La plaza" });
  });

  it("al cambiar una dirección la nueva sale limpia, sin seguimiento", () => {
    const f = abierto(original(), false);
    const pasos = f.pasos.map((p, i) => (i === 0 ? { ...p, url: "https://www.instagram.com/nora/?igsh=zz#x" } : p));
    expect((armar({ ...f, pasos }).pasos as Array<{ url: string }>)[0]?.url).toBe("https://www.instagram.com/nora/");
  });

  it("conserva la red del archivo", () => {
    expect(armar(abierto({ ...original(), red: "testnet" }, false)).red).toBe("testnet");
  });
});

describe("un enlace largo que el modelo acepta", () => {
  const largo = `https://example.org/${"a".repeat(400)}`;
  const archivo = { ...armar(lleno()), pasos: [{ tipo: "enlace", url: largo, texto: { es: "", en: "" } }] };

  it("el modelo lo acepta", () => {
    expect(leerCampana({ ...archivo, red: network.name }).ok).toBe(true);
  });

  it("al abrir el archivo el paso 4 no pide corregirlo y se puede descargar", () => {
    const hecho = formularioDesdeTexto(JSON.stringify(archivo), { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });
    if (!hecho.ok) throw new Error("no abrió");
    expect(faltasDelPaso(hecho.formulario, 4, AHORA, automaticas(hecho.formulario))).toEqual([]);
    expect(faltas(hecho.formulario, AHORA, automaticas(hecho.formulario))).toEqual([]);
  });

  it("escrito a mano sigue sin servir pasados los 300 caracteres", () => {
    const f = { ...lleno(), pasos: [pedido("enlace", largo)] };
    expect(faltasDelPaso(f, 4, AHORA, automaticas(f))).toEqual([{ paso: 4, clave: "ccEnlaceMal", donde: "ccp-pedido-0" }]);
  });
});

describe("la vista del formulario", () => {
  const opciones = (f: FormularioDeCampana): Parameters<typeof campanaParaLaVista>[1] => ({
    ahora: AHORA,
    muestraMarca: "Tu marca",
    muestraLugar: { es: "Tu evento", en: "Your event" },
    bases: automaticas(f),
  });
  const leer = (campana: Record<string, unknown>): ReturnType<typeof leerCampana> => leerCampana({ ...campana, red: network.name });

  it("la de un formulario vacío pasa el lector con Tu marca y 40 dólares de muestra", () => {
    const f = formularioInicial(LA_PAZ, "k3f9");
    const { campana, muestras } = campanaParaLaVista(f, opciones(f));
    const lectura = leer(campana);
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.campana.empresa.nombre).toBe("Tu marca");
    expect(lectura.campana.premios).toEqual([400000000n]);
    expect(lectura.campana.lugar.es).toBe("Tu evento");
    expect(muestras).toEqual({ nombre: true, premio: true, lugar: true, horas: true });
  });

  it("con el nombre cargado ya no lo marca de muestra", () => {
    const f = { ...formularioInicial(LA_PAZ, "k3f9"), nombre: "Alcancía Andina" };
    const { muestras } = campanaParaLaVista(f, opciones(f));
    expect(muestras.nombre).toBe(false);
    expect(muestras.premio).toBe(true);
  });

  it("con todo cargado nada es de muestra y el evento es el del archivo", () => {
    const f = lleno();
    const { campana, muestras } = campanaParaLaVista(f, opciones(f));
    expect(muestras).toEqual({ nombre: false, premio: false, lugar: false, horas: false });
    expect(campana.evento).toBe("alcancia-andina-k3f9-2026-11-21-1000");
  });

  it("con las horas desordenadas usa horas de muestra que siguen en el futuro y pasa el lector", () => {
    const f = { ...lleno(), cierra: "09:00" };
    const { campana, muestras } = campanaParaLaVista(f, opciones(f));
    expect(muestras.horas).toBe(true);
    expect(campana.cierra_ms as number).toBeGreaterThan(AHORA);
    expect(campana.abre_ms as number).toBeLessThan(AHORA);
    expect(leer(campana).ok).toBe(true);
  });

  it("deja afuera un pedido con un enlace malo y uno escrito vacío", () => {
    const f = {
      ...lleno(),
      pasos: [
        pedido("instagram", "no es un enlace"),
        pedido("texto", ""),
        pedido("tiktok", "@alcancia"),
      ],
    };
    const { campana } = campanaParaLaVista(f, opciones(f));
    expect(campana.pasos).toEqual([{ tipo: "tiktok", url: "https://www.tiktok.com/@alcancia", texto: { es: "", en: "" } }]);
    expect(leer(campana).ok).toBe(true);
  });

  it("un pedido escrito con un solo idioma queda a la vista en los dos", () => {
    const f = { ...lleno(), pasos: [pedido("texto", "", "Subir una foto")] };
    const { campana } = campanaParaLaVista(f, opciones(f));
    expect(campana.pasos).toEqual([{ tipo: "texto", url: null, texto: { es: "Subir una foto", en: "Subir una foto" } }]);
    expect(leer(campana).ok).toBe(true);
  });
});
