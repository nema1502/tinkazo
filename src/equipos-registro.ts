import "./pagina";
import { cargaOpcional } from "./version-nueva";
import "./equipos/equipos.css";
import { equiposActivo } from "./equipos/bandera";
import { cifrarEquipo } from "./equipos/datos";
import { direccionDelSorteo, leerEnlaceDeRegistro } from "./equipos/enlace";
import { montarRegistro } from "./equipos/registro";
import { onLangChange, texto } from "./idioma";
import { enNavegadorDeApp } from "./navegador";
import { anotarEquipoEnSala, leerEstadoDeEquipo, leerPublico } from "./sala/equipos";
import { hayModoOficial, network } from "./stellar/config";
import { hasPollarKey } from "./stellar/pollar-config";
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

const hayPollar = hasPollarKey(network.name);
// El navegador de una app (Instagram, Facebook…) no deja entrar con Google, aunque el sitio lo ofrezca: el aviso
// manda a abrir el enlace en el navegador del teléfono. Sin Pollar en el sitio (compilación local) no hay aviso.
const deApp = enNavegadorDeApp(navigator.userAgent);
const enApp = hayPollar && deApp;
const hayGoogle = hayPollar && !deApp;

// El SDK de Pollar baja con la página quieta: abrir la ventana de Google tiene que salir del toque, sin esperas.
// Con el registro de equipos apagado (VITE_EQUIPOS) la página no deja entrar a nadie: no hay para qué bajarlo.
// Si no baja, se vuelve a pedir al tocar el botón, y el fallo no despierta el aviso de versión nueva.
if (hayGoogle && equiposActivo()) void cargaOpcional(import("./stellar/wallet-pollar").then((m) => m.precargarSdk()));

const raiz = document.querySelector<HTMLElement>(".eqp");
if (raiz) {
  const registro = montarRegistro(raiz, {
    tx: texto,
    sala: leerEnlaceDeRegistro(location.search, location.hash, location.hostname),
    activo: equiposActivo(),
    red: network.name,
    hayGoogle,
    enApp,
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
    // La herramienta se abre en esta pestaña, con la sesión de la cuenta y el borrador que se acaba de dejar, en el modo del registro.
    irAlSorteo: () => location.assign(direccionDelSorteo(network.name, hayModoOficial)),
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
