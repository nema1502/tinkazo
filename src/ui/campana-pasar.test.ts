import { beforeEach, describe, expect, it } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import type { SorteoDeCampana } from "../campana/en-curso";
import { premioParaElCuadro } from "../campana/formato";
import type { Campana } from "../campana/modelo";
import { type PasoDelPuente, ponerRechazo } from "../campana/puente";
import { cifrarEquipo } from "../equipos/datos";
import type { SalaDeCampana } from "../sala/campana-org";
import type { EquipoDeSala } from "../sala/cliente";
import { montoDelPremio } from "../stellar/pagos";
import { type ContextoDelPaso, type DepsDelPaso, crearPaso } from "./campana-pasar";

/**
 * Pasar la lista cerrada al cuadro del sorteo, con la sala, el cuadro y el reloj de mentira. Los textos que se comparan
 * están escritos a mano: son lo que lee la persona.
 */

const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: "T".repeat(22),
  clave: "C".repeat(22),
  vence: 2_000_000_000_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};
const CONTRATO = "CCONTRATO";

const campana = (premios: bigint[] = [400_000_000n]): Campana => ({ premios, red: "testnet", evento: "evento-uno" }) as unknown as Campana;
/** La entrada del evento con esa huella: la lista que ya pasó el panel. */
const entradaDe = (huella: string): SorteoDeCampana => ({
  evento: "evento-uno",
  red: "testnet",
  contrato: CONTRATO,
  huella,
  premios: 1,
  organizadora: null,
  pasadaEn: 1,
});
const fila = (n: number): EquipoDeSala => ({ n, cuenta: cuentaDePrueba(n), d: `d${n}`, estado: "aceptado", v: n });

interface Mundo {
  d: DepsDelPaso;
  registro: string[];
  /** La palabra con que se pusieron las etiquetas cada vez. */
  etiquetasDe: (string | undefined)[];
  pasos: PasoDelPuente[];
  cuadro: { lista: string; premio: string; ganadores: number; fijo: boolean; bloqueada: boolean; turnos: boolean; sorteado: boolean };
  entradas: Map<string, SorteoDeCampana>;
  filas: (EquipoDeSala[] | null)[];
  lecturas: number;
  esperas: number[];
  cuenta: string | null;
  organizadora: { cuenta: string | null } | null;
  nombres: Map<string, { nombre: string; revisar: boolean }>;
  red: "mainnet" | "testnet";
  contrato: string | null;
  quitas: number[];
  idioma: "es" | "en";
}

function mundo(): Mundo {
  const m: Mundo = {
    d: undefined as never,
    registro: [],
    etiquetasDe: [],
    pasos: [],
    cuadro: { lista: "", premio: "", ganadores: 1, fijo: false, bloqueada: false, turnos: false, sorteado: false },
    entradas: new Map(),
    filas: [],
    lecturas: 0,
    esperas: [],
    cuenta: null,
    organizadora: { cuenta: null },
    nombres: new Map(),
    red: "testnet",
    contrato: CONTRATO,
    quitas: [],
    idioma: "es",
  };
  m.d = {
    ahora: () => 1_800_000_000_000,
    leer: async () => {
      m.lecturas++;
      return m.filas.shift() ?? null;
    },
    descifrar: async (_clave, d) => ({ nombre: d, integrantes: [] }),
    nombreYFiltro: (datos) => m.nombres.get(datos.nombre) ?? { nombre: datos.nombre.startsWith("d") ? "" : datos.nombre, revisar: false },
    organizadora: async () => m.organizadora,
    cuenta: () => m.cuenta,
    red: () => m.red,
    contrato: () => m.contrato,
    contratoDeLaRed: () => CONTRATO,
    nombreDelModo: (red) => (red === "mainnet" ? "oficial" : "prueba"),
    listaBloqueada: () => m.cuadro.bloqueada,
    sorteado: () => m.cuadro.sorteado,
    listaDelCuadro: () => m.cuadro.lista.split("\n").filter((x) => x !== ""),
    huella: (lineas) => `huella:${lineas.join(",")}`,
    modoTurnos: () => m.cuadro.turnos,
    ponerModoTurnos: (si) => {
      m.registro.push(`turnos:${si}`);
      m.cuadro.turnos = si;
    },
    ponerEtiquetas: (e, de) => {
      m.registro.push(`etiquetas:${e.size}`);
      m.etiquetasDe.push(de);
    },
    setList: (texto) => {
      m.registro.push("lista");
      m.cuadro.lista = texto;
    },
    ponerPremio: (texto) => {
      m.registro.push("premio");
      m.cuadro.premio = texto;
    },
    ponerGanadores: (n) => {
      m.cuadro.ganadores = n;
    },
    fijarPorCampana: (si) => {
      m.cuadro.fijo = si;
    },
    entrada: (red, evento) => m.entradas.get(`${red}/${evento}`) ?? null,
    guardar: (e) => void m.entradas.set(`${e.red}/${e.evento}`, e),
    persona: (n) => `Persona ${n}`,
    botonDeSellar: () => "Sellar la lista",
    premioEnEspanol: premioParaElCuadro,
    esperar: async (ms) => void m.esperas.push(ms),
    poner: (p) => void m.pasos.push(p),
  };
  return m;
}

const contexto = (m: Mundo, premios: bigint[] = [400_000_000n]): ContextoDelPaso => ({
  campana: campana(premios),
  mostradas: new Set<number>(),
  quitasEnCurso: () => m.quitas,
});

const ultimo = (m: Mundo): PasoDelPuente | undefined => m.pasos[m.pasos.length - 1];

beforeEach(() => ponerRechazo(null));

describe("pasar la lista al cuadro del sorteo", () => {
  it("pasa al cuadro las 250 personas que la sala dice, ordenadas por cuenta", async () => {
    const m = mundo();
    m.filas = [Array.from({ length: 250 }, (_, i) => fila(i + 1))];
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("pasada");
    const lineas = m.cuadro.lista.split("\n");
    expect(lineas).toHaveLength(250);
    expect(lineas).toEqual([...lineas].sort());
    expect(ultimo(m)).toEqual({ paso: "en-el-sorteo", n: 250 });
  });

  it("con 251 en la sala y 250 leídas, tres intentos a 3 segundos, dice que no pudo leer y no toca el cuadro", async () => {
    const m = mundo();
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("no-leyo");
    expect(m.lecturas).toBe(3);
    expect(m.esperas).toEqual([3_000, 3_000]);
    expect(m.registro).not.toContain("lista");
    expect(ultimo(m)).toEqual({ paso: "no-leyo" });
  });

  it("el premio es 40 dólares digitales y la lectura del pago lo toma como 40", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m, [400_000_000n]));
    expect(m.cuadro.premio).toBe("40 dólares digitales");
    expect(montoDelPremio(m.cuadro.premio)).toBe("40");
  });

  it("un premio de mil no lleva separador de miles y se lee como mil", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m, [10_000_000_000n]));
    expect(m.cuadro.premio).toBe("1000 dólares digitales");
    expect(montoDelPremio(m.cuadro.premio)).toBe("1000");
  });

  it("un premio con centavos usa coma y dos decimales", () => {
    expect(premioParaElCuadro(125_000_000n)).toBe("12,50 dólares digitales");
  });

  it("pone la cantidad de ganadoras igual a la de premios y la deja fija", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2), fila(3), fila(4)]];
    await crearPaso(m.d).correr(SALA, contexto(m, [100_000_000n, 100_000_000n, 100_000_000n]));
    expect(m.cuadro.ganadores).toBe(3);
    expect(m.cuadro.fijo).toBe(true);
  });

  it("con menos personas que premios dice cuántas hacen falta y no pasa nada", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    const fin = await crearPaso(m.d).correr(SALA, contexto(m, [1n, 1n, 1n]));
    expect(fin).toBe("pocos");
    expect(ultimo(m)).toEqual({ paso: "pocos", n: 3 });
    expect(m.cuadro.lista).toBe("");
  });

  it("con una sola persona dice que hacen falta dos", async () => {
    const m = mundo();
    m.filas = [[fila(1)]];
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("pocos");
    expect(ultimo(m)).toEqual({ paso: "pocos", n: 2 });
  });

  it("si la campaña nombra otra cuenta que la conectada, no pasa y dice los cuatro últimos de la que hace falta", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    m.organizadora = { cuenta: cuentaDePrueba(9) };
    m.cuenta = cuentaDePrueba(8);
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("otra-cuenta");
    expect(ultimo(m)).toEqual({ paso: "otra-cuenta", fin: cuentaDePrueba(9).slice(-4) });
    expect(m.cuadro.lista).toBe("");
  });

  it("con la lista ya pasada y otra cuenta conectada, la suelta del cuadro y dice con cuál entrar", async () => {
    const m = mundo();
    m.filas = [
      [fila(1), fila(2)],
      [fila(1), fila(2)],
    ];
    m.organizadora = { cuenta: cuentaDePrueba(9) };
    m.cuenta = cuentaDePrueba(9);
    const paso = crearPaso(m.d);
    expect(await paso.correr(SALA, contexto(m))).toBe("pasada");
    expect(m.cuadro.lista).not.toBe("");
    m.cuenta = cuentaDePrueba(8);
    expect(await paso.correr(SALA, contexto(m))).toBe("otra-cuenta");
    expect(m.cuadro.lista).toBe("");
    expect(m.entradas.get("testnet/evento-uno")?.huella).toBe("");
    expect(ultimo(m)).toEqual({ paso: "otra-cuenta", fin: cuentaDePrueba(9).slice(-4) });
  });

  it("con la lista ya sellándose y otra cuenta conectada no toca el cuadro", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    m.organizadora = { cuenta: cuentaDePrueba(9) };
    m.cuenta = cuentaDePrueba(9);
    const paso = crearPaso(m.d);
    await paso.correr(SALA, contexto(m));
    const lista = m.cuadro.lista;
    m.cuadro.bloqueada = true;
    m.cuenta = cuentaDePrueba(8);
    await paso.correr(SALA, contexto(m));
    expect(m.cuadro.lista).toBe(lista);
  });

  it("con la cuenta que nombra la campaña pasa la lista", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    m.organizadora = { cuenta: cuentaDePrueba(9) };
    m.cuenta = cuentaDePrueba(9);
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("pasada");
  });

  it("si no se puede leer la organizadora no pasa la lista", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    m.organizadora = null;
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("sin-conexion");
    expect(m.cuadro.lista).toBe("");
  });

  it("con el orden de turnos prendido, lo apaga antes de poner el premio", async () => {
    const m = mundo();
    m.cuadro.turnos = true;
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(m.registro.indexOf("turnos:false")).toBeLessThan(m.registro.indexOf("premio"));
  });

  it("las etiquetas se ponen antes que la lista", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(m.registro.indexOf("etiquetas:2")).toBeLessThan(m.registro.indexOf("lista"));
  });

  it("las etiquetas son de personas: la lista de una campaña no se cuenta como equipos", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(m.etiquetasDe).toEqual(["personas"]);
  });

  it("los nombres son etiquetas y no entran en lo que se sella: la lista son solo cuentas", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(m.cuadro.lista.split("\n").every((l) => /^G[A-Z2-7]{55}$/.test(l))).toBe(true);
  });

  it("la entrada del evento guarda la huella de las líneas puestas, la red y el contrato", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    await crearPaso(m.d).correr(SALA, contexto(m));
    const e = m.entradas.get("testnet/evento-uno");
    expect(e?.huella).toBe(`huella:${m.cuadro.lista.split("\n").join(",")}`);
    expect(e).toMatchObject({ premios: 1, contrato: CONTRATO, red: "testnet", organizadora: null });
  });

  it("una cuenta leída sin forma de cuenta hace fallar la lectura y no toca el cuadro", async () => {
    const m = mundo();
    m.filas = [[fila(1), { ...fila(2), cuenta: "CUENTA2" }]];
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("no-leyo");
    expect(m.cuadro.lista).toBe("");
  });

  it("dos llamadas seguidas corren una detrás de la otra y la última manda", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)], [fila(1), fila(2), fila(3)]];
    const paso = crearPaso(m.d);
    const a = paso.correr(SALA, contexto(m));
    const b = paso.correr(SALA, contexto(m));
    await Promise.all([a, b]);
    expect(m.lecturas).toBe(2);
    expect(m.cuadro.lista.split("\n")).toHaveLength(3);
  });

  it("tres llamadas seguidas dejan una sola pendiente", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)], [fila(1), fila(2), fila(3)], [fila(1), fila(2), fila(3), fila(4)]];
    const paso = crearPaso(m.d);
    await Promise.all([paso.correr(SALA, contexto(m)), paso.correr(SALA, contexto(m)), paso.correr(SALA, contexto(m))]);
    expect(m.lecturas).toBe(2);
  });
});

describe("lo que no se pasa", () => {
  it("con la lista de esta campaña ya sellándose en el cuadro no hace nada ni dice nada", async () => {
    const m = mundo();
    m.cuadro.lista = "GA\nGB";
    m.cuadro.bloqueada = true;
    m.entradas.set("testnet/evento-uno", entradaDe("huella:GA,GB"));
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("pasada");
    expect(m.pasos).toEqual([]);
    expect(m.lecturas).toBe(0);
  });

  it("con otra lista sellada en el cuadro dice que ya hay una sellada y no lee", async () => {
    const m = mundo();
    m.cuadro.lista = "GX\nGY";
    m.cuadro.bloqueada = true;
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("lista-sellada");
    expect(ultimo(m)).toEqual({ paso: "lista-sellada", soltable: true });
    expect(m.lecturas).toBe(0);
  });

  it("con otra lista ya sorteada no ofrece soltarla", async () => {
    const m = mundo();
    m.cuadro.bloqueada = true;
    m.cuadro.sorteado = true;
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(ultimo(m)).toEqual({ paso: "lista-sellada", soltable: false });
  });

  it("si la sala es de otra red que la de la pestaña, lo dice y no lee", async () => {
    const m = mundo();
    m.red = "mainnet";
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("otra-red");
    expect(ultimo(m)).toEqual({ paso: "otra-red", modo: "prueba" });
    expect(m.lecturas).toBe(0);
  });

  it("si el contrato de la pestaña no es el que lee la sala, lo dice y no lee", async () => {
    const m = mundo();
    m.contrato = "COTROCONTRATO";
    expect(await crearPaso(m.d).correr(SALA, contexto(m))).toBe("version-distinta");
    expect(m.lecturas).toBe(0);
  });

  it("con una quita en Deshacer no lee, vacía el cuadro y su entrada pierde la huella", async () => {
    const m = mundo();
    m.cuadro.lista = "GA\nGB";
    m.entradas.set("testnet/evento-uno", entradaDe("huella:GA,GB"));
    m.quitas = [2];
    const fin = await crearPaso(m.d).correr(SALA, contexto(m));
    expect(fin).toBe("en-espera");
    expect(m.lecturas).toBe(0);
    expect(m.cuadro.lista).toBe("");
    expect(m.entradas.get("testnet/evento-uno")?.huella).toBe("");
  });

  it("si una cuenta leída es de alguien que se está quitando, no pasa al cuadro", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2), fila(3)]];
    const ctx: ContextoDelPaso = { ...contexto(m), quitasEnCurso: () => (m.lecturas > 0 ? [3] : []) };
    expect(await crearPaso(m.d).correr(SALA, ctx)).toBe("en-espera");
    expect(m.cuadro.lista).toBe("");
  });

  it("una corrida cancelada no escribe nada en el cuadro ni en la entrada", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    const paso = crearPaso(m.d);
    const corrida = paso.correr(SALA, contexto(m));
    paso.cancelar();
    expect(await corrida).toBe("cancelada");
    expect(m.cuadro.lista).toBe("");
    expect(m.entradas.size).toBe(0);
  });

  it("deja a la vista el motivo del último rechazo del sello en lugar de la línea de siempre", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    ponerRechazo({ paso: "tarde" });
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(ultimo(m)).toEqual({ paso: "tarde" });
  });

  it("conserva el sorteo que salió hacia la sala sin respuesta definitiva", async () => {
    const m = mundo();
    m.filas = [[fila(1), fila(2)]];
    m.entradas.set("testnet/evento-uno", { ...entradaDe("otra"), sorteo: "5", mandados: ["5"], aviso: "pendiente" });
    await crearPaso(m.d).correr(SALA, contexto(m));
    expect(m.entradas.get("testnet/evento-uno")).toMatchObject({ sorteo: "5", mandados: ["5"], aviso: "pendiente" });
  });
});
