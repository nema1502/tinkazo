// La vuelta del vigilante, de punta a punta, con el portero, el KV, el correo, Telegram y el reloj de mentira
// (mundo-falso.ts): ninguna prueba toca una red de verdad. Cada tipo de problema, que no avisa dos veces lo mismo, el
// recordatorio a las 23 horas, el arreglo, el portero que no contesta, el resumen del día, el envío que falla y se
// reintenta, y que el registro nunca lleva un secreto.
import { describe, expect, it } from "vitest";
import {
  BOT,
  CHAT,
  CLAVE_DE_OPERAR,
  DESTINO,
  HORA,
  MINUTO,
  OTRO_DESTINO,
  PORTERO,
  T0,
  estadoBien,
  mundoFalso,
} from "./mundo-falso";
import { CLAVE_MEMORIA, RESUMEN_HORAS_POR_DEFECTO, SIN_RESPUESTA_MAX, inicioDeResumen } from "./vuelta";

const creditosBajos = (extra: Record<string, unknown> = {}) => estadoBien({ creditos: 2400, piso: 2000, margen: 400, ...extra });
const bajoElPiso = () => estadoBien({ creditos: 1800, piso: 2000, margen: -200 });

describe("una vuelta con todo en orden", () => {
  it("le pide el estado al portero de mainnet con la clave de operar y no manda nada", async () => {
    const m = mundoFalso();
    const r = await m.vuelta();
    expect(m.portero.llamadas).toEqual([{ url: `${PORTERO}/v1/patrocinio/estado`, autorizacion: `Bearer ${CLAVE_DE_OPERAR}`, metodo: "GET" }]);
    expect(m.correo.enviados).toEqual([]);
    expect(r.salioBien).toBe(true);
  });

  it("deja anotada la hora de la vuelta y que salió bien", async () => {
    const m = mundoFalso();
    await m.vuelta();
    const guardado = await m.memoria();
    expect(guardado.ultimaVuelta).toBe(new Date(T0).toISOString());
    expect(guardado.salioBien).toBe(true);
    expect(guardado.claves).toEqual([]);
    expect(guardado.pendientes).toEqual([]);
  });

  it("escribe el KV una sola vez por vuelta, con o sin aviso", async () => {
    const m = mundoFalso();
    for (let i = 0; i < 4; i++) {
      const antes = m.libro.escrituras;
      await m.vueltaEn(10);
      expect(m.libro.escrituras - antes).toBe(1);
    }
    m.portero.estado = creditosBajos();
    const antes = m.libro.escrituras;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.libro.escrituras - antes).toBe(1);
  });

  it("sin aviso que mandar ni resumen, guarda sin releer nada de más: una lectura del KV", async () => {
    const m = mundoFalso();
    const antes = m.libro.lecturas;
    await m.vuelta();
    expect(m.libro.lecturas - antes).toBe(1);
  });
});

/** Cada tipo de problema que revisa el guion de GitHub, con lo que tiene que decir el correo. */
const CASOS: Array<{ nombre: string; estado: () => unknown; asunto: RegExp; cifras: string[]; clave: string }> = [
  { nombre: "créditos bajos", estado: () => creditosBajos(), asunto: /créditos de Pollar bajos/i, cifras: ["2.400", "2.000", "400"], clave: "creditos-bajos" },
  { nombre: "créditos bajo el piso", estado: () => bajoElPiso(), asunto: /bajo el piso/i, cifras: ["1.800", "2.000", "-200"], clave: "creditos-bajo-el-piso" },
  {
    nombre: "créditos que no cubren las compras con QR en curso",
    estado: () => estadoBien({ creditos: 2400, piso: 2000, margen: 400, reservasCompras: 530 }),
    asunto: /^Créditos de Pollar bajo las compras en curso: cargá ya$/,
    cifras: ["2.400", "2.000", "530", "faltan 130"],
    clave: "creditos-bajo-las-reservas",
  },
  { nombre: "créditos sin leer", estado: () => estadoBien({ creditos: null, margen: null }), asunto: /créditos de Pollar/i, cifras: [], clave: "creditos-sin-leer" },
  {
    nombre: "la cuenta que paga, con poco saldo",
    estado: () => estadoBien({ alerta: true, motivoAlerta: "saldo-bajo", balanceStroops: "150000000" }),
    asunto: /cuenta que paga/i,
    cifras: ["15,0 XLM", "20,0 XLM"],
    clave: "patrocinadora-baja:saldo-bajo",
  },
  {
    nombre: "la cuenta que paga, casi sin saldo",
    estado: () => estadoBien({ alerta: true, motivoAlerta: "saldo-bajo", balanceStroops: "50000000" }),
    asunto: /casi no le queda saldo/i,
    cifras: ["5,0 XLM"],
    clave: "patrocinadora-casi-sin-saldo",
  },
  {
    nombre: "la cuenta que paga, sin leer",
    estado: () => estadoBien({ alerta: true, motivoAlerta: "saldo-no-leido", balanceStroops: null }),
    asunto: /cuenta que paga/i,
    cifras: [],
    clave: "patrocinadora-baja:saldo-no-leido",
  },
  { nombre: "las altas pausadas a mano", estado: () => estadoBien({ altasPausadas: true }), asunto: /altas están pausadas/i, cifras: [], clave: "altas-pausadas" },
  { nombre: "firmas sin explicar, tramo bajo", estado: () => estadoBien({ firmasSinExplicar: 14 }), asunto: /sin explicar/i, cifras: ["14"], clave: "firmas-sin-explicar:mas-de-10" },
  { nombre: "firmas sin explicar, tramo medio", estado: () => estadoBien({ firmasSinExplicar: 80 }), asunto: /sin explicar/i, cifras: ["80"], clave: "firmas-sin-explicar:mas-de-50" },
  { nombre: "firmas sin explicar, tramo alto", estado: () => estadoBien({ firmasSinExplicar: 300 }), asunto: /sin explicar/i, cifras: ["300"], clave: "firmas-sin-explicar:mas-de-200" },
  { nombre: "firmas sin comparar", estado: () => estadoBien({ firmasSinExplicar: null }), asunto: /comparar/i, cifras: [], clave: "firmas-sin-comparar" },
  {
    nombre: "el patrocinio de la app prendido",
    estado: () => estadoBien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } }),
    asunto: /patrocinio/i,
    cifras: ["sponsor_trustlines"],
    clave: "patrocinio-prendido:sponsor_trustlines",
  },
  { nombre: "el patrocinio de la app sin leer", estado: () => estadoBien({ patrocinioPollar: null }), asunto: /patrocinio/i, cifras: [], clave: "patrocinio-sin-leer" },
  { nombre: "un portero que no es el de mainnet", estado: () => estadoBien({ red: "testnet" }), asunto: /equivocado/i, cifras: ["testnet"], clave: "no-es-mainnet" },
  { nombre: "una respuesta que no es un objeto", estado: () => null, asunto: /no se entiende/i, cifras: [], clave: "respuesta-invalida" },
  { nombre: "el portero apagado", estado: () => estadoBien({ modo: "apagado" }), asunto: /^El portero está apagado: nadie puede sellar$/, cifras: ["Portero: apagado"], clave: "modo:apagado" },
  { nombre: "el portero devuelto a Pollar", estado: () => estadoBien({ modo: "pollar" }), asunto: /^El portero no paga: lo pasaron a Pollar$/, cifras: ["Portero: devuelto a Pollar"], clave: "modo:pollar" },
  { nombre: "un portero que no dice si paga", estado: () => estadoBien({ modo: undefined }), asunto: /^No se puede leer si el portero paga$/, cifras: ["Portero: sin leer"], clave: "modo:sin-leer" },
  { nombre: "el portero sin su llave", estado: () => estadoBien({ llave: null }), asunto: /^El portero no tiene la llave: nadie puede sellar$/, cifras: ["CLAVE_PATROCINADOR"], clave: "portero-sin-llave" },
];

describe("cada tipo de problema se avisa por correo", () => {
  for (const caso of CASOS) {
    it(`${caso.nombre}: un correo a la dirección de aviso, con las cifras y qué hacer`, async () => {
      const m = mundoFalso({ estado: caso.estado() });
      await m.vuelta();
      expect(m.correo.enviados).toHaveLength(1);
      const c = m.correo.enviados[0]!;
      expect(c.to).toEqual([DESTINO]);
      expect(c.subject).toMatch(caso.asunto);
      for (const cifra of caso.cifras) expect(c.text, cifra).toContain(cifra);
      expect(c.text).toMatch(/Qué hacer/);
      expect((await m.memoria()).claves).toContain(caso.clave);
    });
  }

  it("el correo sale desde la dirección del dominio con ruteo, con nombre, en texto plano y solo con lo que pide Cloudflare", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    const c = m.correo.enviados[0]!;
    expect(c.from).toEqual({ email: "avisos@tinkazo.app", name: "Vigilante de Tinkazo" });
    expect(Object.keys(c).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(c.text.length).toBeGreaterThan(80);
  });

  it("varios problemas a la vez van en un solo correo, y el asunto nombra el más grave", async () => {
    const m = mundoFalso({ estado: bajoElPiso() });
    m.portero.estado = estadoBien({ creditos: 1800, piso: 2000, margen: -200, altasPausadas: true, firmasSinExplicar: 20 });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    const c = m.correo.enviados[0]!;
    expect(c.subject).toMatch(/bajo el piso/i);
    expect(c.subject).toMatch(/y 2 más/);
    expect(c.text).toMatch(/altas/i);
    expect(c.text).toMatch(/sin explicar/i);
  });

  it("el correo lleva el saldo de la cuenta que paga, el piso y el margen aunque el problema sea otro", async () => {
    const m = mundoFalso({ estado: estadoBien({ altasPausadas: true }) });
    await m.vuelta();
    const texto = m.correo.enviados[0]!.text;
    expect(texto).toContain("50,0 XLM");
    expect(texto).toContain("9.000");
    expect(texto).toContain("2.000");
    expect(texto).toContain("7.000");
  });

  it("le manda a todas las direcciones de AVISAR_A, separadas por comas", async () => {
    const m = mundoFalso({ estado: creditosBajos(), env: { AVISAR_A: ` ${DESTINO} , ${OTRO_DESTINO} ` } });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.to).toEqual([DESTINO, OTRO_DESTINO]);
  });
});

describe("no avisa dos veces lo mismo", () => {
  it("el mismo problema en varias vueltas manda un solo correo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    for (let i = 0; i < 12; i++) await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("las cifras se mueven y es el mismo problema: no avisa de nuevo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = creditosBajos({ creditos: 2300, margen: 300 });
    await m.vueltaEn(10);
    m.portero.estado = creditosBajos({ creditos: 2100, margen: 100 });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("si empeora (de créditos bajos a bajo el piso) avisa de nuevo, y una sola vez", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = bajoElPiso();
    await m.vueltaEn(10);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados[1]!.subject).toMatch(/bajo el piso/i);
    expect(m.correo.enviados[1]!.subject).not.toMatch(/arreglado/i);
    // Y no manda un «arreglado» de los créditos bajos: es el mismo problema, más grave.
    expect(m.asuntos().filter((a) => /arreglado/i.test(a))).toEqual([]);
  });

  it("si aparece otro problema, avisa solo del nuevo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = creditosBajos({ altasPausadas: true });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados[1]!.subject).toMatch(/altas/i);
    expect(m.correo.enviados[1]!.subject).not.toMatch(/créditos/i);
  });
});

// Estas pruebas cruzan las 12:00 UTC y el resumen del día sale solo: acá se miran los avisos, sin los resúmenes.
describe("el recordatorio a las 23 horas", () => {
  it("el mismo problema sigue: a las 22 horas y 50 minutos no, a las 23 sí", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    await m.vueltaEn(22 * 60 + 50);
    expect(m.correo.avisos).toHaveLength(1);
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(2);
    expect(m.correo.avisos[1]!.subject).toMatch(/^Sigue: /);
    expect(m.correo.avisos[1]!.subject).toMatch(/créditos de Pollar bajos/i);
    expect(m.correo.avisos[1]!.text).toMatch(/sigue igual|sigue sin arreglar/i);
  });

  it("después del recordatorio, otras 23 horas de silencio", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    await m.vueltaEn(23 * 60);
    expect(m.correo.avisos).toHaveLength(2);
    await m.vueltaEn(22 * 60 + 50);
    expect(m.correo.avisos).toHaveLength(2);
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
  });
});

describe("el arreglo", () => {
  it("un problema que se arregla manda un aviso corto y se olvida", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = estadoBien();
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    const c = m.correo.enviados[1]!;
    expect(c.subject).toMatch(/^Arreglado: /);
    expect(c.subject).toMatch(/créditos de Pollar/i);
    expect(c.text).toMatch(/Ya no hay problemas/);
    expect(c.text.split("\n").length).toBeLessThan(25);
    expect((await m.memoria()).claves).toEqual([]);
    // Y no lo repite en la vuelta que viene.
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("si vuelve el problema, es nuevo y avisa", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = estadoBien();
    await m.vueltaEn(10);
    m.portero.estado = creditosBajos();
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(3);
    expect(m.correo.enviados[2]!.subject).toMatch(/créditos de Pollar bajos/i);
    expect(m.correo.enviados[2]!.subject).not.toMatch(/^Sigue/);
  });

  it("arregla uno y sigue otro: el aviso corto dice cuál sigue, y lo que sigue no se vuelve a avisar", async () => {
    const m = mundoFalso({ estado: creditosBajos({ altasPausadas: true }) });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    m.portero.estado = estadoBien({ altasPausadas: true });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    const c = m.correo.enviados[1]!;
    expect(c.subject).toMatch(/^Arreglado: /);
    expect(c.text).toMatch(/Sigue sin arreglar/);
    expect(c.text).toMatch(/altas/i);
    expect(c.text).not.toMatch(/Ya no hay problemas/);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("un problema nuevo y otro arreglado en la misma vuelta van en un solo correo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = estadoBien({ altasPausadas: true });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    const c = m.correo.enviados[1]!;
    expect(c.subject).toMatch(/altas/i);
    expect(c.text).toMatch(/Se arregló/);
    expect(c.text).toMatch(/créditos de Pollar/i);
  });
});

describe("el portero que no paga", () => {
  it("apagado: un solo correo, nada en la vuelta siguiente, el recordatorio a las 23 horas y el arreglo al encenderlo", async () => {
    const m = mundoFalso({ estado: estadoBien({ modo: "apagado" }) });
    await m.vuelta();
    expect(m.correo.avisos.map((c) => c.subject)).toEqual(["El portero está apagado: nadie puede sellar"]);
    expect(m.correo.avisos[0]!.text).toMatch(/a propósito/);
    expect(m.correo.avisos[0]!.text).toMatch(/encender/);
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(1);
    await m.vueltaEn(23 * 60 - 10);
    expect(m.correo.avisos).toHaveLength(2);
    expect(m.correo.avisos[1]!.subject).toBe("Sigue: El portero está apagado: nadie puede sellar");
    m.portero.estado = estadoBien();
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
    expect(m.correo.avisos[2]!.subject).toMatch(/^Arreglado: /);
    expect(m.correo.avisos[2]!.text).toMatch(/El portero volvió a pagar los sellos y los sorteos/);
    expect((await m.memoria()).claves).toEqual([]);
  });

  it("de apagado a Pollar: avisa como nuevo y no lo da por arreglado", async () => {
    const m = mundoFalso({ estado: estadoBien({ modo: "apagado" }) });
    await m.vuelta();
    m.portero.estado = estadoBien({ modo: "pollar" });
    await m.vueltaEn(10);
    expect(m.asuntos()).toEqual(["El portero está apagado: nadie puede sellar", "El portero no paga: lo pasaron a Pollar"]);
    expect(m.asuntos().filter((a) => /arreglado/i.test(a))).toEqual([]);
  });

  it("sin la llave: un solo aviso, y el arreglo cuando vuelve a tenerla", async () => {
    const m = mundoFalso({ estado: estadoBien({ llave: null }) });
    await m.vuelta();
    await m.vueltaEn(10);
    expect(m.asuntos()).toEqual(["El portero no tiene la llave: nadie puede sellar"]);
    m.portero.estado = estadoBien();
    await m.vueltaEn(10);
    expect(m.asuntos()).toHaveLength(2);
    expect(m.asuntos()[1]).toMatch(/^Arreglado: /);
  });

  it("apagado y sin llave a la vez: un correo, con el apagado en el asunto", async () => {
    const m = mundoFalso({ estado: estadoBien({ modo: "apagado", llave: null }) });
    await m.vuelta();
    expect(m.asuntos()).toEqual(["El portero está apagado: nadie puede sellar y 1 más"]);
    expect(m.correo.enviados[0]!.text).toMatch(/llave/);
  });

  it("el resumen con el portero apagado no dice que está todo bien, y muestra si el portero paga", async () => {
    const m = mundoFalso({ sinResumenPendiente: true, estado: estadoBien({ modo: "apagado" }) });
    await m.vuelta();
    const resumen = m.correo.enviados.find((c) => c.subject.startsWith("Resumen del portero"))!;
    expect(resumen.subject).toBe("Resumen del portero: hay 1 problema");
    expect(resumen.text).not.toMatch(/Todo bien/);
    expect(resumen.text).toContain("- Portero: apagado, no paga");
  });

  it("con todo en orden el resumen dice que el portero paga", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    await m.vuelta();
    expect(m.correo.enviados[0]!.text).toContain("- Portero: paga los sellos y los sorteos");
  });
});

describe("el portero que no contesta", () => {
  it("una vuelta sin respuesta no avisa: es un tropiezo", async () => {
    const m = mundoFalso();
    m.portero.falla = "red";
    const r = await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    expect(r.salioBien).toBe(false);
    expect((await m.memoria()).sinRespuesta).toBe(1);
  });

  it(`${SIN_RESPUESTA_MAX} vueltas seguidas sin respuesta sí avisan, y una sola vez`, async () => {
    expect(SIN_RESPUESTA_MAX).toBe(2);
    const m = mundoFalso();
    m.portero.falla = "red";
    await m.vuelta();
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/portero no contesta/i);
    expect(m.correo.enviados[0]!.text).toMatch(/Qué hacer/);
    for (let i = 0; i < 6; i++) await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  for (const [falla, nombre] of [
    ["red", "la conexión se corta"],
    ["tiempo", "se pasa el tiempo"],
    ["json", "contesta algo que no es JSON"],
    [500, "contesta 500"],
    [503, "contesta 503"],
  ] as const) {
    it(`cuenta como sin respuesta cuando ${nombre}`, async () => {
      const m = mundoFalso();
      m.portero.falla = falla;
      await m.vuelta();
      await m.vueltaEn(10);
      expect(m.correo.enviados).toHaveLength(1);
      expect(m.correo.enviados[0]!.subject).toMatch(/portero no contesta/i);
    });
  }

  it("una vuelta buena en el medio corta la cuenta", async () => {
    const m = mundoFalso();
    m.portero.falla = "red";
    await m.vuelta();
    m.portero.falla = null;
    await m.vueltaEn(10);
    m.portero.falla = "red";
    await m.vueltaEn(10);
    expect(m.correo.enviados).toEqual([]);
    expect((await m.memoria()).sinRespuesta).toBe(1);
  });

  it("cuando el portero vuelve avisa que volvió, una sola vez", async () => {
    const m = mundoFalso();
    m.portero.falla = "red";
    await m.vuelta();
    await m.vueltaEn(10);
    m.portero.falla = null;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados[1]!.subject).toMatch(/^Arreglado: /);
    expect(m.correo.enviados[1]!.text).toMatch(/volvió a contestar/i);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    const guardado = await m.memoria();
    expect(guardado.sinRespuesta).toBe(0);
    expect(guardado.claves).toEqual([]);
  });

  it("lo ya avisado se conserva: si el portero vuelve con el mismo problema de antes, no se avisa otra vez", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    m.portero.falla = "red";
    await m.vueltaEn(10);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    m.portero.falla = null;
    await m.vueltaEn(10);
    // Solo el «volvió a contestar»: los créditos bajos ya se habían avisado.
    expect(m.correo.enviados).toHaveLength(3);
    expect(m.correo.enviados[2]!.subject).toMatch(/^Arreglado: /);
    expect(m.correo.enviados[2]!.subject).toMatch(/portero/i);
    expect(m.correo.enviados[2]!.subject).not.toMatch(/créditos/i);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(3);
  });

  it("una clave que el portero rechaza (401) se avisa enseguida, sin esperar otra vuelta", async () => {
    const m = mundoFalso();
    m.portero.falla = 401;
    const r = await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/falta la clave/i);
    expect(r.salioBien).toBe(false);
    m.portero.falla = 403;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("sin la clave de operar no le pregunta nada al portero y avisa que falta", async () => {
    const m = mundoFalso({ env: { PORTERO_ADMIN_TOKEN: undefined } });
    await m.vuelta();
    expect(m.portero.llamadas).toEqual([]);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/falta la clave/i);
    expect(m.correo.enviados[0]!.text).toMatch(/PORTERO_ADMIN_TOKEN/);
  });
});

describe("el resumen del día", () => {
  const RESUMEN = /^Resumen del portero/;

  it("la primera vuelta de un Worker recién puesto manda un resumen: sirve de prueba de que anda", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(RESUMEN);
  });

  it("todo bien: el resumen lo dice y trae las cifras", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    await m.vuelta();
    const c = m.correo.enviados[0]!;
    expect(c.subject).toBe("Resumen del portero: todo bien");
    expect(c.text).toMatch(/Todo bien/);
    expect(c.text).toContain("9.000");
    expect(c.text).toContain("2.000");
    expect(c.text).toContain("7.000");
    expect(c.text).toContain("50,0 XLM");
    expect(c.text).toMatch(/Si un día no llega, el vigilante se cayó/);
  });

  it("con problemas, el resumen dice cuántos y cuáles", async () => {
    const m = mundoFalso({ sinResumenPendiente: true, estado: creditosBajos({ altasPausadas: true }) });
    await m.vuelta();
    // Un correo de aviso por los problemas nuevos y el resumen aparte.
    const resumen = m.correo.enviados.find((c) => RESUMEN.test(c.subject))!;
    expect(resumen.subject).toBe("Resumen del portero: hay 2 problemas");
    expect(resumen.text).toMatch(/créditos de Pollar/i);
    expect(resumen.text).toMatch(/altas/i);
  });

  it("si el portero no contesta a la hora del resumen, el resumen lo dice", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    m.portero.falla = "red";
    await m.vuelta();
    const resumen = m.correo.enviados.find((c) => RESUMEN.test(c.subject))!;
    expect(resumen.subject).toBe("Resumen del portero: no contesta");
  });

  it("sale una vez por día, en la primera vuelta desde las 12:00 UTC (las 8 de la mañana en Bolivia)", async () => {
    // Empieza a las 11:30 UTC con el resumen de ayer ya mandado.
    const m = mundoFalso({ ahora: Date.UTC(2026, 10, 14, 11, 30, 0) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    await m.vueltaEn(20);
    expect(m.correo.enviados).toEqual([]);
    await m.vueltaEn(10);
    expect(new Date(m.reloj.ahora).toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(RESUMEN);
    // El resto del día, nada más.
    for (let i = 0; i < 20; i++) await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    // Y mañana, otro.
    await m.vueltaEn(24 * 60 - 200);
    await m.vueltaEn(10);
    expect(new Date(m.reloj.ahora).getUTCDate()).toBe(15);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("si el envío del resumen falla, se reintenta en la vuelta siguiente y no sale dos veces", async () => {
    const m = mundoFalso({ sinResumenPendiente: true });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    m.correo.falla = null;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(RESUMEN);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("con RESUMEN_CADA_HORAS = 6 (el día de un evento) sale cada seis horas desde las 12:00 UTC", async () => {
    const m = mundoFalso({ ahora: Date.UTC(2026, 10, 14, 11, 50, 0), env: { RESUMEN_CADA_HORAS: "6" } });
    // El resumen «de ayer» ya está mandado para la ranura de 24 horas, no para la de 6: se marca la ranura de seis.
    m.libro.datos.set(CLAVE_MEMORIA, JSON.stringify({ v: 1, resumenEn: inicioDeResumen(new Date(m.reloj.ahora), 6).toISOString() }));
    const horas: string[] = [];
    for (let i = 0; i < 6 * 6 + 1; i++) {
      const antes = m.correo.enviados.length;
      await m.vueltaEn(10);
      if (m.correo.enviados.length > antes) horas.push(new Date(m.reloj.ahora).toISOString().slice(11, 16));
    }
    expect(horas).toEqual(["12:00", "18:00"]);
  });

  it("un valor raro en RESUMEN_CADA_HORAS vuelve al de siempre, uno por día", async () => {
    expect(RESUMEN_HORAS_POR_DEFECTO).toBe(24);
    for (const raro of ["", "0", "-3", "abc", "25", "1.5", "1e2"]) {
      const m = mundoFalso({ sinResumenPendiente: true, env: { RESUMEN_CADA_HORAS: raro } });
      await m.vuelta();
      await m.vueltaEn(2 * 60);
      expect(m.correo.enviados, raro).toHaveLength(1);
    }
  });
});

describe("el envío que falla se reintenta, y no se pierde el aviso", () => {
  it("el correo falla: el aviso queda pendiente, queda anotado y la vuelta no sale bien", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    const r = await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    expect(r.salioBien).toBe(false);
    const guardado = await m.memoria();
    expect(guardado.pendientes).toHaveLength(1);
    expect(guardado.pendientes[0]!.canales).toEqual(["correo"]);
    expect(guardado.pendientes[0]!.asunto).toMatch(/créditos de Pollar bajos/i);
    expect(m.registro.join("\n")).toContain('"evento":"error-envio"');
    expect(m.registro.join("\n")).toContain("E_RECIPIENT_NOT_ALLOWED");
  });

  it("la vuelta siguiente lo manda, una sola vez, y sin avisar de nuevo por el mismo problema", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    m.correo.falla = null;
    const r = await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/créditos de Pollar bajos/i);
    expect(r.salioBien).toBe(true);
    expect((await m.memoria()).pendientes).toEqual([]);
    await m.vueltaEn(10);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("sigue reintentando vuelta tras vuelta mientras falle, y cada intento queda anotado", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    for (let i = 0; i < 4; i++) await m.vueltaEn(10);
    expect(m.correo.intentos).toBe(4);
    expect(m.registro.filter((l) => l.includes('"evento":"error-envio"'))).toHaveLength(4);
    expect((await m.memoria()).pendientes[0]!.intentos).toBe(4);
  });

  it("los pendientes salen en orden, el más viejo primero", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    m.portero.estado = creditosBajos({ altasPausadas: true });
    await m.vueltaEn(10);
    m.correo.falla = null;
    await m.vueltaEn(10);
    expect(m.asuntos()).toHaveLength(2);
    expect(m.asuntos()[0]).toMatch(/créditos de Pollar bajos/i);
    expect(m.asuntos()[1]).toMatch(/altas/i);
  });

  it("un aviso que lleva más de 24 horas sin poder salir se descarta, anotado, para no mandar viejo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    await m.vuelta();
    m.correo.falla = null;
    await m.vueltaEn(24 * 60 + 10);
    // El viejo no sale: se descarta. Salen el recordatorio y el resumen, que son de ahora.
    expect((await m.memoria()).pendientes).toEqual([]);
    expect(m.correo.avisos).toHaveLength(1);
    expect(m.correo.avisos[0]!.subject).toMatch(/^Sigue: /);
    expect(m.registro.join("\n")).toContain('"evento":"aviso-descartado"');
  });

  it("no junta más de diez pendientes: se descartan los más viejos", async () => {
    const m = mundoFalso();
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    for (let i = 0; i < 14; i++) {
      // Un problema distinto cada vez: alterna entre dos para que cada cambio sea un aviso nuevo.
      m.portero.estado = i % 2 === 0 ? creditosBajos() : estadoBien({ altasPausadas: true });
      await m.vueltaEn(10);
    }
    const guardado = await m.memoria();
    expect(guardado.pendientes.length).toBeLessThanOrEqual(10);
    expect(m.registro.join("\n")).toContain('"evento":"aviso-descartado"');
  });

  it("si falla el KV al guardar, la vuelta no se cae: queda anotado", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.libro.fallaEscritura = true;
    const r = await m.vuelta();
    expect(r.salioBien).toBe(false);
    expect(m.registro.join("\n")).toContain('"evento":"error-kv"');
    // El aviso salió igual: mejor repetido que perdido.
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("lo guardado está roto (no es JSON): se anota y se sigue como la primera vez, y se escribe sano", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.libro.datos.set(CLAVE_MEMORIA, "{esto no es json");
    await m.vuelta();
    // Sin memoria, además del aviso sale el resumen: es la primera vuelta.
    expect(m.correo.avisos).toHaveLength(1);
    expect(m.registro.join("\n")).toContain('"evento":"error-kv"');
    expect((await m.memoria()).claves).toEqual(["creditos-bajos"]);
  });

  it("un KV que no se puede leer no es una primera vuelta: no manda nada, no escribe y lo anota", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.libro.fallaLectura = true;
    const r = await m.vuelta();
    expect(m.correo.intentos).toBe(0);
    expect(m.telegram.llamadas).toEqual([]);
    expect(m.libro.escrituras).toBe(0);
    expect(r.salioBien).toBe(false);
    const registro = m.registro.join("\n");
    expect(registro).toContain('"evento":"error-kv"');
    expect(registro).not.toContain("kv-caido");
  });

  it("con el KV roto varias vueltas seguidas no manda ni resumen ni avisos de más, y al volver sigue donde estaba", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    // Una primera vuelta buena: el aviso falla y queda pendiente, y lo avisado queda recordado.
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    const guardado = m.libro.datos.get(CLAVE_MEMORIA);
    const escrituras = m.libro.escrituras;
    expect((await m.memoria()).pendientes).toHaveLength(1);
    m.correo.falla = null;
    const intentos = m.correo.intentos;
    // El KV se rompe: mientras no se pueda leer lo recordado, no se manda ni se da por avisado nada.
    m.libro.fallaLectura = true;
    for (let i = 0; i < 4; i++) await m.vueltaEn(10);
    expect(m.correo.intentos).toBe(intentos);
    expect(m.libro.escrituras).toBe(escrituras);
    expect(m.libro.datos.get(CLAVE_MEMORIA)).toBe(guardado);
    expect(m.registro.filter((l) => l.includes('"evento":"error-kv"'))).toHaveLength(4);
    // Vuelve: sale lo que estaba pendiente, una sola vez, y no se avisa de nuevo lo que ya se avisó.
    m.libro.fallaLectura = false;
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(1);
    expect(m.correo.avisos[0]!.subject).toMatch(/créditos de Pollar bajos/i);
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(1);
  });
});

describe("sin a quién avisar", () => {
  it("sin AVISAR_A ni Telegram, no avisa a nadie, lo anota como error de configuración y no se cae", async () => {
    const m = mundoFalso({ estado: creditosBajos(), env: { AVISAR_A: undefined } });
    const r = await m.vuelta();
    expect(m.correo.intentos).toBe(0);
    expect(r.salioBien).toBe(false);
    expect(m.registro.join("\n")).toContain('"evento":"error-config"');
    expect(m.registro.join("\n")).toContain("AVISAR_A");
    expect((await m.memoria()).pendientes).toEqual([]);
  });

  it("sin a quién avisar no se da nada por avisado: cuando se configura, avisa", async () => {
    const m = mundoFalso({ estado: creditosBajos(), env: { AVISAR_A: undefined } });
    await m.vuelta();
    expect((await m.memoria()).claves).toEqual([]);
    m.env.AVISAR_A = DESTINO;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/créditos de Pollar bajos/i);
  });

  it("el resumen de la primera vuelta espera a que haya a quién mandarlo", async () => {
    const m = mundoFalso({ sinResumenPendiente: true, env: { AVISAR_A: undefined } });
    await m.vuelta();
    expect((await m.memoria()).resumenEn).toBeNull();
    m.env.AVISAR_A = DESTINO;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/^Resumen del portero/);
  });

  it("sin el binding del correo pasa lo mismo", async () => {
    const m = mundoFalso({ estado: creditosBajos(), env: { CORREO: undefined } });
    const r = await m.vuelta();
    expect(r.salioBien).toBe(false);
    expect(m.registro.join("\n")).toContain('"evento":"error-config"');
  });

  it("un aviso que quedó pendiente no se pierde si después no hay a quién mandarlo: sale cuando vuelve", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    expect((await m.memoria()).pendientes).toHaveLength(1);
    m.correo.falla = null;
    m.env.AVISAR_A = undefined;
    const intentos = m.correo.intentos;
    const r = await m.vueltaEn(10);
    expect(r.salioBien).toBe(false);
    expect((await m.memoria()).pendientes).toHaveLength(1);
    expect(m.correo.intentos).toBe(intentos);
    expect(m.registro.join("\n")).not.toContain('"motivo":"sin-canales"');
    m.env.AVISAR_A = DESTINO;
    await m.vueltaEn(10);
    expect(m.asuntos()).toEqual(["Créditos de Pollar bajos: cargá hoy"]);
    expect((await m.memoria()).pendientes).toEqual([]);
    await m.vueltaEn(10);
    expect(m.asuntos()).toHaveLength(1);
  });

  it("sin a quién avisar por más de 24 horas, el pendiente se descarta por viejo, anotado", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    m.correo.falla = null;
    m.env.AVISAR_A = undefined;
    await m.vueltaEn(10);
    await m.vueltaEn(24 * 60);
    expect((await m.memoria()).pendientes).toEqual([]);
    expect(m.registro.join("\n")).toContain('"motivo":"vencido"');
    expect(m.correo.enviados).toEqual([]);
  });
});

describe("Telegram, opcional y apagado", () => {
  it("sin los dos secretos no llama a Telegram", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    expect(m.telegram.llamadas).toEqual([]);
    const solo = mundoFalso({ estado: creditosBajos(), env: { TELEGRAM_BOT_TOKEN: BOT } });
    await solo.vuelta();
    expect(solo.telegram.llamadas).toEqual([]);
    const otro = mundoFalso({ estado: creditosBajos(), env: { TELEGRAM_CHAT_ID: CHAT } });
    await otro.vuelta();
    expect(otro.telegram.llamadas).toEqual([]);
  });

  it("con los dos secretos, el mismo aviso sale también por sendMessage", async () => {
    const m = mundoFalso({ estado: creditosBajos(), conTelegram: true });
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.telegram.llamadas).toHaveLength(1);
    const t = m.telegram.llamadas[0]!;
    expect(t.url).toBe(`https://api.telegram.org/bot${BOT}/sendMessage`);
    expect(t.cuerpo.chat_id).toBe(CHAT);
    expect(String(t.cuerpo.text)).toContain(m.correo.enviados[0]!.subject);
    expect(String(t.cuerpo.text)).toContain("2.400");
  });

  it("funciona sin el correo: solo Telegram", async () => {
    const m = mundoFalso({ estado: creditosBajos(), conTelegram: true, env: { AVISAR_A: undefined } });
    const r = await m.vuelta();
    expect(m.correo.intentos).toBe(0);
    expect(m.telegram.llamadas).toHaveLength(1);
    expect(r.salioBien).toBe(true);
  });

  it("si Telegram falla y el correo no, se reintenta solo Telegram y el correo no se repite", async () => {
    const m = mundoFalso({ estado: creditosBajos(), conTelegram: true });
    m.telegram.falla = 502;
    await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    const pendientes = (await m.memoria()).pendientes;
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]!.canales).toEqual(["telegram"]);
    m.telegram.falla = null;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.telegram.llamadas).toHaveLength(2);
    expect((await m.memoria()).pendientes).toEqual([]);
  });

  it("si falla el correo y Telegram no, el aviso llega por Telegram y el correo se reintenta", async () => {
    const m = mundoFalso({ estado: creditosBajos(), conTelegram: true });
    m.correo.falla = "E_INTERNAL_SERVER_ERROR";
    await m.vuelta();
    expect(m.telegram.llamadas).toHaveLength(1);
    expect((await m.memoria()).pendientes[0]!.canales).toEqual(["correo"]);
    m.correo.falla = null;
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.telegram.llamadas).toHaveLength(1);
  });
});

describe("el registro del Worker no lleva secretos", () => {
  it("ni la clave de operar, ni la dirección de aviso, ni el bot, ni el chat, ni cifras del negocio", async () => {
    const m = mundoFalso({ estado: creditosBajos({ altasPausadas: true }), conTelegram: true });
    m.correo.falla = "E_RECIPIENT_NOT_ALLOWED";
    m.telegram.falla = 502;
    await m.vuelta();
    m.portero.falla = "red";
    await m.vueltaEn(10);
    await m.vueltaEn(10);
    m.portero.falla = 401;
    await m.vueltaEn(10);
    const todo = m.registro.join("\n");
    expect(todo.length).toBeGreaterThan(0);
    for (const secreto of [CLAVE_DE_OPERAR, DESTINO, BOT, CHAT, "token-inventado", "2.400", "2400"]) expect(todo, secreto).not.toContain(secreto);
    expect(todo).not.toMatch(/@/);
    expect(todo).not.toMatch(/Bearer/);
  });

  it("aunque el mensaje de un error de Cloudflare traiga la dirección, el registro la tapa", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.send = async () => {
      throw Object.assign(new Error(`no se pudo mandar a ${DESTINO} con Bearer ${CLAVE_DE_OPERAR}`), { code: "E_DELIVERY_FAILED" });
    };
    await m.vuelta();
    const todo = m.registro.join("\n");
    expect(todo).toContain("E_DELIVERY_FAILED");
    expect(todo).not.toContain(DESTINO);
    expect(todo).not.toContain(CLAVE_DE_OPERAR);
  });
});

describe("el reloj", () => {
  it("las ranuras del resumen arrancan a las 12:00 UTC", () => {
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 11, 59)), 24).toISOString()).toBe("2026-11-13T12:00:00.000Z");
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 12, 0)), 24).toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 23, 59)), 24).toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 17, 59)), 6).toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 18, 0)), 6).toISOString()).toBe("2026-11-14T18:00:00.000Z");
    expect(inicioDeResumen(new Date(Date.UTC(2026, 10, 14, 5, 0)), 6).toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });

  it("la base de las pruebas trae los pagos sueltos y la venta pausada, como el portero vivo, y con o sin ellos no avisa nada", async () => {
    const base = estadoBien();
    expect(base).toMatchObject({ pagosSueltos: 0, ventaPausada: false });
    const { pagosSueltos: _p, ventaPausada: _v, ...sinLosDos } = base;
    for (const estado of [base, sinLosDos]) {
      const m = mundoFalso({ estado });
      for (let i = 0; i < 3; i++) await m.vueltaEn(10);
      expect(m.correo.enviados).toEqual([]);
      expect((await m.memoria()).salioBien).toBe(true);
    }
  });

  it("las constantes del encargo: una vuelta cada diez minutos y dos sin respuesta", () => {
    expect(10 * MINUTO).toBe(600_000);
    expect(HORA).toBe(6 * 10 * MINUTO);
    expect(SIN_RESPUESTA_MAX).toBe(2);
  });
});
