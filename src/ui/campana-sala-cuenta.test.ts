// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La campaña es de la cuenta que la organiza: otra cuenta en la misma compu no la ve ni la mueve, y nada se borra al cambiar
 * de cuenta. Sin sesión la sala se mira (el QR, la lista, la pantalla grande) y lo que cambia la lista pide entrar primero.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CLAVE_EVENTOS_ORG, CLAVE_ORG, guardarOrg, leerOrg } from "../sala/campana-org";
import {
  AHORA,
  SALA,
  TOKEN,
  type Mundo,
  abrirInscripcion,
  alta,
  archivoDe,
  boton,
  botonDeFila,
  cerrarTodos,
  elegirArchivo,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  vistaDe,
} from "./campana-sala-mundo";

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  vi.restoreAllMocks();
});

/** Un mundo que cuenta cuántas veces el panel pidió la entrada con Google. */
function conEntradas(m: Mundo): { entradas: () => number } {
  let n = 0;
  m.deps.entrar = () => void n++;
  return { entradas: () => n };
}

/** Avisa que cambió la sesión, como lo hace la billetera de la página. */
function cambiarLaSesion(m: Mundo, cuenta: string | null): void {
  m.cuenta = cuenta;
  document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: cuenta }));
}

describe("otra cuenta no ve la campaña", () => {
  it("con otra cuenta conectada el panel abre sin campaña y lo guardado sigue ahí", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "abierta" });
    m.sala.fase = "abierta";
    m.cuenta = B;
    const p = nuevoPanel(m);
    await suelta();
    expect(vistaDe(p)).toBe("elegir");
    expect(m.escuchas).toBe(0);
    expect(m.almacen.getItem(CLAVE_ORG)).toContain(TOKEN);
    expect(leerOrg(m.almacen, AHORA, "testnet", B)).toBeNull();
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.sala.token).toBe(TOKEN);
  });

  it("al entrar otra cuenta con la sala a la vista se aparta sin borrar nada, y al volver la dueña se retoma", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "abierta" });
    m.sala.fase = "abierta";
    m.cuenta = A;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));

    cambiarLaSesion(m, B);
    await suelta();
    expect(vistaDe(p)).toBe("elegir");
    expect(m.apartadas.map((s) => s.id)).toEqual([SALA.id]);
    expect(filasDe(p)).toEqual([]);
    expect(m.paradas).toBeGreaterThan(0);
    expect(m.almacen.getItem(CLAVE_ORG)).toContain(TOKEN);
    expect(m.borradas).toBe(0);

    cambiarLaSesion(m, A);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.escuchas).toBe(2);
  });

  it("la cuenta que no es la dueña no usa el token del evento de la otra", async () => {
    const m = mundo();
    m.cuenta = A;
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ organizadora: A }));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    const guardado = JSON.parse(m.almacen.getItem(CLAVE_EVENTOS_ORG) ?? "[]") as { evento: string; token: string; cuenta?: string }[];
    expect(guardado).toEqual([{ evento: "evento-uno", token: TOKEN, cuenta: A }]);
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBe(A);
    p.detener();
    document.body.innerHTML = "";

    const otro = mundo({ almacen: m.almacen });
    otro.cuenta = B;
    const q = nuevoPanel(otro);
    await elegirArchivo(otro, q, archivoDe({ organizadora: B }));
    boton(q, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(otro.creadas).toHaveLength(1));
    expect(otro.creadas[0]?.de.anterior).toBeNull();
    // El token de la dueña sigue guardado: nada se pisó.
    expect(JSON.parse(m.almacen.getItem(CLAVE_EVENTOS_ORG) ?? "[]")).toContainEqual({ evento: "evento-uno", token: TOKEN, cuenta: A });
  });
});

describe("sin sesión la sala se mira y lo que cambia la lista pide entrar", () => {
  async function abiertaSinSesion(): Promise<{ m: Mundo; p: ReturnType<typeof nuevoPanel>; entradas: () => number }> {
    const m = mundo();
    const { entradas } = conEntradas(m);
    guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "abierta" });
    m.sala.fase = "abierta";
    m.cuenta = null;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    return { m, p, entradas };
  }

  it("el botón principal dice Entrar para cerrar y abre la entrada sin tocar la sala", async () => {
    const { m, p, entradas } = await abiertaSinSesion();
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar para cerrar"]);
    boton(p, "Entrar para cerrar").click();
    expect(entradas()).toBe(1);
    expect(m.fases).toEqual([]);
    expect(vistaDe(p)).toBe("abierta");
  });

  it("la pantalla grande se puede abrir y el QR sigue renovándose", async () => {
    const { m, p } = await abiertaSinSesion();
    await vi.waitFor(() => expect(m.qrs.length).toBeGreaterThan(0));
    expect(boton(p, "Mostrar en grande").disabled).toBe(false);
    expect(m.pases).toBeGreaterThan(0);
  });

  it("15 minutos más y Quitar piden entrar y no mandan nada", async () => {
    const { m, p, entradas } = await abiertaSinSesion();
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    boton(p, "15 minutos más").click();
    await suelta();
    expect(m.fases).toEqual([]);
    expect(entradas()).toBe(1);
    botonDeFila(p, 1, "Quitar").click();
    await suelta();
    expect(entradas()).toBe(2);
    expect(m.quitadas).toEqual([]);
    expect(botonesDeMotivo(p)).toBe(0);
  });

  it("con la sesión de la dueña vuelve el botón de cerrar", async () => {
    const { m, p } = await abiertaSinSesion();
    cambiarLaSesion(m, A);
    await suelta();
    expect(principales(p).map((b) => b.textContent)).not.toContain("Entrar para cerrar");
  });

  it("una sala de una campaña que no nombra a nadie no pide entrar", async () => {
    const m = mundo();
    const { entradas } = conEntradas(m);
    guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "abierta" });
    m.sala.fase = "abierta";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(principales(p).map((b) => b.textContent)).not.toContain("Entrar para cerrar");
    expect(entradas()).toBe(0);
  });
});

function botonesDeMotivo(p: ReturnType<typeof nuevoPanel>): number {
  return p.raiz.querySelectorAll(".cpo-motivos").length;
}

describe("la memoria de antes, sin la cuenta guardada", () => {
  const vieja = (m: Mundo): void => {
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    m.sala.fase = "abierta";
  };

  it("sin sesión no se completa: la sala se mira y la acción pide entrar", async () => {
    const m = mundo();
    const { entradas } = conEntradas(m);
    vieja(m);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar para cerrar"]);
    boton(p, "Entrar para cerrar").click();
    expect(entradas()).toBe(1);
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.cuenta).toBeUndefined();
  });

  it("con la sesión de la cuenta que nombra el texto se completa con ella", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = A;
    m.organizadora = A;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBe(A));
    expect(vistaDe(p)).toBe("abierta");
  });

  it("con la sesión de otra cuenta no se retoma, se anota de quién es y no se borra", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = B;
    m.organizadora = A;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(m.apartadas).toHaveLength(1));
    expect(vistaDe(p)).toBe("elegir");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.cuenta).toBe(A);
    expect(leerOrg(m.almacen, AHORA, "testnet", B)).toBeNull();
    expect(m.almacen.getItem(CLAVE_ORG)).toContain(TOKEN);
  });

  it("si la campaña no nombra a nadie queda a cargo de quien tenga el token", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = B;
    m.organizadora = null;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(leerOrg(m.almacen, AHORA, "testnet", B)?.cuenta).toBeNull());
    expect(vistaDe(p)).toBe("abierta");
  });

  it("tras una lectura que falló se vuelve a probar sola, unas veces, sin esperar otra sesión", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = A;
    m.organizadora = "red";
    nuevoPanel(m);
    await suelta();
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBeUndefined();
    m.organizadora = A;
    await m.correr(5_000);
    await vi.waitFor(() => expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBe(A));
  });

  it("si la lectura sigue fallando deja de insistir a los cinco intentos", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = A;
    let lecturas = 0;
    m.deps.organizadoraDeSala = async () => {
      lecturas++;
      return "red";
    };
    nuevoPanel(m);
    await suelta();
    await m.correr(60_000);
    expect(lecturas).toBe(6);
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBeUndefined();
  });

  it("si no se puede leer la campaña queda sin completar y se prueba con la próxima sesión", async () => {
    const m = mundo();
    vieja(m);
    m.cuenta = A;
    m.organizadora = "red";
    const p = nuevoPanel(m);
    await suelta();
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBeUndefined();
    expect(vistaDe(p)).toBe("abierta");
    m.organizadora = A;
    cambiarLaSesion(m, A);
    await vi.waitFor(() => expect(leerOrg(m.almacen, AHORA, "testnet", A)?.cuenta).toBe(A));
  });
});
