/**
 * Cuándo entra la página de prueba de la llave al armado, y cuándo no. Sin imports: lo lee `vite.config.ts`.
 *
 * La regla falla cerrada. La página (`prueba/llave/index.html`) solo se arma con `VITE_PRUEBA_LLAVE=1` en una vista previa
 * de Vercel o en la revisión automática de GitHub. En producción no se arma nunca, y si alguien prende la variable ahí, la
 * construcción falla antes de armar nada. Ningún mensaje escribe el valor de una variable.
 */

export type EntornoDelBuild = Record<string, string | undefined>;

/** ¿Se pidió la prueba? Solo el valor 1 cuenta: cualquier otra cosa es que no. */
function pedida(env: EntornoDelBuild): boolean {
  return env["VITE_PRUEBA_LLAVE"] === "1";
}

/**
 * ¿Entra la página de prueba en este armado?
 * - Con la variable en 1 y `VERCEL_ENV=preview`: sí.
 * - Con la variable en 1, sin `VERCEL_ENV` y con `GITHUB_ACTIONS=true`: sí (la revisión automática).
 * - Con `production`, `development` o cualquier otro valor de `VERCEL_ENV`: no.
 * - Sin la variable: no, siempre.
 */
export function incluirPruebaDeLlave(env: EntornoDelBuild): boolean {
  if (!pedida(env)) return false;
  const vercel = env["VERCEL_ENV"];
  if (vercel === "preview") return true;
  if (vercel === undefined || vercel === "") return env["GITHUB_ACTIONS"] === "true";
  return false;
}

/** Lo que frena la construcción: la prueba pedida en una publicación de producción. */
export function problemasDePruebaDeLlave(env: EntornoDelBuild): string[] {
  if (pedida(env) && env["VERCEL_ENV"] === "production") {
    return ["VITE_PRUEBA_LLAVE=1 no se arma en una publicación de producción: la página de prueba de la llave vive solo en las vistas previas y en la revisión automática."];
  }
  return [];
}

/**
 * Las marcas de lo que trae la prueba, sobre rutas con barras normales (`id.replace(/\\/g, "/")`). Son la forma real del
 * almacén de pnpm: Vite resuelve los enlaces a su ruta real, y el SDK 16 del kit vive en `.pnpm/@stellar+stellar-sdk@16.x`,
 * no dentro de la carpeta del kit. Un sufijo de pares (`smart-account-kit-bindings@0.5.0_@stellar+...`) también coincide.
 * El SDK 17 del sitio no coincide.
 */
export const MARCAS_DE_LA_PRUEBA: readonly RegExp[] = [
  /\/\.pnpm\/smart-account-kit@/,
  /\/\.pnpm\/smart-account-kit-bindings@/,
  /\/\.pnpm\/@simplewebauthn\+browser@/,
  /\/\.pnpm\/@stellar\+stellar-sdk@16\./,
  /\/\.pnpm\/base64url@/,
  /\/node_modules\/smart-account-kit(-bindings)?\//,
  /\/node_modules\/@simplewebauthn\//,
  /\/src\/prueba-llave\//,
];

/** La ruta con barras normales, que es sobre la que corren las marcas. */
export function rutaNormal(id: string): string {
  return id.replace(/\\/g, "/");
}

/** ¿Este módulo es de la prueba? */
export function esModuloDeLaPrueba(id: string): boolean {
  const ruta = rutaNormal(id);
  return MARCAS_DE_LA_PRUEBA.some((m) => m.test(ruta));
}

/** Los módulos de la prueba entre los que se pasan. */
export function modulosDeLaPrueba(ids: string[]): string[] {
  return ids.filter(esModuloDeLaPrueba);
}

/**
 * Los anfitriones donde la página carga el kit: la computadora de quien prueba y el alias de rama de una vista previa.
 * No lo son tinkazo.app ni sus subdominios, tinkazo.vercel.app, el alias de la rama principal ni las direcciones únicas de
 * cada despliegue (que también tienen los de producción). Con un anfitrión fuera de la lista la página no baja el kit.
 */
export function ANFITRIONES_PERMITIDOS(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  return /^tinkazo-git-(?!main-)[a-z0-9-]+\.vercel\.app$/.test(h);
}
