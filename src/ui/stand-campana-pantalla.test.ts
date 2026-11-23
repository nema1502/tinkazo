// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MotivoDeSalida } from "../sala/campana-org";
import {
  crearPantallaDeCampana,
  type DepsDePantallaDeCampana,
} from "./stand-campana-pantalla";
import { TEXTOS_STAND_CAMPANA } from "./stand-campana-textos";
import type { AvisoDelStand, DatosDelProyector, FilaDelStand } from "./stand-campana";

/**
 * La pantalla del stand de campaña: a pantalla completa, con el QR, el logo, el premio, la hora de cierre,
 * cuántas personas van, la lista descifrada con su «Para revisar», quitar con motivo y cerrar con confirmar.
 */

let idioma: "es" | "en" = "es";
const tx = (clave: string): string => TEXTOS_STAND_CAMPANA[idioma][clave] ?? "";

const fila = (n: number, nombre: string, revisar = false): FilaDelStand => ({ n, nombre, revisar });

function datosDe(cambios: Partial<DatosDelProyector> = {}): DatosDelProyector {
  return {
    titulo: "Alcancía Andina",
    logo: null,
    premio: "Premio: 60 dólares digitales",
    cierre: "Cierra 19:00",
    van: "37 personas van",
    enlace: "https://tinkazo.app/participar.html?c=evento-uno&s=AbCd1234&p=AAAAAAAAAAAA&red=prueba#cccccccccccccccccccccc",
    filas: [fila(1, "Ana"), fila(2, "Beto")],
    revisar: [],
    cerrado: false,
    caido: false,
    aviso: null,
    ...cambios,
  };
}

interface Mundo {
  raiz: HTMLElement;
  pintar: (aviso: AvisoDelStand) => void;
  qrLlamadas: string[];
  quitadas: [number, MotivoDeSalida][];
  cierres: () => number;
}

function montar(datosInicial: DatosDelProyector | null): Mundo {
  const qrLlamadas: string[] = [];
  const quitadas: [number, MotivoDeSalida][] = [];
  let cierres = 0;
  let ultimoAviso: AvisoDelStand;
  const deps: DepsDePantallaDeCampana = {
    tx,
    idioma: () => idioma,
    qr: async (img, enlace) => {
      qrLlamadas.push(enlace);
      img.alt = enlace;
    },
    alQuitar: (n, motivo) => void quitadas.push([n, motivo]),
    alCerrar: () => void (cierres += 1),
  };
  const pantalla = crearPantallaDeCampana(deps);
  document.body.append(pantalla.raiz);
  ultimoAviso = datosInicial === null ? { vista: "chequeando" } : { vista: "abierta", datos: datosInicial };
  pantalla.pintar(ultimoAviso);
  return {
    raiz: pantalla.raiz,
    pintar: (aviso) => {
      ultimoAviso = aviso;
      pantalla.pintar(aviso);
    },
    qrLlamadas,
    quitadas,
    cierres: () => cierres,
  };
}

/** En datos abiertos: el aviso que manda el modelo. */
const abierta = (datos: DatosDelProyector): AvisoDelStand => ({ vista: "abierta", datos });

const botonDe = (raiz: HTMLElement, texto: string, dentroDe?: HTMLElement): HTMLButtonElement => {
  const zona = dentroDe ?? raiz;
  const b = [...zona.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent === texto);
  if (!b) throw new Error(`no está el botón ${texto}`);
  return b;
};

const texto = (raiz: HTMLElement, selector: string): string => raiz.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
  idioma = "es";
});

describe("lo que se ve en la pantalla", () => {
  it("a pantalla completa, con el título, el premio, el cierre, el conteo y el QR", () => {
    const { raiz } = montar(datosDe());
    expect(raiz.getAttribute("role")).toBe("dialog");
    expect(raiz.getAttribute("aria-modal")).toBe("true");
    expect(raiz.hidden).toBe(false);
    expect(texto(raiz, ".scp-titulo")).toBe("Alcancía Andina");
    expect(texto(raiz, ".scp-premio")).toBe("Premio: 60 dólares digitales");
    expect(texto(raiz, ".scp-cierre")).toBe("Cierra 19:00");
    expect(texto(raiz, ".scp-van")).toBe("37 personas van");
    expect(raiz.querySelector(".scp-qr-img")).not.toBeNull();
  });

  it("con logo, lo muestra con la campaña de la empresa", () => {
    const { raiz } = montar(datosDe({ logo: { tipo: "image/png", datos: "ABCD" } }));
    const img = raiz.querySelector<HTMLImageElement>(".scp-logo");
    expect(img?.src).toContain("data:image/png;base64,ABCD");
    expect(img?.alt).toBe("Alcancía Andina");
  });

  it("los nombres descifrados van en la lista; los ilegibles salen con su número", () => {
    const { raiz } = montar(
      datosDe({
        filas: [fila(1, "Ana"), fila(2, ""), fila(3, "Beto")],
        revisar: [fila(4, "Ana Puta", true), fila(5, "Ana", true)],
      }),
    );
    const lista = [...raiz.querySelectorAll<HTMLElement>(".scp-lista .scp-nombre")].map((n) => n.textContent);
    expect(lista).toEqual(["Ana", "Persona 2", "Beto"]);
    expect(raiz.querySelector(".scp-revisar-t")?.textContent).toBe("Para revisar");
    const revisados = [...raiz.querySelectorAll<HTMLElement>(".scp-revisar .scp-nombre")].map((n) => n.textContent);
    expect(revisados).toEqual(["Ana Puta", "Ana"]);
  });

  it("el QR se pinta una sola vez por enlace: solo vuelve a pintarse cuando cambia el código", async () => {
    const otro = "https://tinkazo.app/participar.html?c=evento-uno&s=AbCd1234&p=BBBBBBBBBBBB&red=prueba#cccccccccccccccccccccc";
    const { pintar, qrLlamadas } = montar(datosDe());
    expect(qrLlamadas).toHaveLength(1);
    pintar(abierta(datosDe()));
    expect(qrLlamadas).toHaveLength(1);
    pintar(abierta(datosDe({ enlace: otro })));
    expect(qrLlamadas).toHaveLength(2);
    expect((document.querySelector(".scp-qr-img") as HTMLImageElement).alt).toBe(otro);
  });

  it("sin pase todavía no aparece el QR, y cuando se cayó la sala, el aviso queda a la vista", () => {
    const { raiz } = montar(datosDe({ enlace: null, caido: true, aviso: "Sin conexión con la sala. Probando otra vez…" }));
    expect(raiz.querySelector(".scp-qr-img")).toBeNull();
    expect(texto(raiz, ".scp-aviso")).toBe("Sin conexión con la sala. Probando otra vez…");
  });

  it("sin nadie en la lista, dice que nadie va", () => {
    const { raiz } = montar(datosDe({ van: "Todavía no va nadie", filas: [], revisar: [] }));
    expect(texto(raiz, ".scp-vacia")).toBe("Todavía no se anotó nadie.");
  });
});

describe("quitar con motivo y cerrar con confirmar", () => {
  it("Quitar abre los motivos con botones; el motivo manda a la sala", () => {
    const m = montar(datosDe({ revisar: [fila(3, "Ana Puta", true)] }));
    botonDe(m.raiz, "Quitar").click();
    // Los cuatro motivos, en el orden que la sala acepta.
    const motivos = [...m.raiz.querySelectorAll<HTMLButtonElement>(".scp-motivos button")].map((b) => b.dataset.motivo).filter(Boolean);
    expect(motivos).toEqual(["repetida", "evento", "pidio", "otro"]);
    botonDe(m.raiz, "Cuenta repetida").click();
    expect(m.quitadas).toEqual([[1, "repetida"]]);
    // La pregunta se cierra sola después del motivo.
    expect(m.raiz.querySelector(".scp-motivos")).toBeNull();
  });

  it("sin tocar un motivo, Cancelar lo deja como estaba", () => {
    const m = montar(datosDe());
    botonDe(m.raiz, "Quitar").click();
    expect(m.raiz.querySelector(".scp-motivos")).not.toBeNull();
    botonDe(m.raiz, "Cancelar").click();
    expect(m.raiz.querySelector(".scp-motivos")).toBeNull();
    expect(m.quitadas).toEqual([]);
  });

  it("Cerrar pide confirmar: sí cierra, no vuelve y no avisa nada", () => {
    const m = montar(datosDe());
    botonDe(m.raiz, "Cerrar la inscripción").click();
    expect(texto(m.raiz, ".scp-cerrar-titulo")).toBe("¿Cerrar la inscripción?");
    expect(texto(m.raiz, ".scp-cerrar-linea")).toBe("Ya nadie se puede anotar. El QR deja de valer en la próxima ventana.");
    expect(m.cierres()).toBe(0);
    botonDe(m.raiz, "No, seguir").click();
    expect(m.cierres()).toBe(0);
    expect(m.raiz.querySelector(".scp-confirmar")).toBeNull();
    botonDe(m.raiz, "Cerrar la inscripción").click();
    botonDe(m.raiz, "Sí, cerrar").click();
    expect(m.cierres()).toBe(1);
    expect(m.raiz.querySelector(".scp-confirmar")).toBeNull();
  });

  it("cerrada la inscripción, el QR sale y el texto dice que ya cerró", () => {
    const { raiz } = montar(datosDe({ cerrado: true, enlace: null, aviso: null }));
    expect(raiz.querySelector(".scp-qr-img")).toBeNull();
    expect(texto(raiz, ".scp-aviso")).toBe("La inscripción está cerrada.");
    expect(raiz.querySelector(".scp-ayuda-qr")).toBeNull();
  });
});

describe("mientras se comprueba y cuando algo falla al abrir", () => {
  it("mientras se mira la red, dice lo que hace y nada más se ve", () => {
    const m = montar(null);
    m.pintar({ vista: "chequeando" });
    expect(texto(m.raiz, ".scp-fallo")).toBe("Mirando en la red…");
    expect((m.raiz.querySelector(".scp-izq") as HTMLElement).hidden).toBe(true);
    expect((m.raiz.querySelector(".scp-der") as HTMLElement).hidden).toBe(true);
    m.pintar({ vista: "fallo", texto: "El premio no está depositado. Faltan 57 dólares digitales." });
    expect(texto(m.raiz, ".scp-fallo")).toBe("El premio no está depositado. Faltan 57 dólares digitales.");
  });
});

describe("los textos en inglés", () => {
  it("la pantalla traduce sus etiquetas con el idioma del navegador", () => {
    const m = montar(datosDe({ filas: [fila(1, "Ana")], revisar: [fila(2, "Grosera", true)] }));
    idioma = "en";
    m.pintar(abierta(datosDe({ filas: [fila(1, "Ana")], revisar: [fila(2, "Grosera", true)] })));
    expect(m.raiz.querySelector(".scp-revisar-t")?.textContent).toBe("To review");
    expect([...m.raiz.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent)).toContain("Close the entry");
  });
});
