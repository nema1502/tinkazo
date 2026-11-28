import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { RespuestaConsulta, RespuestaEnvio } from "../stellar/envio";
import { entradaDe, entradaDeTransferencia, eventoDeTransferencia } from "./ayuda-de-pruebas";
import type { RespuestaCruda } from "./cobro";
import { destinoDeLaPagina, type OpcionesDePremio } from "./destino";
import type { Estado } from "./estados";
import { Flujo, type EntornoDelFlujo, type OpcionesDeInicio, type RpcDelFlujo } from "./flujo";
import type { Pagador } from "./pagador";
import { anotarRegistroDePremio, guardarEnvioPendiente, leerEnvioPendiente, leerPremioPendiente, leerRegistroDePremio, type Almacen } from "./pendiente";
import { MONTO_DEL_PREMIO, NOTA_DE_PRUEBA } from "./premio";
import type { PuenteKit } from "./puente-tipos";
import { RED_DE_PRUEBA } from "./red";
import type { ResultadoDeSimulacion } from "./rpc";
import { armarLectura, operacionDeTransferencia } from "./transacciones";

/**
 * El modo premio del flujo: recibir las monedas de prueba una sola vez por billetera creada y mandarlas con un desbloqueo.
 * Todo con falsos, sin red ni navegador.
 */

const CUENTA = RED_DE_PRUEBA.verificador;
const INICIO_S = 1_800_000_000;
const DOM = (name: string): Error => Object.assign(new Error(name), { name });
const OPCIONES: OpcionesDeInicio = { host: "localhost", hayPasskeys: true, enApp: false, conBloqueo: true, punteroGrueso: false };

function almacenDeMemoria(): Almacen {
  const datos = new Map<string, string>();
  return { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v), removeItem: (k) => void datos.delete(k) };
}

interface Ajustes {
  premio?: OpcionesDePremio;
  /** Las monedas que tiene la billetera al empezar. */
  saldo?: bigint;
  simulaciones?: Array<Partial<ResultadoDeSimulacion>>;
  consulta?: (n: number, hash: string) => RespuestaConsulta | Promise<RespuestaConsulta>;
  firmarFalla?: Error;
  crearLlaveFalla?: Error;
  pideNota?: (cuenta: string) => Promise<boolean | null>;
  almacen?: Almacen;
  llaves?: Array<{ credentialId: string; contractId: string; estado: string }>;
}

function montar(a: Ajustes = {}) {
  const reloj = { s: INICIO_S };
  const estados: Estado[] = [];
  const enviados: string[] = [];
  const simulados: string[] = [];
  const firmadas: string[] = [];
  const almacen = a.almacen ?? almacenDeMemoria();
  const saldos = new Map<string, bigint>([[CUENTA, a.saldo ?? 0n]]);
  const destino = Keypair.random();
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
    entrarConLlave: async (avisos) => {
      avisos?.alTerminarElDesbloqueo?.();
      return { credentialId: "cred", contractId: CUENTA, entrada: { fuente: "historial", ledgerDeNacimiento: 99, segundosBuscando: 1.2, desbloqueos: 1 } };
    },
    llavesGuardadas: async () => a.llaves ?? [],
    firmarEntrada: async (entrada) => {
      if (a.firmarFalla) throw a.firmarFalla;
      desbloqueos++;
      firmadas.push(entrada);
      return entradaDe(CUENTA, 555);
    },
    desbloqueosHechos: () => desbloqueos,
  };

  const rpc: RpcDelFlujo = {
    secuencia: async () => "100",
    simular: async (tx) => {
      simulados.push(tx);
      const base: ResultadoDeSimulacion = { ok: true, authB64: [], latestLedger: 1000, simulacion: {} };
      return { ...base, ...(a.simulaciones?.[simulaciones++] ?? {}) };
    },
    ensamblar: (tx) => tx,
    enviar: async (tx): Promise<RespuestaEnvio> => {
      enviados.push(tx);
      return { status: "PENDING" };
    },
    consultar: async (hash) => {
      const n = consultas++;
      if (a.consulta) return a.consulta(n, hash);
      return { status: "SUCCESS", cierre: reloj.s + 1, valor: 12n };
    },
    consultarCruda: async (hash): Promise<RespuestaCruda> => ({ status: "SUCCESS", hash, ledger: 7 }),
    saldoDeContrato: async (c) => ({ stroops: saldos.get(c) ?? 0n, vence: 5_000, archivada: false, latestLedger: 1_000 }),
    saldoDeCuenta: async () => 20_000_000n,
  };

  const pagador: Pagador = { publica: Keypair.random().publicKey(), firmar: (t) => t, intentosDeGrifo: [{ http: 200, ms: 5 }], limitado: false };
  const entorno: EntornoDelFlujo = {
    puente,
    rpc,
    crearPagador: async () => pagador,
    ahoraS: () => reloj.s,
    ahoraMs: () => reloj.s * 1000,
    dormir: async (ms) => {
      reloj.s += ms / 1000;
    },
    traerRonda: async () => "ab".repeat(48),
    aFirma96: async () => new Uint8Array(96).fill(1),
    hayFoco: () => true,
    almacen,
    origen: "https://ejemplo.org",
    revisarNacimiento: () => ({ ok: true }),
    esperarSorteo: false,
    armarCreacion: ({ origen }) => armarLectura({ origen, secuencia: "1", id: 1n }),
    ...(a.premio !== undefined ? { premio: a.premio } : {}),
    ...(a.pideNota ? { pideNota: a.pideNota } : {}),
    llaveDeDestino: () => ({ publica: destino.publicKey(), firmar: (t) => t }),
  };
  const f = new Flujo(entorno);
  f.onEstado((e) => estados.push(e));
  return { f, estados, enviados, simulados, firmadas, almacen, puente, rpc, saldos, destino };
}

type Montaje = ReturnType<typeof montar>;

/** La operación que la página pide con el destino que arma ella. */
const operacionDeLaPagina = (m: Montaje, monto = MONTO_DEL_PREMIO) => operacionDeTransferencia({ desde: CUENTA, hacia: destinoDeLaPagina(m.destino.publicKey()).hacia, monto });
/** La simulación de grabar de esa operación: trae la entrada de la billetera. */
const simuladaPara = (op: ReturnType<typeof operacionDeTransferencia>): Partial<ResultadoDeSimulacion> => ({ authB64: [entradaDeTransferencia(CUENTA, op, "direccion")], latestLedger: 1000 });
const entra = async (): Promise<RespuestaConsulta> => ({ status: "SUCCESS", cierre: 1, valor: 12n });
const sinRespuestaLuegoDelPrimero = async (n: number): Promise<RespuestaConsulta> => {
  if (n === 0) return entra();
  throw new Error("sin red");
};

/** Una billetera ya conectada con las monedas, en la pantalla con las monedas. */
async function conMonedas(a: Ajustes = {}): Promise<Montaje> {
  const m = montar({ premio: { destino: null }, saldo: MONTO_DEL_PREMIO, ...a });
  await m.f.usarLlave();
  expect(m.f.estado).toBe("premio-listo");
  m.estados.length = 0;
  return m;
}

describe("al empezar en el modo premio", () => {
  it("cancelar la huella al crear termina en el inicio del premio con la línea de cancelada", async () => {
    const m = montar({ premio: { destino: null }, crearLlaveFalla: DOM("NotAllowedError") });
    await m.f.crear();
    expect(m.f.estado).toBe("premio-inicio");
    expect(m.f.datos.cancelada).toBe(true);
    expect(m.enviados).toHaveLength(0);
  });

  it("el tope de esperar el desbloqueo de crear termina en el inicio del premio", () => {
    const m = montar({ premio: { destino: null } });
    (m.f as unknown as { ir: (e: Estado) => void }).ir("mira-crear");
    m.f.alTope("mira-crear");
    expect(m.f.estado).toBe("premio-inicio");
  });

  it("una llave sin cuenta al recargar ofrece armar la cuenta, y sin llave abre en el inicio del premio", async () => {
    const a = montar({ premio: { destino: null }, llaves: [{ credentialId: "cred", contractId: CUENTA, estado: "pending" }] });
    await a.f.iniciar(OPCIONES);
    expect(a.f.estado).toBe("cuenta-sin-armar");
    const b = montar({ premio: { destino: null } });
    await b.f.iniciar(OPCIONES);
    expect(b.f.estado).toBe("premio-inicio");
  });

  it("con un envío mandado y sin confirmar, abre en el aviso de que tarda", async () => {
    const almacen = almacenDeMemoria();
    guardarEnvioPendiente(
      { contractId: CUENTA, hash: "ab".repeat(32), vence: 1_800_000_030, hacia: "GX", base: "GX", tipo: "G", origen: "pagina", nota: null, monto: "100000000", desdeMs: 1_800_000_000_000 },
      almacen,
    );
    const m = montar({ premio: { destino: null }, almacen });
    await m.f.iniciar(OPCIONES);
    expect(m.f.estado).toBe("lento");
  });

  it("en el modo de hoy crear sigue en la cuenta lista y no lee ningún saldo", async () => {
    const m = montar();
    let lecturas = 0;
    m.rpc.saldoDeContrato = async () => {
      lecturas++;
      return { stroops: 0n, vence: null, archivada: false, latestLedger: 1 };
    };
    await m.f.crear();
    expect(m.f.estado).toBe("cuenta-lista");
    expect(lecturas).toBe(0);
  });
});

describe("recibir el premio", () => {
  it("crear la billetera paga el premio sin pedir otro desbloqueo, y anota pagado", async () => {
    const m = montar({ premio: { destino: null } });
    await m.f.crear();
    expect(m.estados).toEqual(["mira-crear", "armando", "recibiendo", "premio-listo"]);
    expect(m.f.datos).toMatchObject({ recibido: true, monto: "100000000" });
    expect(m.firmadas).toHaveLength(0);
    expect(m.enviados).toHaveLength(2);
    expect(leerRegistroDePremio(CUENTA, m.almacen)).toMatchObject({ estado: "pagado" });
    expect(leerPremioPendiente(m.almacen)).toBeNull();
    expect(m.f.medidas.premio).toMatchObject({ monto: "100000000" });
  });

  it("con el registro en pagado no se manda otro premio, sea cual sea el saldo", async () => {
    const m = montar({ premio: { destino: null } });
    await m.f.crear();
    const antes = m.enviados.length;
    m.saldos.set(CUENTA, 0n);
    await m.f.recibir();
    expect(m.f.estado).toBe("sin-monedas");
    m.saldos.set(CUENTA, 5n);
    await m.f.recibir();
    expect(m.f.estado).toBe("premio-listo");
    expect(m.f.datos.recibido).toBe(false);
    expect(m.enviados).toHaveLength(antes);
  });

  it("entrar desde otro aparato con saldo en cero y sin registro va a sin monedas sin mandar nada", async () => {
    const m = montar({ premio: { destino: null } });
    await m.f.entrar();
    expect(m.f.estado).toBe("sin-monedas");
    expect(m.f.datos.yaEnviadas).toBe(false);
    expect(m.enviados).toHaveLength(0);
    m.saldos.set(CUENTA, MONTO_DEL_PREMIO);
    await m.f.entrar();
    expect(m.f.estado).toBe("premio-listo");
    expect(m.f.datos).toMatchObject({ recibido: false, monto: "100000000" });
    expect(m.enviados).toHaveLength(0);
  });

  it("una entrada que no es la transferencia pedida no se manda", async () => {
    const m = montar({ premio: { destino: null }, simulaciones: [{}, { authB64: [entradaDe(CUENTA)] }] });
    await m.f.crear();
    expect(m.f.estado).toBe("no-llego-premio");
    expect(m.enviados).toHaveLength(1);
  });

  it("sin respuesta queda en lento con el pago guardado, y Mirar de nuevo lo cierra sin mandar otro", async () => {
    const m = montar({ premio: { destino: null }, consulta: sinRespuestaLuegoDelPrimero });
    await m.f.crear();
    expect(m.f.estado).toBe("lento");
    expect(leerPremioPendiente(m.almacen)).not.toBeNull();
    const mandados = new Set(m.enviados).size;
    await m.f.mirar();
    expect(m.f.estado).toBe("premio-listo");
    expect(new Set(m.enviados).size).toBe(mandados);
    expect(leerPremioPendiente(m.almacen)).toBeNull();
    expect(leerRegistroDePremio(CUENTA, m.almacen)?.estado).toBe("pagado");
  });

  it("si leer el saldo falla después de que entró, termina en las monedas con lo pagado y sin otro sobre", async () => {
    const m = montar({ premio: { destino: null } });
    m.rpc.saldoDeContrato = async () => {
      throw new Error("sin red");
    };
    await m.f.crear();
    expect(m.f.estado).toBe("premio-listo");
    expect(m.f.medidas.premio?.saldoDespues).toBeNull();
    expect(m.f.medidas.fallas.some((f) => f.motivo === "lectura-saldo")).toBe(true);
    expect(m.enviados).toHaveLength(2);
  });

  it("por pagar y sin pago guardado (la página se cerró antes de mandar) va a no llegó, y Probar de nuevo paga una sola vez", async () => {
    const almacen = almacenDeMemoria();
    anotarRegistroDePremio({ contractId: CUENTA, estado: "por-pagar", hashPremio: null, hashEnvio: null }, almacen);
    const m = montar({ premio: { destino: null }, almacen, llaves: [{ credentialId: "cred", contractId: CUENTA, estado: "deployed" }] });
    await m.f.iniciar(OPCIONES);
    expect(m.f.estado).toBe("ya-hay-llave");
    await m.f.usarLlave();
    expect(m.f.estado).toBe("no-llego-premio");
    expect(m.enviados).toHaveLength(0);
    await m.f.reintentar();
    expect(m.f.estado).toBe("premio-listo");
    expect(m.enviados).toHaveLength(1);
    await m.f.recibir();
    expect(m.enviados).toHaveLength(1);
  });

  it("se acaba el tiempo de recibir o de mandar: pasa a lento, y el de esperar el desbloqueo de mandar vuelve a las monedas", async () => {
    const m = await conMonedas();
    const ir = (e: Estado): void => (m.f as unknown as { ir: (x: Estado) => void }).ir(e);
    ir("recibiendo");
    m.f.alTope("recibiendo");
    expect(m.f.estado).toBe("lento");
    ir("enviando");
    m.f.alTope("enviando");
    expect(m.f.estado).toBe("lento");
    ir("mira-mandar");
    m.f.alTope("mira-mandar");
    expect(m.f.estado).toBe("premio-listo");
    expect(m.f.datos.cancelada).toBe(true);
  });
});

describe("mandar las monedas", () => {
  it("con el destino que arma la página: un desbloqueo, una cuenta de prueba y un envío, con todo medido", async () => {
    const m = await conMonedas();
    // La simulación de grabar trae la entrada de la billetera. La segunda, con la firma puesta, pasa.
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async (tx) => {
      m.simulados.push(tx);
      const base: ResultadoDeSimulacion = { ok: true, authB64: [], latestLedger: 1000, simulacion: {} };
      return n++ === 0 ? { ...base, ...simuladaPara(op) } : base;
    };
    await m.f.mandar();
    expect(m.estados).toEqual(["enviando", "mira-mandar", "enviando", "enviado"]);
    expect(m.firmadas).toHaveLength(1);
    expect(m.enviados).toHaveLength(2);
    const paso = m.f.medidas.envios[0];
    expect(paso).toMatchObject({
      desbloqueos: 1,
      raiz: "exacta",
      monto: "100000000",
      destino: { tipo: "M", origen: "pagina", direccion: m.destino.publicKey(), fin: m.destino.publicKey().slice(-4) },
      notaPedida: NOTA_DE_PRUEBA.toString(),
      notaEnvio: "sin-dato",
    });
    expect(m.f.datos).toMatchObject({ notaEnvio: "sin-dato", nota: NOTA_DE_PRUEBA.toString(), monto: "100000000" });
    expect(m.f.medidas.destinoDePrueba?.publica).toBe(m.destino.publicKey());
    expect(leerRegistroDePremio(CUENTA, m.almacen)?.estado).toBe("enviado");
    expect(leerEnvioPendiente(m.almacen)).toBeNull();
  });

  it("si la red deja en el evento la misma nota que se pidió, queda confirmada", async () => {
    const m = await conMonedas();
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async (tx) => {
      m.simulados.push(tx);
      const base: ResultadoDeSimulacion = { ok: true, authB64: [], latestLedger: 1000, simulacion: {} };
      return n++ === 0 ? { ...base, ...simuladaPara(op) } : base;
    };
    m.rpc.consultarCruda = async (hash) => ({
      status: "SUCCESS",
      hash,
      ledger: 8,
      events: { contractEventsXdr: [[eventoDeTransferencia({ contrato: RED_DE_PRUEBA.activo, desde: CUENTA, hacia: m.destino.publicKey(), monto: MONTO_DEL_PREMIO, nota: NOTA_DE_PRUEBA })]] },
    });
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    expect(m.f.datos.notaEnvio).toBe("confirmada");
    expect(m.f.medidas.envios[0]).toMatchObject({ notaEnvio: "confirmada", notaVista: NOTA_DE_PRUEBA.toString() });
  });

  it("un puente que pide dos desbloqueos al firmar deja desbloqueos en dos", async () => {
    const m = await conMonedas();
    const op = operacionDeLaPagina(m);
    let sim = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: sim++ === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    let n = 0;
    m.puente.desbloqueosHechos = () => n;
    m.puente.firmarEntrada = async () => {
      n += 2;
      return entradaDe(CUENTA, 555);
    };
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    expect(m.f.medidas.envios[0]?.desbloqueos).toBe(2);
  });

  it("cancelar el desbloqueo vuelve a las monedas sin mandar el envío", async () => {
    const m = await conMonedas({ firmarFalla: DOM("NotAllowedError") });
    const op = operacionDeLaPagina(m);
    m.rpc.simular = async () => ({ ok: true, authB64: [entradaDeTransferencia(CUENTA, op, "direccion")], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("premio-listo");
    expect(m.f.datos.cancelada).toBe(true);
    expect(leerEnvioPendiente(m.almacen)).toBeNull();
    expect(m.f.medidas.envios).toHaveLength(0);
    // Solo se mandó la cuenta de prueba que pide nota: ninguna moneda salió.
    expect(m.enviados).toHaveLength(1);
  });

  it("una entrada que no es la transferencia pedida no pide el desbloqueo", async () => {
    const m = await conMonedas();
    const otra = operacionDeLaPagina(m, MONTO_DEL_PREMIO + 1n);
    m.rpc.simular = async () => ({ ok: true, authB64: [entradaDeTransferencia(CUENTA, otra, "direccion")], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("no-se-envio");
    expect(m.firmadas).toHaveLength(0);
  });

  it("una entrada con la G de abajo en lugar de la M manda y anota normalizada", async () => {
    const m = await conMonedas();
    const conLaG = operacionDeTransferencia({ desde: CUENTA, hacia: m.destino.publicKey(), monto: MONTO_DEL_PREMIO });
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ === 0 ? [entradaDeTransferencia(CUENTA, conLaG, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    expect(m.f.medidas.envios[0]?.raiz).toBe("normalizada");
  });

  it("una G del enlace que pide nota y no trae nota da pide-nota, sin simular ni pedir el desbloqueo", async () => {
    const g = Keypair.random().publicKey();
    const m = await conMonedas({ premio: { destino: { direccion: g, nota: null } }, pideNota: async () => true });
    await m.f.mandar();
    expect(m.f.estado).toBe("pide-nota");
    expect(m.simulados).toHaveLength(0);
    expect(m.firmadas).toHaveLength(0);
    expect(m.enviados).toHaveLength(0);
  });

  it("si el historial no contesta, no se manda: no se envió, sin desbloqueo", async () => {
    const g = Keypair.random().publicKey();
    const m = await conMonedas({ premio: { destino: { direccion: g, nota: null } }, pideNota: async () => null });
    await m.f.mandar();
    expect(m.f.estado).toBe("no-se-envio");
    expect(m.firmadas).toHaveLength(0);
    expect(m.enviados).toHaveLength(0);
  });

  it("una simulación que falla da no-recibe con un destino del enlace y no-se-envio con el de la página", async () => {
    const g = Keypair.random().publicKey();
    const a = await conMonedas({ premio: { destino: { direccion: g, nota: 5n } }, simulaciones: [{ ok: false, error: "HostError" }] });
    await a.f.mandar();
    expect(a.f.estado).toBe("no-recibe");
    expect(a.firmadas).toHaveLength(0);
    const b = await conMonedas({ simulaciones: [{ ok: false, error: "HostError" }] });
    await b.f.mandar();
    expect(b.f.estado).toBe("no-se-envio");
    expect(b.firmadas).toHaveLength(0);
  });

  it("una simulación que pide restaurar va a vencida, sin desbloqueo", async () => {
    const m = await conMonedas({ simulaciones: [{ ok: false, restaurar: true, error: "restaurar" }] });
    await m.f.mandar();
    expect(m.f.estado).toBe("vencida");
    expect(m.firmadas).toHaveLength(0);
  });

  it("mandarse a la propia cuenta da no-recibe y no simula nada", async () => {
    const m = await conMonedas({ premio: { destino: { direccion: CUENTA, nota: null } } });
    await m.f.mandar();
    expect(m.f.estado).toBe("no-recibe");
    expect(m.simulados).toHaveLength(0);
  });

  it("sin respuesta deja el envío guardado antes de mandar, y Mirar de nuevo con SUCCESS lo cierra sin mandar otro", async () => {
    const m = await conMonedas({ consulta: sinRespuestaLuegoDelPrimero });
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("lento");
    expect(leerEnvioPendiente(m.almacen)).not.toBeNull();
    const cantidad = m.enviados.length;
    await m.f.mirar();
    expect(m.f.estado).toBe("enviado");
    expect(m.enviados).toHaveLength(cantidad);
    expect(leerEnvioPendiente(m.almacen)).toBeNull();
    expect(m.f.medidas.envios[0]).toMatchObject({ desbloqueos: null, raiz: null });
  });

  it("Mirar de nuevo con NOT_FOUND antes de la hora sigue en lento, y pasada la hora vuelve a las monedas", async () => {
    const m = await conMonedas({ consulta: sinRespuestaLuegoDelPrimero });
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    const p = leerEnvioPendiente(m.almacen);
    expect(p).not.toBeNull();
    const vence = p?.vence ?? 0;
    m.rpc.consultarCruda = async (hash) => ({ status: "NOT_FOUND", hash, latestLedgerCloseTime: vence - 10 });
    await m.f.mirar();
    expect(m.f.estado).toBe("lento");
    expect(leerEnvioPendiente(m.almacen)).not.toBeNull();
    m.rpc.consultarCruda = async (hash) => ({ status: "NOT_FOUND", hash, latestLedgerCloseTime: vence + 10 });
    await m.f.mirar();
    await new Promise((r) => setTimeout(r, 0));
    expect(m.f.estado).toBe("premio-listo");
    expect(leerEnvioPendiente(m.almacen)).toBeNull();
  });

  it("un sobre vencido se rearma una vez con otro desbloqueo, y nunca se mandan dos distintos sin saber", async () => {
    const m = await conMonedas({
      consulta: async (n) => (n === 1 ? { status: "NOT_FOUND", cierre: 9_999_999_999 } : entra()),
    });
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ % 2 === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    expect(m.firmadas).toHaveLength(2);
    expect(m.f.medidas.envios).toHaveLength(1);
  });

  it("si leer los saldos o el cobro falla después de que entró, termina en enviado y no arma otra transferencia", async () => {
    const m = await conMonedas();
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    let lecturas = 0;
    m.rpc.saldoDeContrato = async () => {
      if (lecturas++ > 0) throw new Error("sin red");
      return { stroops: MONTO_DEL_PREMIO, vence: 5_000, archivada: false, latestLedger: 1_000 };
    };
    m.rpc.saldoDeCuenta = async () => {
      throw new Error("sin red");
    };
    m.rpc.consultarCruda = async () => {
      throw new Error("sin red");
    };
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    expect(n).toBe(2);
    expect(m.enviados).toHaveLength(2);
    expect(leerRegistroDePremio(CUENTA, m.almacen)?.estado).toBe("enviado");
  });

  it("reintentar desde no-se-envio con el saldo en cero va a sin monedas y nunca paga un premio", async () => {
    const m = await conMonedas({ simulaciones: [{ ok: false, error: "x" }] });
    await m.f.mandar();
    expect(m.f.estado).toBe("no-se-envio");
    m.saldos.set(CUENTA, 0n);
    const antes = m.enviados.length;
    await m.f.reintentar();
    expect(m.f.estado).toBe("sin-monedas");
    expect(m.enviados).toHaveLength(antes);
  });

  it("el destino de la página se arma una sola vez por carga, aunque haya un reintento", async () => {
    const m = await conMonedas();
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => {
      const i = n++;
      return i === 0 ? { ok: false, authB64: [], latestLedger: 1000, error: "x", simulacion: {} } : { ok: true, authB64: i === 1 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} };
    };
    await m.f.mandar();
    expect(m.f.estado).toBe("no-se-envio");
    expect(m.enviados).toHaveLength(1);
    await m.f.reintentar();
    expect(m.f.estado).toBe("enviado");
    expect(m.enviados).toHaveLength(2);
  });

  it("mandar, recargar y volver a entrar termina en sin monedas con la línea de las ya mandadas, sin otro premio", async () => {
    const m = await conMonedas();
    const op = operacionDeLaPagina(m);
    let n = 0;
    m.rpc.simular = async () => ({ ok: true, authB64: n++ === 0 ? [entradaDeTransferencia(CUENTA, op, "direccion")] : [], latestLedger: 1000, simulacion: {} });
    await m.f.mandar();
    expect(m.f.estado).toBe("enviado");
    const otra = montar({ premio: { destino: null }, almacen: m.almacen, saldo: 0n });
    await otra.f.entrar();
    expect(otra.f.estado).toBe("sin-monedas");
    expect(otra.f.datos.yaEnviadas).toBe(true);
    expect(otra.enviados).toHaveLength(0);
  });
});
