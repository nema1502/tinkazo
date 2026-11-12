// Los textos de los avisos: que digan qué pasa, las cifras y qué hacer en frases cortas, que el asunto se entienda en
// la pantalla bloqueada del celular y que cumplan las reglas de escritura del proyecto (nada de punto y coma, comillas
// angulares, rayas largas ni tecnicismos). Con estados de mentira, sin red.
import { describe, expect, it } from "vitest";
import {
  CLAVES_CONOCIDAS,
  horaDeBolivia,
  mensajeDeAlerta,
  mensajeDeArreglo,
  mensajeDePrueba,
  mensajeDeResumen,
  miles,
  xlm,
} from "./mensaje";
import { estadoBien } from "./mundo-falso";
import { prendidosLimpios, revisarPortero } from "../../../scripts/lib/revision-portero.mjs";

const AHORA = new Date(Date.UTC(2026, 10, 14, 14, 20, 0));
const ctx = (estado: unknown = estadoBien()) => ({ estado, ahora: AHORA, portero: "https://pm.tinkazo.app" });

/** Cada clave que puede salir del guion de revisión, con una forma real (los que llevan un sufijo, con uno). */
const CLAVES_DE_EJEMPLO = [
  "modo:apagado",
  "modo:pollar",
  "modo:sin-leer",
  "portero-sin-llave",
  "no-es-mainnet",
  "patrocinadora-casi-sin-saldo",
  "patrocinadora-baja:saldo-bajo",
  "patrocinadora-baja:saldo-no-leido",
  "creditos-sin-leer",
  "creditos-bajo-el-piso",
  "creditos-bajos",
  "altas-pausadas",
  "firmas-sin-comparar",
  "firmas-sin-explicar:mas-de-10",
  "firmas-sin-explicar:mas-de-50",
  "firmas-sin-explicar:mas-de-200",
  "patrocinio-sin-leer",
  "patrocinio-prendido:sponsor_trustlines",
  "respuesta-invalida",
  "sin-lectura",
  "vigilante-sin-clave",
];

const TODOS = (estado: unknown = estadoBien({ red: "testnet", creditos: 1500, margen: -500, altasPausadas: true, firmasSinExplicar: 300 })) => {
  const alerta = mensajeDeAlerta({ claves: CLAVES_DE_EJEMPLO, problemas: CLAVES_DE_EJEMPLO, recordatorio: false, arreglados: ["creditos-bajos"], siguen: ["altas-pausadas"] }, ctx(estado));
  return [
    alerta,
    mensajeDeAlerta({ claves: CLAVES_DE_EJEMPLO, problemas: CLAVES_DE_EJEMPLO, recordatorio: true, arreglados: [], siguen: [] }, ctx(estado)),
    mensajeDeArreglo({ arreglados: CLAVES_DE_EJEMPLO, siguen: [] }, ctx(estado)),
    mensajeDeArreglo({ arreglados: ["creditos-bajos"], siguen: ["altas-pausadas"] }, ctx(estado)),
    mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(estado)),
    mensajeDeResumen({ leyo: true, claves: CLAVES_DE_EJEMPLO, problemas: CLAVES_DE_EJEMPLO, horas: 6 }, ctx(estado)),
    mensajeDeResumen({ leyo: false, claves: [], problemas: [], horas: 24 }, ctx(null)),
    mensajeDePrueba({ leyo: true }, ctx(estado)),
    mensajeDePrueba({ leyo: false }, ctx(null)),
    ...CLAVES_DE_EJEMPLO.map((c) => mensajeDeAlerta({ claves: [c], problemas: [c], recordatorio: false, arreglados: [], siguen: [] }, ctx(estado))),
    ...CLAVES_DE_EJEMPLO.map((c) => mensajeDeArreglo({ arreglados: [c], siguen: [] }, ctx(estado))),
  ];
};

describe("el catálogo de problemas", () => {
  it("sabe decir cada problema que puede salir del guion de revisión", () => {
    for (const clave of CLAVES_DE_EJEMPLO) {
      const prefijo = clave.split(":")[0]!;
      expect(CLAVES_CONOCIDAS, clave).toContain(prefijo);
    }
  });

  it("ninguna clave conocida cae en el texto de reserva", () => {
    for (const clave of CLAVES_DE_EJEMPLO) {
      const m = mensajeDeAlerta({ claves: [clave], problemas: ["TEXTO-DE-RESERVA"], recordatorio: false, arreglados: [], siguen: [] }, ctx());
      expect(m.texto, clave).not.toContain("TEXTO-DE-RESERVA");
      expect(m.texto, clave).toMatch(/Qué hacer/);
    }
  });

  it("una clave que no conoce usa el texto del guion de revisión, y no se cae", () => {
    const m = mensajeDeAlerta({ claves: ["algo-nuevo"], problemas: ["pasa algo nuevo"], recordatorio: false, arreglados: [], siguen: [] }, ctx());
    expect(m.texto).toContain("pasa algo nuevo");
    expect(m.asunto.length).toBeGreaterThan(5);
  });
});

describe("las reglas de escritura", () => {
  it("ningún aviso lleva punto y coma, comillas angulares, rayas largas, puntos medios ni flechas", () => {
    for (const m of TODOS()) {
      const todo = `${m.asunto}\n${m.texto}`;
      // Punto y coma, comillas angulares, rayas largas, punto medio y flechas, por su código para que este archivo no los lleve.
      const prohibidos = new RegExp(`[;${[0xab, 0xbb, 0x2014, 0x2013, 0xb7, 0x2192, 0x2190, 0x2194].map((c) => String.fromCharCode(c)).join("")}]`);
      expect(todo).not.toMatch(prohibidos);
      expect(todo).not.toMatch(/\.\.\./);
    }
  });

  it("ningún aviso usa los tecnicismos ni las palabras que el proyecto no dice", () => {
    for (const m of TODOS()) {
      const todo = `${m.asunto}\n${m.texto}`;
      expect(todo).not.toMatch(/\b(token|hash|transacci[oó]n|drand|rifa|loter[ií]a|raffle|ticket|boleto|apuesta|byte|MP4)\b/i);
    }
  });

  it("el asunto entra en la pantalla bloqueada: corto, sin saltos y sin el nombre de la empresa pegado", () => {
    for (const m of TODOS()) {
      expect(m.asunto.length, m.asunto).toBeLessThanOrEqual(72);
      expect(m.asunto).not.toMatch(/[\r\n]/);
      expect(m.asunto.trim()).toBe(m.asunto);
    }
  });

  it("los textos están en voseo y en frases cortas", () => {
    for (const m of TODOS()) {
      for (const linea of m.texto.split("\n")) expect(linea.length, linea).toBeLessThanOrEqual(220);
    }
    const m = mensajeDeAlerta({ claves: ["creditos-bajos"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(estadoBien({ creditos: 2400, margen: 400 })));
    expect(m.texto).toMatch(/Cargá/);
  });
});

describe("las cifras", () => {
  it("el aviso de créditos lleva los créditos, el piso, el margen y el saldo de la cuenta que paga", () => {
    const m = mensajeDeAlerta(
      { claves: ["creditos-bajos"], problemas: [], recordatorio: false, arreglados: [], siguen: [] },
      ctx(estadoBien({ creditos: 3200, piso: 2000, margen: 1200, balanceStroops: "253000000", saldoAlertaStroops: 200000000 })),
    );
    expect(m.texto).toContain("3.200");
    expect(m.texto).toContain("2.000");
    expect(m.texto).toContain("1.200");
    expect(m.texto).toContain("25,3 XLM");
    expect(m.texto).toContain("20,0 XLM");
  });

  it("lo que el portero no manda se dice «sin leer» y no se inventa", () => {
    const m = mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx({ red: "mainnet" }));
    expect(m.texto).toMatch(/sin leer/);
    expect(m.texto).not.toMatch(/undefined|NaN|null/);
  });

  it("las cifras dicen siempre si el portero paga: con su modo y con su llave", () => {
    const linea = (estado: unknown) => mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(estado)).texto.split("\n").find((l) => l.startsWith("- Portero:"));
    expect(linea(estadoBien())).toBe("- Portero: paga los sellos y los sorteos");
    expect(linea(estadoBien({ modo: "apagado" }))).toBe("- Portero: apagado, no paga");
    expect(linea(estadoBien({ modo: "pollar" }))).toBe("- Portero: devuelto a Pollar, no paga");
    expect(linea(estadoBien({ llave: null }))).toBe("- Portero: sin su llave, no paga");
    expect(linea(estadoBien({ modo: undefined }))).toBe("- Portero: sin leer");
    expect(linea(estadoBien({ modo: "apagado\nde mentira" }))).toBe("- Portero: sin leer");
    // Sin el campo llave (un portero que no lo manda) no se inventa que falta.
    const { llave: _llave, ...sinLlave } = estadoBien();
    expect(linea(sinLlave)).toBe("- Portero: paga los sellos y los sorteos");
  });

  it("el aviso del portero apagado dice qué pasa, qué significa para un sorteo y qué hacer", () => {
    const m = mensajeDeAlerta({ claves: ["modo:apagado"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(estadoBien({ modo: "apagado" })));
    expect(m.asunto).toBe("El portero está apagado: nadie puede sellar");
    expect(m.texto).toMatch(/no paga ningún sello ni sorteo/i);
    expect(m.texto).toMatch(/Si lo apagaste a propósito, no hagas nada/);
    const pollar = mensajeDeAlerta({ claves: ["modo:pollar"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(estadoBien({ modo: "pollar" })));
    expect(pollar.texto).toMatch(/regla del contrato/);
    const llave = mensajeDeAlerta({ claves: ["portero-sin-llave"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(estadoBien({ llave: null })));
    expect(llave.texto).toMatch(/secret put CLAVE_PATROCINADOR --env mainnet --config wrangler\.toml/);
    expect(llave.texto).not.toMatch(/GLLAVE/);
  });

  it("el portero apagado pesa más que cualquier otro problema, y el que no dice si paga, menos", () => {
    const asunto = (claves: string[]) => mensajeDeAlerta({ claves, problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx()).asunto;
    expect(asunto(["sin-lectura", "patrocinadora-casi-sin-saldo", "modo:apagado"])).toBe("El portero está apagado: nadie puede sellar y 2 más");
    expect(asunto(["sin-lectura", "patrocinadora-casi-sin-saldo", "portero-sin-llave"])).toBe("El portero no tiene la llave: nadie puede sellar y 2 más");
    expect(asunto(["portero-sin-llave", "modo:pollar"])).toBe("El portero no paga: lo pasaron a Pollar y 1 más");
    expect(asunto(["modo:sin-leer", "creditos-bajos"])).toBe("No se puede leer si el portero paga y 1 más");
    expect(asunto(["modo:sin-leer", "creditos-bajo-el-piso"])).toBe("Créditos de Pollar bajo el piso: cargá ya y 1 más");
  });

  it("un estado raro (texto, lista, números como texto) no rompe nada", () => {
    for (const raro of ["hola", [], 7, { creditos: "9000", piso: {}, margen: [], balanceStroops: 12, firmasSinExplicar: "x", patrocinioPollar: "no" }]) {
      const m = mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(raro));
      expect(m.texto).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("el formato de los números: miles con punto, un decimal con coma", () => {
    expect(miles(0)).toBe("0");
    expect(miles(999)).toBe("999");
    expect(miles(1000)).toBe("1.000");
    expect(miles(1234567)).toBe("1.234.567");
    expect(miles(-200)).toBe("-200");
    expect(miles(-12345)).toBe("-12.345");
    expect(miles(null)).toBe("sin leer");
    expect(miles(Number.NaN)).toBe("sin leer");
    expect(xlm("500000000")).toBe("50,0 XLM");
    expect(xlm("253000000")).toBe("25,3 XLM");
    expect(xlm("15")).toBe("0,0 XLM");
    expect(xlm(200000000)).toBe("20,0 XLM");
    expect(xlm(null)).toBe("sin leer");
    expect(xlm("-5")).toBe("sin leer");
    expect(xlm("1e9")).toBe("sin leer");
  });

  it("la hora se dice en la de Bolivia, que son cuatro menos que la universal", () => {
    expect(horaDeBolivia(AHORA)).toBe("14 de noviembre, 10:20 (hora de Bolivia)");
    expect(horaDeBolivia(new Date(Date.UTC(2026, 11, 1, 2, 5, 0)))).toBe("30 de noviembre, 22:05 (hora de Bolivia)");
  });

  it("con la lista de cobros de Pollar llena, la cifra de cobros sin explicar se dice como lo menos que hay", () => {
    const linea = (estado: unknown) =>
      mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(estado)).texto.split("\n").find((l) => l.startsWith("- Cobros de Pollar sin explicar"));
    const llena = (completo: unknown) => estadoBien({ firmasSinExplicar: 14, firmas: { cobradas: 200, explicadas: 186, completo } });
    expect(linea(llena(false))).toBe("- Cobros de Pollar sin explicar en el último día: al menos 14 (la lista de Pollar vino llena)");
    for (const completo of [true, null, undefined]) expect(linea(llena(completo)), String(completo)).toBe("- Cobros de Pollar sin explicar en el último día: 14");
    expect(linea(estadoBien({ firmasSinExplicar: 14, firmas: "no" }))).toBe("- Cobros de Pollar sin explicar en el último día: 14");
    const { firmas: _firmas, ...sinFirmas } = estadoBien({ firmasSinExplicar: 14 });
    expect(linea(sinFirmas)).toBe("- Cobros de Pollar sin explicar en el último día: 14");
    // Sin la cifra no hay mínimo que decir.
    expect(linea(estadoBien({ firmasSinExplicar: null, firmas: { completo: false } }))).toBe("- Cobros de Pollar sin explicar en el último día: sin leer");
    const aviso = mensajeDeAlerta({ claves: ["firmas-sin-explicar:mas-de-10"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(llena(false)));
    expect(aviso.texto).toMatch(/hay al menos 14 cobros de Pollar/);
    const completa = mensajeDeAlerta({ claves: ["firmas-sin-explicar:mas-de-10"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(llena(true)));
    expect(completa.texto).toMatch(/hay 14 cobros de Pollar/);
  });

  it("las banderas prendidas del patrocinio salen limpias, ordenadas y acotadas, con la misma función que arma la clave", () => {
    const linea = (prendidos: unknown) =>
      mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(estadoBien({ patrocinioPollar: { esperado: false, prendidos } }))).texto.split("\n").find((l) => l.startsWith("- Patrocinio de la app en Pollar"))!;
    const delCorreo = (prendidos: unknown) => linea(prendidos).slice("- Patrocinio de la app en Pollar: prendido: ".length).split(", ");
    // Las de verdad: ordenadas, y la misma lista da siempre la misma línea.
    expect(linea(["sponsor_b", "sponsor_a"])).toBe("- Patrocinio de la app en Pollar: prendido: sponsor_a, sponsor_b");
    expect(linea(["sponsor_a", "sponsor_b"])).toBe(linea(["sponsor_b", "sponsor_a"]));
    expect(linea([])).toBe("- Patrocinio de la app en Pollar: prendido: sin detalle");
    expect(linea("no es una lista")).toBe("- Patrocinio de la app en Pollar: prendido: sin detalle");
    // Las raras: sin caracteres de control, a 70 como mucho por bandera y diez como mucho.
    const muchas = Array.from({ length: 50 }, (_, i) => `sponsor_bandera_${String.fromCharCode(97 + (i % 26))}${i >= 26 ? "z" : ""}`);
    const rara = linea([...muchas, `sponsor_x\n\u0007${"y".repeat(300)}`, "sponsor_\r\tcon\u0000espacios"]);
    expect(rara).not.toMatch(/[\u0000-\u001f\u007f]/);
    const lista = delCorreo([...muchas, `sponsor_x\n\u0007${"y".repeat(300)}`]);
    expect(lista).toHaveLength(10);
    for (const bandera of lista) expect(bandera.length).toBeLessThanOrEqual(70);
    expect(lista).toEqual([...lista].sort());
    expect(delCorreo(["sponsor_\r\tcon\u0000espacios"])).toEqual(["sponsor_ con espacios"]);
    expect(delCorreo([`sponsor_x\n${"y".repeat(300)}`])).toEqual([`sponsor_x ${"y".repeat(60)}`]);
    // Es la misma lista que entra a la clave: una función, no dos copias.
    const clave = revisarPortero(estadoBien({ patrocinioPollar: { esperado: false, prendidos: [...muchas, `sponsor_x\n${"y".repeat(300)}`] } })).claves[0]!;
    expect(delCorreo([...muchas, `sponsor_x\n${"y".repeat(300)}`]).join(",")).toBe(clave.slice("patrocinio-prendido:".length));
    expect(prendidosLimpios(["b", "a\n"])).toEqual(["a", "b"]);
  });

  it("los créditos leídos hace más de dos minutos dicen de cuándo son", () => {
    const linea = (estado: unknown) =>
      mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx(estado)).texto.split("\n").find((l) => l.startsWith("- Créditos de Pollar"));
    const leidos = (ms: unknown) => estadoBien({ creditosLeidos: ms });
    const hace = (minutos: number) => AHORA.getTime() - minutos * 60_000;
    expect(linea(leidos(hace(7)))).toBe("- Créditos de Pollar: 9.000 (leídos hace 7 minutos)");
    expect(linea(leidos(hace(9.9)))).toBe("- Créditos de Pollar: 9.000 (leídos hace 9 minutos)");
    for (const reciente of [hace(0), hace(1.5), hace(2), hace(-5)]) expect(linea(leidos(reciente)), String(reciente)).toBe("- Créditos de Pollar: 9.000");
    for (const raro of [null, "1794450000000", undefined, Number.NaN]) expect(linea(leidos(raro)), String(raro)).toBe("- Créditos de Pollar: 9.000");
    // Sin créditos leídos no hay hora que decir.
    expect(linea(estadoBien({ creditos: null, creditosLeidos: hace(7) }))).toBe("- Créditos de Pollar: sin leer");
  });
});

describe("cada tipo de aviso", () => {
  it("una alerta dice cuántos problemas hay y nombra el más grave en el asunto", () => {
    const m = mensajeDeAlerta(
      { claves: ["altas-pausadas", "creditos-bajo-el-piso"], problemas: [], recordatorio: false, arreglados: [], siguen: [] },
      ctx(estadoBien({ creditos: 1800, margen: -200, altasPausadas: true })),
    );
    expect(m.asunto).toBe("Créditos de Pollar bajo el piso: cargá ya y 1 más");
    expect(m.texto).toMatch(/^Hay 2 problemas/);
  });

  it("el recordatorio empieza con «Sigue» y dice que pasaron más de 23 horas", () => {
    const m = mensajeDeAlerta({ claves: ["creditos-bajos"], problemas: [], recordatorio: true, arreglados: [], siguen: [] }, ctx(estadoBien({ creditos: 2400, margen: 400 })));
    expect(m.asunto).toBe("Sigue: Créditos de Pollar bajos: cargá hoy");
    expect(m.texto).toMatch(/sigue sin arreglar/);
    expect(m.texto).toMatch(/23 horas/);
  });

  it("el arreglo es corto y dice qué se arregló", () => {
    const m = mensajeDeArreglo({ arreglados: ["creditos-bajos"], siguen: [] }, ctx());
    expect(m.asunto).toBe("Arreglado: créditos de Pollar");
    expect(m.texto).toMatch(/Los créditos de Pollar volvieron a estar bien/);
    expect(m.texto).toMatch(/Ya no hay problemas/);
    expect(m.texto.split("\n").length).toBeLessThan(25);
  });

  it("un arreglo de muchas cosas nombra la primera y cuenta las demás, para que entre en la pantalla bloqueada", () => {
    const m = mensajeDeArreglo({ arreglados: ["creditos-bajos", "altas-pausadas", "firmas-sin-comparar", "sin-lectura"], siguen: [] }, ctx());
    expect(m.asunto).toBe("Arreglado: créditos de Pollar y 3 más");
    expect(m.texto).toMatch(/Las altas ya no están pausadas/);
    expect(m.texto).toMatch(/El portero volvió a contestar/);
  });

  it("el arreglo del portero que vuelve a pagar y del que vuelve a tener su llave", () => {
    const m = mensajeDeArreglo({ arreglados: ["modo:apagado"], siguen: [] }, ctx());
    expect(m.asunto).toBe("Arreglado: el portero vuelve a pagar");
    expect(m.texto).toMatch(/El portero volvió a pagar los sellos y los sorteos/);
    expect(mensajeDeArreglo({ arreglados: ["portero-sin-llave"], siguen: [] }, ctx()).asunto).toBe("Arreglado: llave del portero");
  });

  it("si lo que se arregló era no poder leer el modo, no dice que el portero volvió a pagar: solo que se vuelve a leer", () => {
    const m = mensajeDeArreglo({ arreglados: ["modo:sin-leer"], siguen: [] }, ctx());
    expect(m.asunto).toBe("Arreglado: ya se lee si el portero paga");
    expect(m.texto).toMatch(/Ya se puede leer si el portero paga los sellos y los sorteos\./);
    expect(`${m.asunto}\n${m.texto}`).not.toMatch(/vuelve a pagar|volvió a pagar/);
    // En una alerta que también trae un arreglo, la misma frase.
    const alerta = mensajeDeAlerta({ claves: ["altas-pausadas"], problemas: [], recordatorio: false, arreglados: ["modo:sin-leer"], siguen: [] }, ctx());
    expect(alerta.texto).toMatch(/Se arregló: Ya se puede leer si el portero paga/);
    expect(alerta.texto).not.toMatch(/volvió a pagar/);
    // Si antes también estuvo apagado o devuelto a Pollar, y ahora paga, sí volvió a pagar.
    for (const otro of ["modo:apagado", "modo:pollar"]) {
      const junto = mensajeDeArreglo({ arreglados: ["modo:sin-leer", otro], siguen: [] }, ctx());
      expect(junto.asunto, otro).toBe("Arreglado: el portero vuelve a pagar");
      expect(junto.texto, otro).toMatch(/El portero volvió a pagar los sellos y los sorteos/);
    }
    // El modo apagado y el devuelto a Pollar siguen como estaban.
    for (const clave of ["modo:apagado", "modo:pollar"]) expect(mensajeDeArreglo({ arreglados: [clave], siguen: [] }, ctx()).asunto, clave).toBe("Arreglado: el portero vuelve a pagar");
  });

  it("un arreglo de varias cosas las junta en el asunto, sin repetir", () => {
    const m = mensajeDeArreglo({ arreglados: ["creditos-bajos", "creditos-bajo-el-piso", "altas-pausadas"], siguen: [] }, ctx());
    expect(m.asunto).toBe("Arreglado: créditos de Pollar y altas pausadas");
  });

  it("el resumen dice que es la señal de vida", () => {
    const m = mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 24 }, ctx());
    expect(m.asunto).toBe("Resumen del portero: todo bien");
    expect(m.texto).toMatch(/todos los días a las 8 de la mañana/);
    expect(m.texto).toMatch(/Si un día no llega, el vigilante se cayó/);
    const seis = mensajeDeResumen({ leyo: true, claves: [], problemas: [], horas: 6 }, ctx());
    expect(seis.texto).toMatch(/cada 6 horas/);
  });

  it("el resumen cuenta los problemas en singular y en plural, y el portero que no contesta", () => {
    expect(mensajeDeResumen({ leyo: true, claves: ["altas-pausadas"], problemas: [], horas: 24 }, ctx()).asunto).toBe("Resumen del portero: hay 1 problema");
    expect(mensajeDeResumen({ leyo: true, claves: ["altas-pausadas", "creditos-bajos"], problemas: [], horas: 24 }, ctx()).asunto).toBe("Resumen del portero: hay 2 problemas");
    expect(mensajeDeResumen({ leyo: false, claves: [], problemas: [], horas: 24 }, ctx(null)).asunto).toBe("Resumen del portero: no contesta");
  });

  it("el aviso de prueba dice que es una prueba y trae las cifras de ahora", () => {
    const m = mensajeDePrueba({ leyo: true }, ctx());
    expect(m.asunto).toBe("Prueba del vigilante: el aviso llega");
    expect(m.texto).toMatch(/es una prueba/i);
    expect(m.texto).toContain("9.000");
  });

  it("el texto que dice ser el portero entra en una sola línea corta, sin los saltos que traiga", () => {
    const m = mensajeDeAlerta({ claves: ["no-es-mainnet"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, ctx(estadoBien({ red: "test\nnet\r\u0007 con\t\tcosas".padEnd(500, "x") })));
    const linea = m.texto.split("\n").find((l) => l.startsWith("El portero que contesta"))!;
    expect(linea).toContain("Dice ser: test net con cosas");
    expect(linea).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(linea.length).toBeLessThan(120);
  });
});
