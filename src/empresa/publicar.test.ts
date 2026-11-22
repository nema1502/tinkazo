import { leerCampana } from "../campana/modelo";
import { network } from "../stellar/config";
import { instanteDe } from "../campana/crear/horas";
import { describe, expect, it } from "vitest";
import { enlaceDeLaEmpresa, leerEnlaceDeLaEmpresa } from "./enlace";
import { publicarLaCampana, slugDeEvento } from "./publicar";

const NOMBRE = "Café del Sol";
const EVENTOS = [{ ciudad: "La Paz", lugar: "Parque de las aguas 123", dia: "2027-03-14", cierre: "15:45", cupo: 100 }];
const PREMIOS = { monto: 10, ganan: 5 };
const PASOS = [
  { tipo: "instagram" as const, url: "https://instagram.com/cafesol", texto: { es: "Seguí a @cafesol en Instagram", en: "Follow @cafesol on Instagram" } },
];
const ZONA = "America/La_Paz";
const AHORA = Date.UTC(2027, 2, 13, 15, 0, 0);
const SUFIJO = "ab12";

const buena = (): Parameters<typeof publicarLaCampana>[0] => ({
  nombre: NOMBRE,
  eventos: EVENTOS,
  premios: PREMIOS,
  pasos: PASOS,
  sufijo: SUFIJO,
});

const sinDia = (): { ciudad: string; lugar: string; dia: string | null; cierre: string; cupo: number } => {
  const e = EVENTOS[0];
  return e ? { ...e, dia: null } : { ciudad: "", lugar: "", dia: null, cierre: "18:00", cupo: 100 };
};

describe("publicar la campaña del panel", () => {
  it("el nombre se vuelve una campaña con su id, sin espacios ni acentos y con el sufijo", () => {
    expect(slugDeEvento("Café del Sol ☕", "ab12")).toBe("cafe-del-sol-ab12");
    expect(slugDeEvento("~", "ab12")).toBe("campana-ab12");
    const largo = "x".repeat(100);
    expect(slugDeEvento(largo, "ab12").length).toBeLessThanOrEqual(40);
    expect(slugDeEvento(largo, "ab12").endsWith("-ab12")).toBe(true);
  });

  it("publica una campaña que la pantalla previa sabe leer, con lo que el panel eligió", () => {
    const publicada = publicarLaCampana(buena(), network.name, ZONA, AHORA);
    if (!publicada.ok) throw new Error(`no publicó: ${publicada.motivo}`);
    const leida = leerCampana(JSON.parse(publicada.texto));
    if (!leida.ok) throw new Error(`la campaña no se valió: ${leida.campo} ${leida.motivo}`);
    expect(leida.campana.evento).toBe("cafe-del-sol-ab12");
    expect(leida.campana.empresa.nombre).toBe(NOMBRE);
    expect(leida.campana.premios).toEqual(Array(5).fill(10n * 10_000_000n));
    expect(leida.campana.lugar.es).toContain("Parque de las aguas");
    expect(leida.campana.lugar.es).toContain("La Paz");
    expect(leida.campana.estado).toBe("borrador");
    expect(leida.campana.pasos).toHaveLength(1);
    expect(leida.campana.pasos[0]?.texto.es).toBe("Seguí a @cafesol en Instagram");
    expect(leida.campana.pasos[0]?.texto.en).toBe("Follow @cafesol on Instagram");
    expect(publicada.clave).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  });

  it("el enlace privado de la campaña publicada abre este panel con su clave", () => {
    const publicada = publicarLaCampana(buena(), network.name, ZONA, AHORA);
    if (!publicada.ok) throw new Error("no publicó");
    const enlace = enlaceDeLaEmpresa(publicada.evento, publicada.clave, "https://tinkazo.app");
    const u = new URL(enlace);
    expect(leerEnlaceDeLaEmpresa(u.search, u.hash)).toEqual({ evento: publicada.evento, clave: publicada.clave });
  });

  it("el evento cierra a la hora elegida, en pasos de quince minutos y en la zona del evento", () => {
    const publicada = publicarLaCampana(buena(), network.name, ZONA, AHORA);
    if (!publicada.ok) throw new Error(`no publicó: ${publicada.motivo}`);
    const leida = leerCampana(JSON.parse(publicada.texto));
    if (!leida.ok) throw new Error("no se leyó");
    expect(leida.campana.cierraMs).toBe(instanteDe(EVENTOS[0]?.dia ?? "", EVENTOS[0]?.cierre ?? "", ZONA));
    expect(leida.campana.cierraMs).toBeGreaterThan(leida.campana.abreMs);
  });

  it("sin nombre, sin premios o sin día no se publica nada y se dice qué falta", () => {
    expect(publicarLaCampana({ ...buena(), nombre: "  " }, network.name, ZONA, AHORA)).toEqual({ ok: false, motivo: "nombre" });
    expect(publicarLaCampana({ ...buena(), premios: { monto: 0, ganan: 5 } }, network.name, ZONA, AHORA)).toEqual({
      ok: false,
      motivo: "premios",
    });
    expect(publicarLaCampana({ ...buena(), eventos: [sinDia()] }, network.name, ZONA, AHORA)).toEqual({
      ok: false,
      motivo: "horas",
    });
    expect(publicarLaCampana({ ...buena(), eventos: [{ ...sinDia(), dia: "2000-01-01" }] }, network.name, ZONA, AHORA)).toEqual({
      ok: false,
      motivo: "horas",
    });
  });
});
