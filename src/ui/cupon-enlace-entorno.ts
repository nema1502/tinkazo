import { altaActiva } from "../stellar/alta-config";
import { copiarTexto } from "./copiar-texto";
import { type EntornoDelCupon, iniciarCuponDelEnlace } from "./cupon-enlace";
import { currentSession, enNavegadorDeApp, entraConGoogle, entrar, estadoDeLaCuenta } from "./wallet-ui";

/**
 * El entorno de verdad del cupón del enlace (`cupon-enlace.ts`): la dirección de la página, el almacén de la pestaña y
 * la cuenta de `wallet-ui.ts`. Se llama una vez, con la cuenta ya armada (`initWalletUI`).
 */

function almacenDeLaPestana(): EntornoDelCupon["almacen"] {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function entornoDelCupon(): EntornoDelCupon {
  return {
    activo: altaActiva(),
    enApp: enNavegadorDeApp(),
    almacen: almacenDeLaPestana(),
    direccion: () => ({ origen: location.origin, ruta: location.pathname, busqueda: location.search, fragmento: location.hash }),
    reemplazar: (url) => history.replaceState(null, "", url),
    sesion: () => {
      const s = currentSession();
      // Google o correo: la cuenta que firma y manda sola. Freighter (a mano) y la cuenta de prueba son billeteras propias.
      return s ? { pollar: s.kind === "external" && !s.aMano } : null;
    },
    ocupada: () => {
      const e = estadoDeLaCuenta().estado;
      return e === "retomando" || e === "conectando";
    },
    entrar: () => void entrar(),
    claveDeEntrar: () => (entraConGoogle() ? "ctaGoogle" : "ctaHero"),
    copiar: copiarTexto,
    insertar: (el) => {
      const cabecera = document.querySelector("header");
      if (cabecera) cabecera.after(el);
      else document.body.prepend(el);
    },
  };
}

/** Arranca el cupón del enlace en la página. Sin el acceso por cupón a la vista no hace nada. */
export function iniciarCupon(): void {
  iniciarCuponDelEnlace(entornoDelCupon());
}
