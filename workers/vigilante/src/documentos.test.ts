// Que lo que se despliega, lo que dice el README, lo que dice la hoja de operación y lo que lee el código sean lo mismo:
// cada secreto con su comando, cada problema con su fila, y el flujo de GitHub dicho como respaldo. Se leen los archivos
// tal como están escritos.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asuntoDeClave, mensajeDeAlerta } from "./mensaje";
import { estadoBien } from "./mundo-falso";

const raiz = fileURLToPath(new URL("../../../", import.meta.url));
const leer = (ruta: string): string => readFileSync(join(raiz, ruta), "utf8");

const wrangler = leer("workers/vigilante/wrangler.toml");
const readme = leer("workers/vigilante/README.md");
const hoja = leer("docs/operacion.md");
const flujo = leer(".github/workflows/vigilar-portero.yml");
const guion = leer("scripts/lib/vigilar-portero.mjs");
const vuelta = leer("workers/vigilante/src/vuelta.ts");

/** La sección del vigilante en la hoja de operación. */
const seccion = hoja.slice(hoja.indexOf("\n## El vigilante"));

/** Los secretos que carga `wrangler secret put`, con los que lee el código: el único lugar donde se listan. */
const SECRETOS = ["PORTERO_ADMIN_TOKEN", "AVISAR_A", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
const BINDINGS = ["MEMORIA", "CORREO"];

/** Los campos de `interface Entorno` del código. */
function camposDelEntorno(): string[] {
  const desde = vuelta.indexOf("export interface Entorno {");
  const hasta = vuelta.indexOf("\n}", desde);
  return [...vuelta.slice(desde, hasta).matchAll(/^ {2}([A-Z_]+)\??:/gm)].map((m) => m[1]!);
}

/** Los nombres de `[vars]` en wrangler.toml. */
function variablesDeWrangler(): string[] {
  const desde = wrangler.indexOf("[vars]");
  return [...wrangler.slice(desde).matchAll(/^([A-Z_]+) = /gm)].map((m) => m[1]!);
}

/** Todos los archivos que no son pruebas de una carpeta, con su texto. */
function archivosDeCodigo(carpeta: string): Array<{ ruta: string; texto: string }> {
  const salida: Array<{ ruta: string; texto: string }> = [];
  for (const nombre of readdirSync(join(raiz, carpeta), { withFileTypes: true })) {
    const ruta = `${carpeta}/${nombre.name}`;
    if (nombre.isDirectory()) {
      if (nombre.name !== "node_modules" && nombre.name !== ".wrangler") salida.push(...archivosDeCodigo(ruta));
    } else if (!/\.test\.(ts|mjs)$/.test(nombre.name)) {
      salida.push({ ruta, texto: leer(ruta) });
    }
  }
  return salida;
}

describe("wrangler.toml", () => {
  it("es un Worker aparte, con el reloj de diez minutos, el KV con el id del espacio ya creado y el binding de correo", () => {
    expect(wrangler).toMatch(/^name = "tinkazo-vigilante"$/m);
    expect(wrangler).toMatch(/^main = "src\/index\.ts"$/m);
    expect(wrangler).toMatch(/^\[triggers\]\r?\ncrons = \["\*\/10 \* \* \* \*"\]$/m);
    // El espacio ya está creado: el id (que no es un secreto) reemplazó al marcador de la hoja de operación.
    expect(wrangler).toMatch(/^\[\[kv_namespaces\]\]\r?\nbinding = "MEMORIA"\r?\nid = "[0-9a-f]{32}"$/m);
    expect(wrangler).not.toMatch(/^id = "PEGAR-ACA-EL-ID-DEL-KV"$/m);
    expect(wrangler).toMatch(/^\[\[send_email\]\]\r?\nname = "CORREO"$/m);
    expect(wrangler).toMatch(/^\[observability\]\r?\nenabled = true$/m);
    expect(wrangler).toMatch(/^workers_dev = false$/m);
    // Aparte del portero: no comparte ni objetos ni entornos con él.
    expect(wrangler).not.toMatch(/durable_objects|\[env\./);
    expect(wrangler).not.toContain("tinkazo-patrocinio");
  });

  it("declara el KV y el correo en el código con los mismos nombres", () => {
    for (const binding of BINDINGS) expect(camposDelEntorno(), binding).toContain(binding);
    expect(readme).toContain("npx wrangler@4 kv namespace create MEMORIA");
    expect(wrangler).toContain("npx wrangler@4 kv namespace create MEMORIA");
  });

  it("cada campo del entorno es un binding, una variable de wrangler.toml o un secreto de la lista, y nada más", () => {
    const variables = variablesDeWrangler();
    expect(variables.length).toBeGreaterThan(3);
    for (const campo of camposDelEntorno()) {
      expect([...BINDINGS, ...variables, ...SECRETOS], campo).toContain(campo);
    }
    for (const variable of variables) expect(camposDelEntorno(), variable).toContain(variable);
    for (const secreto of SECRETOS) expect(variables, secreto).not.toContain(secreto);
  });

  it("no lleva ningún secreto ni la dirección de aviso", () => {
    for (const secreto of SECRETOS) expect(wrangler.replace(/^#.*$/gm, ""), secreto).not.toContain(`${secreto} =`);
    expect(wrangler).not.toMatch(/AVISAR_A\s*=/);
  });
});

describe("la hoja de operación", () => {
  it("tiene la sección del vigilante con cómo se despliega, cómo se prueba y qué hacer con cada aviso", () => {
    expect(seccion).toContain("## El vigilante");
    for (const titulo of ["### Cómo se despliega", "### Cómo se prueba que anda", "### Qué hacer con cada aviso"]) expect(seccion, titulo).toContain(titulo);
  });

  it("dice cada secreto con su comando exacto y de dónde sale", () => {
    for (const secreto of SECRETOS) {
      expect(seccion, secreto).toContain(`| \`${secreto}\` |`);
      expect(seccion, secreto).toContain(`npx wrangler@4.160.0 secret put ${secreto}`);
      expect(readme, secreto).toContain(`\`${secreto}\``);
    }
    expect(seccion).toContain("`ADMIN_TOKEN`");
    expect(seccion).toContain("`PORTERO_MAINNET_ADMIN_TOKEN`");
    expect(seccion).toContain("Destination addresses");
  });

  it("cuenta el KV como un paso ya hecho, con su id en wrangler.toml, y sigue con desplegar y recién después los secretos", () => {
    const kv = seccion.indexOf("npx wrangler@4.160.0 kv namespace create MEMORIA");
    const desplegar = seccion.indexOf("npx wrangler@4.160.0 deploy --config wrangler.toml");
    const secretos = seccion.indexOf("secret put PORTERO_ADMIN_TOKEN");
    expect(kv).toBeGreaterThan(-1);
    expect(desplegar).toBeGreaterThan(kv);
    expect(secretos).toBeGreaterThan(desplegar);
    // El paso del KV dice que ya está hecho y que el id ya está en wrangler.toml: no manda a pegar nada en un marcador.
    expect(seccion).not.toContain("PEGAR-ACA-EL-ID-DEL-KV");
    expect(seccion).not.toMatch(/pegar el id que imprime/);
    expect(seccion.slice(Math.max(0, kv - 500), desplegar)).toMatch(/ya hecho/i);
    expect(seccion.slice(Math.max(0, kv - 500), desplegar)).toContain("ya está en `wrangler.toml`");
  });

  it("usa la misma versión de wrangler que el corte del portero", () => {
    const version = /npx wrangler@(\d+\.\d+\.\d+) deploy --config wrangler\.toml --env mainnet/.exec(hoja)?.[1];
    expect(version, "el corte con wrangler cambió de forma").toBeDefined();
    expect(seccion).toContain(`npx wrangler@${version} deploy --config wrangler.toml`);
    expect(seccion).not.toMatch(/wrangler@(?!4\.160\.0)\d/);
  });

  it("dice cómo se prueba: la ruta pública, el aviso forzado y la señal de vida", () => {
    expect(seccion).toContain("curl -fsS https://vigilante.tinkazo.app/");
    expect(seccion).toContain("https://vigilante.tinkazo.app/prueba");
    expect(seccion).toContain('"salioBien":true');
    expect(seccion).toContain("Si un día no llega, el vigilante se cayó");
    expect(seccion).toContain("12:00 UTC");
    expect(seccion).toContain("RESUMEN_CADA_HORAS");
    expect(seccion).toContain("E_RECIPIENT_NOT_ALLOWED");
  });

  it("tiene una fila por cada problema que el vigilante sabe contar, con el asunto tal como sale", () => {
    const claves = [
      "modo:apagado",
      "modo:pollar",
      "modo:sin-leer",
      "portero-sin-llave",
      "creditos-bajo-el-piso",
      "creditos-bajos",
      "creditos-sin-leer",
      "patrocinadora-casi-sin-saldo",
      "patrocinadora-baja:saldo-bajo",
      "patrocinadora-baja:saldo-no-leido",
      "altas-pausadas",
      "firmas-sin-explicar:mas-de-10",
      "firmas-sin-comparar",
      "patrocinio-prendido:x",
      "patrocinio-sin-leer",
      "no-es-mainnet",
      "respuesta-invalida",
      "sin-lectura",
      "vigilante-sin-clave",
    ];
    for (const clave of claves) {
      const asunto = asuntoDeClave(clave);
      expect(asunto, clave).not.toBeNull();
      expect(seccion, clave).toContain(`| **${asunto}** |`);
    }
  });

  it("la fila del arreglo y del recordatorio están explicadas", () => {
    expect(seccion).toContain("Sigue: ...");
    expect(seccion).toContain("Arreglado");
    expect(seccion).toContain("23 horas");
  });

  it("el punto de «Antes del evento» manda al vigilante y deja el flujo de GitHub como respaldo", () => {
    const antes = hoja.slice(hoja.indexOf("## Antes del evento"), hoja.indexOf("## Durante el evento"));
    expect(antes).toContain("el vigilante cada diez minutos");
    expect(antes).toContain("de respaldo");
    expect(antes).toContain("`tinkazo-vigilante`");
  });
});

describe("el estado del vigilante, dicho como es", () => {
  it("el README dice que está desplegado desde el 11 de noviembre de 2026 y no que falta desplegarlo", () => {
    const apertura = readme.split("\n").slice(0, 4).join("\n");
    expect(apertura).toContain("vigilante.tinkazo.app");
    expect(apertura).toMatch(/Está desplegado desde el 11 de noviembre de 2026/);
    expect(readme).not.toMatch(/No está desplegado/i);
  });
});

describe("el aviso del portero devuelto a Pollar y la hoja de operación hablan del mismo plan", () => {
  it("el qué hacer del aviso y la fila de la hoja dicen plan B3, que es como la hoja llama a ese último recurso", () => {
    expect(hoja).toMatch(/^- \*\*B3, último recurso/m);
    const aviso = mensajeDeAlerta({ claves: ["modo:pollar"], problemas: [], recordatorio: false, arreglados: [], siguen: [] }, { estado: estadoBien({ modo: "pollar" }), ahora: new Date(0), portero: "https://pm.tinkazo.app" });
    expect(aviso.texto).toContain("Si es el plan B3, mirá que la regla del contrato esté prendida en Pollar.");
    expect(aviso.texto).not.toMatch(/plan B(?!3)/);
    const fila = seccion.split("\n").find((l) => l.includes("**El portero no paga: lo pasaron a Pollar**")) ?? "";
    expect(fila).toContain("Si es el plan B3, que la regla del contrato esté prendida en Pollar");
    expect(fila).not.toMatch(/plan B(?!3)/);
  });
});

describe("POST /prueba se pide con el derivado, y los registros de invocación se miran en los dos Workers", () => {
  it("la hoja y el README dicen cómo se calcula el derivado y ya no mandan la clave de operar al vigilante", () => {
    for (const [nombre, texto] of [
      ["hoja", seccion],
      ["README", readme],
    ] as const) {
      expect(texto, nombre).toContain("tinkazo-vigilante/prueba/v1");
      expect(texto, nombre).toContain('createHmac("sha256"');
      expect(texto, nombre).not.toMatch(/Bearer \$T" https:\/\/vigilante/);
      expect(texto, nombre).not.toContain("Bearer <la clave de operar>");
    }
  });

  it("el paso de los registros de invocación nombra al portero además del vigilante", () => {
    const paso = seccion.split("\n").find((l) => l.includes("registros de invocación")) ?? "";
    expect(paso).toContain("`tinkazo-patrocinio-mainnet`");
    expect(paso).toContain("`tinkazo-vigilante`");
    expect(paso).toContain("REDACTED");
    const enReadme = readme.split("\n").find((l) => l.includes("registros de invocación")) ?? "";
    expect(enReadme).toContain("`tinkazo-patrocinio-mainnet`");
    expect(enReadme).toContain("`tinkazo-vigilante`");
  });
});

describe("el correo de tinkazo.app y los registros de invocación", () => {
  it("la hoja no manda a prender el ruteo de correo: ya está prendido, solo se comprueba y no se tocan los registros del dominio", () => {
    expect(seccion).toContain("ya está prendido");
    expect(seccion).toContain("solo comprobar que sigue prendido");
    expect(seccion).toContain("No se toca ningún registro del dominio");
    expect(seccion).not.toMatch(/comprobar que el ruteo de correo está prendido/);
    expect(seccion).not.toMatch(/prender el ruteo|Enable/);
  });

  it("el README dice lo mismo y ya no lo deja como una duda", () => {
    expect(readme).toContain("ya está prendido");
    expect(readme).toContain("No se toca ningún registro del dominio");
    expect(readme).not.toContain("Si el ruteo de correo ya está prendido");
  });

  it("después del primer despliegue se mira si los registros de invocación guardan la cabecera con la clave, y si la guardan se apagan", () => {
    expect(seccion).toContain("registros de invocación");
    expect(seccion).toContain("`POST /prueba`");
    expect(seccion).toContain("cabecera");
    expect(seccion).toContain("apagar esos registros");
    expect(readme).toContain("registros de invocación");
  });
});

describe("lo que cuida la clave y los pedidos, dicho en el README", () => {
  it("dice la cuenta en Workers Paid, la memoria de 60 segundos de GET /, el enfriamiento de /prueba, el host de la clave y el tope del correo", () => {
    expect(readme).toContain("Workers Paid");
    expect(readme).toMatch(/GET \/.{0,200}60 segundos/);
    expect(readme).toMatch(/\/prueba.{0,200}60 segundos/);
    expect(readme).toContain("`*.tinkazo.app`");
    expect(readme).toContain("redirecciones");
    expect(readme).toContain("15 segundos");
  });

  it("dice qué hace con un KV que no se puede leer y con el acceso perdido", () => {
    expect(readme).toMatch(/KV que no se puede leer/);
    expect(readme).toMatch(/sin acceso|acceso perdido|no puede entrar al portero/);
  });
});

describe("lo que la revisión lee del portero, tal como lo manda", () => {
  // Si el portero cambia el nombre de un campo, falla esta prueba y no se pierde un aviso en silencio.
  const servicio = leer("workers/patrocinio/src/servicio.ts");
  const desde = servicio.indexOf("async estado(): Promise<Respuesta>");
  const hasta = servicio.indexOf("ventanaMs: DIA_MS", desde);
  const cuerpo = servicio.slice(desde, hasta);

  it("estado() manda siempre modo y llave, y modo es portero, pollar o apagado", () => {
    expect(desde, "estado() del portero cambió de forma").toBeGreaterThan(-1);
    expect(hasta, "estado() del portero cambió de forma").toBeGreaterThan(desde);
    expect(servicio).toContain('export type Modo = "portero" | "pollar" | "apagado";');
    expect(cuerpo).toContain("modo: this.modo(),");
    expect(cuerpo).toContain("llave: this.firmante?.clavePublica ?? null,");
    expect(cuerpo).toContain("red: this.cfg.red,");
  });

  it("el README del portero cuenta, entre lo que mira la vigilancia, el portero apagado, el devuelto a Pollar y el que no tiene su llave", () => {
    const readmeDelPortero = leer("workers/patrocinio/README.md");
    const desdeLa = readmeDelPortero.indexOf("- **La vigilancia del portero de mainnet**");
    expect(desdeLa, "la viñeta de la vigilancia cambió de forma").toBeGreaterThan(-1);
    const vigilancia = readmeDelPortero.slice(desdeLa, readmeDelPortero.indexOf("\n", desdeLa));
    expect(vigilancia).toMatch(/si el portero está apagado/);
    expect(vigilancia).toMatch(/devuelto a Pollar/);
    expect(vigilancia).toMatch(/sin su llave/);
  });

  it("las cabeceras del módulo, del guion, del flujo y el README dicen que se mira si el portero paga", () => {
    const modulo = leer("scripts/lib/revision-portero.mjs");
    for (const [nombre, texto] of [
      ["revision-portero.mjs", modulo.slice(0, modulo.indexOf("*/"))],
      ["vigilar-portero.mjs", guion.slice(0, guion.indexOf("\nimport "))],
      ["vigilar-portero.yml", flujo.slice(0, flujo.indexOf("\nname: "))],
      ["README.md", readme],
    ] as const) {
      expect(texto, nombre).toMatch(/apagado/);
      expect(texto, nombre).toMatch(/llave/);
    }
  });
});

describe("el flujo de GitHub, de respaldo", () => {
  it("lo dice en la cabecera del workflow y en la del guion, y apunta al vigilante", () => {
    const cabeceraDelFlujo = flujo.slice(0, flujo.indexOf("\nname: "));
    expect(cabeceraDelFlujo).toMatch(/RESPALDO/);
    expect(cabeceraDelFlujo).toContain("workers/vigilante");
    const cabeceraDelGuion = guion.slice(0, guion.indexOf("\nimport "));
    expect(cabeceraDelGuion).toMatch(/respaldo/);
    expect(cabeceraDelGuion).toContain("workers/vigilante");
    expect(cabeceraDelGuion).toContain("scripts/lib/revision-portero.mjs");
  });

  it("el vigilante importa la misma revisión que el guion, no una copia", () => {
    expect(vuelta).toContain('from "../../../scripts/lib/revision-portero.mjs"');
    expect(guion).toContain('from "./revision-portero.mjs"');
    const duplicados = archivosDeCodigo("workers/vigilante/src").filter((a) => /export function revisarPortero|export function decidirAviso/.test(a.texto));
    expect(duplicados).toEqual([]);
  });
});

describe("el enfriamiento de POST /prueba, dicho como es", () => {
  it("el README y la hoja dicen que los 60 segundos son por instancia del Worker y vuelven a cero con cada despliegue", () => {
    expect(readme).toMatch(/\/prueba.{0,200}60 segundos.{0,200}por instancia/);
    expect(seccion).toMatch(/60 segundos[\s\S]{0,200}por instancia/);
    for (const texto of [readme, seccion]) expect(texto).toMatch(/por instancia.{0,200}despliegue/);
  });
});

describe("lo que se publica", () => {
  const archivos = [...archivosDeCodigo("workers/vigilante"), { ruta: "docs/operacion.md (vigilante)", texto: seccion }];

  it("no lleva rayas largas, puntos medios ni flechas", () => {
    // Por su código, para que este archivo no los lleve.
    const prohibidos = new RegExp(`[${[0x2014, 0xb7, 0x2192, 0x2190].map((c) => String.fromCharCode(c)).join("")}]`);
    for (const { ruta, texto } of archivos) expect(texto, ruta).not.toMatch(prohibidos);
  });

  it("no lleva ninguna dirección de correo que no sea de ejemplo: la del remitente va en dos pedazos y la de aviso es un secreto", () => {
    for (const { ruta, texto } of archivos) {
      const direcciones = [...texto.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]).filter((d) => !/@example\.(org|com|net)$/i.test(d) && d !== "hola@tinkazo.app");
      expect(direcciones, ruta).toEqual([]);
    }
  });

  it("no lleva rutas de esta máquina ni nombres de herramientas internas", () => {
    for (const { ruta, texto } of archivos) {
      // Las partes van separadas para que este archivo no contenga lo que busca.
      const privado = ["Tinkazo", "Privado"].join("_");
      const usuario = ["Nic", "olas"].join("");
      expect(texto, ruta).not.toMatch(new RegExp(`[A-Z]:[\\\\/]+${usuario}|${privado}`));
    }
  });
});
