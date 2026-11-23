// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La campaña es de la cuenta que la organiza: otra cuenta en la misma compu no la ve ni la mueve, y nada se borra al cambiar
 * de cuenta. Sin ninguna cuenta conectada la sala se maneja con su token, como siempre: cerrar, quitar, sumar 15 minutos,
 * reabrir y pasar la lista no piden entrar. Sellar, guardar el resultado y avisar siguen pidiendo la cuenta dueña.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CLAVE_EVENTOS_ORG, CLAVE_ORG, borrarOrg, guardarOrg, leerOrg } from "../sala/campana-org";
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
  confirmarCierre,
  elegirArchivo,
  equipoDe,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
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

describe("sin ninguna cuenta conectada la sala se maneja con su token", () => {
  // Decisión del 22 de noviembre de 2026, contraria a la de antes (que pedía entrar con Google para cerrar o quitar): el evento no
  // puede depender de un ingreso nuevo en el wifi donde 150 personas entran a la vez, y la sala acepta todo esto con el token
  // guardado. La protección queda para otra cuenta conectada, que aparta la campaña (arriba).
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

  it("los botones son los de siempre y ninguno abre la entrada", async () => {
    const { p, entradas } = await abiertaSinSesion();
    expect(principales(p).map((b) => b.textContent)).toEqual(["Mostrar en grande"]);
    expect(boton(p, "Cerrar la lista").disabled).toBe(false);
    expect(p.raiz.textContent).not.toContain("Entrar para cerrar");
    expect(entradas()).toBe(0);
  });

  it("la pantalla grande se puede abrir y el QR sigue renovándose", async () => {
    const { m, p } = await abiertaSinSesion();
    await vi.waitFor(() => expect(m.qrs.length).toBeGreaterThan(0));
    expect(boton(p, "Mostrar en grande").disabled).toBe(false);
    expect(m.pases).toBeGreaterThan(0);
  });

  it("15 minutos más y quitar con motivo llegan a la sala sin pedir entrar", async () => {
    const { m, p, entradas } = await abiertaSinSesion();
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(m.fases.map(([f]) => f)).toEqual(["abierta"]));
    botonDeFila(p, 1, "Quitar").click();
    expect(botonesDeMotivo(p)).toBe(1);
    botonDeFila(p, 1, "Cuenta repetida").click();
    await m.correr(5_000);
    expect(m.quitadas).toEqual([[1, "repetida"]]);
    expect(entradas()).toBe(0);
  });

  it("cerrar la lista, pasarla al sorteo y volver a abrirla andan sin sesión", async () => {
    const { m, p, entradas } = await abiertaSinSesion();
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(m.fases[m.fases.length - 1]).toEqual(["cerrada", null]);
    boton(p, "Volver a abrir la lista").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.fases[m.fases.length - 1]?.[0]).toBe("abierta");
    expect(entradas()).toBe(0);
  });

  it("al recargar con la lista cerrada, Pasar la lista al sorteo anda sin sesión", async () => {
    const m = mundo();
    const { entradas } = conEntradas(m);
    guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await equipoDe(m, 1, "Ana"), await equipoDe(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pasar la lista al sorteo"]);
    boton(p, "Pasar la lista al sorteo").click();
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(entradas()).toBe(0);
  });

  it("con la sesión de la dueña sigue igual, sin apartar nada", async () => {
    const { m, p } = await abiertaSinSesion();
    cambiarLaSesion(m, A);
    await suelta();
    expect(vistaDe(p)).toBe("abierta");
    expect(m.apartadas).toEqual([]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Mostrar en grande"]);
  });

  it("dejar la campaña sin sesión no borra las de otras cuentas guardadas al costado, aunque la suya ya no esté guardada", async () => {
    const m = mundo();
    const DE_B = { ...SALA, id: "BbBb1234", token: "B".repeat(22) };
    guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "abierta" }, AHORA);
    guardarOrg(m.almacen, { sala: DE_B, cuenta: B, fase: "abierta" }, AHORA);
    m.sala.fase = "abierta";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    // La sala en curso deja de estar guardada (venció, o la borró otra lectura) mientras se la mira.
    borrarOrg(m.almacen, "testnet");
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await suelta();
    expect(vistaDe(p)).toBe("elegir");
    expect(leerOrg(m.almacen, AHORA, "testnet", A)?.sala.token).toBe(TOKEN);
  });

  describe("sin sesión y sin sala en curso, la que se retoma es una de las de un costado", () => {
    const DE_B = { ...SALA, id: "BbBb1234", token: "B".repeat(22) };
    const DE_C = { ...SALA, id: "CcCc1234", token: "Q".repeat(22) };
    const C = Keypair.random().publicKey();
    /** Tres cuentas pasaron por esta compu y la última dejó la suya: quedan la de A y la de B al costado, sin sala en curso. */
    function tresCuentas(): Mundo {
      const m = mundo();
      guardarOrg(m.almacen, { sala: SALA, cuenta: A, fase: "abierta" }, AHORA);
      guardarOrg(m.almacen, { sala: DE_B, cuenta: B, fase: "abierta" }, AHORA);
      guardarOrg(m.almacen, { sala: DE_C, cuenta: C, fase: "abierta" }, AHORA);
      borrarOrg(m.almacen, "testnet", C);
      m.sala.fase = "abierta";
      m.cuenta = null;
      // Sin sesión se ve la primera de un costado: la de B.
      expect(leerOrg(m.almacen, AHORA, "testnet", null)?.sala.id).toBe(DE_B.id);
      return m;
    }

    it("si la sala ya no existe, se deja de recordar esa y la de A sigue", async () => {
      const m = tresCuentas();
      m.respuestaAlEstado.push("no-existe");
      const p = nuevoPanel(m);
      await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Esta lista ya no existe."));
      expect(vistaDe(p)).toBe("elegir");
      expect(leerOrg(m.almacen, AHORA, "testnet", B)).toBeNull();
      expect(m.almacen.getItem(CLAVE_ORG)).not.toContain(DE_B.token);
      expect(leerOrg(m.almacen, AHORA, "testnet", A)?.sala).toEqual(SALA);
    });

    it("sin conexión, dejarla saca esa y la de A sigue", async () => {
      const m = tresCuentas();
      m.respuestaAlEstado.push("red");
      const p = nuevoPanel(m);
      await vi.waitFor(() => expect(vistaDe(p)).toBe("sin-red"));
      boton(p, "Elegir otro archivo").click();
      boton(p, "Sí, dejarla").click();
      await suelta();
      expect(vistaDe(p)).toBe("elegir");
      expect(leerOrg(m.almacen, AHORA, "testnet", B)).toBeNull();
      expect(m.almacen.getItem(CLAVE_ORG)).not.toContain(DE_B.token);
      expect(leerOrg(m.almacen, AHORA, "testnet", A)?.sala).toEqual(SALA);
    });
  });

  it("una sala de una campaña que no nombra a nadie tampoco pide entrar", async () => {
    const m = mundo();
    const { entradas } = conEntradas(m);
    guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "abierta" });
    m.sala.fase = "abierta";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Mostrar en grande"]);
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

  it("sin sesión no se completa, y la sala se maneja con su token sin pedir entrar", async () => {
    const m = mundo();
    const { entradas } = conEntradas(m);
    vieja(m);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Mostrar en grande"]);
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(m.fases.map(([f]) => f)).toEqual(["abierta"]));
    expect(entradas()).toBe(0);
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
