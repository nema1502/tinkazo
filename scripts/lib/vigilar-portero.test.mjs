// Prueba la revisión del portero de mainnet (scripts/lib/vigilar-portero.mjs) con respuestas de `/estado`
// inventadas: ninguna prueba le habla al portero. Prueba también cuándo avisar: un problema nuevo, el mismo que sigue
// (un recordatorio cada 23 horas) y el que se arregla y vuelve.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MARGEN_MINIMO,
  MAX_SIN_EXPLICAR,
  RECORDATORIO_HORAS,
  decidirAviso,
  escribirRecordado,
  leerRecordado,
  principal,
  revisarPortero,
  sinRecordar,
} from "./vigilar-portero.mjs";

/** Un `/estado` del portero de mainnet con todo en orden. */
const bien = (extra = {}) => ({
  modo: "portero",
  red: "mainnet",
  alerta: false,
  balanceStroops: "500000000",
  creditos: 9000,
  piso: 2000,
  margen: 7000,
  firmasSinExplicar: 2,
  firmas: { cobradas: 30, explicadas: 28, sellos: 20, sorteos: 6, activaciones: 2, completo: true, desde: 0 },
  patrocinioPollar: { esperado: true, prendidos: [] },
  ...extra,
});

describe("revisarPortero", () => {
  it("con todo en orden no hay problemas, y el resumen dice las cifras", () => {
    const r = revisarPortero(bien());
    expect(r.problemas).toEqual([]);
    expect(r.resumen).toMatch(/9000/);
    expect(r.resumen).toMatch(/2000/);
  });

  it(`los créditos por debajo del piso más ${MARGEN_MINIMO}: falla; justo en el borde, no`, () => {
    expect(MARGEN_MINIMO).toBe(1000);
    expect(revisarPortero(bien({ creditos: 2999, piso: 2000 })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ creditos: 3000, piso: 2000 })).problemas).toEqual([]);
    // Sin saldo leído (Pollar caído), también: no se sabe.
    expect(revisarPortero(bien({ creditos: null })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ piso: undefined })).problemas).toHaveLength(1);
  });

  it("la patrocinadora baja o sin leer: falla", () => {
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-bajo" })).problemas[0]).toMatch(/saldo-bajo/);
    expect(revisarPortero(bien({ alerta: undefined })).problemas).toHaveLength(1);
  });

  it(`más de ${MAX_SIN_EXPLICAR} firmas sin explicar: falla; sin la vigilancia, también`, () => {
    expect(MAX_SIN_EXPLICAR).toBe(10);
    expect(revisarPortero(bien({ firmasSinExplicar: 10 })).problemas).toEqual([]);
    expect(revisarPortero(bien({ firmasSinExplicar: 11 })).problemas[0]).toMatch(/11/);
    expect(revisarPortero(bien({ firmasSinExplicar: null })).problemas).toHaveLength(1);
  });

  it("el patrocinio de la app prendido, o sin leer: falla y nombra lo prendido", () => {
    expect(revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } })).problemas[0]).toMatch(/sponsor_trustlines/);
    expect(revisarPortero(bien({ patrocinioPollar: null })).problemas).toHaveLength(1);
  });

  it("si no es el portero de mainnet (o no trae nada de las altas), falla: no se mira el portero equivocado", () => {
    expect(revisarPortero(bien({ red: "testnet" })).problemas.length).toBeGreaterThan(0);
    expect(revisarPortero({ red: "mainnet", alerta: false }).problemas.length).toBeGreaterThanOrEqual(3);
    expect(revisarPortero(null).problemas.length).toBeGreaterThan(0);
  });

  it("con la página de movimientos llena lo avisa en el resumen, sin fallar por eso", () => {
    const r = revisarPortero(bien({ firmas: { ...bien().firmas, completo: false } }));
    expect(r.problemas).toEqual([]);
    expect(r.resumen).toMatch(/puede haber más/);
  });
});

describe("las claves de los problemas", () => {
  it("hay una clave por problema, en el mismo orden, y ninguna con todo en orden", () => {
    expect(revisarPortero(bien()).claves).toEqual([]);
    const r = revisarPortero(bien({ creditos: 100, firmasSinExplicar: 40 }));
    expect(r.problemas).toHaveLength(2);
    expect(r.claves).toEqual(["creditos-bajos", "firmas-sin-explicar"]);
  });

  it("el mismo problema con otras cifras tiene la misma clave: las cifras se mueven y el problema es el mismo", () => {
    expect(revisarPortero(bien({ creditos: 2500 })).claves).toEqual(revisarPortero(bien({ creditos: 2310 })).claves);
    expect(revisarPortero(bien({ firmasSinExplicar: 11 })).claves).toEqual(revisarPortero(bien({ firmasSinExplicar: 300 })).claves);
  });

  it("otro problema, otra clave: sin leer no es lo mismo que bajo, ni una causa de alerta que otra", () => {
    const bajos = revisarPortero(bien({ creditos: 2500 })).claves;
    const sinLeer = revisarPortero(bien({ creditos: null })).claves;
    expect(sinLeer).not.toEqual(bajos);
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-bajo" })).claves).not.toEqual(revisarPortero(bien({ alerta: true, motivoAlerta: "sin-lectura" })).claves);
    const uno = revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } })).claves;
    const dos = revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines", "sponsor_accounts"] } })).claves;
    expect(uno).not.toEqual(dos);
  });

  it("una respuesta que no es un objeto tiene su clave", () => {
    expect(revisarPortero(null).claves).toEqual(["respuesta-invalida"]);
  });
});

describe("decidirAviso: cuándo hace falta el correo", () => {
  const hora = 3_600_000;
  const t0 = new Date("2026-11-11T14:23:00Z");
  const despues = (horas) => new Date(t0.getTime() + horas * hora);
  const CREDITOS = ["creditos-bajos"];

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
    const d = decidirAviso({ claves: ["firmas-sin-explicar"], recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["firmas-sin-explicar"] });
    expect(d.siguiente.claves).toEqual(["firmas-sin-explicar"]);
  });

  it("se suma un problema a otro que ya se avisó: avisa por el nuevo", () => {
    const antes = { claves: CREDITOS, avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: ["firmas-sin-explicar", ...CREDITOS], recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["firmas-sin-explicar"] });
    expect(d.siguiente.claves).toEqual(["creditos-bajos", "firmas-sin-explicar"]);
  });

  it("se arregla uno de dos: no avisa, y si vuelve es nuevo", () => {
    const antes = { claves: ["creditos-bajos", "firmas-sin-explicar"], avisadoEn: t0.toISOString() };
    const d = decidirAviso({ claves: CREDITOS, recordado: antes, ahora: despues(1) });
    expect(d).toMatchObject({ avisar: false, motivo: "ya-avisado" });
    expect(d.siguiente).toEqual({ claves: CREDITOS, avisadoEn: t0.toISOString() });
    const vuelve = decidirAviso({ claves: ["creditos-bajos", "firmas-sin-explicar"], recordado: d.siguiente, ahora: despues(2) });
    expect(vuelve).toMatchObject({ avisar: true, motivo: "nuevo", nuevos: ["firmas-sin-explicar"] });
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
    expect(principal([archivo("mal.json", JSON.stringify(bien({ firmasSinExplicar: 40 })))], { log })).toBe(1);
    expect(lineas.join("\n")).toMatch(/40/);
    expect(principal([archivo("roto.json", "no es json")], { log })).toBe(1);
    expect(principal([join(dir, "no-existe.json")], { log })).toBe(1);
    expect(principal([], { log })).toBe(1);
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
  function corrida(memoria, archivo, ahora) {
    const lineas = [];
    const codigo = principal([archivo, "--anterior", memoria, "--guardar", memoria], { log: (s) => lineas.push(String(s)), ahora });
    return { codigo, texto: lineas.join("\n") };
  }

  it("los créditos bajos de hoy: avisa la primera vez, no avisa una hora después y avisa al día siguiente", () => {
    const memoria = join(dir, "carpeta", "avisado.json");
    const mal = estado("creditos.json", bien({ creditos: 2500, piso: 2000 }));
    const primera = corrida(memoria, mal, t0);
    expect(primera.codigo).toBe(1);
    expect(primera.texto).toMatch(/Problema: los créditos de Pollar \(2500\)/);
    expect(existsSync(memoria)).toBe(true);

    // Una hora después, con otro saldo: el mismo problema. Sale bien, con las cifras y diciendo que ya se avisó.
    const otra = corrida(memoria, estado("creditos-2.json", bien({ creditos: 2431, piso: 2000 })), despues(1));
    expect(otra.codigo).toBe(0);
    expect(otra.texto).toMatch(/créditos 2431, piso 2000/);
    expect(otra.texto).toMatch(/Problema: los créditos de Pollar \(2431\)/);
    expect(otra.texto).toMatch(/Ya se avisó de esto el 2026-11-11T14:23:00.000Z/);
    expect(otra.texto).toMatch(/Esta corrida sale bien/);

    expect(corrida(memoria, mal, despues(12)).codigo).toBe(0);
    const manana = corrida(memoria, mal, despues(24));
    expect(manana.codigo).toBe(1);
    expect(manana.texto).toMatch(/pasadas 23 horas/);
    expect(corrida(memoria, mal, despues(25)).codigo).toBe(0);
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
});
