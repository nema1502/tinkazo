import { describe, expect, it } from "vitest";
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
});

describe("panel de la cuenta: textos", () => {
  it("la dirección corta deja cuatro letras de cada lado", () => {
    expect(shortAddr("GDVZCRWDWNLVXLMARFDRSZMEZQRPFJMJDP6BQOTUJZGMKSJTZRKB5ZLE")).toBe("GDVZ…5ZLE");
    expect(shortAddr("GABC")).toBe("GABC");
  });

  it("la inicial es la primera letra del nombre, en mayúscula, sin partir una letra con tilde", () => {
    expect(initialOf("Nicolás Emir")).toBe("N");
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
    expect(r.meta).toMatch(/^27 personas · .*oct/i);
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
