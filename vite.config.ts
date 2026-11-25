/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, loadEnv, runnerImport, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import { problemasDeAlta } from "./src/stellar/alta-build";
import { avisosDelRetiro, problemasDeLaComision, problemasDePagarConGoogle, problemasDePremios, problemasDelRetiro, problemasDelVoto } from "./src/stellar/premios-build";
import { comisionDelBuild, costoDelRetiroDelToml, cuentasDelPorteroEnElToml, retirosDelToml } from "./src/stellar/comision-config";
import { cuentaDeCobrosDelPortero } from "./src/stellar/retiro-config";
import { problemasDeLasPaginasConCobro, problemasDeLasPaginasEnOficial, problemasDelRegaloSinDar } from "./src/alta-textos-con-cobro";
import { problemasDeLaPortadaConRetiro } from "./src/costo-del-retiro-portada";
import { esModuloDeLaPrueba, incluirPruebaDeLlave, problemasDePruebaDeLlave, rutaNormal } from "./src/prueba-llave/en-el-build";

type Dict = Record<string, unknown>;

/**
 * Los textos de cada página, adentro de su HTML.
 *
 * El diccionario de `src/i18n.ts` tiene ~870 claves, casi todas de la
 * herramienta y de los relatores de los juegos, y era el 94 % del código común
 * que bajaba cada página: precios o verificar cargaban 140 KB para pintar unos
 * cuantos títulos. Al construir (y en `pnpm dev`), cada página que no es la
 * herramienta recibe en un `<script type="application/json" id="textos">` solo
 * las cadenas que usa, en español y en inglés, y `src/idioma.ts` las pinta.
 *
 * Qué usa una página sale de dos lugares: los atributos `data-i*` de su HTML (y
 * `data-titulo-clave` y `data-desc-clave`, el título y la descripción), y
 * las cadenas entre comillas de su código (la entrada y lo que importa sin
 * `import()`) que son claves del diccionario. Sobra alguna, no falta ninguna:
 * así entran también las que el código pone a mano, como `t("vCheckList")`.
 *
 * La herramienta (`index.html`) importa `i18n.ts` y sigue con el diccionario
 * entero, porque los juegos lo usan con `T[getLang()]` y `t()`.
 */
function textosPorPagina(): Plugin {
  const raiz = __dirname;
  const i18n = resolve(raiz, "src/i18n.ts");
  let cache: { cuando: number; T: Record<"es" | "en", Dict> } | null = null;

  const diccionario = async (): Promise<Record<"es" | "en", Dict>> => {
    const cuando = Math.max(statSync(i18n).mtimeMs, statSync(resolve(raiz, "src/idioma.ts")).mtimeMs);
    if (cache?.cuando !== cuando) {
      const { module } = await runnerImport<{ T: Record<"es" | "en", Dict> }>(i18n, { configFile: false, logLevel: "silent" });
      cache = { cuando, T: module.T };
    }
    return cache.T;
  };

  /** Resuelve un import relativo a un archivo del proyecto, o null si no es código nuestro. */
  const resolver = (desde: string, spec: string): string | null => {
    const base = resolve(dirname(desde), spec);
    for (const f of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (existsSync(f) && statSync(f).isFile()) return f;
    }
    return null;
  };

  /** La entrada y todo lo que importa de forma estática (no `import()`, no `import type`). */
  const alcanzables = (entrada: string): string[] => {
    const vistos = new Set<string>();
    const pendientes = [entrada];
    while (pendientes.length) {
      const f = pendientes.pop() as string;
      if (vistos.has(f) || f === i18n || !f.endsWith(".ts")) continue;
      vistos.add(f);
      const codigo = readFileSync(f, "utf8");
      for (const m of codigo.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gm)) {
        const r = resolver(f, m[1] as string);
        if (r) pendientes.push(r);
      }
    }
    return [...vistos];
  };

  return {
    name: "tinkazo:textos-por-pagina",
    transformIndexHtml: {
      order: "post",
      async handler(_html, ctx) {
        // El HTML de origen: en `post` el que llega ya tiene los scripts reescritos.
        const fuente = readFileSync(ctx.filename, "utf8");
        const entradas = [...fuente.matchAll(/<script[^>]*\bsrc="\/(src\/[^"]+\.ts)"/g)].map((m) => resolve(raiz, m[1] as string));
        if (entradas.length === 0) return;
        // La herramienta importa el diccionario entero: no necesita el suyo.
        const usaElEntero = entradas.some((e) => /^\s*import\s+(?!type\b)[^;]*?from\s*["']\.\/i18n["']/m.test(readFileSync(e, "utf8")));
        if (usaElEntero) return;

        const T = await diccionario();
        const claves = new Set<string>();
        const delHtml = [...fuente.matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria|i-alt|i-con-comision|label-i|titulo-clave|desc-clave)="([^"]+)"/g)].map((m) => m[1] as string);
        for (const k of delHtml) {
          if (typeof T.es[k] !== "string" || typeof T.en[k] !== "string") {
            this.warn(`${ctx.path}: la clave "${k}" no es una cadena en los dos idiomas de src/i18n.ts`);
            continue;
          }
          claves.add(k);
        }
        for (const archivo of entradas.flatMap(alcanzables)) {
          for (const m of readFileSync(archivo, "utf8").matchAll(/(["'`])([A-Za-z][A-Za-z0-9]*)\1/g)) {
            const k = m[2] as string;
            if (typeof T.es[k] === "string" && typeof T.en[k] === "string") claves.add(k);
          }
        }
        const elegir = (l: "es" | "en"): Dict => Object.fromEntries([...claves].sort().map((k) => [k, T[l][k]]));
        // `<` escapado: el JSON va adentro de un <script> y nada puede cerrarlo.
        const json = JSON.stringify({ es: elegir("es"), en: elegir("en") }).replace(/</g, "\\u003c");
        return [{ tag: "script", attrs: { type: "application/json", id: "textos" }, children: json, injectTo: "body" }];
      },
    },
  };
}

/**
 * El build no sale con las banderas del cobro por uso a medio poner (`src/stellar/alta-build.ts`): `VITE_ALTA=1` sin
 * la dirección del portero de la red principal dejaría el acceso sin a quién preguntar. Y la publicación de producción
 * (`VERCEL_ENV=production`) no sale sin `VITE_ALTA=1`, porque las páginas dicen que con un cupón el modo Oficial es
 * gratis. Falla antes de armar nada y sin escribir los valores de las variables. Solo al construir: `pnpm dev` y las
 * pruebas no se frenan.
 */
function validarBanderasDeAlta(): Plugin {
  return {
    name: "tinkazo:banderas-de-alta",
    apply: "build",
    config(_config, { mode }) {
      const problemas = problemasDeAlta(loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"]));
      if (problemas.length) throw new Error(`Las banderas del cobro por uso están a medio poner:\n- ${problemas.join("\n- ")}`);
    },
  };
}

/**
 * El build no sale con el modo premios (`VITE_RAMPA=premios`) junto con el pago con el saldo o la compra con QR
 * (`src/stellar/premios-build.ts`): esos dos firman con la cuenta que guarda el premio o le traen dinero, y el modo
 * promete que solo ve su saldo y recibe. No toca ninguna bandera: obliga a elegir cuál va. Falla antes de armar nada y
 * sin escribir los valores de las variables. Solo al construir: `pnpm dev` y las pruebas no se frenan.
 *
 * Con la misma lectura del entorno frena también el voto por contenido (`VITE_VOTO_POR_CONTENIDO`, issue 180): un valor
 * que no es 1 ni 0, o el 1 junto con el pago con el saldo, la compra con QR o la carga con bolivianos. Y pagar con Google
 * (`VITE_PAGAR_CON_GOOGLE`): un valor que no es 1 ni 0, o el 1 sin el voto por contenido, sin el modo premios, sin los premios
 * pagados, sin el portero de la red principal o junto con la venta que paga con el saldo o con QR.
 */
function validarModoPremios(): Plugin {
  return {
    name: "tinkazo:modo-premios",
    apply: "build",
    config(_config, { mode }) {
      const env = loadEnv(mode, __dirname, ["VITE_"]);
      const problemas = [...problemasDePremios(env), ...problemasDelVoto(env), ...problemasDePagarConGoogle(env)];
      const dicen = "Hay banderas del modo premios, del voto por contenido o de pagar con Google que no van juntas";
      if (problemas.length) throw new Error(`${dicen}:\n- ${problemas.join("\n- ")}`);
    },
  };
}

/**
 * Los diccionarios cuyos textos se leen en las páginas aunque el sitio abra en Prueba: el base, el del modo Oficial y la
 * respuesta de la portada con el costo del retiro, que se pone encima de los dos.
 */
const DICCIONARIOS_DEL_REGALO = ["src/i18n.ts", "src/i18n-modo-oficial.ts", "src/costo-del-retiro-portada.ts"];

/**
 * La publicación de producción con la compra de sorteos prendida no sale mientras las páginas digan lo de antes: que es
 * gratis para todos, que los precios se publican pronto o que no se venden paquetes, o con lo de la compra todavía en un
 * `<template data-con-cobro>` (`src/alta-textos-con-cobro.ts`). El HTML se cambia en el mismo commit que la prende. Las
 * vistas previas, la CI y los builds locales no se frenan: ahí se prueba la compra.
 *
 * Con la misma lectura frena la publicación de producción que abre en Oficial (`VITE_STELLAR_NETWORK`) mientras las
 * páginas que ve primero quien llega digan que Oficial pide el cupón de tu evento (`problemasDeLasPaginasEnOficial`).
 *
 * Y frena toda publicación de producción cuyas páginas o diccionarios prometan los primeros 3 sorteos oficiales gratis
 * sin `VITE_REGALO=1` (`problemasDelRegaloSinDar`): esas frases se leen aunque el sitio abra en Prueba, y no pueden salir
 * antes de que el portero dé el regalo.
 */
function validarPaginasConCobro(): Plugin {
  return {
    name: "tinkazo:paginas-con-cobro",
    apply: "build",
    config(_config, { mode }) {
      const paginas = Object.fromEntries(
        readdirSync(__dirname)
          .filter((f) => f.endsWith(".html"))
          .map((f) => [f, readFileSync(resolve(__dirname, f), "utf8")]),
      );
      const problemas = problemasDeLasPaginasConCobro(loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"]), paginas);
      if (problemas.length) throw new Error(`Las páginas todavía dicen lo de antes de la compra de sorteos:\n- ${problemas.join("\n- ")}`);
      const oficial = problemasDeLasPaginasEnOficial(loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"]), paginas);
      if (oficial.length) throw new Error(`Las páginas todavía dicen lo de antes de abrir en Oficial:\n- ${oficial.join("\n- ")}`);
      const diccionarios = Object.fromEntries(
        DICCIONARIOS_DEL_REGALO.map((f) => [f, readFileSync(resolve(__dirname, f), "utf8")]),
      );
      const regalo = problemasDelRegaloSinDar(loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"]), { ...paginas, ...diccionarios });
      if (regalo.length) throw new Error(`Las páginas prometen el regalo antes de que se dé:\n- ${regalo.join("\n- ")}`);
    },
  };
}

/**
 * La `CUENTA_COBROS` de la red principal del portero, leída de `workers/patrocinio/wrangler.toml`, o `null` si el
 * archivo no está o no la trae. Es contra la que el control del costo del retiro compara `VITE_RETIRO_CUENTA`.
 */
function cuentaDeCobrosDelWrangler(): string | null {
  try {
    return cuentaDeCobrosDelPortero(readFileSync(resolve(__dirname, "workers/patrocinio/wrangler.toml"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * El build no sale con el costo del retiro a medio poner (`VITE_RETIRO_COSTO` y `VITE_RETIRO_CUENTA`): una de las dos
 * mal escrita, la cuenta sin el costo, o un costo que se cobra sin las demás piezas que lo sostienen
 * (`src/stellar/premios-build.ts`). La publicación de producción con el costo prendido tampoco sale mientras la portada
 * diga que Tinkazo no cobra nada (`src/costo-del-retiro-portada.ts`). Con el costo puesto y sin la cuenta el build sale,
 * no cobra nada, y lo deja dicho en la bitácora. Falla antes de armar nada y sin escribir los valores de las variables.
 * Solo al construir: `pnpm dev` y las pruebas no se frenan.
 */
function validarCostoDelRetiro(): Plugin {
  let avisos: string[] = [];
  return {
    name: "tinkazo:costo-del-retiro",
    apply: "build",
    config(_config, { mode }) {
      const env = loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"]);
      const portada = { "index.html": readFileSync(resolve(__dirname, "index.html"), "utf8") };
      const problemas = [
        ...problemasDelRetiro(env, { cuentaDeCobros: cuentaDeCobrosDelWrangler() }),
        ...problemasDeLaPortadaConRetiro(env, portada),
      ];
      if (problemas.length) throw new Error(`El costo del retiro está a medio poner:\n- ${problemas.join("\n- ")}`);
      avisos = avisosDelRetiro(env);
    },
    buildStart() {
      for (const aviso of avisos) this.warn(aviso);
    },
  };
}

/** El texto de `workers/patrocinio/wrangler.toml` (solo se lee), o `null` si el archivo no está. */
function wranglerDelPortero(): string | null {
  try {
    return readFileSync(resolve(__dirname, "workers/patrocinio/wrangler.toml"), "utf8");
  } catch {
    return null;
  }
}

/**
 * El build no sale con lo que Tinkazo cobra a una campaña a medio poner (`VITE_COMISION_PB`, `VITE_COMISION_MINIMO` y
 * `VITE_COMISION_CUENTA`): las tres van juntas, bien escritas, con el costo del retiro cobrándose y pagar con Google
 * prendido, con la cuenta común (no la de cobros ni otra del portero) y con el mismo costo y los retiros prendidos del lado
 * del portero (`src/stellar/premios-build.ts`). Ningún mensaje escribe el valor de una variable. Con la comisión prendida
 * el build deja además `comision.json` en la carpeta publicada, con los datos públicos que usa el guion de quien activa
 * campañas para comprobar que lo que calcula es lo mismo que muestra el sitio.
 */
function validarComision(): Plugin {
  let publicar: Record<string, string> | null = null;
  return {
    name: "tinkazo:comision",
    apply: "build",
    config(_config, { mode }) {
      const env = loadEnv(mode, __dirname, ["VITE_"]);
      const toml = wranglerDelPortero();
      const problemas = problemasDeLaComision(env, {
        cuentasDelPortero: toml === null ? null : cuentasDelPorteroEnElToml(toml),
        costoDelPortero: toml === null ? null : costoDelRetiroDelToml(toml),
        retirosDelPortero: toml === null ? null : retirosDelToml(toml),
      });
      if (problemas.length) throw new Error(`La comisión de las campañas está a medio poner:\n- ${problemas.join("\n- ")}`);
      const c = comisionDelBuild(env);
      publicar = c ? { pb: String(c.pb), minimo: String(c.minimo), cuenta: c.cuenta, costo: String(c.costo) } : null;
    },
    generateBundle() {
      if (publicar) this.emitFile({ type: "asset", fileName: "comision.json", source: `${JSON.stringify(publicar)}\n` });
    },
  };
}

/** El módulo que reemplaza al par opcional del kit (`@creit-tech/stellar-wallets-kit`), que la prueba nunca usa. */
const SIN_WALLETS_KIT = "\0tinkazo-sin-wallets-kit";

/**
 * La página de prueba de la llave (`prueba/llave/index.html`, issue 301) y todo lo que trae (el kit de cuentas de contrato,
 * su SDK y su librería de passkeys) entran al armado solo con `VITE_PRUEBA_LLAVE=1` en una vista previa de Vercel o en la
 * revisión automática de GitHub (`src/prueba-llave/en-el-build.ts`). Con la variable en una publicación de producción, la
 * construcción falla. Sin la variable, y en cualquier armado que no la pida, `generateBundle` falla si algún trozo trae un
 * módulo de la prueba. Con la prueba incluida, ninguna otra entrada puede alcanzar un módulo de la prueba, ni por imports
 * estáticos ni por `import()`.
 *
 * El kit trae un `import()` de un par opcional que la prueba no instala: acá se resuelve a un módulo que falla al usarse,
 * solo para los imports que hace el kit. No se toca nada global.
 */
function pruebaDeLlave(): Plugin {
  let incluida = false;
  const esDeLaPagina = (id: string | null | undefined): boolean => !!id && rutaNormal(id).endsWith("/prueba/llave/index.html");
  return {
    name: "tinkazo:prueba-de-llave",
    apply: "build",
    enforce: "pre",
    config(_config, { mode }) {
      const env = loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV", "GITHUB_ACTIONS"]);
      const problemas = problemasDePruebaDeLlave(env);
      if (problemas.length) throw new Error(`La prueba de la llave está mal puesta:\n- ${problemas.join("\n- ")}`);
      incluida = incluirPruebaDeLlave(env);
      if (!incluida) return;
      return { build: { rollupOptions: { input: { "prueba-llave": resolve(__dirname, "prueba/llave/index.html") } } } };
    },
    resolveId: {
      order: "pre",
      handler(source, importer) {
        if (!incluida || !source.startsWith("@creit-tech/stellar-wallets-kit")) return null;
        if (!importer || !/\/smart-account-kit@|\/node_modules\/smart-account-kit\//.test(rutaNormal(importer))) return null;
        return SIN_WALLETS_KIT;
      },
    },
    load(id) {
      if (id !== SIN_WALLETS_KIT) return null;
      return [
        'const falla = () => { throw new Error("stellar-wallets-kit no se usa en la prueba de la llave"); };',
        "export const StellarWalletsKit = { init: falla };",
        "export const sep43Modules = falla;",
      ].join("\n");
    },
    generateBundle(_salida, bundle) {
      const trozos = Object.values(bundle).filter((t) => t.type === "chunk");
      const conMarcas = (t: (typeof trozos)[number]): string[] => (t.type === "chunk" ? Object.keys(t.modules).filter(esModuloDeLaPrueba) : []);
      if (!incluida) {
        const sueltos = trozos.flatMap(conMarcas);
        const archivos = Object.keys(bundle).filter((f) => f.startsWith("prueba/"));
        if (sueltos.length || archivos.length) {
          this.error("La prueba de la llave se coló en un armado que no la pidió: " + [...sueltos.slice(0, 3), ...archivos.slice(0, 3)].join(", "));
        }
        return;
      }
      // Con la prueba incluida: lo que alcanza cualquier entrada que no sea la suya no puede traer nada de la prueba.
      const porNombre = new Map(trozos.map((t) => [t.fileName, t]));
      for (const entrada of trozos) {
        if (entrada.type !== "chunk" || !entrada.isEntry || esDeLaPagina(entrada.facadeModuleId)) continue;
        const vistos = new Set<string>();
        const pendientes = [entrada.fileName];
        while (pendientes.length) {
          const nombre = pendientes.pop() as string;
          if (vistos.has(nombre)) continue;
          vistos.add(nombre);
          const t = porNombre.get(nombre);
          if (!t || t.type !== "chunk") continue;
          const marcados = conMarcas(t);
          if (marcados.length) this.error(`La entrada ${entrada.fileName} alcanza un módulo de la prueba de la llave: ${marcados[0] ?? ""}`);
          pendientes.push(...t.imports, ...t.dynamicImports);
        }
      }
    },
  };
}

/**
 * Las páginas de lectura se adelantan: cuando el mouse se posa 200 ms sobre un
 * enlace a otra (o al tocarlo, en el celular), Chrome la prerenderiza y al
 * hacer clic se muestra al instante. Solo esas once: son livianas y no tienen
 * efectos. Las tres de sorteo (meetup, clase y verificable) son de lectura como
 * las demás. La herramienta no, que arranca audio, sesiones y miniaturas, y el
 * contador de visitas espera a que la página se muestre (`analytics.ts`). Los
 * navegadores sin speculation rules ignoran el bloque.
 */
function adelantarLectura(): Plugin {
  const paginas = ["juegos", "como-funciona", "historia", "seguridad", "precios", "terminos", "sorteo-para-meetup", "sorteo-en-clase", "sorteo-verificable", "ruleta-de-nombres", "sorteo-para-eventos"];
  const reglas = {
    prerender: [{ where: { href_matches: paginas.map((p) => `/${p}.html`) }, eagerness: "moderate" }],
  };
  return {
    name: "tinkazo:adelantar-lectura",
    transformIndexHtml: () => [{ tag: "script", attrs: { type: "speculationrules" }, children: JSON.stringify(reglas), injectTo: "head" }],
  };
}

/**
 * Los enlaces cortos de los comprobantes: `tinkazo.app/c/<id>` sirve `c.html`,
 * que abre el comprobante guardado y va a su página (`src/c.ts`). En Vercel lo
 * hace la reescritura de `vercel.json`; esto es lo mismo para `pnpm dev` y
 * `pnpm preview`. La consulta (`?lang=`, `?theme=`) se conserva; el fragmento,
 * con la clave, nunca llega al servidor.
 */
function enlacesCortos(): Plugin {
  const reescribir = (req: { url?: string }, _res: unknown, next: () => void): void => {
    const url = req.url ?? "";
    if (/^\/c\/[^/?#]+\/?(?:\?.*)?$/.test(url)) {
      const q = url.indexOf("?");
      req.url = `/c.html${q >= 0 ? url.slice(q) : ""}`;
    }
    next();
  };
  return {
    name: "tinkazo:enlaces-cortos",
    configureServer: (server) => void server.middlewares.use(reescribir),
    configurePreviewServer: (server) => void server.middlewares.use(reescribir),
  };
}

/**
 * El aviso de trozos de más de 500 kB, con una sola excepción con nombre: el SDK
 * de Stellar.
 *
 * El SDK pesa unos 690 kB minificado (138 kB con gzip) y 431 kB de eso son las
 * definiciones XDR que genera Stellar. No se achica importándolo de otra forma:
 * `contract.Client` y `rpc.Server` usan casi todas por dentro, y con cualquier
 * manera de importarlo sale del mismo tamaño (medido el 21 de octubre de 2026).
 * Tampoco se puede partir en trozos de menos de 500 kB: las definiciones con lo
 * que usan suman 516 kB, y un corte más fino deja dos trozos que se importan el
 * uno al otro, y entonces que el SDK arranque depende del orden en que el
 * navegador los evalúe, que nadie controla. Y no hace falta: se baja recién
 * cuando se usa (con la página quieta después de entrar con una cuenta, al
 * sellar, al sortear o al verificar un sorteo anclado). La portada, los juegos y
 * la verificación de un comprobante sin anclar no lo piden.
 *
 * Por eso el aviso de Vite queda para lo enorme (`chunkSizeWarningLimit`, 1 MB)
 * y este avisa desde 500 kB por cualquier otro trozo, por el del SDK si se
 * mezcla con código nuestro y también si alguna página lo baja al abrirse (un
 * import estático en la portada): la excepción vale mientras se pida cuando se
 * usa, que es lo que la justifica.
 */
function avisoDeTrozosGrandes(limiteKb = 500): Plugin {
  // El SDK y lo que usa solo él (con pnpm, el último node_modules de la ruta).
  const delSdk = /[\\/]node_modules[\\/](?:@stellar[\\/](?:stellar-sdk|js-xdr)|bignumber\.js|feaxios|@noble[\\/]ed25519|@exodus[\\/]bytes|uint8array-extras)[\\/]/;
  return {
    name: "tinkazo:aviso-de-trozos-grandes",
    apply: "build",
    // Después de Vite, que todavía les agrega a los trozos la lista de lo que precargan.
    enforce: "post",
    generateBundle(_salida, bundle) {
      // Lo que baja una página al abrirse: su entrada y lo que importa sin import().
      const alAbrir = new Set<string>();
      const pendientes: string[] = [];
      for (const t of Object.values(bundle)) if (t.type === "chunk" && t.isEntry) pendientes.push(t.fileName);
      while (pendientes.length) {
        const f = pendientes.pop() as string;
        const t = bundle[f];
        if (alAbrir.has(f) || t?.type !== "chunk") continue;
        alAbrir.add(f);
        pendientes.push(...t.imports);
      }
      for (const trozo of Object.values(bundle)) {
        if (trozo.type !== "chunk") continue;
        const kb = Buffer.byteLength(trozo.code) / 1000;
        if (kb <= limiteKb) continue;
        const ids = Object.keys(trozo.modules);
        const soloSdk = ids.length > 0 && ids.every((id) => delSdk.test(id));
        // three.js (el 3D de src/games/tres/) pesa unos 505 kB y se baja solo con el 3D prendido: mientras ninguna página lo pida al abrirse, no se avisa.
        const soloTres = ids.length > 0 && ids.every((id) => /[\\/]node_modules[\\/]three[\\/]/.test(id));
        if ((soloSdk || soloTres) && !alAbrir.has(trozo.fileName)) continue;
        this.warn(
          soloSdk || soloTres
            ? soloTres
              ? `${trozo.fileName} es three.js (${kb.toFixed(0)} kB) y una página lo baja al abrirse: tiene que pedirse con import() recién cuando se use el 3D.`
              : `${trozo.fileName} es el SDK de Stellar (${kb.toFixed(0)} kB) y una página lo baja al abrirse: tiene que pedirse con import() recién cuando se use.`
            : `${trozo.fileName} pesa ${kb.toFixed(0)} kB minificado, más de ${limiteKb} kB: si no hace falta al abrir la página, que se baje con import() cuando se use.`,
        );
      }
    },
  };
}

// El sitio, que es la herramienta y nada más; la verificación pública, que se
// abre desde el QR o el enlace del comprobante y no necesita cuenta; y las
// páginas de lectura (precios, juegos, historia, seguridad, términos), que
// salieron de la principal para no meterle nada de eso a quien solo quiere
// sortear.
export default defineConfig({
  plugins: [
    pruebaDeLlave(),
    validarBanderasDeAlta(),
    validarModoPremios(),
    validarCostoDelRetiro(),
    validarComision(),
    validarPaginasConCobro(),
    textosPorPagina(),
    adelantarLectura(),
    enlacesCortos(),
    avisoDeTrozosGrandes(),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    // El de 500 kB lo da `avisoDeTrozosGrandes`, que sabe cuál es el SDK de Stellar.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // three.js en un trozo con nombre propio: todos los juegos en 3D (src/games/tres/) comparten el mismo y se baja una sola vez.
      output: { manualChunks: (id: string) => (/[\\/]node_modules[\\/]three[\\/]/.test(id) ? "three" : undefined) },
      input: {
        index: resolve(__dirname, "index.html"),
        verificar: resolve(__dirname, "verificar.html"),
        precios: resolve(__dirname, "precios.html"),
        juegos: resolve(__dirname, "juegos.html"),
        historia: resolve(__dirname, "historia.html"),
        marca: resolve(__dirname, "marca.html"),
        seguridad: resolve(__dirname, "seguridad.html"),
        "como-funciona": resolve(__dirname, "como-funciona.html"),
        "sorteo-para-meetup": resolve(__dirname, "sorteo-para-meetup.html"),
        "sorteo-en-clase": resolve(__dirname, "sorteo-en-clase.html"),
        "sorteo-verificable": resolve(__dirname, "sorteo-verificable.html"),
        "ruleta-de-nombres": resolve(__dirname, "ruleta-de-nombres.html"),
        "sorteo-para-eventos": resolve(__dirname, "sorteo-para-eventos.html"),
        lista: resolve(__dirname, "lista.html"),
        equipos: resolve(__dirname, "equipos.html"),
        participar: resolve(__dirname, "participar.html"),
        "crear-campana": resolve(__dirname, "crear-campana.html"),
        evento: resolve(__dirname, "evento.html"),
        confirmar: resolve(__dirname, "confirmar.html"),
        c: resolve(__dirname, "c.html"),
        terminos: resolve(__dirname, "terminos.html"),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    // Las copias de trabajo de git (worktrees) no se prueban: sin esto,
    // `pnpm test` corría también las pruebas a medias de otra copia y
    // fallaba por trabajo ajeno (18 de octubre de 2026).
    exclude: [...configDefaults.exclude, "**/worktrees/**"],
    // Las pruebas corren siempre con el sitio abriendo en Prueba: un `.env.local` traído de Vercel con
    // `VITE_STELLAR_NETWORK=mainnet` no puede cambiar la red de cientos de pruebas que hoy dan Prueba por sentado.
    env: { VITE_STELLAR_NETWORK: "" },
    // Con la máquina cargada, las pruebas que verifican firmas reales o cargan el SDK de Stellar pasan de 5 segundos,
    // y las que simulan cientos de carreras enteras pasan de 30 cuando el procesador trabaja en modo silencioso o
    // hay otras tareas al lado. Subir el margen no esconde fallas: deja de confundir la carga con un error.
    testTimeout: 60000,
  },
});
