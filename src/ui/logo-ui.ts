import { $ } from "../dom";
import { onLangChange, texto as t } from "../idioma";
import { LogoError, convertirLogo, type Placa } from "../logo";
import { alCambiarLogo, guardarLogo, logoActual, quitarLogo } from "../logo-guardado";
import { crearPieza } from "./logo-pieza";

/**
 * "Poner logo": el botón y la vista previa, arriba de "Sellar la lista".
 *
 * Dos toques: "Poner logo" y la imagen. No hay "Confirmar": el logo se ve al
 * instante, sobre un fondo claro y otro oscuro, y se puede cambiar, quitar o
 * cambiarle la placa. El navegador lo achica y lo guarda acá (`logo.ts`,
 * `logo-guardado.ts`): no hay servidor ni cuenta. Queda dicho en la vista
 * previa: en otro equipo, hay que volver a subirlo.
 *
 * No es parte del sorteo: no cambia quién gana ni lo que se sella.
 */

/** La imagen que se subió, mientras la página siga abierta: para "Cambiar el fondo". */
let archivo: Blob | null = null;
/** La placa con la que quedó. */
let placa: Placa | null = null;
/** El último aviso, para volver a escribirlo si cambia el idioma. */
let aviso: { clave: string; error: boolean } | null = null;

const ERRORES: Record<string, string> = {
  "no-abre": "logoNoAbre",
  pesa: "logoPesa",
  grande: "logoGrande",
};

function decir(clave: string | null, error = true): void {
  aviso = clave ? { clave, error } : null;
  const caja = $("logo-error");
  caja.hidden = !clave;
  caja.textContent = clave ? t(clave) : "";
  caja.setAttribute("role", error ? "alert" : "status");
}

function muestra(clase: string, logo: Parameters<typeof crearPieza>[0]): HTMLElement {
  const m = document.createElement("div");
  m.className = `logo-muestra ${clase}`;
  m.append(crearPieza(logo));
  return m;
}

/** Pone en pantalla lo que hay: el botón solo, o la vista previa. */
function pintar(): void {
  const actual = logoActual();
  $("logo-poner").hidden = !!actual;
  $("logo-vista").hidden = !actual;
  const muestras = $("logo-muestras");
  muestras.replaceChildren();
  if (!actual) return;
  muestras.append(muestra("claro", actual.logo), muestra("oscuro", actual.logo));
  // "Cambiar el fondo" solo si todavía está la imagen de la que salió: recargada la página, se vuelve a subir.
  $("logo-fondo").hidden = !archivo;
}

/** Cuál fue la última subida elegida: si dos se cruzan, queda esa y no la que terminó última. */
let ultimaSubida = 0;

async function subir(f: Blob, forzada?: Placa): Promise<void> {
  const mia = ++ultimaSubida;
  decir(null);
  const poner = $("logo-poner");
  poner.setAttribute("aria-busy", "true");
  try {
    const r = await convertirLogo(f, forzada);
    if (mia !== ultimaSubida) return;
    archivo = f;
    placa = r.placa;
    const { guardado } = guardarLogo(r);
    pintar();
    // El botón de "Poner logo" se esconde: el foco pasa a "Cambiar" para que no se pierda.
    if (document.activeElement === document.body || document.activeElement === $("logo-input")) $("logo-cambiar").focus({ preventScroll: true });
    if (guardado) decir("logoListo", false);
    else decir("logoSinGuardar", false);
  } catch (e) {
    if (mia !== ultimaSubida) return;
    decir(e instanceof LogoError ? (ERRORES[e.motivo] ?? "logoNoAbre") : "logoNoAbre");
  } finally {
    poner.removeAttribute("aria-busy");
  }
}

/** Engancha el botón y la vista previa. Una vez, al arrancar. */
export function iniciarLogo(): void {
  const entrada = document.getElementById("logo-input") as HTMLInputElement | null;
  if (!entrada) return;
  entrada.addEventListener("change", () => {
    const f = entrada.files?.[0];
    entrada.value = "";
    if (f) void subir(f);
  });
  // "Cambiar" abre el mismo selector de archivos que "Poner logo".
  $("logo-cambiar").addEventListener("click", () => entrada.click());
  $("logo-quitar").addEventListener("click", () => {
    quitarLogo();
    archivo = null;
    placa = null;
    decir("logoQuitado", false);
    pintar();
    $("logo-input").focus({ preventScroll: true });
  });
  $("logo-fondo").addEventListener("click", () => {
    if (archivo) void subir(archivo, placa === "oscura" ? "clara" : "oscura");
  });
  alCambiarLogo(pintar);
  onLangChange(() => {
    if (aviso) decir(aviso.clave, aviso.error);
  });
  pintar();
}
