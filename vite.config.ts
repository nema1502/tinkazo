/// <reference types="vitest/config" />
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, runnerImport, type Plugin } from "vite";
import { configDefaults } from "vitest/config";

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
        const delHtml = [...fuente.matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria|label-i|titulo-clave|desc-clave)="([^"]+)"/g)].map((m) => m[1] as string);
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
 * Las páginas de lectura se adelantan: cuando el mouse se posa 200 ms sobre un
 * enlace a otra (o al tocarlo, en el celular), Chrome la prerenderiza y al
 * hacer clic se muestra al instante. Solo esas nueve: son livianas y no tienen
 * efectos. Las tres de sorteo (meetup, clase y verificable) son de lectura como
 * las demás. La herramienta no, que arranca audio, sesiones y miniaturas, y el
 * contador de visitas espera a que la página se muestre (`analytics.ts`). Los
 * navegadores sin speculation rules ignoran el bloque.
 */
function adelantarLectura(): Plugin {
  const paginas = ["juegos", "como-funciona", "historia", "seguridad", "precios", "terminos", "sorteo-para-meetup", "sorteo-en-clase", "sorteo-verificable"];
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
 * y este avisa desde 500 kB por cualquier otro trozo, y también por el del SDK
 * si se mezcla con código nuestro: así un import estático del SDK en la
 * portada, que la haría bajar todo eso de entrada, no pasa callado.
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
      for (const trozo of Object.values(bundle)) {
        if (trozo.type !== "chunk") continue;
        const kb = Buffer.byteLength(trozo.code) / 1000;
        if (kb <= limiteKb) continue;
        const ids = Object.keys(trozo.modules);
        if (ids.length > 0 && ids.every((id) => delSdk.test(id))) continue;
        this.warn(`${trozo.fileName} pesa ${kb.toFixed(0)} kB minificado, más de ${limiteKb} kB: si no hace falta al abrir la página, que se baje con import() cuando se use.`);
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
  plugins: [textosPorPagina(), adelantarLectura(), enlacesCortos(), avisoDeTrozosGrandes()],
  build: {
    target: "es2022",
    sourcemap: true,
    // El de 500 kB lo da `avisoDeTrozosGrandes`, que sabe cuál es el SDK de Stellar.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        verificar: resolve(__dirname, "verificar.html"),
        precios: resolve(__dirname, "precios.html"),
        juegos: resolve(__dirname, "juegos.html"),
        historia: resolve(__dirname, "historia.html"),
        seguridad: resolve(__dirname, "seguridad.html"),
        "como-funciona": resolve(__dirname, "como-funciona.html"),
        "sorteo-para-meetup": resolve(__dirname, "sorteo-para-meetup.html"),
        "sorteo-en-clase": resolve(__dirname, "sorteo-en-clase.html"),
        "sorteo-verificable": resolve(__dirname, "sorteo-verificable.html"),
        lista: resolve(__dirname, "lista.html"),
        evento: resolve(__dirname, "evento.html"),
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
    // Con la máquina cargada (los agentes corren al lado), las pruebas que
    // verifican firmas reales o cargan el SDK de Stellar pasan de 5 segundos.
    // Subir el margen no esconde fallas: deja de confundir la carga con un error.
    testTimeout: 30000,
  },
});
