import { describe, expect, it } from "vitest";
import {
  formularioDeDemostracion,
  formularioInicial,
  leerGuardado,
  reducir,
  saltoDeBajada,
  saltoDeSubida,
  sufijoNuevo,
  type Accion,
  type FormularioDeCampana,
} from "./estado";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const inicial = (): FormularioDeCampana => formularioInicial("America/La_Paz", "k3f9");
const aplicar = (f: FormularioDeCampana, ...acciones: Accion[]): FormularioDeCampana => acciones.reduce(reducir, f);
const repetir = (a: Accion, veces: number): Accion[] => Array.from({ length: veces }, () => a);

describe("el estado inicial", () => {
  it("tiene una persona que gana, ningún monto, las horas 10:00, 18:00 y 18:30 y la zona que recibe", () => {
    const f = inicial();
    expect(f.ganan).toBe(1);
    expect(f.monto).toBeNull();
    expect([f.abre, f.cierra, f.sorteo]).toEqual(["10:00", "18:00", "18:30"]);
    expect(f.zona).toBe("America/La_Paz");
    expect(f.fecha).toBe("");
  });

  it("el sufijo nuevo son cuatro letras o números", () => {
    expect(sufijoNuevo()).toMatch(/^[a-z0-9]{4}$/u);
  });
});

describe("el premio", () => {
  it("elegir un botón de monto lo deja elegido y apaga el contador de otro monto", () => {
    const f = aplicar(inicial(), { t: "otro-monto" }, { t: "monto", valor: 40 });
    expect(f.monto).toBe(40);
    expect(f.otroMonto).toBe(false);
  });

  it("otro monto arranca en el último monto elegido con un botón, o en 100 si no se eligió ninguno", () => {
    expect(aplicar(inicial(), { t: "otro-monto" }).monto).toBe(10);
    expect(aplicar(inicial(), { t: "monto", valor: 20 }, { t: "otro-monto" }).monto).toBe(20);
  });

  it("el contador de otro monto no baja de 5 ni pasa de 1000", () => {
    const abajo = aplicar(inicial(), { t: "monto", valor: 10 }, { t: "otro-monto" }, ...repetir({ t: "otro-menos" }, 10));
    expect(abajo.monto).toBe(5);
    const arriba = aplicar(inicial(), { t: "monto", valor: 500 }, { t: "otro-monto" }, ...repetir({ t: "otro-mas" }, 30));
    expect(arriba.monto).toBe(1000);
  });

  it("el salto crece con el monto: de a 5 hasta 50, de a 10 hasta 200 y de a 50 después", () => {
    expect([saltoDeSubida(10), saltoDeSubida(50), saltoDeSubida(100), saltoDeSubida(200), saltoDeSubida(500)]).toEqual([5, 10, 10, 50, 50]);
    expect([saltoDeBajada(50), saltoDeBajada(60), saltoDeBajada(200), saltoDeBajada(250)]).toEqual([5, 10, 10, 50]);
  });

  it("de 200 a 500 hay como mucho 6 toques", () => {
    const f = aplicar(inicial(), { t: "monto", valor: 200 }, { t: "otro-monto" }, ...repetir({ t: "otro-mas" }, 6));
    expect(f.monto).toBe(500);
  });

  it("cuántas personas ganan no baja de 1 ni pasa de 10", () => {
    expect(aplicar(inicial(), { t: "ganan-menos" }).ganan).toBe(1);
    expect(aplicar(inicial(), ...repetir({ t: "ganan-mas" }, 20)).ganan).toBe(10);
  });
});

describe("los pasos", () => {
  it("ir a un paso visitado lo abre e ir a uno sin visitar no cambia nada", () => {
    const f = aplicar(inicial(), { t: "seguir" }, { t: "seguir" }, { t: "ir", paso: 1 });
    expect(f.paso).toBe(1);
    expect(f.visitado).toBe(3);
    expect(aplicar(f, { t: "ir", paso: 5 }).paso).toBe(1);
    expect(aplicar(f, { t: "ir", paso: 3 }).paso).toBe(3);
  });

  it("seguir sube el paso y lo marca como visitado, y no pasa del sexto", () => {
    const f = aplicar(inicial(), ...repetir({ t: "seguir" }, 9));
    expect(f.paso).toBe(6);
    expect(f.visitado).toBe(6);
  });
});

describe("los pedidos", () => {
  it("se pueden sumar 8 pedidos y el noveno no se suma", () => {
    const f = aplicar(inicial(), ...repetir({ t: "sumar-paso", tipo: "instagram" }, 9));
    expect(f.pasos).toHaveLength(8);
  });

  it("quitar un pedido saca solo ese", () => {
    const f = aplicar(inicial(), { t: "sumar-paso", tipo: "instagram" }, { t: "sumar-paso", tipo: "tiktok" }, { t: "quitar-paso", indice: 0 });
    expect(f.pasos.map((p) => p.tipo)).toEqual(["tiktok"]);
  });

  it("escribir solo en español deja el inglés igual mientras no se edite a mano", () => {
    const f = aplicar(inicial(), { t: "sumar-paso", tipo: "texto" }, { t: "paso-texto", indice: 0, idioma: "es", valor: "Venir con tu amigo" });
    expect(f.pasos[0]?.texto).toEqual({ es: "Venir con tu amigo", en: "Venir con tu amigo" });
  });

  it("después de editar el inglés a mano, escribir en español ya no lo toca", () => {
    const f = aplicar(
      inicial(),
      { t: "sumar-paso", tipo: "texto" },
      { t: "paso-texto", indice: 0, idioma: "es", valor: "Hola" },
      { t: "paso-texto", indice: 0, idioma: "en", valor: "Hi" },
      { t: "paso-texto", indice: 0, idioma: "es", valor: "Hola a todos" },
    );
    expect(f.pasos[0]?.texto).toEqual({ es: "Hola a todos", en: "Hi" });
  });

  it("un pedido que no existe no cambia nada", () => {
    const f = inicial();
    expect(aplicar(f, { t: "paso-url", indice: 3, valor: "x" })).toEqual(f);
  });
});

describe("lo que se escribe", () => {
  it("quita los caracteres invisibles del nombre y del lugar", () => {
    const f = aplicar(inicial(), { t: "nombre", valor: "Alca​ncía\u0007" }, { t: "lugar", valor: "Feria⁠ Andina" });
    expect(f.nombre).toBe("Alcancía");
    expect(f.lugar).toBe("Feria Andina");
  });

  it("el nombre no pasa de 40 caracteres ni el lugar de 60", () => {
    const f = aplicar(inicial(), { t: "nombre", valor: "a".repeat(80) }, { t: "lugar", valor: "b".repeat(80) });
    expect(f.nombre).toHaveLength(40);
    expect(f.lugar).toHaveLength(60);
  });

  it("en las bases se dejan los saltos de línea", () => {
    const f = aplicar(inicial(), { t: "bases", idioma: "es", valor: "Uno\r\nDos", automaticas: { es: "x", en: "y" } });
    expect(f.bases.es).toBe("Uno\nDos");
    expect(f.bases.moldeEs).toBe("x");
  });
});

describe("el día", () => {
  it("elegir hoy con la hora de abrir ya pasada pone la próxima de 5 minutos y corre las otras", () => {
    const f = aplicar(inicial(), { t: "fecha", valor: "2026-11-18", ahora: AHORA });
    expect([f.abre, f.cierra, f.sorteo]).toEqual(["11:05", "19:05", "19:35"]);
  });

  it("elegir otro día deja las horas como estaban", () => {
    const f = aplicar(inicial(), { t: "fecha", valor: "2026-11-21", ahora: AHORA });
    expect([f.abre, f.cierra, f.sorteo]).toEqual(["10:00", "18:00", "18:30"]);
  });
});

describe("las bases escritas", () => {
  const automaticas = { es: "Lo de siempre", en: "As usual" };

  it("escribir y volver al texto de siempre las deja automáticas", () => {
    const f = aplicar(
      inicial(),
      { t: "bases", idioma: "es", valor: "Otra cosa", automaticas },
      { t: "bases", idioma: "es", valor: "Lo de siempre", automaticas },
    );
    expect(f.bases).toEqual({ es: null, en: null, moldeEs: null, moldeEn: null });
  });

  it("volver a escribirlas las deja automáticas", () => {
    const f = aplicar(inicial(), { t: "bases", idioma: "en", valor: "Other", automaticas }, { t: "rehacer-bases" });
    expect(f.bases.en).toBeNull();
  });

  it("dejarlas así cambia el molde al de ahora y conserva lo escrito", () => {
    const nuevas = { es: "Nuevo", en: "New" };
    const f = aplicar(inicial(), { t: "bases", idioma: "es", valor: "Mío", automaticas }, { t: "dejar-bases", automaticas: nuevas });
    expect(f.bases.es).toBe("Mío");
    expect(f.bases.moldeEs).toBe("Nuevo");
  });
});

describe("lo guardado", () => {
  it("lo guardado se lee igual que se escribió", () => {
    const logo = { tipo: "image/png" as const, datos: "AAAA" };
    const f = aplicar(formularioDeDemostracion("2026-11-19", "America/La_Paz"), { t: "logo", valor: logo, blanco: true });
    expect(leerGuardado(JSON.stringify(f))).toEqual(f);
  });

  it("un guardado con basura o con otra versión no se lee", () => {
    expect(leerGuardado(null)).toBeNull();
    expect(leerGuardado("no es json")).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), v: 2 }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), paso: 9 }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), zona: "Marte/Nada" }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), pasos: [{ tipo: "otra", url: "", texto: { es: "", en: "" } }] }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), nombre: "a".repeat(41) }))).toBeNull();
  });

  it("un logo guardado que no es base64 no se lee", () => {
    expect(leerGuardado(JSON.stringify({ ...inicial(), logo: { tipo: "image/png", datos: "no es base64!" } }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), logo: { tipo: "image/png", datos: "AAA" } }))).toBeNull();
  });

  it("un logo guardado más largo que el tope del lector de la campaña no se lee", () => {
    expect(leerGuardado(JSON.stringify({ ...inicial(), logo: { tipo: "image/png", datos: "A".repeat(54_620) } }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...inicial(), logo: { tipo: "image/png", datos: "A".repeat(54_616) } }))?.logo?.datos).toHaveLength(54_616);
  });

  it("un guardado de antes, sin lo que ahora se conserva del archivo, se lee con los valores de siempre", () => {
    const viejo = { organizadora: null, contrato: null, promo: null, comprobante: null, recibirHastaMs: null };
    const f = leerGuardado(JSON.stringify({ ...inicial(), conservado: viejo }));
    expect(f?.conservado).toMatchObject({ entrada: "google", estado: "abierta", red: "mainnet", anotadas: 0, lugar: null });
  });

  it("un monto que no es entero se descarta y el resto se conserva", () => {
    const f = leerGuardado(JSON.stringify({ ...inicial(), monto: 12.5 }));
    expect(f?.monto).toBeNull();
  });

  it("la campaña de demostración trae marca, premio, día y dos pedidos", () => {
    const f = formularioDeDemostracion("2026-11-19", "America/La_Paz");
    expect([f.nombre, f.monto, f.ganan, f.fecha, f.pasos.length]).toEqual(["Alcancía Andina", 40, 3, "2026-11-19", 2]);
  });
});
