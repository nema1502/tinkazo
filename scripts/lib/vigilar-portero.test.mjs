// Prueba la revisión del portero de mainnet (scripts/lib/vigilar-portero.mjs) con respuestas de `/estado`
// inventadas: ninguna prueba le habla al portero. Prueba también cuándo avisar: un problema nuevo, uno que empeora, el
// mismo que sigue (un recordatorio cada 23 horas), el que se arregla y vuelve, la corrida a mano y el portero que no
// contesta. Y que lo que sale al registro (público) y a la caché nunca lleva una cifra del negocio.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MARGEN_MINIMO,
  MAX_SIN_EXPLICAR,
  RECORDATORIO_HORAS,
  TRAMOS_SIN_EXPLICAR,
  decidirAviso,
  escribirRecordado,
  leerRecordado,
  principal,
  revisarPortero,
  sinRecordar,
} from "./vigilar-portero.mjs";

/** Un `/estado` del portero de mainnet con todo en orden (los campos que manda de verdad). */
const bien = (extra = {}) => ({
  modo: "portero",
  red: "mainnet",
  patrocinadora: "GPATROCINADORAINVENTADAPARALASPRUEBASDELPORTERODEMAINNET",
  llave: "GLLAVEINVENTADAPARALASPRUEBASDELPORTERODEMAINNETQUEFIRMA",
  alerta: false,
  balanceStroops: "500000000",
  saldoAlertaStroops: 200000000,
  creditos: 9000,
  piso: 2000,
  margen: 7000,
  altasPausadas: false,
  firmasSinExplicar: 2,
  firmas: { cobradas: 30, explicadas: 28, sellos: 20, sorteos: 6, activaciones: 2, completo: true, desde: 0 },
  patrocinioPollar: { esperado: true, prendidos: [] },
  // Los manda el portero vivo (con las altas prendidas en mainnet) aunque la venta esté cerrada. La revisión no los mira.
  pagosSueltos: 0,
  ventaPausada: false,
  ...extra,
});

/** La cuenta patrocinadora baja, como la manda el portero: `alerta` y el motivo de `servicio.ts`. */
const patrocinadoraBaja = (balanceStroops) => bien({ alerta: true, motivoAlerta: "saldo-bajo", balanceStroops });

/** Lo que sale en el registro sin las fechas de los avisos ni las «23 horas» del recordatorio. */
const sinFechas = (texto) => texto.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "").replace(/23 horas/g, "");

describe("revisarPortero", () => {
  it("con todo en orden no hay problemas ni claves", () => {
    const r = revisarPortero(bien());
    expect(r.problemas).toEqual([]);
    expect(r.claves).toEqual([]);
  });

  it(`los créditos por debajo del piso más ${MARGEN_MINIMO}: falla; justo en el borde, no`, () => {
    expect(MARGEN_MINIMO).toBe(1000);
    expect(revisarPortero(bien({ creditos: 2999, piso: 2000 })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ creditos: 3000, piso: 2000 })).problemas).toEqual([]);
    // Sin saldo leído (Pollar caído), también: no se sabe.
    expect(revisarPortero(bien({ creditos: null })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ piso: undefined })).problemas).toHaveLength(1);
  });

  it("los créditos bajo el piso son otro problema que los créditos bajos: ahí el portero deja de aceptar canjes", () => {
    expect(revisarPortero(bien({ creditos: 2999, piso: 2000 })).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero(bien({ creditos: 2000, piso: 2000 })).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero(bien({ creditos: 1999, piso: 2000 })).claves).toEqual(["creditos-bajo-el-piso"]);
    expect(revisarPortero(bien({ creditos: 0, piso: 2000 })).claves).toEqual(["creditos-bajo-el-piso"]);
    expect(revisarPortero(bien({ creditos: 1999, piso: 2000 })).problemas).toHaveLength(1);
  });

  it("con compras con QR en curso, los créditos que no cubren el piso más sus reservas son un problema propio, antes que un 402", () => {
    // Piso 2.000 y 530 reservados por una compra en camino.
    expect(revisarPortero(bien({ creditos: 2529, piso: 2000, reservasCompras: 530 })).claves).toEqual(["creditos-bajo-las-reservas"]);
    expect(revisarPortero(bien({ creditos: 2529, piso: 2000, reservasCompras: 530 })).problemas[0]).toMatch(/compras con QR en curso/);
    // Cubiertas, pero sin el margen encima de las reservas: créditos bajos.
    expect(revisarPortero(bien({ creditos: 2530, piso: 2000, reservasCompras: 530 })).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero(bien({ creditos: 3529, piso: 2000, reservasCompras: 530 })).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero(bien({ creditos: 3530, piso: 2000, reservasCompras: 530 })).claves).toEqual([]);
    // Bajo el piso sigue siendo lo más grave.
    expect(revisarPortero(bien({ creditos: 1999, piso: 2000, reservasCompras: 530 })).claves).toEqual(["creditos-bajo-el-piso"]);
    // Sin reservas, o sin el campo (la compra con QR apagada), como siempre.
    expect(revisarPortero(bien({ creditos: 2529, piso: 2000, reservasCompras: 0 })).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero(bien({ creditos: 3000, piso: 2000 })).claves).toEqual([]);
  });

  it("la patrocinadora baja o sin leer: falla, con los motivos que manda el portero", () => {
    expect(revisarPortero(patrocinadoraBaja("150000000")).problemas[0]).toMatch(/saldo-bajo/);
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-no-leido", balanceStroops: null })).problemas[0]).toMatch(/saldo-no-leido/);
    expect(revisarPortero(bien({ alerta: undefined })).problemas).toHaveLength(1);
  });

  it("la patrocinadora que casi no tiene saldo (menos de la mitad del nivel de alerta) es un problema más grave", () => {
    expect(revisarPortero(patrocinadoraBaja("150000000")).claves).toEqual(["patrocinadora-baja:saldo-bajo"]);
    // Justo la mitad todavía es el tramo de abajo; un stroop menos, el de arriba.
    expect(revisarPortero(patrocinadoraBaja("100000000")).claves).toEqual(["patrocinadora-baja:saldo-bajo"]);
    expect(revisarPortero(patrocinadoraBaja("99999999")).claves).toEqual(["patrocinadora-casi-sin-saldo"]);
    expect(revisarPortero(patrocinadoraBaja("0")).claves).toEqual(["patrocinadora-casi-sin-saldo"]);
    // Sin saldo leído no se sabe cuánto queda: sigue siendo el problema de siempre.
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-no-leido", balanceStroops: null })).claves).toEqual(["patrocinadora-baja:saldo-no-leido"]);
    // Y sin el nivel de alerta en la respuesta no se inventa uno.
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-bajo", balanceStroops: "10", saldoAlertaStroops: undefined })).claves).toEqual(["patrocinadora-baja:saldo-bajo"]);
    expect(revisarPortero(patrocinadoraBaja("99999999")).problemas).toHaveLength(1);
  });

  it("las altas pausadas (el campo altasPausadas de /estado) son un problema", () => {
    expect(revisarPortero(bien({ altasPausadas: false })).claves).toEqual([]);
    expect(revisarPortero(bien({ altasPausadas: undefined })).claves).toEqual([]);
    const r = revisarPortero(bien({ altasPausadas: true }));
    expect(r.claves).toEqual(["altas-pausadas"]);
    expect(r.problemas).toHaveLength(1);
  });

  it(`más de ${MAX_SIN_EXPLICAR} firmas sin explicar: falla; sin la vigilancia, también`, () => {
    expect(MAX_SIN_EXPLICAR).toBe(10);
    expect(revisarPortero(bien({ firmasSinExplicar: 10 })).problemas).toEqual([]);
    expect(revisarPortero(bien({ firmasSinExplicar: 11 })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ firmasSinExplicar: null })).problemas).toHaveLength(1);
  });

  it("las firmas sin explicar van por tramos gruesos: más de 10, más de 50 y más de 200", () => {
    expect(TRAMOS_SIN_EXPLICAR).toEqual([10, 50, 200]);
    const clave = (n) => revisarPortero(bien({ firmasSinExplicar: n })).claves;
    expect(clave(10)).toEqual([]);
    expect(clave(11)).toEqual(["firmas-sin-explicar:mas-de-10"]);
    expect(clave(50)).toEqual(["firmas-sin-explicar:mas-de-10"]);
    expect(clave(51)).toEqual(["firmas-sin-explicar:mas-de-50"]);
    expect(clave(200)).toEqual(["firmas-sin-explicar:mas-de-50"]);
    expect(clave(201)).toEqual(["firmas-sin-explicar:mas-de-200"]);
    expect(clave(5000)).toEqual(["firmas-sin-explicar:mas-de-200"]);
    expect(clave(null)).toEqual(["firmas-sin-comparar"]);
  });

  it("el patrocinio de la app prendido, o sin leer: falla y nombra lo prendido", () => {
    expect(revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } })).problemas[0]).toMatch(/sponsor_trustlines/);
    expect(revisarPortero(bien({ patrocinioPollar: null })).problemas).toHaveLength(1);
  });

  it("el portero que no paga es un problema: apagado o devuelto a Pollar, cada uno con su clave", () => {
    expect(revisarPortero(bien({ modo: "portero" })).claves).toEqual([]);
    const apagado = revisarPortero(bien({ modo: "apagado" }));
    expect(apagado.claves).toEqual(["modo:apagado"]);
    expect(apagado.problemas[0]).toMatch(/apagado/);
    const pollar = revisarPortero(bien({ modo: "pollar" }));
    expect(pollar.claves).toEqual(["modo:pollar"]);
    expect(pollar.problemas[0]).toMatch(/Pollar/);
  });

  it("un modo que falta o que no es ninguno de los tres es no saber si el portero paga, y no entra a la clave", () => {
    expect(revisarPortero(bien({ modo: undefined })).claves).toEqual(["modo:sin-leer"]);
    const { modo: _modo, ...sinModo } = bien();
    expect(revisarPortero(sinModo).claves).toEqual(["modo:sin-leer"]);
    for (const raro of ["apagado\notra cosa", "x".repeat(5000), "Portero", "APAGADO", "", 1, null, {}, ["portero"]]) {
      const r = revisarPortero(bien({ modo: raro }));
      expect(r.claves, String(raro).slice(0, 20)).toEqual(["modo:sin-leer"]);
      expect(r.problemas.join("\n")).not.toMatch(/otra cosa|xxxx/);
    }
  });

  it("sin la llave del portero (llave en null) es un problema; un estado que no trae el campo, no", () => {
    const r = revisarPortero(bien({ llave: null }));
    expect(r.claves).toEqual(["portero-sin-llave"]);
    expect(r.problemas[0]).toMatch(/llave/);
    expect(revisarPortero(bien({ llave: "GOTRALLAVE" })).claves).toEqual([]);
    const { llave: _llave, ...sinLlave } = bien();
    expect(revisarPortero(sinLlave).claves).toEqual([]);
    // Ni un texto vacío ni otra cosa que no sea null se toma como que falta: no se inventa.
    expect(revisarPortero(bien({ llave: undefined })).claves).toEqual([]);
  });

  it("apagado y sin llave a la vez: las dos claves", () => {
    expect(revisarPortero(bien({ modo: "apagado", llave: null })).claves).toEqual(["modo:apagado", "portero-sin-llave"]);
  });

  it("si no es el portero de mainnet (o no trae nada de las altas), falla: no se mira el portero equivocado", () => {
    expect(revisarPortero(bien({ red: "testnet" })).problemas.length).toBeGreaterThan(0);
    expect(revisarPortero({ red: "mainnet", alerta: false }).problemas.length).toBeGreaterThanOrEqual(3);
    expect(revisarPortero(null).problemas.length).toBeGreaterThan(0);
  });

  it("los problemas nombran qué pasa en palabras: ninguno lleva una cifra, un saldo ni una dirección", () => {
    const todoMal = bien({
      red: "testnet",
      alerta: true,
      motivoAlerta: "saldo-bajo",
      balanceStroops: "17654321",
      patrocinadora: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
      creditos: 1234,
      piso: 2000,
      altasPausadas: true,
      firmasSinExplicar: 777,
      patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] },
    });
    const r = revisarPortero({ ...todoMal, modo: "apagado", llave: null });
    expect(r.claves).toContain("modo:apagado");
    expect(r.claves).toContain("portero-sin-llave");
    expect(r.problemas).toHaveLength(r.claves.length);
    expect(r.problemas.length).toBeGreaterThanOrEqual(8);
    const texto = r.problemas.join("\n");
    expect(texto).not.toMatch(/\d/);
    expect(texto).not.toMatch(/GABCDEF/);
    // Cada tramo de las firmas y cada nivel de los créditos lo dice con palabras.
    for (const n of [11, 51, 201]) expect(revisarPortero(bien({ firmasSinExplicar: n })).problemas.join("")).not.toMatch(/\d/);
    for (const c of [100, 2500]) expect(revisarPortero(bien({ creditos: c })).problemas.join("")).not.toMatch(/\d/);
    expect(revisarPortero(patrocinadoraBaja("1")).problemas.join("")).not.toMatch(/\d/);
  });
});

describe("las claves de los problemas", () => {
  it("hay una clave por problema, en el mismo orden, y ninguna con todo en orden", () => {
    expect(revisarPortero(bien()).claves).toEqual([]);
    const r = revisarPortero(bien({ creditos: 100, firmasSinExplicar: 40 }));
    expect(r.problemas).toHaveLength(2);
    expect(r.claves).toEqual(["creditos-bajo-el-piso", "firmas-sin-explicar:mas-de-10"]);
  });

  it("el mismo problema con otras cifras tiene la misma clave: las cifras se mueven y el problema es el mismo", () => {
    expect(revisarPortero(bien({ creditos: 2500 })).claves).toEqual(revisarPortero(bien({ creditos: 2310 })).claves);
    expect(revisarPortero(bien({ creditos: 1500 })).claves).toEqual(revisarPortero(bien({ creditos: 90 })).claves);
    expect(revisarPortero(bien({ firmasSinExplicar: 11 })).claves).toEqual(revisarPortero(bien({ firmasSinExplicar: 14 })).claves);
    expect(revisarPortero(bien({ firmasSinExplicar: 60 })).claves).toEqual(revisarPortero(bien({ firmasSinExplicar: 190 })).claves);
    expect(revisarPortero(patrocinadoraBaja("150000000")).claves).toEqual(revisarPortero(patrocinadoraBaja("120000000")).claves);
  });

  it("empeorar es otra clave: de bajos a bajo el piso, de un tramo de firmas al siguiente, de baja a casi sin saldo", () => {
    const bajos = revisarPortero(bien({ creditos: 2500 })).claves;
    const bajoElPiso = revisarPortero(bien({ creditos: 1500 })).claves;
    expect(bajoElPiso).not.toEqual(bajos);
    expect(revisarPortero(bien({ firmasSinExplicar: 60 })).claves).not.toEqual(revisarPortero(bien({ firmasSinExplicar: 11 })).claves);
    expect(revisarPortero(bien({ firmasSinExplicar: 300 })).claves).not.toEqual(revisarPortero(bien({ firmasSinExplicar: 60 })).claves);
    expect(revisarPortero(patrocinadoraBaja("50000000")).claves).not.toEqual(revisarPortero(patrocinadoraBaja("150000000")).claves);
  });

  it("otro problema, otra clave: sin leer no es lo mismo que bajo, ni una causa de alerta que otra", () => {
    const bajos = revisarPortero(bien({ creditos: 2500 })).claves;
    const sinLeer = revisarPortero(bien({ creditos: null })).claves;
    expect(sinLeer).not.toEqual(bajos);
    const baja = revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-bajo" })).claves;
    expect(baja).not.toEqual(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-no-leido" })).claves);
    const uno = revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } })).claves;
    const dos = revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines", "sponsor_accounts"] } })).claves;
    expect(uno).not.toEqual(dos);
  });

  it("una respuesta que no es un objeto tiene su clave", () => {
    expect(revisarPortero(null).claves).toEqual(["respuesta-invalida"]);
  });

  it("el texto que llega del portero entra limpio y corto: sin saltos de línea, sin caracteres de control y acotado", () => {
    const r = revisarPortero(bien({ red: "test\nnet\r\u0007\t\tcon cosas".padEnd(500, "x") }));
    expect(r.claves).toEqual(["no-es-mainnet"]);
    expect(r.problemas[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(r.problemas[0]).toContain("red: test net con cosasxxx");
    expect(r.problemas[0].length).toBeLessThanOrEqual("no es el portero de mainnet (red: )".length + 70);
    const prendidos = Array.from({ length: 50 }, (_, i) => `sponsor_bandera_${String.fromCharCode(97 + (i % 26))}${i >= 26 ? "z" : ""}`);
    const muchas = revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: [...prendidos, `sponsor_x\n${"y".repeat(300)}`] } }));
    expect(muchas.claves).toHaveLength(1);
    const lista = muchas.claves[0].slice("patrocinio-prendido:".length).split(",");
    expect(lista).toHaveLength(10);
    for (const p of lista) {
      expect(p.length).toBeLessThanOrEqual(70);
      expect(p).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
    expect(muchas.problemas[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("las banderas de verdad dan la misma clave que antes: limpiar no cambia nada de lo que ya se avisó", () => {
    const clave = (prendidos) => revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos } })).claves;
    expect(clave(["sponsor_b", "sponsor_a"])).toEqual(["patrocinio-prendido:sponsor_a,sponsor_b"]);
    expect(clave(["sponsor_trustlines"])).toEqual(["patrocinio-prendido:sponsor_trustlines"]);
    const larga = `sponsor_${"a".repeat(60)}`;
    expect(larga.length).toBe(68);
    expect(clave([larga])).toEqual([`patrocinio-prendido:${larga}`]);
    expect(clave([])).toEqual(["patrocinio-prendido:"]);
    expect(revisarPortero(bien({ red: "testnet" })).problemas).toEqual(["no es el portero de mainnet (red: testnet)"]);
  });

  it("el motivo de la alerta de la patrocinadora entra a la clave y al texto solo si es uno de los dos que manda el portero", () => {
    const baja = (motivoAlerta) => revisarPortero(bien({ alerta: true, motivoAlerta }));
    // Los dos de verdad dan las claves de siempre y se nombran en el texto.
    expect(baja("saldo-bajo").claves).toEqual(["patrocinadora-baja:saldo-bajo"]);
    expect(baja("saldo-no-leido").claves).toEqual(["patrocinadora-baja:saldo-no-leido"]);
    expect(baja("saldo-bajo").problemas[0]).toBe("la cuenta patrocinadora está baja o no se pudo leer (saldo-bajo)");
    expect(baja("saldo-no-leido").problemas[0]).toBe("la cuenta patrocinadora está baja o no se pudo leer (saldo-no-leido)");
    // Cualquier otra cosa es sin-motivo, y lo que mande el portero no entra ni a la clave ni al texto.
    const largo = "x".repeat(5000);
    for (const raro of [undefined, null, "", "saldo-bajo\notra cosa", largo, "SALDO-BAJO", " saldo-bajo", "constructor", "__proto__", 1, true, {}, ["saldo-bajo"]]) {
      const r = baja(raro);
      expect(r.claves, String(raro).slice(0, 20)).toEqual(["patrocinadora-baja:sin-motivo"]);
      expect(r.problemas, String(raro).slice(0, 20)).toEqual(["la cuenta patrocinadora está baja o no se pudo leer (sin motivo conocido)"]);
    }
    // Sin el campo alerta en la respuesta tampoco hay motivo, y casi sin saldo sigue siendo su propia clave.
    expect(revisarPortero(bien({ alerta: undefined })).claves).toEqual(["patrocinadora-baja:sin-motivo"]);
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: largo, balanceStroops: "1" })).claves).toEqual(["patrocinadora-casi-sin-saldo"]);
  });
});

describe("decidirAviso: cuándo hace falta el correo", () => {
  const hora = 3_600_000;
  const t0 = new Date("2026-11-11T14:23:00Z");
  const despues = (horas) => new Date(t0.getTime() + horas * hora);
  const CREDITOS = ["creditos-bajos"];
  const FIRMAS = ["firmas-sin-explicar:mas-de-10"];

  it("sin problemas no avisa, y se olvida lo avisado", () => {
    const d = decidirAviso({ claves: [], recordado: { claves: CREDITOS, avisadoEn: t0.toISOString() }, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: false, motivo: "sin-problemas", siguiente: sinRecordar() });
  });

  it("un problema nuevo avisa, y queda recordado con la fecha", () => {
    const d = decidirAviso({ claves: CREDITOS, recordado: sinRecordar(), ahora: t0 });
    expect(d).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: CREDITOS });
    expect(d.siguiente).toEqual({ claves: CREDITOS, avisadoEn: t0.toISOString() });
  });

  it("el mismo problema una hora después no avisa, y la fecha del aviso no se mueve", () => {
    const antes = decidirAviso({ claves: CREDITOS, recordado: sinRecordar(), ahora: t0 }).siguiente;
    const d = decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: false, motivo: "ya-avisado" });
    expect(d.siguiente).toEqual(antes);
    // Y sigue sin avisar el resto de la jornada.
    expect(decidirAviso({ claves: CREDITOS, recordado: d.siguiente, ahora: despues(RECORDATORIO_HORAS - 0.5) }).avisar).toBe(false);
  });

  it("el mismo problema al día siguiente avisa una vez, y la hora siguiente ya no", () => {
    const antes = decidirAviso({ claves: CREDITOS, recordado: sinRecordar(), ahora: t0 }).siguiente;
    const manana = decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(24) });
    expect(manana).toMatchObject({ avisar: true, motivo: "recordatorio" });
    expect(manana.siguiente.avisadoEn).toBe(despues(24).toISOString());
    const otraHora = decidirAviso({ claves: CREDITOS, recordado: manana.siguiente, ahora: despues(25) });
    expect(otraHora).toMatchObject({ avisar: false, motivo: "ya-avisado" });
  });

  it("el recordatorio llega a las 23 horas y no antes, para que la hora no se corra de a poco", () => {
    expect(RECORDATORIO_HORAS).toBe(23);
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    expect(decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(22.9) }).avisar).toBe(false);
    expect(decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(23) }).avisar).toBe(true);
  });

  it("cambia el problema: avisa, aunque el otro se haya avisado hace una hora", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: FIRMAS, recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: FIRMAS });
    expect(d.siguiente.claves).toEqual(FIRMAS);
  });

  it("se suma un problema a otro que ya se avisó: avisa por el nuevo", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: [...FIRMAS, ...CREDITOS], recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: FIRMAS });
    expect(d.siguiente.claves).toEqual([...CREDITOS, ...FIRMAS].sort());
  });

  it("se arregla uno de dos: no avisa, y si vuelve es nuevo", () => {
    const antes = { claves: [...CREDITOS, ...FIRMAS].sort(), avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: false, motivo: "ya-avisado" });
    expect(d.siguiente).toEqual({ claves: CREDITOS, avisadoEn: t0.toISOString() });
    const vuelve = decidirAviso({ claves: [...CREDITOS, ...FIRMAS], recordado: d.siguiente, ahora: despues(2) });
    expect(vuelve).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: FIRMAS });
  });

  it("se arregla y vuelve: avisa, aunque haya pasado menos de un día", () => {
    let memoria = sinRecordar();
    const corrida = (claves, horas) => {
      const d = decidirAviso({ claves, recordado: memoria, ahora: despues(horas) });
      memoria = d.siguiente;
      return d.avisar;
    };
    expect(corrida(CREDITOS, 0)).toBe(true);
    expect(corrida(CREDITOS, 1)).toBe(false);
    expect(corrida([], 2)).toBe(false);
    expect(corrida(CREDITOS, 3)).toBe(true);
    expect(corrida(CREDITOS, 4)).toBe(false);
  });

  it("el orden y las repeticiones de las claves no cambian nada", () => {
    const antes = { claves: ["a", "b"], avisadoEn: t0.toISOString() };
    expect(decidirAviso({ claves: ["b", "a", "b"], recordado: antes, ahora: despues(1) }).avisar).toBe(false);
  });

  it("una fecha del futuro (el reloj se atrasó) no deja al problema sin recordatorio", () => {
    const d = decidirAviso({ claves: CREDITOS, recordado: { claves: CREDITOS, avisadoEn: despues(5).toISOString() }, ahora: t0 });
    expect(d).toMatchObject({ avisar: true, motivo: "recordatorio" });
  });

  it("el portero que se apaga avisa, el que después pasa a Pollar avisa de nuevo, y el que vuelve a pagar no avisa", () => {
    const apagado = decidirAviso({ claves: ["modo:apagado"], recordado: sinRecordar(), ahora: t0 });
    expect(apagado).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["modo:apagado"] });
    const pollar = decidirAviso({ claves: ["modo:pollar"], recordado: apagado.siguiente, ahora: despues(1) });
    expect(pollar).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["modo:pollar"] });
    const vuelve = decidirAviso({ claves: [], recordado: pollar.siguiente, ahora: despues(2) });
    expect(vuelve).toMatchObject({ avisar: false, motivo: "sin-problemas", siguiente: sinRecordar() });
  });

  it("si el portero no contesta, lo ya avisado se conserva: no se olvida por no poder mirar", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const sinLectura = decidirAviso({ claves: ["sin-lectura"], recordado: antes, ahora: despues(1) });
    expect(sinLectura).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["sin-lectura"] });
    expect(sinLectura.siguiente.claves).toEqual(["creditos-bajos", "sin-lectura"]);
    // Sigue sin contestar: no se vuelve a avisar y se sigue conservando.
    const otra = decidirAviso({ claves: ["sin-lectura"], recordado: sinLectura.siguiente, ahora: despues(2) });
    expect(otra).toMatchObject({ avisar: false, motivo: "ya-avisado" });
    expect(otra.siguiente.claves).toEqual(["creditos-bajos", "sin-lectura"]);
    // Vuelve con lo mismo de antes: ya estaba avisado.
    const vuelve = decidirAviso({ claves: CREDITOS, recordado: otra.siguiente, ahora: despues(3) });
    expect(vuelve).toMatchObject({ avisar: false, motivo: "ya-avisado" });
    expect(vuelve.siguiente.claves).toEqual(CREDITOS);
  });

  it("solo se conserva cuando la única clave es sin-lectura: con otro problema, lo arreglado se olvida", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: ["sin-lectura", "respuesta-invalida"], recordado: antes, ahora: despues(1) });
    expect(d.siguiente.claves).toEqual(["respuesta-invalida", "sin-lectura"]);
    // Y sin problemas se olvida todo, como siempre.
    expect(decidirAviso({ claves: [], recordado: antes, ahora: despues(1) }).siguiente).toEqual(sinRecordar());
  });

  it("sin usar la memoria (corrida a mano o repetida) avisa siempre que hay un problema, y lo guarda igual", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(1), usarMemoria: false });
    expect(d).toMatchObject({ avisar: true, motivo: "sin-memoria", nuevos: CREDITOS });
    expect(d.siguiente).toEqual({ claves: CREDITOS, avisadoEn: despues(1).toISOString() });
    // Sin problemas no avisa: se arregló.
    expect(decidirAviso({ claves: [], recordado: antes, ahora: despues(1), usarMemoria: false })).toMatchObject({ avisar: false, motivo: "sin-problemas" });
    // Y aunque no decida con la memoria, no la pierde si el portero no contesta.
    const sinLectura = decidirAviso({ claves: ["sin-lectura"], recordado: antes, ahora: despues(1), usarMemoria: false });
    expect(sinLectura.avisar).toBe(true);
    expect(sinLectura.siguiente.claves).toEqual(["creditos-bajos", "sin-lectura"]);
  });
});

describe("leerRecordado y escribirRecordado", () => {
  it("lo escrito se lee igual, con las claves ordenadas", () => {
    const r = { claves: ["a", "b"], avisadoEn: "2026-11-11T14:23:00.000Z" };
    expect(leerRecordado(escribirRecordado(r))).toEqual(r);
    expect(leerRecordado(JSON.stringify({ claves: ["b", "a"], avisadoEn: r.avisadoEn }))).toEqual(r);
  });

  it("un archivo vacío, roto o con otra forma es como si nada se hubiera avisado", () => {
    const malos = [
      "",
      "no es json",
      "null",
      "[]",
      "{}",
      '{"claves":"x","avisadoEn":"2026-11-11T00:00:00Z"}',
      '{"claves":[1],"avisadoEn":"2026-11-11T00:00:00Z"}',
      '{"claves":["a"],"avisadoEn":"ayer"}',
      '{"claves":["a"]}',
    ];
    for (const malo of malos) expect(leerRecordado(malo), JSON.stringify(malo)).toEqual(sinRecordar());
  });
});

describe("principal: lee el archivo y sale con 1 si hay problemas", () => {
  const dir = mkdtempSync(join(tmpdir(), "tinkazo-vigilar-portero-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const archivo = (nombre, contenido) => {
    const f = join(dir, nombre);
    writeFileSync(f, contenido);
    return f;
  };

  it("bien, 0; con un problema, 1; un archivo que no es JSON o que falta, 1", () => {
    const lineas = [];
    const log = (s) => lineas.push(String(s));
    expect(principal([archivo("bien.json", JSON.stringify(bien()))], { log })).toBe(0);
    expect(lineas.join("\n")).toMatch(/Sin problemas/);
    expect(principal([archivo("mal.json", JSON.stringify(bien({ firmasSinExplicar: 40 })))], { log })).toBe(1);
    expect(lineas.join("\n")).toMatch(/Problema: /);
    expect(principal([archivo("roto.json", "no es json")], { log })).toBe(1);
    expect(principal([join(dir, "no-existe.json")], { log })).toBe(1);
    expect(principal([], { log })).toBe(1);
  });

  it("el registro nunca lleva una cifra: ni créditos, ni piso, ni saldo, ni firmas, ni una dirección", () => {
    const lineas = [];
    const log = (s) => lineas.push(String(s));
    const estado = bien({
      alerta: true,
      motivoAlerta: "saldo-bajo",
      balanceStroops: "17654321",
      patrocinadora: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
      creditos: 2431,
      piso: 2000,
      margen: 431,
      altasPausadas: true,
      firmasSinExplicar: 77,
    });
    expect(principal([archivo("cifras.json", JSON.stringify(estado))], { log, ahora: new Date("2026-11-11T14:23:00Z") })).toBe(1);
    const texto = lineas.join("\n");
    for (const cifra of ["2431", "2000", "431", "17654321", "77", "GABCDEF", "500000000", "200000000", "9000"]) expect(texto, cifra).not.toContain(cifra);
    expect(sinFechas(texto)).not.toMatch(/\d/);
    // Y un estado que está bien tampoco las muestra.
    lineas.length = 0;
    expect(principal([archivo("bien-2.json", JSON.stringify(bien()))], { log })).toBe(0);
    expect(lineas.join("\n")).not.toMatch(/\d/);
  });

  it("si no se pudo leer, el registro dice que no contestó sin copiar lo que había en el archivo", () => {
    const lineas = [];
    const log = (s) => lineas.push(String(s));
    expect(principal([archivo("roto-2.json", '{"creditos": 2431, "balanceStroops": "17654321" oops')], { log })).toBe(1);
    const texto = lineas.join("\n");
    expect(texto).toMatch(/No se pudo leer la respuesta del portero/);
    expect(texto).not.toContain("2431");
    expect(texto).not.toContain("17654321");
    expect(texto).not.toContain(dir);
  });
});

describe("principal con lo avisado de la corrida anterior", () => {
  const dir = mkdtempSync(join(tmpdir(), "tinkazo-vigilar-portero-memoria-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const hora = 3_600_000;
  const t0 = new Date("2026-11-11T14:23:00Z");
  const despues = (horas) => new Date(t0.getTime() + horas * hora);
  const estado = (nombre, e) => {
    const f = join(dir, nombre);
    writeFileSync(f, JSON.stringify(e));
    return f;
  };

  /** Una corrida entera: el mismo `/estado`, la misma memoria en disco, y la hora. */
  function corrida(memoria, archivo, ahora, extra = []) {
    const lineas = [];
    const codigo = principal([archivo, "--anterior", memoria, "--guardar", memoria, ...extra], { log: (s) => lineas.push(String(s)), ahora });
    return { codigo, texto: lineas.join("\n") };
  }

  it("los créditos bajos de hoy: avisa la primera vez, no avisa una hora después y avisa al día siguiente", () => {
    const memoria = join(dir, "carpeta", "avisado.json");
    const mal = estado("creditos.json", bien({ creditos: 2500, piso: 2000 }));
    const primera = corrida(memoria, mal, t0);
    expect(primera.codigo).toBe(1);
    expect(primera.texto).toMatch(/Problema: los créditos de Pollar están bajos/);
    expect(existsSync(memoria)).toBe(true);

    // Una hora después, con otro saldo: el mismo problema. Sale bien y dice que ya se avisó.
    const otra = corrida(memoria, estado("creditos-2.json", bien({ creditos: 2431, piso: 2000 })), despues(1));
    expect(otra.codigo).toBe(0);
    expect(otra.texto).toMatch(/Problema: los créditos de Pollar están bajos/);
    expect(otra.texto).toMatch(/Ya se avisó de esto el 2026-11-11T14:23:00.000Z/);
    expect(otra.texto).toMatch(/Esta corrida sale bien/);

    expect(corrida(memoria, mal, despues(12)).codigo).toBe(0);
    const manana = corrida(memoria, mal, despues(24));
    expect(manana.codigo).toBe(1);
    expect(manana.texto).toMatch(/pasadas 23 horas/);
    expect(corrida(memoria, mal, despues(25)).codigo).toBe(0);
  });

  it("los créditos bajos ya avisados y una hora después bajo el piso: avisa, porque empeoró", () => {
    const memoria = join(dir, "avisado-empeora-creditos.json");
    expect(corrida(memoria, estado("c-bajos.json", bien({ creditos: 2500, piso: 2000 })), t0).codigo).toBe(1);
    const bajoElPiso = estado("c-bajo-el-piso.json", bien({ creditos: 1500, piso: 2000 }));
    const empeora = corrida(memoria, bajoElPiso, despues(1));
    expect(empeora.codigo).toBe(1);
    expect(empeora.texto).toMatch(/por debajo del piso/);
    expect(empeora.texto).toMatch(/Es un problema que no se había avisado/);
    // Con menos créditos todavía, es el mismo problema: no avisa.
    expect(corrida(memoria, estado("c-bajo-el-piso-2.json", bien({ creditos: 600, piso: 2000 })), despues(2)).codigo).toBe(0);
  });

  it("las firmas sin explicar: de 11 a 60 avisa, de 11 a 14 no", () => {
    const memoria = join(dir, "avisado-firmas.json");
    expect(corrida(memoria, estado("f-11.json", bien({ firmasSinExplicar: 11 })), t0).codigo).toBe(1);
    expect(corrida(memoria, estado("f-14.json", bien({ firmasSinExplicar: 14 })), despues(1)).codigo).toBe(0);
    expect(corrida(memoria, estado("f-60.json", bien({ firmasSinExplicar: 60 })), despues(2)).codigo).toBe(1);
    expect(corrida(memoria, estado("f-70.json", bien({ firmasSinExplicar: 70 })), despues(3)).codigo).toBe(0);
    expect(corrida(memoria, estado("f-250.json", bien({ firmasSinExplicar: 250 })), despues(4)).codigo).toBe(1);
    expect(corrida(memoria, estado("f-251.json", bien({ firmasSinExplicar: 251 })), despues(5)).codigo).toBe(0);
  });

  it("la patrocinadora que de baja pasa a casi sin saldo, y las altas que se pausan: avisan", () => {
    const memoria = join(dir, "avisado-patrocinadora.json");
    expect(corrida(memoria, estado("p-baja.json", patrocinadoraBaja("150000000")), t0).codigo).toBe(1);
    expect(corrida(memoria, estado("p-baja-2.json", patrocinadoraBaja("140000000")), despues(1)).codigo).toBe(0);
    const casi = corrida(memoria, estado("p-casi.json", patrocinadoraBaja("40000000")), despues(2));
    expect(casi.codigo).toBe(1);
    expect(casi.texto).toMatch(/casi no le queda saldo/);
    const pausadas = corrida(memoria, estado("p-pausadas.json", { ...patrocinadoraBaja("40000000"), altasPausadas: true }), despues(3));
    expect(pausadas.codigo).toBe(1);
    expect(pausadas.texto).toMatch(/pausadas a mano/);
  });

  it("se arregla y vuelve: la que se arregló deja la memoria vacía y la que vuelve avisa", () => {
    const memoria = join(dir, "avisado-2.json");
    const mal = estado("mal.json", bien({ firmasSinExplicar: 40 }));
    const ok = estado("ok.json", bien());
    expect(corrida(memoria, mal, t0).codigo).toBe(1);
    const sana = corrida(memoria, ok, despues(1));
    expect(sana.codigo).toBe(0);
    expect(JSON.parse(readFileSync(memoria, "utf8"))).toEqual({ claves: [], avisadoEn: null });
    expect(corrida(memoria, mal, despues(2)).codigo).toBe(1);
  });

  it("un problema distinto avisa aunque el anterior se haya avisado hace una hora", () => {
    const memoria = join(dir, "avisado-3.json");
    expect(corrida(memoria, estado("a.json", bien({ creditos: 100 })), t0).codigo).toBe(1);
    const otro = estado("b.json", bien({ creditos: 100, patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } }));
    expect(corrida(memoria, otro, despues(1)).codigo).toBe(1);
  });

  it("el portero que no contesta (sin archivo) es un problema que se avisa una vez", () => {
    const memoria = join(dir, "avisado-4.json");
    const falta = join(dir, "no-hay.json");
    expect(corrida(memoria, falta, t0).codigo).toBe(1);
    const siguiente = corrida(memoria, falta, despues(1));
    expect(siguiente.codigo).toBe(0);
    expect(siguiente.texto).toMatch(/No se pudo leer/);
    expect(siguiente.texto).toMatch(/Ya se avisó/);
  });

  it("si el portero no contesta una hora, no se olvida lo que ya se avisó: al volver con lo mismo, no avisa", () => {
    const memoria = join(dir, "avisado-sin-lectura.json");
    const mal = estado("sl-mal.json", bien({ creditos: 2500, piso: 2000 }));
    expect(corrida(memoria, mal, t0).codigo).toBe(1);
    const caido = corrida(memoria, join(dir, "no-contesto.json"), despues(1));
    expect(caido.codigo).toBe(1);
    expect(caido.texto).toMatch(/No se pudo leer/);
    expect(JSON.parse(readFileSync(memoria, "utf8")).claves).toEqual(["creditos-bajos", "sin-lectura"]);
    const vuelve = corrida(memoria, mal, despues(2));
    expect(vuelve.codigo).toBe(0);
    expect(vuelve.texto).toMatch(/Ya se avisó/);
    // Ya no está caído: sin-lectura se olvidó, y si vuelve a caer, avisa.
    expect(JSON.parse(readFileSync(memoria, "utf8")).claves).toEqual(["creditos-bajos"]);
    expect(corrida(memoria, join(dir, "no-contesto.json"), despues(3)).codigo).toBe(1);
  });

  it("una corrida a mano o repetida no usa la memoria: con un problema falla aunque ya se haya avisado, y lo guarda", () => {
    const memoria = join(dir, "avisado-a-mano.json");
    const mal = estado("am-mal.json", bien({ creditos: 2500, piso: 2000 }));
    expect(corrida(memoria, mal, t0).codigo).toBe(1);
    // La del reloj, una hora después: ya avisado, sale bien.
    expect(corrida(memoria, mal, despues(1)).codigo).toBe(0);
    // A mano: quien cargó créditos y comprueba tiene que ver que el problema sigue.
    const aMano = corrida(memoria, mal, despues(2), ["--sin-memoria"]);
    expect(aMano.codigo).toBe(1);
    expect(aMano.texto).toMatch(/Problema: los créditos de Pollar están bajos/);
    expect(aMano.texto).toMatch(/a mano o repetida/);
    expect(aMano.texto).not.toMatch(/Esta corrida sale bien/);
    // Se guardó: la corrida del reloj que sigue no repite el aviso.
    expect(JSON.parse(readFileSync(memoria, "utf8"))).toEqual({ claves: ["creditos-bajos"], avisadoEn: despues(2).toISOString() });
    expect(corrida(memoria, mal, despues(3)).codigo).toBe(0);
    // Arreglado, a mano sale bien.
    const arreglado = corrida(memoria, estado("am-ok.json", bien()), despues(4), ["--sin-memoria"]);
    expect(arreglado.codigo).toBe(0);
    expect(arreglado.texto).toMatch(/Sin problemas/);
  });

  it("sin archivo de antes, o con uno roto, nada se había avisado", () => {
    const mal = estado("mal-2.json", bien({ creditos: 100 }));
    expect(corrida(join(dir, "no-existe-antes.json"), mal, t0).codigo).toBe(1);
    const roto = join(dir, "roto-antes.json");
    writeFileSync(roto, "{no es json");
    expect(corrida(roto, mal, t0).codigo).toBe(1);
  });

  it("sin --anterior ni --guardar avisa siempre que hay un problema", () => {
    const mal = estado("mal-3.json", bien({ creditos: 100 }));
    const log = () => undefined;
    expect(principal([mal], { log, ahora: t0 })).toBe(1);
    expect(principal([mal], { log, ahora: despues(1) })).toBe(1);
  });

  it("lo que se guarda en la caché lleva claves de problemas y una fecha, nunca una cifra", () => {
    const memoria = join(dir, "avisado-sin-cifras.json");
    const e = {
      ...patrocinadoraBaja("17654321"),
      patrocinadora: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
      creditos: 1234,
      piso: 2000,
      altasPausadas: true,
      firmasSinExplicar: 777,
    };
    expect(corrida(memoria, estado("sc.json", e), t0).codigo).toBe(1);
    const guardado = readFileSync(memoria, "utf8");
    for (const cifra of ["17654321", "1234", "2000", "777", "GABCDEF"]) expect(guardado, cifra).not.toContain(cifra);
    const j = JSON.parse(guardado);
    expect(Object.keys(j).sort()).toEqual(["avisadoEn", "claves"]);
    expect(j.claves).toEqual(["altas-pausadas", "creditos-bajo-el-piso", "firmas-sin-explicar:mas-de-200", "patrocinadora-casi-sin-saldo"]);
  });
});

describe("principal con --resumen: lo que queda en el resumen de la corrida", () => {
  const dir = mkdtempSync(join(tmpdir(), "tinkazo-vigilar-portero-resumen-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const t0 = new Date("2026-11-11T14:23:00Z");
  const estado = (nombre, e) => {
    const f = join(dir, nombre);
    writeFileSync(f, JSON.stringify(e));
    return f;
  };
  const resumenDe = (argv, ahora = t0) => {
    const salida = join(dir, `resumen-${Math.random().toString(36).slice(2)}.md`);
    const codigo = principal([...argv, "--resumen", salida], { log: () => undefined, ahora });
    return { codigo, resumen: existsSync(salida) ? readFileSync(salida, "utf8") : null };
  };

  it("sin problemas dice «Sin problemas»", () => {
    const { codigo, resumen } = resumenDe([estado("r-bien.json", bien())]);
    expect(codigo).toBe(0);
    expect(resumen).toMatch(/Sin problemas/);
    expect(resumen).not.toMatch(/\d{3,}/);
  });

  it("con problemas, los lista y dice si ya se había avisado de cada uno", () => {
    const memoria = join(dir, "r-memoria.json");
    writeFileSync(memoria, escribirRecordado({ claves: ["creditos-bajos"], avisadoEn: t0.toISOString() }));
    const mal = estado("r-mal.json", bien({ creditos: 2500, piso: 2000, firmasSinExplicar: 60 }));
    const { codigo, resumen } = resumenDe([mal, "--anterior", memoria], new Date(t0.getTime() + 3_600_000));
    expect(codigo).toBe(1);
    expect(resumen).toMatch(/créditos de Pollar están bajos.*ya se había avisado/);
    expect(resumen).toMatch(/firmas de cuentas de Google sin explicar.*no se había avisado/);
    expect(resumen).toMatch(/se avisa/i);
  });

  it("en una corrida a mano dice que no usa lo avisado antes, y que por eso falla", () => {
    const memoria = join(dir, "r-memoria-2.json");
    writeFileSync(memoria, escribirRecordado({ claves: ["creditos-bajos"], avisadoEn: t0.toISOString() }));
    const mal = estado("r-mal-2.json", bien({ creditos: 2500, piso: 2000 }));
    const { codigo, resumen } = resumenDe([mal, "--anterior", memoria, "--sin-memoria"], new Date(t0.getTime() + 3_600_000));
    expect(codigo).toBe(1);
    expect(resumen).toMatch(/ya se había avisado/);
    expect(resumen).toMatch(/a mano o repetida/);
    expect(resumen).toMatch(/falla/);
  });

  it("el resumen tampoco lleva cifras ni direcciones, y se suma a lo que ya había en el archivo", () => {
    const salida = join(dir, "r-suma.md");
    writeFileSync(salida, "Lo que escribió otro paso\n");
    const e = bien({ alerta: true, motivoAlerta: "saldo-bajo", balanceStroops: "17654321", creditos: 2431, piso: 2000, firmasSinExplicar: 77, patrocinadora: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW" });
    expect(principal([estado("r-cifras.json", e), "--resumen", salida], { log: () => undefined, ahora: t0 })).toBe(1);
    const texto = readFileSync(salida, "utf8");
    expect(texto).toContain("Lo que escribió otro paso");
    for (const cifra of ["17654321", "2431", "2000", "77", "GABCDEF"]) expect(texto, cifra).not.toContain(cifra);
    expect(sinFechas(texto)).not.toMatch(/\d/);
  });
});

describe("el estado entero, como lo arma el portero de mainnet que está vivo", () => {
  /**
   * Todos los campos de `GET /v1/patrocinio/estado` con las altas prendidas y la venta cerrada: los de `servicio.ts`
   * (estado), `rutas-altas.ts` (resumen y vigilancia, con `compras` y `pagosConSaldo` dentro de `firmas`) y `admin.ts`
   * (resumen, con `pagosSueltos` y `ventaPausada`). `reservasCompras` llega solo con la compra con QR prendida o con
   * alguna en curso.
   */
  const vivo = () => ({
    modo: "portero",
    red: "mainnet",
    patrocinadora: "GPATROCINADORAINVENTADAPARALASPRUEBASDELPORTERODEMAINNET",
    llave: "GLLAVEINVENTADAPARALASPRUEBASDELPORTERODEMAINNETQUEFIRMA",
    balanceStroops: "500000000",
    saldoAlertaStroops: 200000000,
    alerta: false,
    topeGeneralStroops: 450000000,
    gasto24h: 1200000,
    sellos24h: 12,
    sorteos24h: 4,
    reservadoParaSorteos: 0,
    enElAire: 0,
    ventanaMs: 86400000,
    creditos: 9000,
    creditosLeidos: 1794450000000,
    piso: 2000,
    margen: 7000,
    altasPausadas: false,
    altas24h: 3,
    cuponesHoy: 3,
    cuponesCreadosHoy: 0,
    pagosSueltos: 0,
    ventaPausada: false,
    firmasSinExplicar: 0,
    firmas: { cobradas: 19, explicadas: 19, sellos: 12, sorteos: 4, activaciones: 3, compras: 0, pagosConSaldo: 0, completo: true, desde: 1794363600000 },
    patrocinioPollar: { esperado: true, prendidos: [] },
  });

  it("con todo en orden no hay ningún problema", () => {
    expect(revisarPortero(vivo())).toEqual({ problemas: [], claves: [] });
  });

  it("con la compra con QR prendida suma reservasCompras: en 0, o cubiertas con margen, no es ningún problema", () => {
    expect(revisarPortero({ ...vivo(), reservasCompras: 0 })).toEqual({ problemas: [], claves: [] });
    expect(revisarPortero({ ...vivo(), reservasCompras: 810 })).toEqual({ problemas: [], claves: [] });
    // Cubiertas, pero sin los 1.000 de margen encima: créditos bajos. Sin cubrir: su propia clave.
    expect(revisarPortero({ ...vivo(), reservasCompras: 6100 }).claves).toEqual(["creditos-bajos"]);
    expect(revisarPortero({ ...vivo(), reservasCompras: 7001 }).claves).toEqual(["creditos-bajo-las-reservas"]);
    // Lo que no es un número no inventa reservas.
    for (const raro of [null, "530", -5, Number.NaN]) expect(revisarPortero({ ...vivo(), reservasCompras: raro }).claves, String(raro)).toEqual([]);
  });

  it("sin los pagos sueltos ni la venta pausada (un portero que no los manda) tampoco: es un dato que falta, no un problema", () => {
    const { pagosSueltos: _p, ventaPausada: _v, ...sinLosDos } = vivo();
    expect(revisarPortero(sinLosDos)).toEqual({ problemas: [], claves: [] });
  });

  it("los pagos sueltos y la venta pausada no se miran todavía: la venta está cerrada", () => {
    expect(revisarPortero({ ...vivo(), pagosSueltos: 3, ventaPausada: true }).claves).toEqual([]);
  });

  it("la base de las pruebas tiene la misma forma en lo que se revisa", () => {
    for (const campo of ["modo", "red", "llave", "alerta", "creditos", "piso", "altasPausadas", "firmasSinExplicar", "patrocinioPollar", "pagosSueltos", "ventaPausada"]) {
      expect(Object.keys(bien()), campo).toContain(campo);
    }
  });
});
