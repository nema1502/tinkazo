/**
 * La ventana rápida del resultado con su interruptor ENCENDIDO (se simula acá: en el código está apagado). Con él, las
 * dependencias dicen que la página mire el resultado cada pocos segundos.
 */

import { describe, expect, it, vi } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import { depsConectadas, type PiezasDelCelular } from "./conectar";

vi.mock("./ventana-rapida", () => ({ VENTANA_RAPIDA_ENCENDIDA: true }));

const AHORA = 1_800_000_000_000;

function piezas(): PiezasDelCelular {
  return {
    base: {
      tx: (clave) => clave,
      idioma: () => "es",
      enApp: false,
      ahora: () => AHORA,
      cada: () => () => undefined,
      visible: () => true,
      alVolver: () => () => undefined,
      vibrar: () => undefined,
      movimientoReducido: () => true,
    },
    campana: campanaDeEjemplo(AHORA),
    servicio: "https://servicio.example.org",
    sala: "ABCDEFGH",
    clave: "abcdefghijklmnopqrstuv",
    pase: "ABCDEFGHIJKL",
    google: {
      retomar: async () => null,
      entrar: async () => ({ cuenta: `G${"A".repeat(55)}`, nombre: null }),
      token: async () => null,
      nombreTardio: async () => null,
      sigueLaSesion: async () => false,
      salir: async () => undefined,
      renovar: () => undefined,
    },
    memoria: null,
    red: "testnet",
    enLinea: () => true,
    ir: () => undefined,
    enlace: () => "x",
  };
}

describe("la ventana rápida del resultado, encendida", () => {
  it("las dependencias dicen que la ventana está encendida", () => {
    expect(depsConectadas(piezas()).ventanaRapida).toBe(true);
  });

  it("el azar es el de la página, y se puede cambiar para las pruebas", () => {
    const deps = depsConectadas({ ...piezas(), dep: { azar: () => 0.25 } });
    expect(deps.azar?.()).toBe(0.25);
  });
});
