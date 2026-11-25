import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPOS_POR_MINUTO, NOMBRES_POR_MINUTO, VentanaPorMinuto } from "../../workers/sala/src/logica";

/**
 * El tope por minuto de la sala (`workers/sala/src/index.ts`). Los nombres que mandan los celulares y las altas de
 * equipos gastaban el mismo contador y se frenaban entre sí. Ahora cada uno tiene su ventana: 240 nombres deja entrar
 * a 200 personas que escanean a la vez, mientras los equipos conservan su tope independiente de 120.
 */

const fuente = readFileSync(join(process.cwd(), "workers", "sala", "src", "index.ts"), "utf8");
/** El cuerpo de un método de la clase `Sala`, hasta la llave que lo cierra con su sangría. */
const metodo = (nombre: string): string => new RegExp(`\\n  async ${nombre}\\([\\s\\S]*?\\r?\\n  \\}\\r?\\n`).exec(fuente)?.[0] ?? "";

describe("las salas de campaña en el Worker", () => {
  it("el fetch crea campañas con el permiso del evento en dos tiempos y su método de creación", () => {
    expect(fuente).toContain('partes[1] === "campana"');
    expect(fuente).toContain("crearSalaDeCampana({");
    expect(fuente).not.toContain("permitirCampana(");
    const creacion = readFileSync(join(process.cwd(), "workers", "sala", "src", "creacion.ts"), "utf8");
    const reservar = creacion.indexOf("a.cupos.reservarCampana(");
    const crear = creacion.indexOf("a.salas.crearCampana(");
    const confirmar = creacion.indexOf("a.cupos.confirmarCampana(");
    expect(reservar).toBeGreaterThan(-1);
    expect(crear).toBeGreaterThan(reservar);
    expect(confirmar).toBeGreaterThan(crear);
    expect(creacion).toContain("a.cupos.soltarCampana(");
  });

  it("las escrituras comunes miran esCampana antes de tocar el registro", () => {
    for (const nombre of ["sumar", "configurar", "anotarEquipo", "cambiarEstado", "quitarEquipo"]) {
      const cuerpo = metodo(nombre);
      expect(cuerpo, nombre).not.toBe("");
      expect(cuerpo, nombre).toContain("this.esCampana()");
    }
  });

  it("las rutas quitar y avisar usan bearer(req)", () => {
    const inicioQuitar = fuente.indexOf('partes[4] === "quitar"');
    const inicioAvisar = fuente.indexOf('partes[4] === "avisar"');
    const inicioAlta = fuente.indexOf('partes[4] === "alta"');
    expect(inicioQuitar).toBeGreaterThan(-1);
    expect(inicioAvisar).toBeGreaterThan(inicioQuitar);
    expect(inicioAlta).toBeGreaterThan(inicioAvisar);
    const quitar = fuente.slice(inicioQuitar, inicioAvisar);
    const avisar = fuente.slice(inicioAvisar, inicioAlta);
    expect(quitar).toContain(".quitarPersona(bearer(req),");
    expect(avisar).toContain(".avisarGanadora(bearer(req),");
  });

  it("la ruta del resultado no acepta ganadoras del cuerpo", () => {
    const inicio = fuente.indexOf('partes[4] === "resultado"');
    const fin = fuente.indexOf('partes[4] === "quitar"', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    expect(fuente.slice(inicio, fin)).not.toContain("cuerpo.ganadoras");
  });

  it("la red se lee en el fetch del Worker y no dentro de Sala", () => {
    const inicioSala = fuente.indexOf("export class Sala");
    const finSala = fuente.indexOf("/* --------------------------------------------------------------- el Worker */", inicioSala);
    const clase = fuente.slice(inicioSala, finSala);
    expect(clase).not.toContain("leerSorteoEnLaRed");
    expect(fuente.slice(fuente.indexOf("export default"))).toContain("leerSorteoEnLaRed(");
  });
});

describe("el alta de campaña y el proveedor", () => {
  const inicio = fuente.indexOf('partes[4] === "alta"');
  const fin = fuente.indexOf('partes[4] === "yo"', inicio);
  const ruta = fuente.slice(inicio, fin);

  it("verifica después de la comprobación previa y antes de anotar, sin tomar la cuenta del cuerpo", () => {
    const prealta = ruta.indexOf(".prealta(");
    const verificar = ruta.indexOf(".verificar(");
    const anotar = ruta.indexOf(".anotarPersona({");
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    expect(prealta).toBeGreaterThan(-1);
    expect(verificar).toBeGreaterThan(prealta);
    expect(anotar).toBeGreaterThan(verificar);
    expect(ruta).toContain("let cuenta = sesion.cuenta");
    expect(ruta).toContain("proveedor.billeteraDe(sesion.usuario)");
    expect(ruta).not.toContain("cuerpo.cuenta");
  });

  it("la vía de la sesión se decide con la lista de lo permitido y el modo estricto por defecto", () => {
    expect(ruta).toContain("viaPermitida(sesion.via, modoSoloGoogle(env.SOLO_GOOGLE))");
    expect(ruta).not.toContain('"estricto"');
    expect(ruta).not.toContain("sesion.via === null");
    expect(ruta).not.toContain('sesion.via === "otra"');
  });

  it("cada sesión rechazada se cuenta con su ficha, y las que se rechazan antes de llamar no pasan por rechazo", () => {
    // La sesión que el proveedor rechaza, la que no es de Google y la que no tiene billetera: las tres costaron llamadas.
    expect(ruta.match(/\.rechazo\(ip, token(, false)?\)/g)).toHaveLength(3);
    // Solo la que espera su cuenta cuenta a la ficha y no a la conexión: esa sesión el proveedor ya la dio por buena.
    expect(ruta.match(/\.rechazo\(ip, token, false\)/g)).toHaveLength(1);
    const sinBilletera = ruta.indexOf('falla({ motivo: "sin-billetera" }, h)');
    expect(ruta.lastIndexOf(".rechazo(ip, token, false)", sinBilletera)).toBeGreaterThan(ruta.indexOf("billetera.cuenta === null"));
    expect(ruta.indexOf(".prealta(")).toBeLessThan(ruta.indexOf(".verificar("));
    expect(ruta).toContain(".prealta(ip, p, exigirPase, token, llave, d)");
    expect(ruta).toContain(".yaEsta(sesion.usuario, llave, ip, token, sesion.vence, d)");
  });

  it("ninguna respuesta JSON menciona la llave secreta del proveedor", () => {
    const respuestas = fuente.split(/\r?\n/).filter((linea) => linea.includes("json(") && linea.includes("POLLAR_SECRETO"));
    expect(respuestas).toEqual([]);
  });

  it("la clase Sala no llama al proveedor: eso ocurre solo en el Worker", () => {
    const inicioSala = fuente.indexOf("export class Sala");
    const finSala = fuente.indexOf("/* --------------------------------------------------------------- el Worker */", inicioSala);
    const clase = fuente.slice(inicioSala, finSala);
    expect(clase).not.toContain("verificar(");
    expect(clase).not.toContain("billeteraDe(");
  });
});

describe("los topes por minuto de la sala", () => {
  it("240 nombres en un minuto no frenan un alta de equipo", () => {
    const nombres = new VentanaPorMinuto(NOMBRES_POR_MINUTO);
    const equipos = new VentanaPorMinuto(EQUIPOS_POR_MINUTO);
    const ahora = 1_000_000;
    for (let i = 0; i < NOMBRES_POR_MINUTO; i++) expect(nombres.intentar(ahora)).toBe(true);
    expect(nombres.intentar(ahora)).toBe(false);
    expect(equipos.intentar(ahora)).toBe(true);
  });

  it("entran 200 personas en un minuto y los equipos conservan su tope aparte", () => {
    expect(NOMBRES_POR_MINUTO).toBe(240);
    expect(EQUIPOS_POR_MINUTO).toBe(120);
    const nombres = new VentanaPorMinuto(NOMBRES_POR_MINUTO);
    for (let i = 0; i < 200; i++) expect(nombres.intentar(1_000)).toBe(true);
  });

  it("la sala usa una ventana para los nombres y otra para los equipos", () => {
    const sumar = metodo("sumar");
    const anotar = metodo("anotarEquipo");
    expect(sumar).not.toBe("");
    expect(anotar).not.toBe("");
    expect(sumar).toMatch(/this\.porMinuto\.intentar\(/);
    expect(anotar).toMatch(/this\.equiposPorMinuto\.intentar\(/);
    expect(anotar).not.toMatch(/this\.porMinuto\./);
    expect(fuente).toMatch(/private equiposPorMinuto = new VentanaPorMinuto\(EQUIPOS_POR_MINUTO\);/);
  });
});
