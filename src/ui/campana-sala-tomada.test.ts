// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tu campaña sigue en otra compu: cuando la sala deja de aceptar el token de esta compu (la misma cuenta abrió la campaña en
 * otra), el panel lo dice con una respuesta concreta (403 token, el cierre 4001 o 4401 del socket, o tuya en falso), deja de
 * escuchar, cierra la pantalla grande y saca el QR. Lo guardado no se borra: Dejar esta campaña olvida lo de esta compu y no le
 * toca la sala. La falta de respuesta nunca es una toma.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { ponerPaso, reiniciarElPuente } from "../campana/puente";
import { CLAVE_ORG, guardarOrg, leerOrg } from "../sala/campana-org";
import {
  AHORA,
  SALA,
  TOKEN,
  type Mundo,
  abrirInscripcion,
  alta,
  boton,
  botonDeFila,
  botones,
  cerrarTodos,
  confirmarCierre,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
  $,
} from "./campana-sala-mundo";

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

/** Lo que dice la pantalla de la campaña que tomó otra compu. */
function dicePantallaTomada(p: ReturnType<typeof nuevoPanel>): void {
  expect(vistaDe(p)).toBe("tomada");
  expect(texto(p, "#cpo-h")).toBe("Tu campaña sigue en otra compu");
  expect(texto(p, "#cpo-linea")).toBe("Se abrió con tu cuenta en otro lado.");
  expect(principales(p).map((b) => b.textContent)).toEqual(["Dejar esta campaña"]);
  expect($(p, "#cpo-qr").hidden).toBe(true);
  expect($(p, "#cpo-lista").hidden).toBe(true);
  expect(texto(p, "#cpo-aviso")).toBe("");
  expect($(p, "#cpo-conexion").hidden).toBe(true);
}

async function abierta(m: Mundo): Promise<ReturnType<typeof nuevoPanel>> {
  const p = nuevoPanel(m);
  await abrirInscripcion(m, p);
  await alta(m, 1, "Ana");
  await alta(m, 2, "Nora");
  await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
  return p;
}

describe("cómo se entera el panel de que la tomaron", () => {
  it("el pase que la sala rechaza con el motivo token lleva a la pantalla y no a la caída ni al rechazo común", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.respuestasAlPase.push("token");
    await m.correr(120_000);
    dicePantallaTomada(p);
    expect(m.paradas).toBeGreaterThan(0);
    expect(m.almacen.getItem(CLAVE_ORG)).toContain(TOKEN);
  });

  it("cerrar la lista con el token que ya no vale lleva a la pantalla y no cierra nada", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.respuestasAFase.push({ falla: "token", llega: false });
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("tomada"));
    dicePantallaTomada(p);
    expect(texto(p, "#cpo-aviso")).not.toContain("Sin conexión");
  });

  it("15 minutos más con el token que ya no vale también", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.respuestasAFase.push({ falla: "token", llega: false });
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("tomada"));
    dicePantallaTomada(p);
  });

  it("quitar a alguien con el token que ya no vale lleva a la pantalla", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.respuestasAQuitar.push({ falla: "token", llega: false });
    botonDeFila(p, 1, "Quitar").click();
    botonDeFila(p, 1, "Otro").click();
    await m.correr(5_000);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("tomada"));
    dicePantallaTomada(p);
  });

  it("el cierre 4001 o 4401 del socket, o el 403 del sondeo, llegan por alTomada y llevan a la pantalla", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.escucha().alTomada?.();
    dicePantallaTomada(p);
  });

  it("el aviso del sello o del resultado que la sala rechaza por el token lleva a la pantalla", async () => {
    const m = mundo();
    const p = await abierta(m);
    ponerPaso({ paso: "tomada" });
    dicePantallaTomada(p);
  });

  it("al retomar, un 403 token del estado o un tuya en falso llevan a la pantalla, no a sin conexión", async () => {
    for (const estado of ["token", { fase: "abierta" as const, total: 0, cierraMs: AHORA + 3_600_000, tuya: false }] as const) {
      document.body.innerHTML = "";
      const m = mundo();
      guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "abierta" });
      m.respuestaAlEstado.push(estado);
      const p = nuevoPanel(m);
      await vi.waitFor(() => expect(vistaDe(p)).toBe("tomada"));
      dicePantallaTomada(p);
      expect(m.escuchas).toBe(0);
      cerrarTodos();
    }
  });

  it("al retomar, un tuya en verdadero sigue como siempre", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "abierta" });
    m.sala.fase = "abierta";
    m.respuestaAlEstado.push({ fase: "abierta", total: 0, cierraMs: AHORA + 3_600_000, tuya: true });
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("sin respuesta nunca es una toma: sigue en sin conexión, con la sala guardada", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "abierta" });
    m.respuestaAlEstado.push("red");
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sin-red"));
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.sala.token).toBe(TOKEN);
  });

  it("el pase que falla por la red no es una toma", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.respuestasAlPase.push("red");
    await m.correr(120_000);
    expect(vistaDe(p)).toBe("abierta");
  });
});

describe("la pantalla de la campaña tomada", () => {
  it("cierra la pantalla grande que estaba abierta", async () => {
    const m = mundo();
    const p = await abierta(m);
    boton(p, "Mostrar en grande").click();
    await suelta();
    expect(document.querySelector(".campana-grande")).not.toBeNull();
    m.escucha().alTomada?.();
    await suelta();
    expect(document.querySelector(".campana-grande")).toBeNull();
    dicePantallaTomada(p);
  });

  it("no ofrece nada más que dejar la campaña: ni cerrar, ni quitar, ni abrir de nuevo", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.escucha().alTomada?.();
    expect(botones(p).map((b) => b.textContent)).toEqual(["Dejar esta campaña"]);
  });

  it("no vuelve a pedir pases ni a escuchar la sala", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.escucha().alTomada?.();
    const pases = m.pases;
    await m.correr(20 * 60_000);
    expect(m.pases).toBe(pases);
    expect(vistaDe(p)).toBe("tomada");
  });

  it("Dejar esta campaña olvida lo guardado en esta compu y no le toca la sala", async () => {
    const m = mundo();
    const p = await abierta(m);
    m.escucha().alTomada?.();
    boton(p, "Dejar esta campaña").click();
    expect(vistaDe(p)).toBe("elegir");
    expect(m.almacen.getItem(CLAVE_ORG)).toBeNull();
    expect(m.borradas).toBe(0);
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(0);
  });

  it("mientras está en esta pantalla no se vuelve a guardar la sala", async () => {
    const m = mundo();
    const p = await abierta(m);
    const antes = m.almacen.getItem(CLAVE_ORG);
    m.escucha().alTomada?.();
    await alta(m, 3, "Beto");
    await m.correr(60_000);
    expect(m.almacen.getItem(CLAVE_ORG)).toBe(antes);
    expect(vistaDe(p)).toBe("tomada");
  });
});
