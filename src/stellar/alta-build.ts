import { NOMBRES_DE_LA_VENTA, banderasDeVenta, ventaAbiertaATodos } from "./venta-piloto";

/**
 * Lo que el build comprueba de las banderas del cobro por uso (`alta-config.ts`) antes de armar el sitio. Importa solo
 * la puerta del piloto (`venta-piloto.ts`), que no importa nada: lo lee `vite.config.ts`, que no puede traer la
 * configuración del navegador.
 *
 * Devuelve lo que está mal, en español y sin valores de variables (una dirección o una llave no se escribe en la
 * bitácora de un build). Vacío: el entorno está bien.
 *
 * Además de las banderas, mira dónde se publica: `VERCEL_ENV` (lo pone Vercel) dice `production` solo en la
 * publicación de producción. Las páginas de lectura dicen que con un cupón de evento el modo Oficial es gratis
 * (`i18n-modo-oficial.ts`), y sin `VITE_ALTA=1` el sitio no tiene dónde canjearlo: esa publicación no sale. La CI, las
 * vistas previas y los builds locales no se frenan por esto.
 */

/**
 * Las banderas del cobro por uso (con las tres de la venta, que se leen en `venta-piloto.ts`, y la que saca su piloto,
 * `VITE_VENTA_ABIERTA`), y la del plan B del ingreso (`src/ui/ingreso-plan-b.ts`, que no tiene que ver con el cobro pero
 * se escribe igual y se equivoca igual): cada una vale 1 (prendida), 0 o vacía (apagada).
 */
const BANDERAS = ["VITE_ALTA", "VITE_ALTA_LIBRE", "VITE_SORTEO_SERVIDOR", ...NOMBRES_DE_LA_VENTA, "VITE_VENTA_ABIERTA", "VITE_INGRESO_PLAN_B"] as const;

/**
 * Dónde atiende el portero de la red principal. Con `VITE_ALTA=1` el sitio le manda ahí el token de la sesión de Pollar
 * de quien canjea un cupón: el build no sale si la variable apunta a otro lado. Si el portero se muda, se cambia acá.
 */
export const HOSTS_DEL_PORTERO_OFICIAL: readonly string[] = ["pm.tinkazo.app"];
/** El portero de Prueba: nunca recibe un token de la red principal. */
const HOST_DEL_PORTERO_DE_PRUEBA = "p.tinkazo.app";

/**
 * La dirección tiene forma de portero de la red principal: https, sin ruta, consulta, fragmento ni credenciales, y no
 * es la de Prueba. Devuelve la dirección leída, o `null`. Es lo que mira también `alta-api.ts` antes de mandar el token.
 */
export function formaDePortero(crudo: string | null | undefined): URL | null {
  const limpio = String(crudo ?? "").trim().replace(/\/+$/, "");
  if (!limpio) return null;
  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.hostname === HOST_DEL_PORTERO_DE_PRUEBA) return null;
  return url;
}

/** La dirección es la del portero de la red principal: con forma de portero y en uno de sus hosts, sin puerto. */
export function esUrlDePorteroOficial(crudo: string | null | undefined): boolean {
  const url = formaDePortero(crudo);
  return !!url && !url.port && HOSTS_DEL_PORTERO_OFICIAL.includes(url.hostname);
}

export function problemasDeAlta(env: Record<string, string | undefined>): string[] {
  const uno = (k: string): boolean => env[k] === "1";
  const problemas: string[] = [];
  // Un valor que no es 1, 0 ni vacío («true», «on», « 1») dejaba la bandera apagada sin que nadie se enterara.
  for (const k of BANDERAS) {
    const v = env[k];
    if (v === undefined || v.trim() === "" || v === "0" || v === "1") continue;
    problemas.push(`${k} solo acepta 1 o 0 (vacía es apagada): con otro valor la bandera queda apagada sin aviso.`);
  }
  const url = (env.VITE_PATROCINIO_URL_MAINNET ?? "").trim().replace(/\/+$/, "");
  if (uno("VITE_ALTA") && url === "") {
    problemas.push("VITE_ALTA=1 necesita VITE_PATROCINIO_URL_MAINNET: sin el portero de la red principal, el acceso por cupón no tiene a quién preguntar.");
  } else if (uno("VITE_ALTA") && !esUrlDePorteroOficial(url)) {
    problemas.push(
      `VITE_ALTA=1 manda el token de la sesión a VITE_PATROCINIO_URL_MAINNET, y esa dirección no es la del portero de la red principal: tiene que ser https, sin ruta ni consulta, en ${HOSTS_DEL_PORTERO_OFICIAL.join(" o ")} (si el portero se mudó, se cambia en src/stellar/alta-build.ts).`,
    );
  }
  // El plan B1 (activar sin acceso confirmado) va solo: con el acceso por cupón, juntas activarían a cualquiera sin acceso.
  if (uno("VITE_ALTA") && uno("VITE_ALTA_LIBRE")) {
    problemas.push("VITE_ALTA_LIBRE=1 no va junto con VITE_ALTA=1: juntas dejan activar una cuenta sin el acceso confirmado. El plan B1 es VITE_ALTA_LIBRE sola.");
  }
  // Las de la venta, tal como vienen en el build (el piloto es del navegador, no del build).
  const venta = banderasDeVenta(env);
  const sinAcceso = (k: string): string => `${k}=1 necesita VITE_ALTA=1: la compra de sorteos y el sorteo por el servidor dependen del acceso.`;
  if (venta.pago && !uno("VITE_ALTA")) problemas.push(sinAcceso(NOMBRES_DE_LA_VENTA[0]));
  if (uno("VITE_SORTEO_SERVIDOR") && !uno("VITE_ALTA")) problemas.push(sinAcceso("VITE_SORTEO_SERVIDOR"));
  // El plan B1 (VITE_ALTA_LIBRE sola) es la salida de emergencia y se puede publicar sin el acceso por cupón.
  if (env.VERCEL_ENV === "production" && !uno("VITE_ALTA") && !uno("VITE_ALTA_LIBRE")) {
    problemas.push(
      "La publicación de producción necesita VITE_ALTA=1: las páginas dicen que con un cupón de evento el modo Oficial es gratis, y sin esa bandera el sitio no tiene dónde canjearlo. Para volver atrás se revierte primero el cambio que puso esos textos y después se vacía la variable: vaciarla antes deja la publicación sin salir.",
    );
  }
  // Pagar con el saldo es un medio de la compra: sin la compra prendida no hay orden que pagar.
  if (venta.saldo && !venta.pago) problemas.push("VITE_PAGO_CON_SALDO=1 necesita VITE_ALTA_PAGO=1: pagar con el saldo de la cuenta es un medio de la compra de sorteos.");
  // La compra con QR carga dólares en la cuenta y paga el paquete con ese saldo: sin el pago con el saldo, lo cargado no
  // tendría cómo pagar la compra.
  if (venta.qr && !venta.saldo) {
    problemas.push("VITE_COMPRA_QR=1 necesita VITE_PAGO_CON_SALDO=1: la compra con QR termina pagando el paquete con el saldo de la cuenta, y sin eso lo cargado no tendría cómo pagar la compra.");
  }
  // Sacar el piloto abre la venta para todos: sin la compra prendida no hay venta que abrir.
  if (ventaAbiertaATodos(env) && !venta.pago) {
    problemas.push("VITE_VENTA_ABIERTA=1 necesita VITE_ALTA_PAGO=1: saca el piloto de la venta de sorteos, y sin la compra prendida no hay venta que abrir.");
  }
  return problemas;
}
