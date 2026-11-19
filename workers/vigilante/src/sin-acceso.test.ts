// Cuando el vigilante pierde el acceso al portero (la clave no está, el portero la rechaza o contesta algo que no se
// entiende) no sabe cómo están las cosas. En ese caso no puede dar nada por arreglado, ni olvidar lo ya avisado: al
// recuperar el acceso, lo que seguía mal no se avisa otra vez como si fuera nuevo.
import { describe, expect, it } from "vitest";
import { estadoBien, mundoFalso } from "./mundo-falso";

const creditosBajos = () => estadoBien({ creditos: 2400, piso: 2000, margen: 400 });
const arreglos = (asuntos: string[]) => asuntos.filter((a) => /^Arreglado: /.test(a));

describe("la clave rechazada por el portero (401 o 403)", () => {
  it("no dice que los créditos volvieron a estar bien: no se sabe, y lo avisado se conserva", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    expect(m.correo.avisos).toHaveLength(1);
    m.portero.falla = 401;
    await m.vueltaEn(10);
    // Un aviso nuevo, el de la clave, y ninguno de «arreglado».
    expect(m.correo.avisos).toHaveLength(2);
    expect(m.correo.avisos[1]!.subject).toMatch(/falta la clave/i);
    expect(arreglos(m.asuntos())).toEqual([]);
    const guardado = await m.memoria();
    expect(guardado.claves).toContain("creditos-bajos");
    expect(guardado.claves).toContain("vigilante-sin-clave");
    m.portero.falla = 403;
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(2);
  });

  it("al recuperar el acceso solo avisa que se arregló la clave: lo de los créditos no es nuevo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.falla = 401;
    await m.vueltaEn(10);
    m.portero.falla = null;
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
    expect(m.correo.avisos[2]!.subject).toMatch(/^Arreglado: clave del vigilante/);
    // Los créditos bajos se avisaron una sola vez en total.
    expect(m.asuntos().filter((a) => /^Créditos de Pollar bajos/.test(a))).toHaveLength(1);
    expect((await m.memoria()).claves).toEqual(["creditos-bajos"]);
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
  });

  it("si el problema de antes se arregló mientras no había acceso, al volver lo avisa como arreglado", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.falla = 401;
    await m.vueltaEn(10);
    m.portero.falla = null;
    m.portero.estado = estadoBien();
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
    expect(m.correo.avisos[2]!.subject).toMatch(/^Arreglado: /);
    expect(m.correo.avisos[2]!.subject).toMatch(/créditos de Pollar/i);
    expect((await m.memoria()).claves).toEqual([]);
  });
});

describe("sin la clave cargada en el vigilante", () => {
  it("tampoco da nada por arreglado ni olvida lo avisado", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    const conClave = m.env.PORTERO_ADMIN_TOKEN;
    m.env.PORTERO_ADMIN_TOKEN = undefined;
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(2);
    expect(arreglos(m.asuntos())).toEqual([]);
    expect((await m.memoria()).claves).toContain("creditos-bajos");
    m.env.PORTERO_ADMIN_TOKEN = conClave;
    await m.vueltaEn(10);
    expect(m.asuntos().filter((a) => /^Créditos de Pollar bajos/.test(a))).toHaveLength(1);
  });
});

describe("una respuesta que el vigilante no entiende", () => {
  it("no dice que los créditos se arreglaron, y al volver con lo mismo de antes no los avisa de nuevo", async () => {
    const m = mundoFalso({ estado: creditosBajos() });
    await m.vuelta();
    m.portero.estado = null;
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(2);
    expect(m.correo.avisos[1]!.subject).toMatch(/no se entiende/i);
    expect(arreglos(m.asuntos())).toEqual([]);
    expect((await m.memoria()).claves).toContain("creditos-bajos");
    m.portero.estado = creditosBajos();
    await m.vueltaEn(10);
    expect(m.correo.avisos).toHaveLength(3);
    expect(m.correo.avisos[2]!.subject).toMatch(/^Arreglado: respuesta del portero/);
    expect(m.asuntos().filter((a) => /^Créditos de Pollar bajos/.test(a))).toHaveLength(1);
    expect((await m.memoria()).claves).toEqual(["creditos-bajos"]);
  });
});
