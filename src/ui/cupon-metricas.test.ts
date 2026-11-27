// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://tinkazo.app/"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarConteo } from "../../workers/enlaces/src/conteo";
import { contar, olvidarOrigen, origenActual, probarCon, recordarOrigen } from "../contar";
import { marcarEnsayo } from "../ensayo-modo";
import { cuponGuardado, guardarCupon } from "../stellar/cupon-guardado";
import { contarEntradaConRed, contarPasoOficial } from "./contadores";
import { type ControlDelCupon, type EntornoDelCupon, iniciarCuponDelEnlace } from "./cupon-enlace";

const CODIGO = "K7M29QXA4HTR";
const enviados: unknown[] = [];
const controles: ControlDelCupon[] = [];

function iniciar(op: Partial<EntornoDelCupon> = {}, fragmento = `#cupon=${CODIGO}`) {
  const direccion = { origen: "https://tinkazo.app", ruta: "/", busqueda: "?o=tarjeta", fragmento };
  const env: EntornoDelCupon = {
    activo: true,
    enApp: false,
    almacen: sessionStorage,
    direccion: () => direccion,
    reemplazar: vi.fn(),
    sesion: () => null,
    ocupada: () => false,
    entrar: vi.fn(),
    claveDeEntrar: () => "ctaGoogle",
    copiar: vi.fn(async () => true),
    insertar: (el) => document.body.append(el),
    ...op,
  };
  const control = iniciarCuponDelEnlace(env);
  controles.push(control);
  return { env, control, direccion };
}

beforeEach(() => {
  // El almacén público de jsdom: la deduplicación se prueba con almacenamiento disponible.
  vi.stubGlobal("sessionStorage", window.sessionStorage);
  sessionStorage.clear();
  olvidarOrigen();
  enviados.length = 0;
  document.body.innerHTML = "";
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "?o=tarjeta", pathname: "/", hash: `#cupon=${CODIGO}` });
  vi.stubGlobal("navigator", { doNotTrack: null, sendBeacon: vi.fn((_url: string, body: string) => { enviados.push(JSON.parse(body)); return true; }) });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    enviados.push(JSON.parse(String(init.body)));
    return { status: 204 };
  }));
  probarCon("https://contador.invalid/v1/contar");
});

afterEach(() => {
  for (const control of controles.splice(0)) control.detener();
  marcarEnsayo(false);
  olvidarOrigen();
  probarCon("");
  vi.unstubAllGlobals();
});

describe("la llegada anónima del cupón", () => {
  it.each([[false, "oficial"], [true, "app"]] as const)("cuenta al leerlo (app: %s), sin código ni dirección", (enApp, donde) => {
    const { control, env, direccion } = iniciar({ enApp });
    expect(enviados).toEqual([{ e: "cupon_llegada", p: { donde } }]);
    expect(validarConteo(enviados[0])).toMatchObject({ ok: true });
    expect(cuponGuardado(env.almacen)).toBe(CODIGO);
    expect(direccion.fragmento).toBe(`#cupon=${CODIGO}`);
    expect(env.reemplazar).not.toHaveBeenCalled();
    expect(document.getElementById("cupon-franja")?.dataset.modo).toBe(enApp ? "afuera" : "entrar");
    control.actualizar();
    document.dispatchEvent(new Event("tinkazo:sesion"));
    document.dispatchEvent(new Event("tinkazo:cuenta"));
    expect(enviados).toHaveLength(1);
  });

  it.each(["", "#cupon=mal", "#cupon=%", `#cupon=${CODIGO}&otro=1`])("sin cupón válido (%s), no cuenta ni reemplaza el guardado", (fragmento) => {
    guardarCupon(CODIGO, sessionStorage);
    const { env } = iniciar({}, fragmento);
    expect(enviados).toEqual([]);
    expect(cuponGuardado(env.almacen)).toBe(CODIGO);
    expect(env.reemplazar).not.toHaveBeenCalled();
  });

  it("con el acceso apagado (también en Prueba), no lee ni guarda ni cuenta", () => {
    const direccion = vi.fn(() => { throw new Error("no debe leer"); });
    iniciar({ activo: false, direccion });
    expect(direccion).not.toHaveBeenCalled();
    expect(cuponGuardado()).toBeNull();
    expect(enviados).toEqual([]);
    expect(document.getElementById("cupon-franja")).toBeNull();
  });

  it("cuenta la lectura aunque no se pueda guardar, sin cambiar la dirección", () => {
    const { env, direccion } = iniciar({ almacen: null, sesion: () => ({ pollar: true }) });
    expect(enviados).toEqual([{ e: "cupon_llegada", p: { donde: "oficial" } }]);
    expect(env.reemplazar).not.toHaveBeenCalled();
    expect(direccion.fragmento).toBe(`#cupon=${CODIGO}`);
    expect(document.getElementById("cupon-franja")).toBeNull();
  });

  it.each(["dnt", "gpc", "robot", "local", "demo", "ensayo"])("respeta la exclusión %s sin impedir guardar el cupón", (caso) => {
    if (caso === "dnt") vi.stubGlobal("navigator", { doNotTrack: "1" });
    if (caso === "gpc") vi.stubGlobal("navigator", { globalPrivacyControl: true });
    if (caso === "robot") vi.stubGlobal("navigator", { webdriver: true });
    if (caso === "local") vi.stubGlobal("location", { hostname: "localhost", search: "" });
    if (caso === "demo") vi.stubGlobal("location", { hostname: "tinkazo.app", search: "?demo=1" });
    if (caso === "ensayo") marcarEnsayo(true);
    iniciar();
    expect(enviados).toEqual([]);
    expect(cuponGuardado()).toBe(CODIGO);
  });

  it("conserva el origen tarjeta para conectar la cuenta y sellar, sin sumarlo a la llegada", () => {
    recordarOrigen("?o=tarjeta");
    iniciar();
    contarEntradaConRed("google", "mainnet");
    contar("seal_confirmed", { network: "mainnet", from: origenActual() });
    expect(enviados).toEqual([
      { e: "cupon_llegada", p: { donde: "oficial" } },
      { e: "account_connected", p: { kind: "google", network: "mainnet", from: "tarjeta" } },
      { e: "seal_confirmed", p: { network: "mainnet", from: "tarjeta" } },
    ]);
    for (const evento of enviados) expect(validarConteo(evento)).toMatchObject({ ok: true });
  });

  it("conserva las seis etapas independientes una vez por pestaña y ninguna desde Prueba", () => {
    const pasos = ["abrio", "cupon", "activada", "protegida", "lista", "prueba"] as const;
    for (const paso of pasos) {
      expect(contarPasoOficial(paso, "testnet")).toBe(false);
      expect(contarPasoOficial(paso, "mainnet")).toBe(true);
      expect(contarPasoOficial(paso, "mainnet")).toBe(false);
    }
    expect(enviados).toEqual(pasos.map((paso) => ({ e: "oficial_step", p: { paso } })));
    sessionStorage.clear();
    expect(contarPasoOficial("cupon", "mainnet")).toBe(true);
    expect(enviados).toHaveLength(7);
  });
});
