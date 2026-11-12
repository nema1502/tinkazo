// Prueba la parte pura de la revisión del portero (scripts/lib/revision-portero.mjs): la que comparten el guion de
// GitHub (scripts/lib/vigilar-portero.mjs) y el Worker del vigilante (workers/vigilante). Que no traiga nada de Node
// (el Worker la empaqueta), que el guion use las mismas funciones y no una copia, y qué se da por arreglado.
// Las pruebas de la revisión en sí (cada problema, cuándo avisar) siguen en vigilar-portero.test.mjs, sin aflojar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as guion from "./vigilar-portero.mjs";
import * as puro from "./revision-portero.mjs";

const NOMBRES_COMPARTIDOS = [
  "MARGEN_MINIMO",
  "MAX_SIN_EXPLICAR",
  "TRAMOS_SIN_EXPLICAR",
  "RECORDATORIO_HORAS",
  "decidirAviso",
  "escribirRecordado",
  "leerRecordado",
  "revisarPortero",
  "sinRecordar",
];

describe("revision-portero.mjs: la parte pura", () => {
  it("no importa nada ni toca el proceso de Node: el Worker la empaqueta tal cual", () => {
    const fuente = readFileSync(new URL("./revision-portero.mjs", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/^\s*import\s/m);
    expect(fuente).not.toMatch(/\bimport\s*\(/);
    expect(fuente).not.toMatch(/\brequire\s*\(/);
    expect(fuente).not.toMatch(/\bnode:/);
    expect(fuente).not.toMatch(/\bprocess\b/);
    expect(fuente).not.toMatch(/\bconsole\b/);
  });

  it("el guion de GitHub usa las mismas funciones y constantes, no una copia", () => {
    for (const nombre of NOMBRES_COMPARTIDOS) {
      expect(puro[nombre], nombre).toBeDefined();
      expect(guion[nombre], nombre).toBe(puro[nombre]);
    }
  });

  it("la clave de que el portero no contestó es una sola, la misma que usa el guion", () => {
    expect(puro.SIN_LECTURA).toBe("sin-lectura");
    expect(puro.decidirAviso({ claves: [puro.SIN_LECTURA], ahora: new Date(0) }).siguiente.claves).toEqual(["sin-lectura"]);
  });
});

describe("prendidosLimpios: las banderas del patrocinio, como entran a la clave y al correo", () => {
  it("limpia, ordena y acota: caracteres de control a un espacio, 70 por bandera y diez como mucho", () => {
    expect(puro.prendidosLimpios(["sponsor_b", "sponsor_a"])).toEqual(["sponsor_a", "sponsor_b"]);
    expect(puro.prendidosLimpios(["sponsor_\r\tcon\u0000cosas", `sponsor_${"a".repeat(80)}`])).toEqual(["sponsor_ con cosas", `sponsor_${"a".repeat(62)}`]);
    const muchas = Array.from({ length: 30 }, (_, i) => `sponsor_${String(i).padStart(2, "0")}`);
    expect(puro.prendidosLimpios([...muchas].reverse())).toEqual(muchas.slice(0, 10));
  });

  it("lo que no es una lista queda en una lista vacía, y la clave usa la misma función", () => {
    for (const raro of [undefined, null, "sponsor_a", 7, {}]) expect(puro.prendidosLimpios(raro), String(raro)).toEqual([]);
    const prendidos = ["sponsor_z", "sponsor_y\n", ...Array.from({ length: 12 }, (_, i) => `sponsor_${String(i).padStart(2, "0")}`)];
    const clave = puro.revisarPortero({ red: "mainnet", modo: "portero", alerta: false, creditos: 9000, piso: 2000, firmasSinExplicar: 0, patrocinioPollar: { esperado: false, prendidos } }).claves;
    expect(clave).toEqual([`patrocinio-prendido:${puro.prendidosLimpios(prendidos).join(",")}`]);
  });

  it("el módulo la define una sola vez: ni el guion ni el Worker llevan su propia copia de la limpieza", () => {
    const worker = readFileSync(new URL("../../workers/vigilante/src/mensaje.ts", import.meta.url), "utf8");
    expect(worker).toContain("prendidosLimpios");
    expect(worker).not.toMatch(/\.map\(String\)/);
    expect(worker).not.toMatch(/\\u0000-\\u001f\\u007f-\\u009f/);
  });
});

describe("arreglados: qué problemas ya avisados dejaron de estar", () => {
  it("sin nada avisado no hay nada arreglado", () => {
    expect(puro.arreglados([], [])).toEqual([]);
    expect(puro.arreglados([], ["creditos-bajos"])).toEqual([]);
  });

  it("un problema avisado que ya no está se da por arreglado", () => {
    expect(puro.arreglados(["creditos-bajos"], [])).toEqual(["creditos-bajos"]);
    expect(puro.arreglados(["creditos-bajos", "altas-pausadas"], ["altas-pausadas"])).toEqual(["creditos-bajos"]);
    expect(puro.arreglados(["altas-pausadas", "creditos-bajos"], [])).toEqual(["altas-pausadas", "creditos-bajos"]);
  });

  it("uno que sigue, aunque más grave o menos grave, no está arreglado", () => {
    expect(puro.arreglados(["creditos-bajos"], ["creditos-bajo-el-piso"])).toEqual([]);
    expect(puro.arreglados(["creditos-bajo-el-piso"], ["creditos-bajos"])).toEqual([]);
    expect(puro.arreglados(["creditos-bajos"], ["creditos-sin-leer"])).toEqual([]);
    expect(puro.arreglados(["patrocinadora-baja:saldo-bajo"], ["patrocinadora-casi-sin-saldo"])).toEqual([]);
    expect(puro.arreglados(["firmas-sin-explicar:mas-de-10"], ["firmas-sin-explicar:mas-de-50"])).toEqual([]);
    expect(puro.arreglados(["patrocinio-prendido:sponsor_trustlines"], ["patrocinio-prendido:sponsor_all_contracts,sponsor_trustlines"])).toEqual([]);
  });

  it("el portero que pasa de apagado a Pollar sigue sin pagar: no se da por arreglado. Al volver a pagar, sí", () => {
    expect(puro.grupoDeClave("modo:apagado")).toBe(puro.grupoDeClave("modo:pollar"));
    expect(puro.arreglados(["modo:apagado"], ["modo:pollar"])).toEqual([]);
    expect(puro.arreglados(["modo:pollar"], [])).toEqual(["modo:pollar"]);
    expect(puro.arreglados(["modo:apagado", "portero-sin-llave"], ["modo:apagado"])).toEqual(["portero-sin-llave"]);
    expect(puro.grupoDeClave("portero-sin-llave")).not.toBe(puro.grupoDeClave("modo:apagado"));
  });

  it("un problema de otro grupo no tapa al arreglado", () => {
    expect(puro.arreglados(["creditos-bajos"], ["patrocinadora-baja:saldo-bajo"])).toEqual(["creditos-bajos"]);
  });

  it("si lo único que hay es que el portero no contesta, no se sabe qué se arregló", () => {
    expect(puro.arreglados(["creditos-bajos"], ["sin-lectura"])).toEqual([]);
    expect(puro.arreglados([], ["sin-lectura"])).toEqual([]);
  });

  it("el portero que vuelve a contestar es un arreglo, aunque siga el problema de antes", () => {
    expect(puro.arreglados(["creditos-bajos", "sin-lectura"], ["creditos-bajos"])).toEqual(["sin-lectura"]);
    expect(puro.arreglados(["sin-lectura"], [])).toEqual(["sin-lectura"]);
  });

  it("no depende del orden ni de las repeticiones", () => {
    expect(puro.arreglados(["b", "a", "b"], ["a"])).toEqual(["b"]);
  });
});

describe("grupoDeClave: las claves de un mismo problema que empeora o mejora", () => {
  it("junta los tramos de cada problema", () => {
    expect(puro.grupoDeClave("creditos-bajos")).toBe(puro.grupoDeClave("creditos-bajo-el-piso"));
    expect(puro.grupoDeClave("patrocinadora-baja:saldo-bajo")).toBe(puro.grupoDeClave("patrocinadora-casi-sin-saldo"));
    expect(puro.grupoDeClave("firmas-sin-explicar:mas-de-10")).toBe(puro.grupoDeClave("firmas-sin-explicar:mas-de-200"));
    expect(puro.grupoDeClave("creditos-bajos")).not.toBe(puro.grupoDeClave("altas-pausadas"));
  });
});
