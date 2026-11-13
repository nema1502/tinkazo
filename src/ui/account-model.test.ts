import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_DRAWS, drawRow, feeCovered, fmtBalance, initialOf, kindText, moneyLine, shortAddr, shortDate } from "./account-model";
import type { Entry } from "./history";

const base: Entry = { organizer: "GAAA", listHash: "a".repeat(64), count: 27, numWinners: 1, round: 1, sealedAt: 1760659200, prize: "" };

describe("panel de la cuenta: quién no ve el saldo", () => {
  it("Google y correo son las cuentas que cubre Tinkazo; las demás no", () => {
    expect(feeCovered("Google")).toBe(true);
    expect(feeCovered("Email")).toBe(true);
    expect(feeCovered("Freighter")).toBe(false);
    expect(feeCovered("Cuenta de prueba")).toBe(false);
    expect(feeCovered("")).toBe(false);
  });

  it("con Google o correo no hay saldo mientras sea menor que 1, ni grifo", () => {
    for (const label of ["Google", "Email"]) {
      expect(moneyLine(label, 0, "testnet")).toEqual({ balance: null, fund: false });
      expect(moneyLine(label, 0.99, "testnet")).toEqual({ balance: null, fund: false });
      // Si no se pudo leer, tampoco se muestra un "saldo sin leer": no es asunto suyo.
      expect(moneyLine(label, -1, "testnet")).toEqual({ balance: null, fund: false });
    }
  });

  it("con Google o correo y 1 XLM o más, el saldo se muestra, y el grifo nunca", () => {
    expect(moneyLine("Google", 1, "testnet")).toEqual({ balance: 1, fund: false });
    expect(moneyLine("Email", 250.5, "testnet")).toEqual({ balance: 250.5, fund: false });
  });

  it("un saldo que no es un número cuenta como un saldo que no se pudo leer", () => {
    expect(moneyLine("Freighter", Number.NaN, "testnet")).toEqual({ balance: "unknown", fund: false });
    expect(moneyLine("Google", Number.NaN, "testnet")).toEqual({ balance: null, fund: false });
  });

  it("con Freighter o la cuenta de prueba el saldo se muestra siempre, como hoy", () => {
    expect(moneyLine("Freighter", 0, "testnet").balance).toBe(0);
    expect(moneyLine("Cuenta de prueba", 10000, "testnet").balance).toBe(10000);
    expect(moneyLine("Freighter", -1, "testnet").balance).toBe("unknown");
  });

  it("el grifo, solo en testnet y con menos de 20 XLM, y solo para esas cuentas", () => {
    expect(moneyLine("Freighter", 0, "testnet").fund).toBe(true);
    expect(moneyLine("Freighter", 19.99, "testnet").fund).toBe(true);
    expect(moneyLine("Freighter", 20, "testnet").fund).toBe(false);
    expect(moneyLine("Cuenta de prueba", 10000, "testnet").fund).toBe(false);
    // Sin poder leer el saldo no se ofrece: no se sabe si hace falta.
    expect(moneyLine("Freighter", -1, "testnet").fund).toBe(false);
    // En mainnet no hay grifo.
    expect(moneyLine("Freighter", 0, "mainnet").fund).toBe(false);
  });

  it("con ?grifo=0 el botón no aparece, ni siquiera con la cuenta vacía; el saldo se sigue mostrando", () => {
    expect(moneyLine("Freighter", 0, "testnet", false)).toEqual({ balance: 0, fund: false });
    expect(moneyLine("Cuenta de prueba", 0, "testnet", false)).toEqual({ balance: 0, fund: false });
    expect(moneyLine("Freighter", 5, "testnet", false).fund).toBe(false);
    // Con el grifo prendido (el valor por defecto) sigue como siempre.
    expect(moneyLine("Cuenta de prueba", 0, "testnet", true).fund).toBe(true);
    expect(moneyLine("Cuenta de prueba", 0, "testnet").fund).toBe(true);
  });
});

describe("panel de la cuenta: textos", () => {
  it("la dirección corta deja cuatro letras de cada lado", () => {
    expect(shortAddr("GDVZCRWDWNLVXLMARFDRSZMEZQRPFJMJDP6BQOTUJZGMKSJTZRKB5ZLE")).toBe("GDVZ…5ZLE");
    expect(shortAddr("GABC")).toBe("GABC");
  });

  it("la inicial es la primera letra del nombre, en mayúscula, sin partir una letra con tilde", () => {
    expect(initialOf("Mateo Emir")).toBe("M");
    expect(initialOf("  ana quispe")).toBe("A");
    expect(initialOf("ñandú")).toBe("Ñ");
    expect(initialOf("")).toBe("");
    expect(initialOf("   ")).toBe("");
  });

  it("la cuenta de prueba se escribe en el idioma de la pantalla", () => {
    expect(kindText("Cuenta de prueba")).toBe("Cuenta de prueba");
    expect(kindText("Freighter")).toBe("Freighter");
  });

  it("el saldo lleva hasta dos decimales y XLM", () => {
    expect(fmtBalance(15.256)).toMatch(/^15[.,]26 XLM$/);
    expect(fmtBalance(10000)).toMatch(/^10[.,   ]?000 XLM$/);
  });

  it("la fecha es día y mes, y vacía si no hay", () => {
    expect(shortDate(0)).toBe("");
    expect(shortDate(1760659200)).toMatch(/oct/i);
  });
});

describe("panel de la cuenta: las filas de Tus sorteos", () => {
  it("el título es el premio; sin premio, 'Sorteo #id'; sin id, 'Sorteo'", () => {
    expect(drawRow({ ...base, prize: "Tubienestarprimero" }).title).toBe("Tubienestarprimero");
    expect(drawRow({ ...base, prize: "  ", id: "7" }).title).toBe("Sorteo #7");
    expect(drawRow(base).title).toBe("Sorteo");
  });

  it("la segunda línea dice cuántas personas y cuándo", () => {
    const r = drawRow({ ...base, winners: ["Ana"] });
    expect(r.meta).toMatch(/^27 personas, .*oct/i);
    expect(r.meta).not.toContain("sin sortear");
  });

  it("un sorteo sellado y sin sortear lo dice", () => {
    expect(drawRow(base).meta).toContain("sin sortear");
    // Con los nombres, con el puesto que trajo la cadena o con la transacción del sorteo, ya se sorteó.
    expect(drawRow({ ...base, winners: ["Ana"] }).meta).not.toContain("sin sortear");
    expect(drawRow({ ...base, winnerIdx: [3] }).meta).not.toContain("sin sortear");
    expect(drawRow({ ...base, drawTx: "abc" }).meta).not.toContain("sin sortear");
  });

  it("el comprobante es el enlace del sorteo, o nada", () => {
    expect(drawRow({ ...base, proof: "https://tinkazo.app/verificar.html#x" }).proof).toBe("https://tinkazo.app/verificar.html#x");
    expect(drawRow(base).proof).toBeNull();
    expect(drawRow({ ...base, proof: "" }).proof).toBeNull();
  });

  it("el panel muestra los últimos cuatro", () => {
    expect(LAST_DRAWS).toBe(4);
  });
});

describe("panel de la cuenta: un orden de turnos sin sello no ofrece comprobante", () => {
  const RONDA = "https://api.drand.sh/dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493/public/100";
  const VERIFICAR = "https://tinkazo.app/verificar.html#rX";
  const orden: Entry = { ...base, count: 3, numWinners: 3, prize: "Turnos", winners: ["Beto", "Ana", "Carla"], sinSello: true };

  it("con el enlace de la ronda, que es como se anota ahora", () => {
    expect(drawRow({ ...orden, proof: RONDA }).proof).toBeNull();
  });

  it("con el enlace de verificación de una entrada anotada antes", () => {
    expect(drawRow({ ...orden, proof: VERIFICAR }).proof).toBeNull();
    expect(drawRow({ ...orden, proof: "https://tinkazo.app/verificar.html?modo=turnos#rX" }).proof).toBeNull();
  });

  it("sigue mostrando de qué sorteo se trata", () => {
    const r = drawRow({ ...orden, proof: RONDA });
    expect(r.title).toBe("Turnos");
    expect(r.meta).toMatch(/^3 personas, .*oct/i);
  });

  it("un orden con sello (tiene número) conserva su enlace", () => {
    expect(drawRow({ ...orden, sinSello: undefined, id: "7", proof: VERIFICAR }).proof).toBe(VERIFICAR);
    // También si se marcó sin sello pero el sello entró a tiempo y la entrada ya tiene su número.
    expect(drawRow({ ...orden, id: "7", proof: VERIFICAR }).proof).toBe(VERIFICAR);
  });

  it("un sorteo común sin sello conserva su enlace", () => {
    const comun: Entry = { ...base, count: 12, numWinners: 3, prize: "Turnos de limpieza", sinSello: true, proof: VERIFICAR };
    expect(drawRow(comun).proof).toBe(VERIFICAR);
    expect(drawRow({ ...base, numWinners: 1, prize: "Termo", sinSello: true, proof: VERIFICAR }).proof).toBe(VERIFICAR);
  });
});

describe("panel de la cuenta: cuántas personas tiene cada sorteo", () => {
  // Ana con 2, Beto con 1 y Carla con 2: 3 personas y 5 líneas.
  const repartida = ["Ana Quispe (1/2)", "Ana Quispe (2/2)", "Beto Rojas", "Carla Suarez (1/2)", "Carla Suarez (2/2)"];
  const conLista = { ...base, count: 5, names: repartida };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("con los modos a la vista, el reparto dice 3 personas, 5 participaciones, igual que Mis sorteos", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { cuentaDeLaEntrada } = await import("./cuenta-entrada");
    expect(cuentaDeLaEntrada(conLista)).toBe("3 personas, 5 participaciones");
    expect(drawRow(conLista).meta).toContain("3 personas, 5 participaciones");
    expect(drawRow(conLista).meta).not.toContain("5 personas");
  });

  it("sin modos, la misma entrada dice 5 personas, como hoy", () => {
    vi.stubEnv("VITE_MODOS", "0");
    const meta = drawRow(conLista).meta;
    expect(meta.startsWith("5 personas, ")).toBe(true);
    expect(meta.endsWith(", sin sortear")).toBe(true);
    expect(meta).not.toContain("participaciones");
  });

  it("una entrada sin la lista dice lo de siempre con la cantidad, con modos o sin ellos", () => {
    vi.stubEnv("VITE_MODOS", "0");
    expect(drawRow(base).meta).toContain("27 personas");
    vi.stubEnv("VITE_MODOS", "1");
    expect(drawRow(base).meta).toContain("27 personas");
    expect(drawRow(base).meta).not.toContain("participaciones");
  });
});
