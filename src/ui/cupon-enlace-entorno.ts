import { altaActiva } from "../stellar/alta-config";
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

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sin portapapeles (algunos navegadores de una app): se copia seleccionando un campo que no se ve.
    try {
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(campo);
      campo.select();
      const ok = document.execCommand("copy");
      campo.remove();
      return ok;
    } catch {
      return false;
    }
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
    copiar,
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
