import "./pagina";
import "./equipos/equipos.css";
import { equiposActivo } from "./equipos/bandera";
import { cifrarEquipo } from "./equipos/datos";
import { leerEnlaceDeRegistro } from "./equipos/enlace";
import { montarRegistro } from "./equipos/registro";
import { onLangChange, texto } from "./idioma";
import { enNavegadorDeApp } from "./navegador";
import { anotarEquipoEnSala, leerEstadoDeEquipo, leerPublico } from "./sala/equipos";
import { network } from "./stellar/config";
import { loadSessionKind } from "./stellar/session-store";
import { cuentaDeLaSesion } from "./equipos/sesion";

/**
 * La página de registro de un equipo (`equipos.html`): el QR de la pantalla del evento la abre, y el encargado del
 * equipo entra con su cuenta, escribe el nombre del equipo y sus integrantes y lo anota.
 *
 * El enlace trae la sala en la dirección (`?sala=`) y la clave que cifra los nombres después del `#`, que ningún
 * navegador manda a un servidor. Detrás de la bandera `VITE_EQUIPOS`: apagada, la página dice que el registro no
 * está abierto. Todo lo que se puede probar sin navegador vive en `equipos/registro.ts`.
 */

const hayPollar = !!import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY;
const hayGoogle = hayPollar && !enNavegadorDeApp(navigator.userAgent);

// El SDK de Pollar baja con la página quieta: abrir la ventana de Google tiene que salir del toque, sin esperas.
// Con el registro de equipos apagado (VITE_EQUIPOS) la página no deja entrar a nadie: no hay para qué bajarlo.
if (hayGoogle && equiposActivo()) void import("./stellar/wallet-pollar").then((m) => m.precargarSdk());

const raiz = document.querySelector<HTMLElement>(".eqp");
if (raiz) {
  const registro = montarRegistro(raiz, {
    tx: texto,
    sala: leerEnlaceDeRegistro(location.search, location.hash, location.hostname),
    activo: equiposActivo(),
    red: network.name,
    hayGoogle,
    // La sesión que ya está abierta en este celular (Google, Freighter o la cuenta de prueba): si hay una, no se pide
    // pegar la cuenta. Nada de esto abre una ventana ni pide permiso.
    cuentaRecordada: () =>
      cuentaDeLaSesion({
        tipo: loadSessionKind(network.name),
        hayPollar,
        google: async () => (await import("./stellar/wallet-pollar")).pollarWallet.restore(),
        freighter: async () => (await import("./stellar/wallet-lite")).freighterWallet.restore(),
        prueba: async () => (await import("./stellar/wallet")).guestWallet.restore(),
      }),
    entrarConGoogle: async () => {
      const { pollarWallet } = await import("./stellar/wallet-pollar");
      return pollarWallet.connect();
    },
    leerPublico,
    anotar: anotarEquipoEnSala,
    leerEstado: leerEstadoDeEquipo,
    cifrar: cifrarEquipo,
    local: localStorage,
    sesion: sessionStorage,
    // La herramienta se abre en esta pestaña, con la sesión de la cuenta y el borrador que se acaba de dejar.
    irAlSorteo: () => location.assign("/#sortear"),
    cada: (f, ms) => {
      const id = setInterval(f, ms);
      return () => clearInterval(id);
    },
    visible: () => document.visibilityState === "visible",
  });
  onLangChange(() => registro.pintar());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") registro.alVolver();
  });
}
