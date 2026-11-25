import { Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { canonicalList, listHash } from "../protocol/canonical";
import { randomnessOf } from "../protocol/quicknet";
import { roundTime } from "../protocol/quicknet-hora";
import { select } from "../protocol/select";
import type { RespuestaConsulta, RespuestaEnvio } from "../stellar/envio";
import { entradaDe } from "./ayuda-de-pruebas";
import type { RespuestaCruda } from "./cobro";
import type { Estado } from "./estados";
import { Flujo, type EntornoDelFlujo, type OpcionesDeInicio, type RpcDelFlujo } from "./flujo";
import type { Pagador } from "./pagador";
import { guardarSelloPendiente, leerCreacionPendiente, leerSelloPendiente, type Almacen, type SelloPendiente } from "./pendiente";
import type { PuenteKit } from "./puente-tipos";
import { RED_DE_PRUEBA } from "./red";
import type { ResultadoDeSimulacion } from "./rpc";
import { armarLectura } from "./transacciones";

const CUENTA = RED_DE_PRUEBA.verificador;
const FIRMA48 = "ab".repeat(48);
const INICIO_S = 1_800_000_000;
const NOMBRES = ["Ana", "Nora", "Beto"];
const GANADOR = select(randomnessOf(FIRMA48), listHash(canonicalList(NOMBRES.join("\n"))), 3, 1)[0] ?? 0;

const DOM = (name: string): Error => Object.assign(new Error(name), { name });

function almacenDeMemoria(): Almacen {
  const datos = new Map<string, string>();
  return { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v), removeItem: (k) => void datos.delete(k) };
}

interface Montaje {
  f: Flujo;
  estados: Estado[];
  reloj: { s: number };
  enviados: string[];
  simulados: string[];
  almacen: Almacen;
  firmadas: Array<{ entrada: string; vence: number }>;
  puente: PuenteKit;
  rpc: RpcDelFlujo;
}

interface Ajustes {
  /** Cuántos segundos tarda la persona en desbloquear, por cada vez. */
  desbloqueoS?: number[];
  firmarFalla?: Error;
  simulaciones?: Array<Partial<ResultadoDeSimulacion>>;
  consulta?: (n: number, hash: string) => RespuestaConsulta | Promise<RespuestaConsulta>;
  llaves?: Array<{ credentialId: string; contractId: string; estado: string }>;
  crearLlaveFalla?: Error;
  grifoFalla?: boolean;
  focoActual?: boolean;
  almacen?: Almacen;
  enviarEstado?: RespuestaEnvio["status"];
  revision?: { ok: true } | { ok: false; motivo: string };
  /** Con `false`, el sorteo no sale solo después del sello. */
  esperarSorteo?: boolean;
}

function montar(a: Ajustes = {}): Montaje {
  const reloj = { s: INICIO_S };
  const estados: Estado[] = [];
  const enviados: string[] = [];
  const simulados: string[] = [];
  const firmadas: Array<{ entrada: string; vence: number }> = [];
  const almacen = a.almacen ?? almacenDeMemoria();
  let desbloqueos = 0;
  let consultas = 0;
  let simulaciones = 0;

  const puente: PuenteKit = {
    crearLlave: async () => {
      if (a.crearLlaveFalla) throw a.crearLlaveFalla;
      return { credentialId: "cred", contractId: CUENTA, funcB64: "func", authB64: ["auth"] };
    },
    rehacerCreacion: async () => ({ contractId: CUENTA, funcB64: "func", authB64: ["auth"] }),
    anotarCreacion: async () => undefined,
    conectar: async (credentialId, contractId) => ({ credentialId, contractId }),
    volver: async () => ({ credentialId: "cred", contractId: CUENTA }),
    entrarConLlave: async () => ({ credentialId: "cred", contractId: CUENTA }),
    llavesGuardadas: async () => a.llaves ?? [],
    firmarEntrada: async (entrada, vence) => {
      if (a.firmarFalla) throw a.firmarFalla;
      reloj.s += a.desbloqueoS?.[desbloqueos] ?? 0;
      desbloqueos++;
      firmadas.push({ entrada, vence });
      return entradaDe(CUENTA, 555);
    },
  };

  const cruda = (hash: string): RespuestaCruda => ({ status: "SUCCESS", hash, ledger: 7 });
  const rpc: RpcDelFlujo = {
    secuencia: async () => "100",
    simular: async (tx) => {
      simulados.push(tx);
      const base: ResultadoDeSimulacion = { ok: true, authB64: [], latestLedger: 1000, simulacion: {} };
      return { ...base, ...(a.simulaciones?.[simulaciones++] ?? {}) };
    },
    ensamblar: (tx) => tx,
    enviar: async (tx) => {
      enviados.push(tx);
      return { status: a.enviarEstado ?? "PENDING" };
    },
    consultar: async (hash) => {
      const n = consultas++;
      if (a.consulta) return a.consulta(n, hash);
      return { status: "SUCCESS", cierre: reloj.s + 1, valor: 12n };
    },
    consultarCruda: async (hash) => cruda(hash),
  };

  const pagador: Pagador = { publica: Keypair.random().publicKey(), firmar: (t) => t, intentosDeGrifo: [{ http: 200, ms: 5 }], limitado: false };
  const entorno: EntornoDelFlujo = {
    puente,
    rpc,
    crearPagador: async () => {
      if (a.grifoFalla) throw new Error("grifo");
      return pagador;
    },
    ahoraS: () => reloj.s,
    ahoraMs: () => reloj.s * 1000,
    dormir: async (ms) => {
      reloj.s += ms / 1000;
    },
    traerRonda: async () => FIRMA48,
    aFirma96: async () => new Uint8Array(96).fill(1),
    hayFoco: () => a.focoActual ?? true,
    almacen,
    origen: "https://ejemplo.org",
    revisarNacimiento: () => a.revision ?? { ok: true },
    esperarSorteo: a.esperarSorteo ?? true,
    armarCreacion: ({ origen }) => armarLectura({ origen, secuencia: "1", id: 1n }),
  };
  const f = new Flujo(entorno);
  f.onEstado((e) => estados.push(e));
  return { f, estados, reloj, enviados, simulados, almacen, firmadas, puente, rpc };
}

const simulacionDeSello = (ledger = 1000): Partial<ResultadoDeSimulacion> => ({ authB64: [entradaDe(CUENTA)], latestLedger: ledger });
const registroDeSorteo = { winners: [GANADOR] };
const esperar = (f: Flujo, estado: Estado): Promise<void> => vi.waitFor(() => expect(f.estado).toBe(estado), { timeout: 5_000 });

const OPCIONES: OpcionesDeInicio = { host: "localhost", hayPasskeys: true, enApp: false, conBloqueo: true, punteroGrueso: false };

describe("crear la llave", () => {
  it("el camino feliz termina con la cuenta lista y mide el paso", async () => {
    const m = montar();
    await m.f.crear();
    expect(m.estados).toEqual(["mira-crear", "armando", "cuenta-lista"]);
    expect(m.f.medidas.cuenta?.contractId).toBe(CUENTA);
    expect(m.f.medidas.cuenta?.ledger).toBe(7);
    expect(m.f.medidas.pagador?.intentos).toEqual([{ http: 200, ms: 5 }]);
    expect(m.enviados).toHaveLength(1);
    expect(leerCreacionPendiente(m.almacen)).toBeNull();
  });

  it("si la persona cancela el desbloqueo vuelve al inicio sin mandar nada", async () => {
    const m = montar({ crearLlaveFalla: DOM("NotAllowedError") });
    await m.f.crear();
    expect(m.f.estado).toBe("inicio");
    expect(m.f.datos.cancelada).toBe(true);
    expect(m.enviados).toHaveLength(0);
    expect(m.f.medidas.fallas[0]).toMatchObject({ paso: "crear", motivo: "cancelada", conFoco: true });
  });

  it("sin el foco de la página el mismo error se anota como sin-foco", async () => {
    const m = montar({ crearLlaveFalla: DOM("NotAllowedError"), focoActual: false });
    await m.f.crear();
    expect(m.f.medidas.fallas[0]).toMatchObject({ motivo: "sin-foco", conFoco: false });
  });

  it("con el grifo caído la llave queda y la pantalla pide probar de nuevo sin otro desbloqueo", async () => {
    const m = montar({ grifoFalla: true });
    await m.f.crear();
    expect(m.f.estado).toBe("cuenta-sin-armar");
    expect(m.enviados).toHaveLength(0);
    expect(leerCreacionPendiente(m.almacen)?.credentialId).toBe("cred");
  });

  it("una creación que no pasa la revisión no se paga", async () => {
    const m = montar({ revision: { ok: false, motivo: "otro-codigo" } });
    await m.f.crear();
    expect(m.f.estado).toBe("no-se-armo");
    expect(m.f.error).toBe("nacimiento:otro-codigo");
    expect(m.enviados).toHaveLength(0);
  });
});

describe("sellar la lista", () => {
  async function conCuenta(a: Ajustes = {}): Promise<Montaje> {
    const m = montar({ esperarSorteo: false, ...a });
    await m.f.usarLlave();
    m.estados.length = 0;
    return m;
  }

  it("el camino feliz: un desbloqueo, un sello mandado, y queda esperando el sorteo", async () => {
    const m = await conCuenta({ simulaciones: [simulacionDeSello(1000), {}] });
    await m.f.sellar();
    expect(m.estados.slice(0, 4)).toEqual(["sellando", "mira-sellar", "sellando", "esperando"]);
    expect(m.firmadas).toHaveLength(1);
    expect(m.firmadas[0]?.vence).toBe(1060);
    expect(m.enviados).toHaveLength(1);
    expect(m.simulados).toHaveLength(2);
    expect(m.f.medidas.sello).toMatchObject({ id: "12", desbloqueos: 1 });
    expect(leerSelloPendiente(m.almacen)).toMatchObject({ id: "12", nombres: NOMBRES });
    expect(m.f.enlace).toContain("https://ejemplo.org/verificar.html#");
  });

  it("un desbloqueo lento (60 s) igual sella con un solo desbloqueo", async () => {
    const m = await conCuenta({ desbloqueoS: [60], simulaciones: [simulacionDeSello(), {}] });
    await m.f.sellar();
    expect(m.firmadas).toHaveLength(1);
    expect(m.enviados).toHaveLength(1);
    expect(m.f.medidas.sello?.desbloqueos).toBe(1);
  });

  it("un desbloqueo tan lento que la ronda ya no alcanza pide la ronda siguiente y otro desbloqueo, una sola vez", async () => {
    const m = await conCuenta({ desbloqueoS: [90, 0], simulaciones: [simulacionDeSello(), simulacionDeSello(), {}] });
    await m.f.sellar();
    expect(m.firmadas).toHaveLength(2);
    expect(m.enviados).toHaveLength(1);
    expect(m.f.estado).toBe("esperando");
  });

  it("si la persona cancela, no se manda nada y vuelve a la cuenta lista", async () => {
    const m = await conCuenta({ firmarFalla: DOM("NotAllowedError"), simulaciones: [simulacionDeSello()] });
    await m.f.sellar();
    expect(m.f.estado).toBe("cuenta-lista");
    expect(m.f.datos.cancelada).toBe(true);
    expect(m.enviados).toHaveLength(0);
  });

  it("si la simulación pide la entrada de otra cuenta, no se firma ni se manda", async () => {
    const m = await conCuenta({ simulaciones: [{ authB64: [entradaDe(RED_DE_PRUEBA.contrato)] }] });
    await m.f.sellar();
    expect(m.f.estado).toBe("no-se-sello");
    expect(m.firmadas).toHaveLength(0);
    expect(m.enviados).toHaveLength(0);
  });

  it("si el contrato rechaza el sello con la firma puesta, se dice y no se manda", async () => {
    const m = await conCuenta({ simulaciones: [simulacionDeSello(), { ok: false, error: "HostError: Error(Auth, InvalidAction)" }] });
    await m.f.sellar();
    expect(m.f.estado).toBe("no-se-sello");
    expect(m.f.error).toContain("simulacion-con-firma");
    expect(m.enviados).toHaveLength(0);
  });

  it("sin respuesta de la red nunca se manda un segundo sello distinto", async () => {
    const m = await conCuenta({
      simulaciones: [simulacionDeSello(), {}],
      consulta: async () => {
        throw new Error("sin red");
      },
    });
    await m.f.sellar();
    expect(m.f.estado).toBe("lento");
    expect(new Set(m.enviados).size).toBe(1);
    expect(m.simulados).toHaveLength(2);
  });

  it("con la red rechazando la transacción se dice, sin reintentar con otra", async () => {
    const m = await conCuenta({ simulaciones: [simulacionDeSello(), {}], enviarEstado: "ERROR" });
    await m.f.sellar();
    expect(m.f.estado).toBe("no-se-sello");
    expect(m.enviados).toHaveLength(1);
  });

  it("con el grifo caído al sellar muestra que la prueba no pudo arrancar", async () => {
    const m = await conCuenta({ grifoFalla: true });
    await m.f.sellar();
    expect(m.f.estado).toBe("sin-fondos");
    expect(m.f.medidas.fallas[0]?.motivo).toBe("grifo");
  });
});

describe("sortear", () => {
  it("después del sello espera la ronda, sortea y dice quién ganó, con el resultado que se rehace", async () => {
    const m = montar({ simulaciones: [simulacionDeSello(), {}, {}] });
    await m.f.usarLlave();
    // El valor que devuelve la confirmación es el número del sello primero y el registro del sorteo después.
    let llamadas = 0;
    m.rpc.consultar = async (): Promise<RespuestaConsulta> => ({ status: "SUCCESS", cierre: m.reloj.s + 1, valor: llamadas++ === 0 ? 12n : registroDeSorteo });
    await m.f.sellar();
    await esperar(m.f, "listo");
    expect(m.f.datos.ganador).toBe(NOMBRES[GANADOR]);
    expect(m.f.medidas.sorteo?.coincide).toBe(true);
    expect(m.f.medidas.sorteo?.ganadores).toEqual([NOMBRES[GANADOR]]);
    expect(leerSelloPendiente(m.almacen)).toBeNull();
    expect(m.f.enlace).toContain("verificar.html#");
    // No pide ningún desbloqueo para sortear: la llave firmó solo una vez.
    expect(m.firmadas).toHaveLength(1);
    const ronda = m.f.medidas.sello?.ronda ?? 0;
    expect(m.reloj.s).toBeGreaterThanOrEqual(roundTime(ronda));
  });

  const sello: SelloPendiente = { id: "12", ronda: 0, nombres: NOMBRES, hashSello: "ab".repeat(32), selladoEn: INICIO_S, credentialId: "cred" };

  it("si la página se recarga con un sello hecho, retoma con otro pagador y sortea", async () => {
    const almacen = almacenDeMemoria();
    const roundAt = INICIO_S + 125;
    // Una ronda que ya nació 5 segundos antes de "ahora".
    const ronda = Math.floor((roundAt - 1_692_803_367) / 3) + 1;
    guardarSelloPendiente({ ...sello, ronda }, almacen);
    const m = montar({ almacen });
    m.reloj.s = roundTime(ronda) + 5;
    m.rpc.consultar = async (): Promise<RespuestaConsulta> => ({ status: "SUCCESS", cierre: m.reloj.s + 1, valor: registroDeSorteo });
    await m.f.iniciar(OPCIONES);
    await esperar(m.f, "listo");
    expect(m.f.datos.ganador).toBe(NOMBRES[GANADOR]);
    expect(m.firmadas).toHaveLength(0);
    expect(leerSelloPendiente(almacen)).toBeNull();
  });

  it("si la ronda todavía no está lista para el contrato espera y vuelve a intentar", async () => {
    const almacen = almacenDeMemoria();
    const ronda = Math.floor((INICIO_S + 125 - 1_692_803_367) / 3) + 1;
    guardarSelloPendiente({ ...sello, ronda }, almacen);
    const m = montar({ almacen, simulaciones: [{ ok: false, error: "HostError: Error(Contract, #7)" }, {}] });
    m.reloj.s = roundTime(ronda) + 1;
    m.rpc.consultar = async (): Promise<RespuestaConsulta> => ({ status: "SUCCESS", cierre: m.reloj.s + 1, valor: registroDeSorteo });
    await m.f.iniciar(OPCIONES);
    await esperar(m.f, "listo");
    expect(m.simulados).toHaveLength(2);
  });

  it("si el sorteo ya salió, lee el registro y sigue", async () => {
    const almacen = almacenDeMemoria();
    const ronda = Math.floor((INICIO_S + 125 - 1_692_803_367) / 3) + 1;
    guardarSelloPendiente({ ...sello, ronda }, almacen);
    const m = montar({ almacen, simulaciones: [{ ok: false, error: "HostError: Error(Contract, #2)" }, {}] });
    m.reloj.s = roundTime(ronda) + 1;
    // La lectura devuelve el registro como valor en base64: acá se cambia la simulación.
    const registro = nativeToScVal({ winners: [GANADOR] }, { type: { winners: ["symbol", null] } });
    m.rpc.simular = (async (tx: string) => {
      m.simulados.push(tx);
      if (m.simulados.length === 1) return { ok: false, authB64: [], latestLedger: 1, error: "HostError: Error(Contract, #2)", simulacion: {} };
      return { ok: true, authB64: [], latestLedger: 1, retornoB64: registro.toXDR("base64"), simulacion: {} };
    }) as RpcDelFlujo["simular"];
    await m.f.iniciar(OPCIONES);
    await esperar(m.f, "listo");
    expect(m.enviados).toHaveLength(0);
    expect(m.f.datos.ganador).toBe(NOMBRES[GANADOR]);
  });

  it("si la simulación del sorteo falla por otra causa, queda trabado y se puede volver a probar", async () => {
    const almacen = almacenDeMemoria();
    const ronda = Math.floor((INICIO_S + 125 - 1_692_803_367) / 3) + 1;
    guardarSelloPendiente({ ...sello, ronda }, almacen);
    const m = montar({ almacen, simulaciones: [{ ok: false, error: "HostError: Error(Contract, #8)" }] });
    m.reloj.s = roundTime(ronda) + 1;
    await m.f.iniciar(OPCIONES);
    await esperar(m.f, "sorteo-trabado");
    expect(m.enviados).toHaveLength(0);
    expect(m.f.error).toContain("simulacion");
  });
});

describe("al abrir la página", () => {
  it("el camino normal abre en el inicio", async () => {
    const m = montar();
    await m.f.iniciar(OPCIONES);
    expect(m.f.estado).toBe("inicio");
  });

  it("con una llave ya creada en este aparato ofrece usarla", async () => {
    const m = montar({ llaves: [{ credentialId: "cred", contractId: CUENTA, estado: "deployed" }] });
    await m.f.iniciar(OPCIONES);
    expect(m.f.estado).toBe("ya-hay-llave");
  });

  it("con una llave sin cuenta ofrece rehacer la cuenta", async () => {
    const m = montar({ llaves: [{ credentialId: "cred", contractId: CUENTA, estado: "pending" }] });
    await m.f.iniciar(OPCIONES);
    expect(m.f.estado).toBe("cuenta-sin-armar");
  });

  it("en un anfitrión fuera de la lista no ofrece nada", async () => {
    const m = montar();
    await m.f.iniciar({ ...OPCIONES, host: "tinkazo.app" });
    expect(m.f.estado).toBe("no-es-aca");
  });

  it("entrar con una llave de otro aparato: cancelar vuelve al inicio y no encontrarla lo dice", async () => {
    const m = montar();
    m.puente.entrarConLlave = async () => {
      throw DOM("NotAllowedError");
    };
    await m.f.entrar();
    expect(m.f.estado).toBe("inicio");
    expect(m.f.datos.cancelada).toBe(true);

    m.puente.entrarConLlave = async () => {
      throw new Error("Smart account contract not found");
    };
    await m.f.entrar();
    expect(m.f.estado).toBe("no-aparece");
  });

  it("se acaba el tiempo de una pantalla de espera: pasa a la que corresponde, y solo si seguía en ella", () => {
    const m = montar();
    (m.f as unknown as { ir: (e: Estado) => void }).ir("mira-crear");
    m.f.alTope("armando");
    expect(m.f.estado).toBe("mira-crear");
    m.f.alTope("mira-crear");
    expect(m.f.estado).toBe("inicio");
    (m.f as unknown as { ir: (e: Estado) => void }).ir("sellando");
    m.f.alTope("sellando");
    expect(m.f.estado).toBe("lento");
  });
});
