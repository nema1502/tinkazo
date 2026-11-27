import { Address, Keypair, Networks, nativeToScVal, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { CHECKS_DE_PREMIO, checksDePremio, MONTO_DEL_PREMIO, NOTA_DE_PRUEBA, notaEnLaRed, prepararDestino, saldosEnLaRed, SALDO_INICIAL_DEL_DESTINO_STROOPS } from "./premio-llave.mjs";
import { RED } from "./previo-llave.mjs";

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status });

/** Un reloj de mentira: dormir lo adelanta, así las esperas no tardan nada. */
function reloj() {
  let t = 1_000;
  return { ahora: () => t, dormir: async (ms) => void (t += ms) };
}

describe("preparar la cuenta de destino", () => {
  /** Una red de mentira. `c` cambia lo que contesta cada parte. */
  function redFalsa(c = {}) {
    const visto = { enviadas: [], pedidos: [] };
    let marca = false;
    const fetchFn = async (url, init) => {
      const u = String(url);
      visto.pedidos.push(u);
      if (u.startsWith(RED.friendbot)) return respuesta({}, c.friendbot ?? 200);
      if (u.startsWith(`${RED.horizon}/accounts/`)) {
        if (c.sinCuenta) return respuesta({}, 404);
        return respuesta({ sequence: "100", data: marca && !c.sinMarca ? { "config.memo_required": "MQ==" } : {} });
      }
      if (u === RED.rpc) {
        const { method, params } = JSON.parse(String(init?.body));
        if (method === "sendTransaction") {
          if (c.envioCae) throw new Error("sin red");
          visto.enviadas.push(params.transaction);
          marca = true;
          return respuesta({ result: { status: c.estadoDelEnvio ?? "PENDING" } });
        }
        if (method === "getTransaction") return respuesta({ result: { status: c.estadoDeLaTransaccion ?? "SUCCESS" } });
      }
      return respuesta({}, 404);
    };
    return { fetchFn, visto };
  }

  it("fondea la cuenta, le pone la marca de que pide nota y espera a verla en el historial", async () => {
    const par = Keypair.random();
    const { fetchFn, visto } = redFalsa();
    const r = await prepararDestino({ fetchFn, par, ...reloj() });
    expect(r).toMatchObject({ publica: par.publicKey() });
    expect(visto.enviadas).toHaveLength(1);
    const tx = TransactionBuilder.fromXDR(visto.enviadas[0], Networks.TESTNET);
    expect(tx.source).toBe(par.publicKey());
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({ type: "manageData", name: "config.memo_required" });
    expect(new TextDecoder().decode(tx.operations[0].value)).toBe("1");
    expect(tx.signatures).toHaveLength(1);
    // La última lectura del historial es la que ya muestra la marca.
    expect(visto.pedidos.at(-1)).toContain("/accounts/");
  });

  it("un grifo que dice que ya hay demasiados pedidos es una falla ajena", async () => {
    const { fetchFn } = redFalsa({ friendbot: 429 });
    expect(await prepararDestino({ fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "grifo-limitado" });
  });

  it("una cuenta que el historial nunca muestra, un envío que se corta, uno rechazado o una marca que no aparece son fallas ajenas", async () => {
    expect(await prepararDestino({ fetchFn: redFalsa({ sinCuenta: true }).fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "cuenta-sin-aparecer" });
    expect(await prepararDestino({ fetchFn: redFalsa({ envioCae: true }).fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "rpc-ajeno" });
    expect(await prepararDestino({ fetchFn: redFalsa({ estadoDelEnvio: "ERROR" }).fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "rpc-ajeno" });
    expect(await prepararDestino({ fetchFn: redFalsa({ estadoDeLaTransaccion: "FAILED" }).fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "rpc-ajeno" });
    expect(await prepararDestino({ fetchFn: redFalsa({ sinMarca: true }).fetchFn, ...reloj() })).toEqual({ ajena: true, motivo: "historial-sin-marca" });
  });
});

describe("los saldos en la red", () => {
  const contrato = RED.verificador;
  const cuenta = Keypair.random().publicKey();
  const servidor = (respuestas, cuentaBalance = 20_000_000n) => {
    let n = 0;
    return {
      llamadas: () => n,
      getAssetBalance: async () => respuestas[Math.min(n++, respuestas.length - 1)],
      getAccountEntry: async () => ({ balance: cuentaBalance }),
    };
  };

  it("una billetera sin entrada de saldo tiene cero, y una cuenta G da su saldo", async () => {
    const r = await saldosEnLaRed({ contrato, cuenta, servidor: servidor([{ latestLedger: 50 }]), dormir: async () => undefined });
    expect(r).toEqual({ contrato: 0n, cuenta: 20_000_000n, latestLedger: 50 });
  });

  it("con entrada lee el monto como número grande", async () => {
    const r = await saldosEnLaRed({ contrato, servidor: servidor([{ latestLedger: 50, balanceEntry: { amount: "100000000" } }]), dormir: async () => undefined });
    expect(r.contrato).toBe(100_000_000n);
    expect(r.cuenta).toBeNull();
  });

  it("si el RPC todavía no llegó al ledger pedido, espera y vuelve a leer, hasta tres veces más", async () => {
    let esperas = 0;
    const s = servidor([{ latestLedger: 5 }, { latestLedger: 6 }, { latestLedger: 10, balanceEntry: { amount: "7" } }]);
    const r = await saldosEnLaRed({ contrato, desdeLedger: 10, servidor: s, dormir: async (ms) => void (esperas += ms) });
    expect(r.contrato).toBe(7n);
    expect(s.llamadas()).toBe(3);
    expect(esperas).toBe(6_000);
    const nunca = servidor([{ latestLedger: 5 }]);
    const sinLlegar = await saldosEnLaRed({ contrato, desdeLedger: 10, servidor: nunca, dormir: async () => undefined });
    expect(nunca.llamadas()).toBe(4);
    expect(sinLlegar.contrato).toBe(0n);
  });

  it("una cuenta G que no existe da null", async () => {
    const s = { getAssetBalance: async () => ({ latestLedger: 1 }), getAccountEntry: async () => Promise.reject(new Error("Account not found")) };
    expect((await saldosEnLaRed({ cuenta, servidor: s, dormir: async () => undefined })).cuenta).toBeNull();
  });
});

describe("la nota que dejó la red", () => {
  const hash = "ab".repeat(32);
  const tipos = { amount: ["symbol", "i128"], to_muxed_id: ["symbol", "u64"] };
  const dato = (nota) => nativeToScVal({ amount: MONTO_DEL_PREMIO, to_muxed_id: nota }, { type: tipos });
  const temas = () => [nativeToScVal("transfer", { type: "symbol" }), new Address(RED.verificador).toScVal(), new Address(Keypair.random().publicKey()).toScVal(), nativeToScVal("native", { type: "string" })];
  const evento = (contrato, nota) =>
    new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: new xdr.ContractId(StrKey.decodeContract(contrato)),
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics: temas(), data: dato(nota) })),
    }).toXDR("base64");
  const rpcFalso = (porMetodo) => async (_url, init) => {
    const { method } = JSON.parse(String(init?.body));
    return respuesta({ result: porMetodo[method] });
  };

  it("la lee del evento de la transacción cuando la red lo trae", async () => {
    const fetchFn = rpcFalso({ getTransaction: { status: "SUCCESS", ledger: 9, events: { contractEventsXdr: [[evento(RED.activo, NOTA_DE_PRUEBA)]] } } });
    expect(await notaEnLaRed({ hash, fetchFn })).toEqual({ nota: NOTA_DE_PRUEBA, monto: MONTO_DEL_PREMIO, fuente: "transaccion" });
  });

  it("si la transacción no trae eventos, los pide por getEvents desde su ledger", async () => {
    const e = { txHash: hash, topic: [nativeToScVal("transfer", { type: "symbol" }).toXDR("base64")], value: dato(42n).toXDR("base64") };
    const otra = { txHash: "cd".repeat(32), topic: e.topic, value: dato(1n).toXDR("base64") };
    const fetchFn = rpcFalso({ getTransaction: { status: "SUCCESS", ledger: 9 }, getEvents: { events: [otra, e] } });
    expect(await notaEnLaRed({ hash, fetchFn })).toEqual({ nota: 42n, monto: MONTO_DEL_PREMIO, fuente: "eventos" });
  });

  it("ignora los eventos de otro contrato y, sin nada, da null", async () => {
    const deOtro = rpcFalso({ getTransaction: { status: "SUCCESS", ledger: 0, events: { contractEventsXdr: [[evento(RED.contrato, 5n)]] } } });
    expect(await notaEnLaRed({ hash, fetchFn: deOtro })).toEqual({ nota: null, monto: null, fuente: null });
  });
});

describe("los checks de recibir y mandar", () => {
  const monto = MONTO_DEL_PREMIO;
  const destinoFinal = SALDO_INICIAL_DEL_DESTINO_STROOPS + monto;
  const bien = () => ({
    c1: { estado: "premio-listo", medidas: { premio: { monto: "100000000" }, envios: [] } },
    s1: { contrato: monto },
    destinoAntes: 100_000_000_000n,
    pideNota: { estado: "pide-nota", medidas: { envios: [] } },
    sPide: { contrato: monto, cuenta: 100_000_000_000n },
    c2: { estado: "premio-listo", medidas: { premio: null, envios: [] } },
    s2: { contrato: monto },
    enviado: { estado: "enviado", medidas: { premio: null, envios: [{ desbloqueos: 1, raiz: "exacta" }] } },
    s3: { contrato: 0n, cuenta: destinoFinal },
    nota: { nota: NOTA_DE_PRUEBA },
    c3: { estado: "sin-monedas", medidas: { premio: null, envios: [] } },
    s4: { contrato: 0n },
  });
  const por = (d) => Object.fromEntries(checksDePremio(d).map((c) => [c.nombre, c.ok]));

  it("con todo bien dan los diez, en el orden de la lista", () => {
    const r = checksDePremio(bien());
    expect(r.map((c) => c.nombre)).toEqual(CHECKS_DE_PREMIO);
    expect(r.every((c) => c.ok)).toBe(true);
    expect(r.every((c) => typeof c.detalle === "string")).toBe(true);
  });

  it("sin ningún dato, todos dan falso y ninguno lanza", () => {
    expect(Object.values(por({})).every((ok) => ok === false)).toBe(true);
  });

  it("recibir pide el monto exacto del premio en la red", () => {
    const d = bien();
    d.s1.contrato = monto - 1n;
    expect(por(d)["premio-recibir"]).toBe(false);
  });

  it("pide-nota falla si algo se movió o si ya había un envío", () => {
    const a = bien();
    a.sPide.cuenta += 1n;
    expect(por(a)["premio-pide-nota"]).toBe(false);
    const b = bien();
    b.pideNota.medidas.envios = [{}];
    expect(por(b)["premio-pide-nota"]).toBe(false);
    const c = bien();
    c.sPide.contrato = 0n;
    expect(por(c)["premio-pide-nota"]).toBe(false);
  });

  it("sin-doble falla si la segunda carga pagó otro premio o la billetera cambió", () => {
    const a = bien();
    a.c2.medidas.premio = { monto: "100000000" };
    expect(por(a)["premio-sin-doble"]).toBe(false);
    const b = bien();
    b.s2.contrato = monto * 2n;
    expect(por(b)["premio-sin-doble"]).toBe(false);
  });

  it("un desbloqueo cuenta lo que midió el navegador: con dos falla", () => {
    const d = bien();
    d.enviado.medidas.envios[0].desbloqueos = 2;
    expect(por(d)["premio-un-desbloqueo"]).toBe(false);
  });

  it("la nota tiene que ser la de prueba y estar en la red", () => {
    const a = bien();
    a.nota.nota = 5n;
    expect(por(a)["premio-nota"]).toBe(false);
    const b = bien();
    b.nota.nota = null;
    expect(por(b)["premio-nota"]).toBe(false);
  });

  it("los saldos piden la billetera en cero y el destino con lo que tenía más el premio, sin comisiones", () => {
    const a = bien();
    a.s3.cuenta = destinoFinal - 100n;
    expect(por(a)["premio-saldos"]).toBe(false);
    const b = bien();
    b.s3.contrato = 1n;
    expect(por(b)["premio-saldos"]).toBe(false);
  });

  it("después de mandar, la tercera carga tiene que llegar a sin monedas, sin premio y con la billetera en cero", () => {
    const a = bien();
    a.c3.estado = "premio-listo";
    expect(por(a)["premio-sin-doble-tras-mandar"]).toBe(false);
    const b = bien();
    b.c3.medidas.premio = {};
    expect(por(b)["premio-sin-doble-tras-mandar"]).toBe(false);
    const c = bien();
    c.s4.contrato = 5n;
    expect(por(c)["premio-sin-doble-tras-mandar"]).toBe(false);
  });

  it("la raíz normalizada no pasa el check, pero el detalle dice cuál fue", () => {
    const d = bien();
    d.enviado.medidas.envios[0].raiz = "normalizada";
    const c = checksDePremio(d).find((x) => x.nombre === "premio-raiz");
    expect(c.ok).toBe(false);
    expect(c.detalle).toBe("normalizada");
  });
});
