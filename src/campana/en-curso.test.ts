// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_ORG, type MemoriaDeOrg, type FaseDeSala, borrarOrg, guardarOrg } from "../sala/campana-org";
import { network } from "../stellar/config";
import { type WalletAdapter, setActiveWallet } from "../stellar/wallet-lite";
import {
  CLAVE_DE_LA_SALA,
  CLAVE_SORTEOS,
  MAX_SORTEOS,
  VIDA_CAMPANA_MS,
  type SorteoDeCampana,
  campanaDeLaLista,
  cuentaConectada,
  entradaDelEvento,
  esListaDeCampana,
  esSorteoDeCampana,
  guardarSorteoDeCampana,
  hayCampanaActiva,
  leerSorteosDeCampana,
  listaCambiadaDeLaCampana,
  salaDeCampanaActiva,
} from "./en-curso";

/**
 * Lo que la herramienta recuerda de un sorteo de empresa: de qué sorteos es la campaña y qué lista pasó el panel. Fuera de
 * una campaña, todo da falso o `null`: así el resto de la herramienta se comporta como siempre.
 */

const AHORA = 1_800_000_000_000;
const HUELLA = "ab".repeat(32);
const TOKEN = "T".repeat(22);
const sala = (evento = "evento-uno") => ({
  id: "AbCd1234",
  token: TOKEN,
  clave: "C".repeat(22),
  vence: AHORA + VIDA_CAMPANA_MS,
  servicio: "https://s.tinkazo.app",
  evento,
  red: network.name,
});

const entrada = (cambios: Partial<SorteoDeCampana> = {}): SorteoDeCampana => ({
  evento: "evento-uno",
  red: network.name,
  contrato: network.contractId ?? "",
  huella: HUELLA,
  premios: 2,
  organizadora: null,
  pasadaEn: AHORA - 60_000,
  ...cambios,
});

function ponerSala(fase: FaseDeSala, evento = "evento-uno"): void {
  const memoria: MemoriaDeOrg = { sala: sala(evento), fase };
  guardarOrg(localStorage, memoria, AHORA);
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_CAMPANAS", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("de qué sorteos es la campaña", () => {
  it("con una entrada de esta red y este contrato, el número 777 es de la campaña y el 778 no", () => {
    guardarSorteoDeCampana(entrada({ sorteo: "777", mandados: ["777"] }));
    expect(esSorteoDeCampana(777n)).toBe(true);
    expect(esSorteoDeCampana(778n)).toBe(false);
  });

  it("un sorteo mandado sin respuesta definitiva también es de la campaña", () => {
    guardarSorteoDeCampana(entrada({ sorteo: "777", mandados: ["776", "777"] }));
    expect(esSorteoDeCampana(776n)).toBe(true);
  });

  it("sin la bandera es falso", () => {
    guardarSorteoDeCampana(entrada({ sorteo: "777" }));
    vi.stubEnv("VITE_CAMPANAS", "");
    expect(esSorteoDeCampana(777n)).toBe(false);
  });

  it("sin memoria, con otra red o con otro contrato es falso", () => {
    expect(esSorteoDeCampana(777n)).toBe(false);
    guardarSorteoDeCampana(entrada({ sorteo: "777", red: network.name === "mainnet" ? "testnet" : "mainnet" }));
    expect(esSorteoDeCampana(777n)).toBe(false);
    guardarSorteoDeCampana(entrada({ sorteo: "777", contrato: "CTRATODISTINTO" }));
    expect(esSorteoDeCampana(777n)).toBe(false);
  });

  it("sin número de sorteo es falso", () => {
    guardarSorteoDeCampana(entrada({ sorteo: "777" }));
    expect(esSorteoDeCampana(undefined)).toBe(false);
  });

  it("con un almacenamiento que lanza es falso y no lanza", () => {
    const roto = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(esSorteoDeCampana(777n, roto)).toBe(false);
    expect(leerSorteosDeCampana(roto)).toEqual([]);
    expect(() => guardarSorteoDeCampana(entrada(), roto)).not.toThrow();
  });

  it("lo guardado que no se entiende se descarta", () => {
    localStorage.setItem(CLAVE_SORTEOS, "esto no es json");
    expect(leerSorteosDeCampana()).toEqual([]);
    localStorage.setItem(CLAVE_SORTEOS, JSON.stringify([{ evento: 1 }, "x", entrada({ sorteo: "5" })]));
    expect(leerSorteosDeCampana().map((e) => e.sorteo)).toEqual(["5"]);
  });
});

describe("la lista que pasó el panel", () => {
  it("da la entrada de esa huella con la sala cerrada de ese evento", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    expect(campanaDeLaLista(HUELLA, AHORA)?.premios).toBe(2);
  });

  it("da null para otra huella", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    expect(campanaDeLaLista("cd".repeat(32), AHORA)).toBeNull();
  });

  it("da null sin la bandera", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    vi.stubEnv("VITE_CAMPANAS", "");
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });

  it("da null si la entrada tiene la huella pero no hay memoria de la sala de ese evento", () => {
    guardarSorteoDeCampana(entrada());
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
    ponerSala("cerrada", "otro-evento");
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });

  it("da null si la sala ya no está en cerrada", () => {
    guardarSorteoDeCampana(entrada());
    ponerSala("abierta");
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
    ponerSala("sellada");
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });

  it("da null si la entrada venció a las 24 horas", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ pasadaEn: AHORA - VIDA_CAMPANA_MS - 1 }));
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });

  it("da null si el resultado ya está hecho o si ya hay un sorteo sin resolver", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ resultado: "hecho" }));
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
    guardarSorteoDeCampana(entrada({ sorteo: "5", mandados: ["5"], aviso: "pendiente" }));
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });

  it("da null con otro contrato", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ contrato: "CTRATODISTINTO" }));
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
  });
});

describe("si una lista es la de la campaña, aunque su sello esté en duda", () => {
  it("con la sala cerrada o sellada y la huella de la entrada, es de la campaña", () => {
    guardarSorteoDeCampana(entrada());
    ponerSala("cerrada");
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(true);
    ponerSala("sellada");
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(true);
  });

  it("con un sorteo mandado sin respuesta sigue siendo de la campaña, aunque ya no sirva para sellar de nuevo", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ sorteo: "5", mandados: ["5"], aviso: "pendiente" }));
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(true);
  });

  it("con otra huella, otro contrato, la sala en otra fase, vencida o sin la bandera, no", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    expect(esListaDeCampana("cd".repeat(32), AHORA)).toBe(false);
    guardarSorteoDeCampana(entrada({ contrato: "CTRATODISTINTO" }));
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
    guardarSorteoDeCampana(entrada({ pasadaEn: AHORA - VIDA_CAMPANA_MS - 1 }));
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
    guardarSorteoDeCampana(entrada());
    ponerSala("abierta");
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
    ponerSala("sorteada");
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
    ponerSala("cerrada");
    vi.stubEnv("VITE_CAMPANAS", "");
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
  });
});

describe("si el cuadro ya no tiene la lista que pasó el panel", () => {
  it("con la sala cerrada y otra huella en el cuadro, la lista cambió", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(true);
  });

  it("con la misma huella, no cambió", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada());
    expect(listaCambiadaDeLaCampana(HUELLA, AHORA)).toBe(false);
  });

  it("con la huella de la entrada vacía (nada pasado), no hay nada que haya cambiado", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ huella: "" }));
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
  });

  it("sin sala de campaña cerrada, sin la bandera, con otro contrato o vencida, no", () => {
    guardarSorteoDeCampana(entrada());
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
    ponerSala("sellada");
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ contrato: "CTRATODISTINTO" }));
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
    guardarSorteoDeCampana(entrada({ pasadaEn: AHORA - VIDA_CAMPANA_MS - 1 }));
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
    guardarSorteoDeCampana(entrada());
    vi.stubEnv("VITE_CAMPANAS", "");
    expect(listaCambiadaDeLaCampana("cd".repeat(32), AHORA)).toBe(false);
  });
});

describe("lo que se recuerda por evento", () => {
  it("guarda hasta cinco eventos, el más nuevo primero, y cambiar uno lo reemplaza", () => {
    for (let i = 1; i <= 7; i++) guardarSorteoDeCampana(entrada({ evento: `evento-${i}` }));
    expect(leerSorteosDeCampana().map((e) => e.evento)).toEqual(["evento-7", "evento-6", "evento-5", "evento-4", "evento-3"]);
    expect(leerSorteosDeCampana()).toHaveLength(MAX_SORTEOS);
    guardarSorteoDeCampana(entrada({ evento: "evento-4", sorteo: "9" }));
    expect(leerSorteosDeCampana().map((e) => e.evento)).toEqual(["evento-4", "evento-7", "evento-6", "evento-5", "evento-3"]);
    expect(entradaDelEvento(network.name, "evento-4")?.sorteo).toBe("9");
  });

  it("borrar la sala de quien organiza no borra lo que se recuerda del sorteo", () => {
    ponerSala("cerrada");
    guardarSorteoDeCampana(entrada({ sorteo: "777" }));
    borrarOrg(localStorage, network.name);
    expect(esSorteoDeCampana(777n)).toBe(true);
    expect(entradaDelEvento(network.name, "evento-uno")?.sorteo).toBe("777");
  });

  it("guarda el comprobante, las ganadoras y lo que dijo el servicio de cada puesto", () => {
    guardarSorteoDeCampana(
      entrada({
        comprobante: "/verificar.html#x",
        resultado: "pendiente",
        ganadoras: ["GA", "GB"],
        altas: { "0": { estado: "puede" }, "1": { estado: "fallo", motivo: "red" } },
      }),
    );
    const e = entradaDelEvento(network.name, "evento-uno");
    expect(e?.ganadoras).toEqual(["GA", "GB"]);
    expect(e?.altas).toEqual({ "0": { estado: "puede" }, "1": { estado: "fallo", motivo: "red" } });
    expect(e?.comprobante).toBe("/verificar.html#x");
  });
});

describe("la campaña activa", () => {
  it("la clave de la sala es la misma que usa el panel de quien organiza", () => {
    expect(CLAVE_DE_LA_SALA).toBe(CLAVE_ORG);
  });

  it("sin memoria no hay campaña activa", () => {
    expect(hayCampanaActiva(AHORA)).toBe(false);
    expect(salaDeCampanaActiva(network.name, AHORA)).toBeNull();
  });

  it.each(["abierta", "cerrada", "sellada", "sorteada"] as const)("con la sala en %s hay campaña activa", (fase) => {
    ponerSala(fase);
    expect(hayCampanaActiva(AHORA)).toBe(true);
  });

  it("con la sala en lista, vencida, sin la bandera o de la otra red no hay campaña activa", () => {
    ponerSala("lista");
    expect(hayCampanaActiva(AHORA)).toBe(false);
    ponerSala("cerrada");
    expect(hayCampanaActiva(AHORA + 2 * VIDA_CAMPANA_MS)).toBe(false);
    vi.stubEnv("VITE_CAMPANAS", "");
    expect(hayCampanaActiva(AHORA)).toBe(false);
    vi.stubEnv("VITE_CAMPANAS", "1");
    expect(salaDeCampanaActiva(network.name === "mainnet" ? "testnet" : "mainnet", AHORA)).toBeNull();
  });
});

describe("de quién es la campaña que recuerda la compu", () => {
  const CUENTA_A = Keypair.random().publicKey();
  const CUENTA_B = Keypair.random().publicKey();
  const conCuenta = (cuenta: string | null): void =>
    setActiveWallet(cuenta === null ? null : ({ kind: "guest", label: "prueba", address: cuenta } as unknown as WalletAdapter));
  afterEach(() => setActiveWallet(null));

  const salaDe = (cuenta: string | null | undefined, fase: FaseDeSala = "cerrada"): void => {
    const memoria: MemoriaDeOrg = { sala: sala(), fase };
    if (cuenta !== undefined) memoria.cuenta = cuenta;
    guardarOrg(localStorage, memoria, AHORA);
  };

  it("con otra cuenta conectada la sala no cuenta como activa, y sigue guardada", () => {
    salaDe(CUENTA_A);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_A)).not.toBeNull();
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_B)).toBeNull();
    expect(hayCampanaActiva(AHORA, localStorage, CUENTA_B)).toBe(false);
    expect(hayCampanaActiva(AHORA, localStorage, CUENTA_A)).toBe(true);
    expect(localStorage.getItem(CLAVE_ORG)).toContain(TOKEN);
  });

  it("la sala de una cuenta que otra apartó al crear la suya sigue contando como activa para ella", () => {
    salaDe(CUENTA_A, "sellada");
    guardarOrg(localStorage, { sala: { ...sala(), evento: "evento-de-b", token: "B".repeat(22) }, fase: "lista", cuenta: CUENTA_B }, AHORA);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_A)).toEqual({ evento: sala().evento, fase: "sellada" });
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_B)).toBeNull();
    guardarOrg(localStorage, { sala: { ...sala(), evento: "evento-de-b", token: "B".repeat(22) }, fase: "abierta", cuenta: CUENTA_B }, AHORA);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_B)).toEqual({ evento: "evento-de-b", fase: "abierta" });
  });

  it("sin sesión la sala cuenta como activa, y la memoria de antes o sin organizadora, con cualquier cuenta", () => {
    salaDe(CUENTA_A);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, null)).not.toBeNull();
    salaDe(undefined);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_B)).not.toBeNull();
    salaDe(null);
    expect(salaDeCampanaActiva(network.name, AHORA, localStorage, CUENTA_B)).not.toBeNull();
  });

  it("la cuenta conectada es la de la billetera activa", () => {
    expect(cuentaConectada()).toBeNull();
    conCuenta(CUENTA_B);
    expect(cuentaConectada()).toBe(CUENTA_B);
    salaDe(CUENTA_A);
    expect(hayCampanaActiva(AHORA)).toBe(false);
    conCuenta(CUENTA_A);
    expect(hayCampanaActiva(AHORA)).toBe(true);
  });

  it("la entrada del sorteo de una cuenta no se ofrece a otra, y guardar la de una no pisa la de la otra", () => {
    guardarSorteoDeCampana(entrada({ organizadora: CUENTA_A, sorteo: "777", mandados: ["777"] }));
    guardarSorteoDeCampana(entrada({ evento: "evento-dos", organizadora: CUENTA_B, huella: "cd".repeat(32) }));
    expect(leerSorteosDeCampana(localStorage, CUENTA_A).map((e) => e.evento)).toEqual(["evento-uno"]);
    expect(leerSorteosDeCampana(localStorage, CUENTA_B).map((e) => e.evento)).toEqual(["evento-dos"]);
    expect(entradaDelEvento(network.name, "evento-uno", localStorage, CUENTA_B)).toBeNull();
    expect(entradaDelEvento(network.name, "evento-uno", localStorage, CUENTA_A)?.sorteo).toBe("777");
    // Sin sesión se ve todo, y una entrada sin organizadora la ve cualquiera.
    expect(leerSorteosDeCampana(localStorage, null)).toHaveLength(2);
    guardarSorteoDeCampana(entrada({ evento: "evento-tres", organizadora: null }));
    expect(leerSorteosDeCampana(localStorage, CUENTA_B).map((e) => e.evento).sort()).toEqual(["evento-dos", "evento-tres"]);
  });

  it("con otra cuenta conectada el sorteo de la campaña no es de la campaña y su lista no se ofrece", () => {
    salaDe(CUENTA_A);
    guardarSorteoDeCampana(entrada({ organizadora: CUENTA_A, sorteo: "777", mandados: ["777"] }));
    conCuenta(CUENTA_A);
    expect(esSorteoDeCampana(777n)).toBe(true);
    conCuenta(CUENTA_B);
    expect(esSorteoDeCampana(777n)).toBe(false);
    conCuenta(CUENTA_A);
    expect(esSorteoDeCampana(777n)).toBe(true);

    guardarSorteoDeCampana(entrada({ organizadora: CUENTA_A }));
    expect(campanaDeLaLista(HUELLA, AHORA)).not.toBeNull();
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(true);
    expect(listaCambiadaDeLaCampana("00".repeat(32), AHORA)).toBe(true);
    conCuenta(CUENTA_B);
    expect(campanaDeLaLista(HUELLA, AHORA)).toBeNull();
    expect(esListaDeCampana(HUELLA, AHORA)).toBe(false);
    expect(listaCambiadaDeLaCampana("00".repeat(32), AHORA)).toBe(false);
    expect(leerSorteosDeCampana(localStorage)).toEqual([]);
    // Nada se borró: al volver la dueña está todo.
    conCuenta(CUENTA_A);
    expect(campanaDeLaLista(HUELLA, AHORA)).not.toBeNull();
  });
});
