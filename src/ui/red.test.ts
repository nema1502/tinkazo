import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RPC_LISTAS } from "../stellar/config";
import { type RpcDeMentira, redFalsa } from "../stellar/rpc-falso";

/**
 * La pantalla de la red (`red.ts`) con un documento de mentira mínimo y la red de
 * mentira con las respuestas reales del 25 de octubre de 2026: lo que no se puede
 * mirar con Chrome esta noche se mira acá. Se comprueba qué dice la caja, qué
 * dice el botón de sellar, qué hace cada toque y que "Seguir sin sello" pide confirmar.
 */

const DIR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const SDF = RPC_LISTAS.testnet[0];
const ANKR = RPC_LISTAS.testnet[1] as string;

/* ------------------------------------------------------- un documento mínimo */

class El {
  id = "";
  className = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hijos: El[] = [];
  disabled = false;
  texto = "";
  oyentes: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public tag = "div") {}
  get textContent(): string {
    return this.texto + this.hijos.map((h) => h.textContent).join("");
  }
  set textContent(v: string) {
    this.texto = v;
    this.hijos = [];
  }
  get childElementCount(): number {
    return this.hijos.length;
  }
  append(...xs: Array<El | string>): void {
    for (const x of xs) {
      if (typeof x === "string") this.texto += x;
      else this.hijos.push(x);
    }
  }
  replaceChildren(): void {
    this.hijos = [];
    this.texto = "";
  }
  addEventListener(tipo: string, f: (e: unknown) => void): void {
    (this.oyentes[tipo] ??= []).push(f);
  }
  click(): void {
    for (const f of this.oyentes.click ?? []) f({});
  }
  setAttribute(): void {}
  focus(): void {}
  remove(): void {}
  insertAdjacentElement(): void {}
  /** Solo lo que usa red.ts: un descendiente por clase. */
  buscar(clase: string): El | null {
    for (const h of this.hijos) {
      if (h.className.split(" ").includes(clase)) return h;
      const d = h.buscar(clase);
      if (d) return d;
    }
    return null;
  }
  /** Los botones de adentro, con su texto. */
  botones(): El[] {
    return this.hijos.flatMap((h) => (h.tag === "button" ? [h] : h.botones()));
  }
}

const h = vi.hoisted(() => ({
  red: { name: "testnet" as "testnet" | "mainnet" },
  wallet: null as null | Record<string, unknown>,
  xlmBalance: vi.fn(),
  fund: vi.fn(),
  puede: true,
}));

vi.mock("./wallet-ui", () => ({ canAnchor: () => h.puede, currentSession: () => (h.puede ? { address: DIR } : null) }));
vi.mock("./anchor", () => ({ limpiarDetalle: () => undefined }));
vi.mock("./detalle-error", () => ({ ponerDetalle: () => undefined }));
vi.mock("./siguiente", () => ({ verError: () => undefined }));
// Sin grifo en mainnet.
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => h.red.name === "testnet" }));
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      const m = h.red.name === "mainnet";
      // Mainnet de mentira: el contrato de testnet (una dirección válida), y la passphrase de mainnet.
      return {
        ...real.network,
        name: h.red.name,
        rpcUrl: m ? real.RPC_LISTAS.mainnet[0] : real.network.rpcUrl,
        networkPassphrase: m ? "Public Global Stellar Network ; September 2015" : real.network.networkPassphrase,
        friendbotUrl: m ? null : real.network.friendbotUrl,
      };
    },
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => {
  const real = await orig<typeof import("../stellar/wallet-lite")>();
  return { ...real, activeWallet: () => h.wallet, xlmBalance: h.xlmBalance, fundWithFriendbot: h.fund };
});

let els: Record<string, El>;
let oyentesDoc: Record<string, Array<(e: unknown) => void>>;

function montar(): void {
  els = {};
  for (const [id, tag] of [["btn-freeze", "button"], ["red-estado", "aside"], ["red-fila", "div"], ["btn-red", "button"], ["btn-red-txt", "span"], ["names", "div"]] as const) {
    const e = new El(tag);
    e.id = id;
    els[id] = e;
  }
  (els["red-estado"] as El).style.display = "none";
  (els["btn-freeze"] as El).textContent = "Sellar la lista";
  oyentesDoc = {};
  vi.stubGlobal("document", {
    getElementById: (id: string) => els[id] ?? null,
    createElement: (tag: string) => new El(tag),
    querySelector: (sel: string) => (sel === "#red-estado .red-texto" ? (els["red-estado"] as El).buscar("red-texto") : null),
    addEventListener: (tipo: string, f: (e: unknown) => void) => void (oyentesDoc[tipo] ??= []).push(f),
    visibilityState: "visible",
  });
  vi.stubGlobal("MutationObserver", class { observe() {} });
  vi.stubGlobal("location", { search: "" });
}

const caja = (): El => els["red-estado"] as El;
const boton = (): El => els["btn-freeze"] as El;
const frase = (): string => caja().buscar("red-texto")?.textContent ?? "";
const visible = (): boolean => caja().style.display === "block";

/** Pone dos nombres en la lista y avisa que hay cuenta: lo que dispara el chequeo de segundo plano. */
function hayLista(n = 2): void {
  (els["names"] as El).hijos = Array.from({ length: n }, () => new El());
  for (const f of oyentesDoc["tinkazo:sesion"] ?? []) f({ detail: DIR });
}

let falsa: ReturnType<typeof redFalsa>;
function red(rpcs: Record<string, RpcDeMentira>): void {
  falsa = redFalsa(rpcs, Date.now);
  vi.stubGlobal("fetch", falsa.fetch);
}
const bien = (o: RpcDeMentira = {}): Record<string, RpcDeMentira> => ({ [SDF as string]: o, [ANKR]: {} });
const pollar = () => ({ kind: "external", address: DIR, submitsItself: true });

async function cargar() {
  vi.resetModules();
  const r = await import("./red");
  const { app } = await import("../state");
  const sellar = vi.fn(async () => undefined);
  r.iniciarRed({ sellar });
  return { r, app, sellar };
}

beforeEach(() => {
  montar();
  h.red.name = "testnet";
  h.wallet = pollar();
  h.puede = true;
  h.xlmBalance.mockReset().mockResolvedValue(0);
  h.fund.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const esperar = (f: () => void) => vi.waitFor(f, { timeout: 8000, interval: 20 });

describe("la red está bien", () => {
  it("verde no dice nada y el botón sigue siendo 'Sellar la lista'", async () => {
    red(bien());
    const { r } = await cargar();
    hayLista();
    // Se mira un momento después de que la lista y la cuenta están a la vista.
    await esperar(() => expect(falsa.pedidos.length).toBeGreaterThan(0));
    await new Promise((x) => setTimeout(x, 100));
    expect(visible()).toBe(false);
    expect(boton().textContent).toBe("Sellar la lista");
    expect(r.hayAccionDeRed()).toBe(false);
    expect(r.alApretarSellar()).toBe(false);
  });

  it("con una lista de un solo nombre no mira nada", async () => {
    red(bien());
    await cargar();
    hayLista(1);
    await new Promise((x) => setTimeout(x, 1200));
    expect(falsa.pedidos).toHaveLength(0);
  });

  it("sin cuenta que selle (modo libre, la demo) no mira ni muestra el botón", async () => {
    red(bien());
    h.puede = false;
    await cargar();
    hayLista();
    await new Promise((x) => setTimeout(x, 1200));
    expect(falsa.pedidos).toHaveLength(0);
    expect((els["red-fila"] as El).style.display).toBe("none");
  });

  it("el botón de un toque dice 'La red está bien: podés sellar.' y se va solo", async () => {
    red(bien());
    await cargar();
    hayLista();
    (els["btn-red"] as El).click();
    await esperar(() => expect(frase()).toBe("La red está bien: podés sellar."));
    expect(caja().className).toContain("verde");
    expect(visible()).toBe(true);
  });
});

describe("caso 1: el sello cuesta más de lo que el patrocinador paga", () => {
  it("antes de sellar lo dice y 'Sellar con saldo de prueba' reemplaza a 'Sellar la lista'", async () => {
    red(bien({ simulacion: "caro" }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(visible()).toBe(true);
    expect(frase()).toBe("Hoy sellar cuesta más de lo que Tinkazo puede pagar.");
    expect(caja().className).toContain("rojo");
    expect(boton().textContent).toBe("Sellar con saldo de prueba");
    expect(boton().disabled).toBe(false);
    expect(r.hayAccionDeRed()).toBe(true);
    // 'Seguir sin sello' es secundaria, y es la única otra cosa.
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Seguir sin sello"]);
  });

  it("tocar la acción carga saldo de prueba y sella pagando con la cuenta", async () => {
    red(bien({ simulacion: "caro" }));
    // El saldo aparece cuando el grifo contesta.
    h.fund.mockImplementation(async () => void h.xlmBalance.mockResolvedValue(10_000));
    const { r, sellar } = await cargar();
    await r.chequearAntesDeSellar();
    expect(r.alApretarSellar()).toBe(true);
    await esperar(() => expect(sellar).toHaveBeenCalled());
    expect(h.fund).toHaveBeenCalledWith(DIR);
    expect(sellar).toHaveBeenCalledWith({ saltarChequeo: true, pagarConMiCuenta: true });
  });

  it("si el grifo no contesta, vuelve la caja con el motivo y no sella", async () => {
    red(bien({ simulacion: "caro" }));
    h.fund.mockRejectedValue(new Error("friendbot-failed"));
    const { r, sellar } = await cargar();
    await r.chequearAntesDeSellar();
    r.alApretarSellar();
    await esperar(() => expect(frase()).toContain("No pude ponerle fondos"));
    expect(sellar).not.toHaveBeenCalled();
    expect(boton().textContent).toBe("Sellar con saldo de prueba");
  });

  it("con la cuenta de prueba (paga ella) un costo alto solo avisa: se puede sellar", async () => {
    h.wallet = { kind: "guest", address: DIR };
    h.xlmBalance.mockResolvedValue(10_000);
    red(bien({ simulacion: "caro" }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(true);
    expect(caja().className).toContain("amarillo");
    expect(frase()).toBe("Hoy sellar cuesta más de lo normal, pero se puede.");
    expect(r.hayAccionDeRed()).toBe(false);
  });

  it("el costo del sello de verdad (ya simulado) también arma el caso, con el costo que pasó", async () => {
    red(bien());
    const { r } = await cargar();
    await r.mostrarCostoAlto(69.2, false);
    expect(frase()).toBe("Hoy sellar cuesta más de lo que Tinkazo puede pagar.");
    expect(boton().textContent).toBe("Sellar con saldo de prueba");
  });
});

/**
 * Mainnet: no hay grifo. Antes de "Seguir sin sello" se ofrece "Sellar pagando con mi cuenta" si la
 * cuenta es una wallet con saldo suficiente (el doble de lo que cuesta sellar). "Seguir sin sello" queda
 * al final, y siempre con la confirmación.
 */
describe("mainnet: pagar con mi cuenta antes de seguir sin sello", () => {
  const MAINNET = "Public Global Stellar Network ; September 2015";
  const principal = (o: RpcDeMentira = {}): Record<string, RpcDeMentira> => ({
    [RPC_LISTAS.mainnet[0]]: { passphrase: MAINNET, ...o },
    [RPC_LISTAS.mainnet[1] as string]: { passphrase: MAINNET },
  });
  beforeEach(() => {
    h.red.name = "mainnet";
  });

  it("caso 1 con saldo suficiente: 'Sellar pagando con mi cuenta' primero (sin grifo), 'Seguir sin sello' aparte", async () => {
    h.xlmBalance.mockResolvedValue(50);
    // 5 XLM de recurso: muy por encima de 0,33.
    red(principal({ minResourceFee: "50000000" }));
    const { r, sellar } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(frase()).toBe("Hoy sellar cuesta más de lo que Tinkazo puede pagar.");
    expect(boton().textContent).toBe("Sellar pagando con mi cuenta");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Seguir sin sello"]);
    r.alApretarSellar();
    await esperar(() => expect(sellar).toHaveBeenCalledWith({ saltarChequeo: true, pagarConMiCuenta: true }));
    // Nada de grifo: en mainnet no existe.
    expect(h.fund).not.toHaveBeenCalled();
  });

  it("caso 1 sin saldo: 'Seguir sin sello' es la única acción, y pide confirmar", async () => {
    h.xlmBalance.mockResolvedValue(0);
    red(principal({ minResourceFee: "50000000" }));
    const { r, sellar } = await cargar();
    await r.chequearAntesDeSellar();
    expect(boton().textContent).toBe("Seguir sin sello");
    expect(caja().botones()).toHaveLength(0);
    r.alApretarSellar();
    expect(sellar).not.toHaveBeenCalled();
    expect(boton().textContent).toBe("Seguir igual");
    r.alApretarSellar();
    await esperar(() => expect(sellar).toHaveBeenCalledWith({ sinSello: true, saltarChequeo: true }));
  });

  it("caso 1 con saldo justo para el doble: alcanza; con un poco menos, no", async () => {
    // 5 XLM de recurso: el doble son 10 XLM.
    red(principal({ minResourceFee: "50000000" }));
    h.xlmBalance.mockResolvedValue(10.1);
    const a = await cargar();
    await a.r.chequearAntesDeSellar();
    expect(boton().textContent).toBe("Sellar pagando con mi cuenta");
    h.xlmBalance.mockResolvedValue(9);
    const b = await cargar();
    await b.r.chequearAntesDeSellar();
    expect(boton().textContent).toBe("Seguir sin sello");
  });

  it("caso 4, el patrocinador no tiene con qué pagar y la cuenta tiene saldo: 'Sellar pagando con mi cuenta'", async () => {
    h.xlmBalance.mockResolvedValue(5);
    red(principal());
    const { r } = await cargar();
    await r.mostrarSinSaldo();
    expect(frase()).toBe("Tu cuenta no tiene saldo para sellar.");
    expect(boton().textContent).toBe("Sellar pagando con mi cuenta");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Seguir sin sello"]);
  });

  it("caso 4 sin saldo propio: solo 'Seguir sin sello'", async () => {
    h.xlmBalance.mockResolvedValue(0);
    red(principal());
    const { r } = await cargar();
    await r.mostrarSinSaldo();
    expect(boton().textContent).toBe("Seguir sin sello");
    expect(caja().botones()).toHaveLength(0);
  });

  it("caso 4 con Freighter y sin saldo: tampoco hay grifo, 'Seguir sin sello'", async () => {
    h.wallet = { kind: "external", address: DIR };
    h.xlmBalance.mockResolvedValue(0.01);
    red(principal());
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(frase()).toBe("Tu cuenta no tiene saldo para sellar.");
    expect(boton().textContent).toBe("Seguir sin sello");
  });

  it("el textos de lo que se lee no habla de XLM, fee ni RPC", async () => {
    h.xlmBalance.mockResolvedValue(50);
    red(principal({ minResourceFee: "50000000" }));
    const { r } = await cargar();
    await r.chequearAntesDeSellar();
    expect(frase() + boton().textContent + caja().botones().map((b) => b.textContent).join(" ")).not.toMatch(/XLM|\bfee\b|RPC|stroop|verific/i);
  });
});

describe("caso 2: Stellar no contesta", () => {
  const caidos = (): Record<string, RpcDeMentira> => ({ [SDF as string]: { anda: "cortado" }, [ANKR]: { anda: "503" } });

  it("lo dice con la cuenta atrás, 'Probar ahora' es la acción, y vuelve a probar solo", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    red(caidos());
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(frase()).toBe("Stellar no contesta. Vuelvo a probar en 0:15.");
    expect(boton().textContent).toBe("Probar ahora");
    expect(caja().botones()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(frase()).toBe("Stellar no contesta. Vuelvo a probar en 0:10.");
    const antes = falsa.pedidos.length;
    await vi.advanceTimersByTimeAsync(10_000);
    // Llegó a cero: volvió a mirar solo.
    await vi.waitFor(() => expect(falsa.pedidos.length).toBeGreaterThan(antes));
    await vi.waitFor(() => expect(frase()).toBe("Stellar no contesta. Vuelvo a probar en 0:15."));
  });

  it("tres intentos sin respuesta: 'Seguir sin sello' pasa a ser la principal y 'Probar ahora' queda aparte", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    red(caidos());
    const { r } = await cargar();
    await r.chequearAntesDeSellar();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => expect(falsa.pedidos.length).toBeGreaterThanOrEqual(8 * (i + 2)));
      await vi.waitFor(() => expect(boton().disabled).toBe(false));
    }
    await vi.waitFor(() => expect(frase()).toBe("Stellar no contesta."));
    expect(boton().textContent).toBe("Seguir sin sello");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Probar ahora"]);
    // Ya no vuelve a probar sola.
    const n = falsa.pedidos.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(falsa.pedidos).toHaveLength(n);
  });

  it("'Probar ahora' con la red de vuelta: la caja se va, y si venía de 'Sellar la lista' se sigue sellando", async () => {
    red(caidos());
    const { r, sellar } = await cargar();
    await r.chequearAntesDeSellar();
    red(bien());
    expect(r.alApretarSellar()).toBe(true);
    await esperar(() => expect(sellar).toHaveBeenCalledWith({ saltarChequeo: true }));
    expect(visible()).toBe(false);
    expect(boton().textContent).toBe("Sellar la lista");
  });

  it("si venía de un chequeo de fondo (sin apretar nada), al volver la red solo se va la caja", async () => {
    red(caidos());
    const { r, sellar } = await cargar();
    hayLista();
    await esperar(() => expect(frase()).toContain("Stellar no contesta"));
    red(bien());
    expect(r.alApretarSellar()).toBe(true);
    await esperar(() => expect(visible()).toBe(false));
    expect(sellar).not.toHaveBeenCalled();
    expect(boton().textContent).toBe("Sellar la lista");
  });

  it("si falla uno solo de los dos RPC no se entera nadie", async () => {
    red({ [SDF as string]: { anda: "503" }, [ANKR]: {} });
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(true);
    expect(visible()).toBe(false);
  });
});

describe("caso 3: la red está saturada", () => {
  it("avisa en amarillo, deja el botón como está y se puede sellar", async () => {
    red(bien({ p90: "5000" }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(true);
    expect(caja().className).toContain("amarillo");
    expect(frase()).toBe("La red está saturada: sellar puede tardar un poco más.");
    expect(boton().textContent).toBe("Sellar la lista");
    expect(r.alApretarSellar()).toBe(false);
  });
});

describe("caso 4: sin saldo", () => {
  it("cuenta que paga sola y sin saldo: 'Cargar saldo de prueba' reemplaza el botón; al cargar, vuelve a mirar y queda 'Sellar la lista'", async () => {
    h.wallet = { kind: "guest", address: DIR };
    h.xlmBalance.mockResolvedValue(0);
    red(bien());
    const { r, sellar } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(frase()).toBe("Tu cuenta no tiene saldo para sellar.");
    expect(boton().textContent).toBe("Cargar saldo de prueba");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Seguir sin sello"]);
    // Al cargar, el saldo aparece.
    h.xlmBalance.mockResolvedValue(10_000);
    r.alApretarSellar();
    await esperar(() => expect(h.fund).toHaveBeenCalledWith(DIR));
    await esperar(() => expect(boton().textContent).toBe("Sellar la lista"));
    expect(visible()).toBe(false);
    expect(sellar).not.toHaveBeenCalled();
  });

  it("el patrocinador sin saldo en testnet (el sello de verdad lo dijo): la salida es cargar saldo de prueba", async () => {
    h.xlmBalance.mockResolvedValue(5);
    red(bien());
    const { r } = await cargar();
    await r.mostrarSinSaldo();
    expect(frase()).toBe("Tu cuenta no tiene saldo para sellar.");
    expect(boton().textContent).toBe("Cargar saldo de prueba");
  });
});

describe("caso 5: el protocolo cambió", () => {
  it("una versión nueva con la simulación bien: amarillo y se sella igual", async () => {
    red(bien({ protocolo: 31 }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(true);
    expect(caja().className).toContain("amarillo");
    expect(frase()).toBe("Stellar cambió algo y Tinkazo todavía no se puso al día. Se puede sellar igual.");
    expect(boton().textContent).toBe("Sellar la lista");
  });

  it("el Protocolo 30 (Bell) ya es conocido: no avisa", async () => {
    red(bien({ protocolo: 30 }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(true);
    expect(visible()).toBe(false);
  });

  it("solo frena si la simulación falla, con 'Seguir sin sello' como principal", async () => {
    red(bien({ protocolo: 31, simulacion: "error" }));
    const { r } = await cargar();
    expect(await r.chequearAntesDeSellar()).toBe(false);
    expect(caja().className).toContain("rojo");
    expect(boton().textContent).toBe("Seguir sin sello");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Probar ahora"]);
  });
});

describe("'Seguir sin sello' pide confirmar y desalienta", () => {
  async function enRojo() {
    red(bien({ protocolo: 31, simulacion: "error" }));
    const c = await cargar();
    await c.r.chequearAntesDeSellar();
    return c;
  }

  it("el primer toque no sigue: pregunta, y la acción principal pasa a ser 'Seguir igual', con 'Esperar a la red' aparte", async () => {
    const { r, sellar } = await enRojo();
    expect(r.alApretarSellar()).toBe(true);
    expect(sellar).not.toHaveBeenCalled();
    expect(frase()).toBe("Sin sello, nadie va a poder comprobar este sorteo después. ¿Seguir igual?");
    expect(boton().textContent).toBe("Seguir igual");
    expect(caja().botones().map((b) => b.textContent)).toEqual(["Esperar a la red"]);
    // Nada de lo que se lee dice "verificable" ni habla de XLM.
    expect(frase() + boton().textContent).not.toMatch(/verific|XLM/i);
  });

  it("el segundo toque sigue sin sello, sin volver a frenar por el chequeo", async () => {
    const { r, sellar } = await enRojo();
    r.alApretarSellar();
    r.alApretarSellar();
    await esperar(() => expect(sellar).toHaveBeenCalledWith({ sinSello: true, saltarChequeo: true }));
    expect(visible()).toBe(false);
  });

  it("'Esperar a la red' vuelve a mirar y no sigue", async () => {
    const { r, sellar } = await enRojo();
    r.alApretarSellar();
    caja().botones()[0]?.click();
    await esperar(() => expect(boton().textContent).toBe("Seguir sin sello"));
    expect(sellar).not.toHaveBeenCalled();
  });

  it("en el medio de la confirmación 'refreshFreezeLabel' no pisa el botón", async () => {
    const { r } = await enRojo();
    r.alApretarSellar();
    expect(r.hayAccionDeRed()).toBe(true);
  });
});

describe("después de sellar", () => {
  it("la caja y el botón de un toque se van, y 'Seguir sin sello' deja la caja con su estado", async () => {
    red(bien({ simulacion: "caro" }));
    const { r, app } = await cargar();
    await r.chequearAntesDeSellar();
    expect(visible()).toBe(true);
    r.marcarSellado(true);
    app.frozen = { names: ["a", "b"], listHash: "x", ts: 1, at: "", prize: "", round: 5 };
    r.limpiarRed();
    expect(visible()).toBe(false);
    expect((els["red-fila"] as El).style.display).toBe("none");
    // Sellada la lista, el botón ya no es de la red.
    expect(r.alApretarSellar()).toBe(false);
  });

  it("sin sello: la caja dice que sigue intentando, con 'Volver a intentar el sello'", async () => {
    red(bien());
    const { r } = await cargar();
    const reintentar = vi.fn();
    r.verSinSello("esperando", reintentar);
    expect(frase()).toBe("Sin sello por ahora. Sigo intentando sellar hasta unos segundos antes de que nazca el número.");
    const [b] = caja().botones();
    expect(b?.textContent).toBe("Volver a intentar el sello");
    b?.click();
    expect(reintentar).toHaveBeenCalledTimes(1);
    r.verSinSello("entro");
    expect(frase()).toBe("Entró el sello: este sorteo sí se puede comprobar.");
    r.verSinSello("vencio");
    expect(frase()).toBe("El sello no entró a tiempo. Este sorteo queda sin sello: no se puede comprobar.");
    expect(caja().botones()).toHaveLength(0);
  });
});
