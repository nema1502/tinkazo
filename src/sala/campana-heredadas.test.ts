import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Las rutas viejas de la sala (el stand por nombres y el registro de equipos por QR) en una sala de campaña. Con solo el id
 * de la sala no se dice nada de nadie: contestan igual que una sala común donde esa persona no está.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const D_CIFRADO = "A".repeat(60);
const LLAVE_EQUIPO = "llaveDeUnEquipo0000000000";

interface Respuesta {
  estado: number;
  cuerpo: unknown;
}

async function leer(r: Response): Promise<Respuesta> {
  const texto = await r.text();
  return { estado: r.status, cuerpo: texto === "" ? null : (JSON.parse(texto) as unknown) };
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

describe("las rutas heredadas en una sala de campaña", () => {
  let mundo: MundoDeSala;
  let campana: SalaDeCampana;
  let anotada: PersonaDePrueba;
  let comun: SalaDeCampana;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    campana = await campanaAbierta(mundo, AHORA);
    anotada = personaDePrueba(mundo, 1);
    expect((await altaDe(mundo, campana.id, anotada)).status).toBe(201);
    comun = (await (await mundo.pedir("/v1/sala", { metodo: "POST" })).json()) as SalaDeCampana;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedir = async (id: string, ruta: string, init: Parameters<MundoDeSala["pedir"]>[1] = {}): Promise<Respuesta> =>
    leer(await mundo.pedir(`/v1/sala/${id}${ruta}`, init));

  it("GET equipos/<cuenta> no dice si una cuenta anotada está ni su número: contesta como una sala común sin ese equipo", async () => {
    const enCampana = await pedir(campana.id, `/equipos/${anotada.cuenta}`);
    const enLaComun = await pedir(comun.id, `/equipos/${anotada.cuenta}`);
    expect(enCampana).toEqual({ estado: 404, cuerpo: { error: "no-existe" } });
    expect(enCampana).toEqual(enLaComun);
  });

  it("GET equipos/<cuenta> contesta igual con una cuenta que no está anotada", async () => {
    const otra = Keypair.random().publicKey();
    const presente = await pedir(campana.id, `/equipos/${anotada.cuenta}`);
    const ausente = await pedir(campana.id, `/equipos/${otra}`);
    expect(ausente).toEqual(presente);
  });

  it("GET publico contesta como una sala sin registro de equipos, con el mismo cuerpo que una común", async () => {
    const enCampana = await pedir(campana.id, "/publico");
    const enLaComun = await pedir(comun.id, "/publico");
    expect(enCampana).toEqual({ estado: 200, cuerpo: { config: null, equipos: 0 } });
    expect(enCampana).toEqual(enLaComun);
  });

  it("GET equipos?desde sin token da token, igual que con un token equivocado", async () => {
    const sin = await pedir(campana.id, "/equipos?desde=0");
    const mal = await pedir(campana.id, "/equipos?desde=0", { cabeceras: bearer("T".repeat(22)) });
    expect(sin).toEqual({ estado: 403, cuerpo: { error: "token" } });
    expect(mal).toEqual(sin);
  });

  it("GET nombres?desde sin token da token, igual que con un token equivocado", async () => {
    const sin = await pedir(campana.id, "/nombres?desde=0");
    const mal = await pedir(campana.id, "/nombres?desde=0", { cabeceras: bearer("T".repeat(22)) });
    expect(sin).toEqual({ estado: 403, cuerpo: { error: "token" } });
    expect(mal).toEqual(sin);
  });

  it("GET nombres?desde con el token de quien organiza no trae nada: en una campaña no hay nombres", async () => {
    const r = await pedir(campana.id, "/nombres?desde=0", { cabeceras: bearer(campana.token) });
    expect(r).toEqual({ estado: 200, cuerpo: [] });
  });

  it("GET equipos?desde con el token de quien organiza sigue trayendo las anotadas, como dice el contrato del panel", async () => {
    const r = await pedir(campana.id, "/equipos?desde=0", { cabeceras: bearer(campana.token) });
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject([{ n: 1, cuenta: anotada.cuenta, estado: "aceptado" }]);
  });

  it("POST de un nombre da campana", async () => {
    const r = await pedir(campana.id, "", { cuerpo: { d: D_CIFRADO, h: D_CIFRADO, llave: LLAVE_EQUIPO } });
    expect(r).toEqual({ estado: 409, cuerpo: { error: "campana" } });
  });

  it("PUT config da campana con el token de quien organiza", async () => {
    const config = { modo: "cupon", evento: "feria-del-libro", cuenta: Keypair.random().publicKey() };
    const r = await pedir(campana.id, "/config", { metodo: "PUT", cuerpo: config, cabeceras: bearer(campana.token) });
    expect(r).toEqual({ estado: 409, cuerpo: { error: "campana" } });
  });

  it("POST de un equipo da campana y no anota nada", async () => {
    const cuenta = Keypair.random().publicKey();
    const r = await pedir(campana.id, "/equipos", { cuerpo: { cuenta, d: D_CIFRADO, llave: LLAVE_EQUIPO } });
    expect(r).toEqual({ estado: 409, cuerpo: { error: "campana" } });
    const lista = await pedir(campana.id, "/equipos?desde=0", { cabeceras: bearer(campana.token) });
    expect(lista.cuerpo).toHaveLength(1);
  });

  it("PUT del estado de un equipo y DELETE de un equipo dan campana con el token de quien organiza", async () => {
    const cambio = await pedir(campana.id, "/equipos/1", {
      metodo: "PUT",
      cuerpo: { estado: "cupon" },
      cabeceras: bearer(campana.token),
    });
    const quitar = await pedir(campana.id, "/equipos/1", { metodo: "DELETE", cabeceras: bearer(campana.token) });
    expect(cambio).toEqual({ estado: 409, cuerpo: { error: "campana" } });
    expect(quitar).toEqual({ estado: 409, cuerpo: { error: "campana" } });
    const lista = await pedir(campana.id, "/equipos?desde=0", { cabeceras: bearer(campana.token) });
    expect(lista.cuerpo).toMatchObject([{ n: 1, estado: "aceptado" }]);
  });

  it("lo único que cada celular sabe de sí mismo es lo de /yo, con su llave", async () => {
    const con = await pedir(campana.id, "/campana/yo", { cuerpo: { cuenta: anotada.cuenta, llave: anotada.llave } });
    const sin = await pedir(campana.id, "/campana/yo", { cuerpo: { cuenta: anotada.cuenta, llave: "otraLlave".padEnd(22, "x") } });
    expect(con.cuerpo).toMatchObject({ anotada: true });
    expect(sin.cuerpo).toMatchObject({ anotada: false });
    expect(JSON.stringify([con.cuerpo, sin.cuerpo])).not.toContain('"n"');
  });
});

describe("las rutas heredadas en una sala común quedan igual", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  const cuenta = Keypair.random().publicKey();

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    sala = (await (await mundo.pedir("/v1/sala", { metodo: "POST" })).json()) as SalaDeCampana;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedir = async (ruta: string, init: Parameters<MundoDeSala["pedir"]>[1] = {}): Promise<Respuesta> =>
    leer(await mundo.pedir(`/v1/sala/${sala.id}${ruta}`, init));

  it("el registro de equipos por QR se arma, anota, se consulta por cuenta y se lista con token", async () => {
    const config = { modo: "cupon", evento: "feria-del-libro", cuenta: Keypair.random().publicKey() };
    expect((await pedir("/config", { metodo: "PUT", cuerpo: config, cabeceras: bearer(sala.token) })).estado).toBe(204);
    const anotar = await pedir("/equipos", { cuerpo: { cuenta, d: D_CIFRADO, llave: LLAVE_EQUIPO } });
    expect(anotar).toEqual({ estado: 201, cuerpo: { n: 1, estado: "aceptado" } });
    expect(await pedir(`/equipos/${cuenta}`)).toEqual({ estado: 200, cuerpo: { n: 1, estado: "aceptado" } });
    expect(await pedir("/publico")).toEqual({ estado: 200, cuerpo: { config, equipos: 1 } });
    const lista = await pedir("/equipos?desde=0", { cabeceras: bearer(sala.token) });
    expect(lista.cuerpo).toMatchObject([{ n: 1, cuenta, estado: "aceptado" }]);
  });

  it("una cuenta que no se anotó da no-existe y una sala sin registro da cero equipos", async () => {
    expect(await pedir(`/equipos/${cuenta}`)).toEqual({ estado: 404, cuerpo: { error: "no-existe" } });
    expect(await pedir("/publico")).toEqual({ estado: 200, cuerpo: { config: null, equipos: 0 } });
  });

  it("el estado de un equipo lo cambia quien tiene el token", async () => {
    const config = { modo: "cupon", evento: "feria-del-libro", cuenta: Keypair.random().publicKey() };
    await pedir("/config", { metodo: "PUT", cuerpo: config, cabeceras: bearer(sala.token) });
    await pedir("/equipos", { cuerpo: { cuenta, d: D_CIFRADO, llave: LLAVE_EQUIPO } });
    const cambio = await pedir("/equipos/1", { metodo: "PUT", cuerpo: { estado: "cupon" }, cabeceras: bearer(sala.token) });
    expect(cambio.estado).toBe(204);
    expect(await pedir(`/equipos/${cuenta}`)).toEqual({ estado: 200, cuerpo: { n: 1, estado: "cupon" } });
    const quitar = await pedir("/equipos/1", { metodo: "DELETE", cabeceras: bearer(sala.token) });
    expect(quitar.estado).toBe(204);
    expect(await pedir(`/equipos/${cuenta}`)).toEqual({ estado: 404, cuerpo: { error: "no-existe" } });
  });
});
