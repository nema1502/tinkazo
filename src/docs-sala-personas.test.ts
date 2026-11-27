/**
 * Lo que dicen los documentos de la línea de persona no promete más de lo que es cierto: mientras la sala vive, quien tiene
 * acceso a su almacenamiento puede comprobar si una cuenta de Google conocida se anotó.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\s+/gu, " ");
const FRASE = "mientras la sala vive, quien tiene acceso a su almacenamiento puede comprobar si una cuenta de google conocida se anotó";

describe("los documentos de la línea de persona dicen quién puede comprobar una cuenta", () => {
  it("el README de la sala lo dice junto a lo que se borra a las 24 horas", () => {
    const lee = leer("../workers/sala/README.md");
    const desde = lee.indexOf("Cómo se entera quien gana");
    expect(desde).toBeGreaterThan(-1);
    expect(lee.slice(desde, desde + 2500).toLowerCase()).toContain(FRASE);
  });

  it("el párrafo de la línea de persona de premios lo dice y la frase está una sola vez", () => {
    const lee = leer("../docs/premios.md");
    const desde = lee.indexOf("**La línea de persona");
    expect(desde).toBeGreaterThan(-1);
    const hasta = lee.indexOf("**El código de entrega", desde);
    expect(lee.slice(desde, hasta).toLowerCase()).toContain(FRASE);
    expect(lee.toLowerCase().split(FRASE).length - 1).toBe(1);
  });
});

describe("los documentos dicen lo que ve quien ganó y lo que no recupera", () => {
  it("el README de la sala y la operación dicen que en otro navegador, después del sorteo, no se ve el código y decide quien organiza", () => {
    const sala = leer("../workers/sala/README.md");
    const desde = sala.indexOf("Cómo se entera quien gana");
    expect(sala.slice(desde, desde + 2500)).toContain("quien abre el enlace en otro navegador después del sorteo no ve su código");
    const operacion = leer("../docs/operacion.md");
    const limite = operacion.indexOf("Desde otro celular o desde otro navegador no sirve");
    expect(limite).toBeGreaterThan(-1);
    expect(operacion.slice(limite, limite + 900)).toContain("pregunte en el stand");
    expect(operacion.slice(limite, limite + 900)).toContain("decide quien organiza");
  });

  it("la UX dice que Ganaste no tiene botón y que No soy yo existe solo con la lista abierta", () => {
    const ux = leer("../docs/ux.md");
    const desde = ux.indexOf("Con premio en mano, el panel no habla de plata");
    const parrafo = ux.slice(desde, desde + 6000);
    expect(parrafo).toContain("sin ningún botón de recibir");
    expect(parrafo).toContain("No soy yo existe solo en la pantalla de anotada con la lista abierta");
    expect(parrafo).toContain("después del cierre ninguna pantalla ofrece olvidar");
  });
});

describe("los documentos dicen lo que el comprobante muestra de una lista de personas", () => {
  const operacion = leer("../docs/operacion.md");
  const desde = operacion.indexOf("El show y las tarjetas del resultado dicen el nombre");
  const renglon = operacion.slice(desde, operacion.indexOf("- La pantalla del resultado trae una sola línea", desde));

  it("la operación no dice que el comprobante muestra las líneas: dice el lugar, y con qué se recalcula la huella", () => {
    expect(desde).toBeGreaterThan(-1);
    expect(operacion).not.toContain("salvo la lista sellada del comprobante");
    expect(operacion).not.toContain("la lista pública que cualquiera recalcula");
    expect(renglon).toContain("Ninguna pantalla muestra una línea `p1:`");
    expect(renglon).toContain("La lista sellada del comprobante también dice Lugar n en cada fila");
    expect(renglon).toContain("La huella se recalcula con la lista sellada que tiene quien organiza");
  });

  it("dice Lugar n donde el show y las tarjetas dicen Lugar n, y Lugar n de la lista donde se dice así", () => {
    expect(renglon).toContain("si esta pestaña no lo tiene, Lugar n (o Sin nombre, si la lista del cuadro no trae esa línea)");
    expect(renglon).toContain("Mis sorteos, el evento, el comprobante y el celular de quien mira dicen Lugar n de la lista");
  });

  it("dice lo que el evento comprueba y que el comprobante no ofrece buscar por nombre", () => {
    expect(renglon).toContain("En la página del evento lo comprobado es ese lugar");
    expect(renglon).toContain("no ofrece buscar por nombre");
  });

  it("los textos que cita son los del sitio", async () => {
    const { T } = await import("./i18n");
    expect(T.es.vLugar).toBe("Lugar {n}");
    expect(T.es.vLugarDeLaLista).toBe("Lugar {n} de la lista");
    expect(T.es.vPersonaAnotada).toBe("Sin nombre");
  });
});
