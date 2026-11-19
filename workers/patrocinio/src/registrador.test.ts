import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { Administracion } from "./admin";
import { LOTE, SECRETO_CUPON, SECRETO_POLLAR, T0, codigo, montarAltas, tokenDe } from "./altas-prueba";
import { mostrar } from "./altas";
import { DIA_MS } from "./config";
import { limpiar, registrador } from "./registrador";

describe("limpiar: lo que nunca va a la bitácora", () => {
  const g = Keypair.random();

  it("tapa cuentas, llaves, correos, tokens y códigos de cupón, aunque vengan adentro de un texto", () => {
    const sucio = {
      error: `falló con ${g.publicKey()} y ${g.secret()}`,
      detalle: "escribile a ana.perez@example.com",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.firma_rara-123",
      cabecera: "Bearer tok_abc_123",
      llavePollar: `${SECRETO_POLLAR} y pub_mainnet_abcdefgh`,
      escrito: `${mostrar("K7M29QXA4HTR")} o K7M29QXA4HTR`,
      id: "3f2b8c1e-9a4d-4e2b-8c1e-9a4d4e2b8c1e",
    };
    const limpio = limpiar(sucio);
    const texto = JSON.stringify(limpio);
    for (const prohibido of [g.publicKey(), g.secret(), "ana.perez@example.com", "eyJhbGciOiJIUzI1NiJ9", "tok_abc_123", SECRETO_POLLAR, "pub_mainnet_abcdefgh", "K7M2-9QXA-4HTR", "K7M29QXA4HTR", "3f2b8c1e-9a4d"]) {
      expect(texto).not.toContain(prohibido);
    }
    expect(limpio.error).toBe("falló con [cuenta] y [cuenta]");
    expect(limpio.detalle).toBe("escribile a [correo]");
    expect(limpio.escrito).toBe("[cupon] o [cupon]");
    expect(limpio.cabecera).toBe("Bearer [token]");
  });

  it("saca los campos que nombran a una persona, y deja lo que sirve para seguir un pedido", () => {
    expect(limpiar({ usuario: "usr_ana", userId: "usr_ana", token: "x", correo: "x", email: "x", cuenta: "x", cupon: "x", motivo: "piso" })).toEqual({ motivo: "piso" });
    const util = { lote: "space-apps-14nov", sorteos: 3, altaNueva: 1, hash: "a1b2c3d4", codigo: "401-SERVER_KEY_INVALID", llamada: "verify", saldo: "123456789012", red: "TRY_AGAIN_LATER", razon: "SDK_TOKEN_WRONG_APPLICATION" };
    expect(limpiar(util)).toEqual(util);
  });

  it("el registrador manda los error- a la salida de errores, y todo limpio", () => {
    const log: string[] = [];
    const error: string[] = [];
    const registrar = registrador({ log: (s) => log.push(s), error: (s) => error.push(s) });
    registrar("alta-canje", { lote: LOTE, sorteos: 3 });
    registrar("error-interno", { donde: "alta", error: `algo con ${g.publicKey()}` });
    expect(log).toEqual([JSON.stringify({ evento: "alta-canje", lote: LOTE, sorteos: 3 })]);
    expect(error).toEqual([JSON.stringify({ evento: "error-interno", donde: "alta", error: "algo con [cuenta]" })]);
    registrar("alarma");
    expect(log[1]).toBe(JSON.stringify({ evento: "alarma" }));
  });
});

describe("los eventos de las altas, con un registrador espía", () => {
  it("alta-canje con el lote, alta-pausa con su motivo, error-pollar con el código y lo de administración, sin nada de nadie", async () => {
    const m = montarAltas();
    const admin = new Administracion({ cfg: m.cfg, cupos: m.cupos, altas: m.altas, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar: (e, d) => void m.anotado.push([e, d]) });
    const ana = m.persona("usr_ana_secreta");
    const beto = m.persona("usr_beto_secreto");
    const nico = Keypair.random().publicKey();
    await admin.atender("cupones-crear", { lote: LOTE, codigos: [codigo(1), codigo(2), codigo(3)], sorteos: 3, dias: 60, vence: T0 + 30 * DIA_MS, usos: 1 });
    await m.cupon(ana.token, mostrar(codigo(1)));
    // Bajo el piso: créditos que no alcanzan.
    m.pm.creditos = 0;
    m.mover(61_000);
    await m.cupon(beto.token, codigo(2));
    m.pm.creditos = 100_000;
    m.mover(61_000);
    await admin.atender("altas-pausar", {});
    await m.cupon(beto.token, codigo(2));
    await admin.atender("altas-reanudar", {});
    // Pollar caído: error-pollar con la llamada y el código.
    m.persona("usr_nadie_secreto");
    m.pm.caido = true;
    await m.estado(tokenDe("usr_nadie_secreto"));
    m.pm.caido = false;
    await admin.atender("cupones-anular", { codigo: codigo(3) });
    await admin.atender("cupones-anular", { lote: LOTE });
    await admin.atender("altas-admitir", { cuenta: nico, sorteos: 20, dias: 60, ref: "pruebas-internas" });

    const eventos = m.anotado.map(([e, d]) => [e, d ?? {}]);
    expect(eventos).toContainEqual(["admin-cupones", { lote: LOTE, creados: 3, repetidos: 0 }]);
    expect(eventos).toContainEqual(["alta-canje", { lote: LOTE, sorteos: 3, altaNueva: 1 }]);
    expect(eventos).toContainEqual(["alta-pausa", { motivo: "piso" }]);
    expect(eventos).toContainEqual(["alta-pausa", { motivo: "a-mano" }]);
    expect(eventos).toContainEqual(["alta-reanudar", {}]);
    expect(eventos).toContainEqual(["error-pollar", { llamada: "verify", codigo: 503 }]);
    expect(eventos).toContainEqual(["admin-anular", { por: "codigo", anulados: 1 }]);
    // Quedaban dos sin anular: el canjeado (anularlo no le quita nada) y el que nunca pasó.
    expect(eventos).toContainEqual(["admin-anular", { por: "lote", lote: LOTE, anulados: 2 }]);
    expect(eventos).toContainEqual(["admin-alta", { sorteos: 20, dias: 60, altaNueva: 1 }]);

    const todo = JSON.stringify(m.anotado);
    for (const prohibido of [ana.token, beto.token, tokenDe("usr_nadie_secreto"), "usr_ana_secreta", "usr_beto_secreto", "usr_nadie_secreto", ana.cuenta as string, beto.cuenta as string, nico, codigo(1), codigo(2), codigo(3), mostrar(codigo(1)), SECRETO_CUPON, SECRETO_POLLAR, "x@y.z"]) {
      expect(todo).not.toContain(prohibido);
    }
  });
});
