// Prueba que la alerta del fondo del portero, en .github/workflows/vigilar-red.yml, corra
// aunque falle un paso anterior. El recordatorio diario falla a propósito (una red en naranja
// o la línea base vieja) y, sin `always()`, GitHub saltea los pasos que siguen: la alerta del
// fondo no correría justo el día del recordatorio. Vale con el paso comentado, como está hasta
// que exista el portero, y el día que se descomente.
//
// También prueba el workflow aparte de la vigilancia del portero de mainnet,
// .github/workflows/vigilar-portero.yml: que corra con el Environment `vigilancia` (que solo ve
// `main`), con la clave de operar por `env` y nunca dentro del comando, y que vigilar-red.yml ya
// no la nombre. Y que recuerde lo que ya avisó en la caché de Actions, con las mismas acciones
// (y los mismos SHA) que vigilar-red.yml: si no, falla en cada corrida mientras dure el problema.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aqui = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(aqui, "..", "..", ".github", "workflows", "vigilar-red.yml");
const WORKFLOW_PORTERO = resolve(aqui, "..", "..", ".github", "workflows", "vigilar-portero.yml");
const NOMBRE = "Fondo del portero de patrocinio";

/** Un renglón sin el `#` de comentario de adelante (si lo tiene), con su sangría. */
const sinComentario = (renglon) => renglon.replace(/^(\s*)#\s?/, "$1");

/**
 * Los renglones del paso con ese nombre, comentado o no: desde su `- name:` hasta el
 * próximo paso o hasta lo que ya no le pertenece (menos sangría que sus claves).
 */
function renglonesDelPaso(texto, nombre) {
  const renglones = texto.split(/\r?\n/).map(sinComentario);
  const inicio = renglones.findIndex((r) => {
    const m = r.match(/^\s*-\s*name:\s*(.+?)\s*$/);
    return m && m[1].replace(/^["']|["']$/g, "") === nombre;
  });
  if (inicio < 0) return null;
  const sangria = renglones[inicio].indexOf("-") + 2;
  const paso = [renglones[inicio]];
  for (const r of renglones.slice(inicio + 1)) {
    if (r.trim() === "") continue;
    const propia = r.length - r.trimStart().length;
    if (propia < sangria) break;
    paso.push(r);
  }
  return paso;
}

/** La condición del paso, sin `${{ }}`, o null si no tiene. */
function condicionDelPaso(texto, nombre) {
  const paso = renglonesDelPaso(texto, nombre);
  if (!paso) return null;
  const linea = paso.find((r) => /^\s*if:/.test(r));
  if (!linea) return null;
  return linea
    .replace(/^\s*if:\s*/, "")
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}\s*$/, "")
    .trim();
}

describe("vigilar-red.yml: la alerta del fondo del portero", () => {
  const texto = readFileSync(WORKFLOW, "utf8");

  it("el paso está una sola vez", () => {
    const veces = texto.split(/\r?\n/).filter((r) => r.includes(`name: ${NOMBRE}`)).length;
    expect(veces).toBe(1);
  });

  it("su condición empieza con always() &&, para correr aunque falle el recordatorio diario", () => {
    const condicion = condicionDelPaso(texto, NOMBRE);
    expect(condicion, "el paso no tiene if:").not.toBeNull();
    expect(condicion).toMatch(/^always\(\)\s*&&\s*/);
  });

  it("sigue siendo una vez al día: con el recordatorio de las 12:07 o a mano con diario", () => {
    const condicion = condicionDelPaso(texto, NOMBRE);
    const resto = condicion.replace(/^always\(\)\s*&&\s*/, "");
    expect(resto).toMatch(/^\(.*\)$/);
    expect(resto).toContain("github.event.schedule == '7 12 * * *'");
    expect(resto).toContain("inputs.diario");
  });
});

describe("condicionDelPaso", () => {
  const paso = (prefijo, condicion) =>
    [
      "    steps:",
      `${prefijo}  - name: Otro`,
      `${prefijo}    if: always()`,
      `${prefijo}  - name: ${NOMBRE}`,
      `${prefijo}    if: ${condicion}`,
      `${prefijo}    run: echo hola`,
      "      - name: Latido",
      "        if: always()",
    ].join("\r\n");

  it("lee la condición del paso comentado y del descomentado", () => {
    const cond = "${{ always() && (github.event.schedule == '7 12 * * *' || inputs.diario) }}";
    const esperado = "always() && (github.event.schedule == '7 12 * * *' || inputs.diario)";
    expect(condicionDelPaso(paso("    ", cond), NOMBRE)).toBe(esperado);
    expect(condicionDelPaso(paso("    # ", cond), NOMBRE)).toBe(esperado);
  });

  it("no toma la condición de otro paso", () => {
    const sinIf = ["      - name: " + NOMBRE, "        run: echo", "      - name: Latido", "        if: always()"].join("\n");
    expect(condicionDelPaso(sinIf, NOMBRE)).toBeNull();
  });

  it("sin always() la condición no pasa la regla", () => {
    const cond = "${{ github.event.schedule == '7 12 * * *' || inputs.diario }}";
    expect(condicionDelPaso(paso("    # ", cond), NOMBRE)).not.toMatch(/^always\(\)\s*&&/);
  });
});

describe("vigilar-portero.yml: el portero de mainnet", () => {
  const texto = readFileSync(WORKFLOW_PORTERO, "utf8");
  const PASO = "Portero de mainnet";
  const crudo = texto.split(/\r?\n/);
  /** El archivo sin sus renglones de comentario: lo que GitHub lee de verdad. */
  const vivo = crudo.filter((r) => !/^\s*#/.test(r)).join("\n");

  it("corre con el Environment vigilancia, que solo ve main", () => {
    expect(vivo).toMatch(/^ {4}environment:\s*vigilancia\s*$/m);
    expect(vivo.match(/^\s*environment:/gm)).toHaveLength(1);
  });

  it("solo puede leer el repositorio: permissions con contents: read y nada más", () => {
    expect(vivo).toMatch(/^permissions:\n {2}contents:\s*read\s*(\n|$)/m);
    expect(vivo).not.toMatch(/:\s*write\b/);
  });

  it("corre cada hora (minuto 23) y a mano con workflow_dispatch", () => {
    const crones = vivo.match(/^\s*-\s*cron:.*$/gm) ?? [];
    expect(crones).toHaveLength(1);
    expect(crones[0]).toMatch(/cron:\s*'23 \* \* \* \*'\s*$/);
    expect(vivo).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("el paso está una sola vez, prendido (no comentado) y sin condición: corre en cada disparo", () => {
    const veces = crudo.filter((r) => r.includes(`name: ${PASO}`));
    expect(veces).toHaveLength(1);
    expect(veces[0]).toMatch(/^\s*-\s*name:/);
    expect(condicionDelPaso(texto, PASO)).toBeNull();
  });

  it("la clave va por env desde los secretos, nunca adentro del comando, y mira pm.tinkazo.app", () => {
    const paso = renglonesDelPaso(texto, PASO).join("\n");
    // Con la clave de solo lectura (issue #219): si está cargada es la que viaja a /estado; la de operar queda de respaldo.
    expect(paso).toMatch(/PORTERO_TOKEN_LECTURA:\s*\$\{\{\s*secrets\.PORTERO_MAINNET_TOKEN_LECTURA\s*\}\}/);
    expect(paso).toMatch(/PORTERO_ADMIN_TOKEN:\s*\$\{\{\s*secrets\.PORTERO_MAINNET_ADMIN_TOKEN\s*\}\}/);
    expect(paso).toContain("https://pm.tinkazo.app");
    const run = paso.slice(paso.indexOf("run:"));
    expect(run).not.toContain("${{");
    expect(run).toContain("/v1/patrocinio/estado");
    expect(run).toContain("node scripts/lib/vigilar-portero.mjs");
    // Es el único secreto del archivo: no se le pasa al checkout ni a ningún otro paso.
    // Dos secrets ahora: la clave de lectura (#219) y la de operar, con su env cada una.
    expect(vivo.match(/secrets\./g)).toHaveLength(2);
  });

  it("sin ninguna de las dos claves no falla: avisa y sale con 0", () => {
    const run = renglonesDelPaso(texto, PASO).join("\n");
    expect(run).toMatch(/CLAVE="\$\{PORTERO_TOKEN_LECTURA:-\$PORTERO_ADMIN_TOKEN\}"/);
    expect(run).toMatch(/if \[ -z "\$CLAVE" \]; then[\s\S]*exit 0/);
  });
});

/**
 * El comportamiento de la clave, corriendo el paso de verdad con un curl y un node de mentira: qué clave viaja a
 * /estado según cuáles estén cargadas. No toca la red ni ningún secreto: los valores son de prueba.
 */
const hayBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
describe.skipIf(!hayBash)("vigilar-portero.yml: qué clave viaja al portero", () => {
  const texto = readFileSync(WORKFLOW_PORTERO, "utf8");
  const paso = renglonesDelPaso(texto, "Portero de mainnet").join("\n");
  const run = paso
    .slice(paso.indexOf("run: |") + "run: |".length)
    .split("\n")
    .map((r) => r.replace(/^ {10}/, ""))
    .join("\n");
  const LECTURA = "lectura-de-prueba";
  const OPERAR = "operar-de-prueba";

  /** Corre el paso con esas claves cargadas. Devuelve lo que dijo, cómo terminó y la clave con la que llamó a /estado. */
  function correrPaso(claves) {
    const carpeta = mkdtempSync(join(tmpdir(), "vigilar-portero-"));
    try {
      const bin = join(carpeta, "bin");
      mkdirSync(bin);
      // El curl de mentira anota el encabezado de autorización y deja un archivo de respuesta.
      writeFileSync(join(bin, "curl"), '#!/bin/sh\nwhile [ $# -gt 0 ]; do\n  case "$1" in\n    -H) echo "$2" >> "$LLAMADAS"; shift ;;\n    -o) echo "{}" > "$2"; shift ;;\n  esac\n  shift\ndone\n', { mode: 0o755 });
      writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const llamadas = join(carpeta, "llamadas.txt");
      writeFileSync(llamadas, "");
      const r = spawnSync("bash", ["-c", run], {
        cwd: carpeta,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          LLAMADAS: llamadas,
          PORTERO_URL: "https://portero.example.org",
          GITHUB_STEP_SUMMARY: join(carpeta, "resumen.md"),
          USAR_MEMORIA: "true",
          PORTERO_TOKEN_LECTURA: claves.lectura ?? "",
          PORTERO_ADMIN_TOKEN: claves.operar ?? "",
        },
      });
      return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, encabezados: readFileSync(llamadas, "utf8").split("\n").filter(Boolean) };
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  }

  it("con las dos cargadas viaja la de solo lectura y la de operar no sale", () => {
    const r = correrPaso({ lectura: LECTURA, operar: OPERAR });
    expect(r.codigo).toBe(0);
    expect(r.encabezados).toEqual([`Authorization: Bearer ${LECTURA}`]);
  });

  it("solo con la de operar, viaja esa: el flujo sigue como antes de que existiera la de lectura", () => {
    const r = correrPaso({ operar: OPERAR });
    expect(r.codigo).toBe(0);
    expect(r.encabezados).toEqual([`Authorization: Bearer ${OPERAR}`]);
  });

  it("solo con la de lectura, viaja esa", () => {
    const r = correrPaso({ lectura: LECTURA });
    expect(r.codigo).toBe(0);
    expect(r.encabezados).toEqual([`Authorization: Bearer ${LECTURA}`]);
  });

  it("sin ninguna no llama al portero, lo dice y sale con 0", () => {
    const r = correrPaso({});
    expect(r.codigo).toBe(0);
    expect(r.encabezados).toEqual([]);
    expect(r.salida).toContain("el portero de mainnet no se mira");
  });
});

describe("vigilar-portero.yml: no manda un correo por hora por el mismo problema", () => {
  const texto = readFileSync(WORKFLOW_PORTERO, "utf8");
  const textoRed = readFileSync(WORKFLOW, "utf8");
  const PASO = "Portero de mainnet";
  const RECUPERAR = "Recuperar lo que se avisó en la corrida anterior";
  const GUARDAR = "Guardar lo avisado para la próxima corrida";
  const vivo = texto.split(/\r?\n/).filter((r) => !/^\s*#/.test(r));
  const nombres = vivo.flatMap((r) => r.match(/^\s*-\s*name:\s*(.+?)\s*$/)?.slice(1) ?? []).map((n) => n.replace(/^["']|["']$/g, ""));

  /** La acción de un paso, con su SHA: `actions/cache/restore@0057…`. */
  const accionDe = (archivo, nombre) => renglonesDelPaso(archivo, nombre)?.join("\n").match(/uses:\s*(\S+)/)?.[1];

  it("recupera lo avisado antes del paso que mira, y lo guarda después", () => {
    expect(nombres.indexOf(RECUPERAR)).toBeGreaterThan(-1);
    expect(nombres.indexOf(RECUPERAR)).toBeLessThan(nombres.indexOf(PASO));
    expect(nombres.indexOf(GUARDAR)).toBeGreaterThan(nombres.indexOf(PASO));
  });

  it("usa las mismas acciones de caché, fijadas por SHA, que vigilar-red.yml", () => {
    const recuperar = accionDe(texto, RECUPERAR);
    const guardar = accionDe(texto, GUARDAR);
    expect(recuperar).toMatch(/^actions\/cache\/restore@[0-9a-f]{40}$/);
    expect(guardar).toMatch(/^actions\/cache\/save@[0-9a-f]{40}$/);
    expect(recuperar).toBe(accionDe(textoRed, "Recuperar lo que se avisó en la corrida anterior"));
    expect(guardar).toBe(accionDe(textoRed, "Guardar lo avisado para la próxima corrida"));
  });

  it("guarda aunque la corrida falle (avisar es fallar), y solo si hay algo que guardar", () => {
    const condicion = condicionDelPaso(texto, GUARDAR);
    expect(condicion, "el paso no tiene if:").not.toBeNull();
    expect(condicion).toMatch(/^always\(\)\s*&&\s*/);
    expect(condicion).toContain("hashFiles('.estado-portero/avisado.json')");
  });

  it("la clave de la caché es nueva en cada corrida y trae la más reciente con restore-keys", () => {
    const recuperar = renglonesDelPaso(texto, RECUPERAR).join("\n");
    const guardar = renglonesDelPaso(texto, GUARDAR).join("\n");
    const clave = /key:\s*vigilar-portero-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}\s*$/m;
    expect(recuperar).toMatch(clave);
    expect(recuperar).toMatch(/restore-keys:\s*vigilar-portero-\s*$/m);
    expect(guardar).toMatch(clave);
    expect(recuperar).toMatch(/path:\s*\.estado-portero\s*$/m);
    expect(guardar).toMatch(/path:\s*\.estado-portero\s*$/m);
  });

  it("el guion lee y escribe el archivo de la carpeta que se guarda", () => {
    const paso = renglonesDelPaso(texto, PASO).join("\n");
    const run = paso.slice(paso.indexOf("run:"));
    expect(run).toContain("--anterior .estado-portero/avisado.json");
    expect(run).toContain("--guardar .estado-portero/avisado.json");
    // La clave sigue entrando solo por env.
    expect(run).not.toContain("${{");
  });

  it("solo la corrida del reloj, en su primer intento, decide con lo avisado: a mano o repetida va con --sin-memoria", () => {
    const paso = renglonesDelPaso(texto, PASO).join("\n");
    // La condición entra por env, no pegada al comando.
    expect(paso).toMatch(/USAR_MEMORIA:\s*\$\{\{\s*github\.event_name == 'schedule' && github\.run_attempt == 1\s*\}\}/);
    const run = paso.slice(paso.indexOf("run:"));
    expect(run).toMatch(/if \[ "\$USAR_MEMORIA" != "true" \]; then[\s\S]*--sin-memoria[\s\S]*fi/);
    // Lo avisado se guarda igual en las dos: --guardar va siempre, no solo en la rama del reloj.
    const antes = run.slice(0, run.indexOf('if [ "$USAR_MEMORIA"'));
    expect(antes).toContain("--guardar .estado-portero/avisado.json");
    expect(antes).not.toContain("--sin-memoria");
  });

  it("escribe el resultado en el resumen de la corrida", () => {
    const run = renglonesDelPaso(texto, PASO).join("\n");
    expect(run).toContain('--resumen "$GITHUB_STEP_SUMMARY"');
  });

  it("la caché se guarda con una clave por corrida y por intento: una repetición no puede reescribir la de la primera", () => {
    const guardar = renglonesDelPaso(texto, GUARDAR).join("\n");
    expect(guardar).toMatch(/key:\s*vigilar-portero-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/);
    const cabecera = texto.split(/\r?\n/).filter((r) => /^#/.test(r)).join("\n");
    expect(cabecera).toContain("<número de corrida>-<intento>");
  });

  it("no se pisa con otra corrida: concurrency con su grupo y sin cancelar la que está corriendo", () => {
    expect(vivo.join("\n")).toMatch(/^concurrency:\n {2}group:\s*vigilar-portero\n {2}cancel-in-progress:\s*false\s*(\n|$)/m);
  });

  it("el comentario de guardar no dice que sin el archivo no hay nada que guardar: con la caché recuperada el archivo existe", () => {
    expect(texto).not.toContain("no hay nada que guardar");
    expect(texto).toMatch(/si la caché se había recuperado, el archivo existe y se\s+# guarda/);
  });

  it("un portero que no contesta no corta el paso antes del guion: se cuenta como un problema más", () => {
    const run = renglonesDelPaso(texto, PASO).join("\n");
    expect(run).toMatch(/curl [^\n]*-o estado-portero-mainnet\.json \|\| echo /);
  });

  it("la cabecera dice cómo avisa", () => {
    const cabecera = texto.split(/\r?\n/).filter((r) => /^#/.test(r)).join("\n");
    expect(cabecera).toContain("no un correo por hora");
    expect(cabecera).toContain("23 horas");
    expect(cabecera).toContain("caché de Actions");
  });

  it("la cabecera dice que el registro no lleva cifras y que una corrida a mano no usa lo avisado", () => {
    const cabecera = texto.split(/\r?\n/).filter((r) => /^#/.test(r)).join("\n");
    expect(cabecera).toContain("nunca una cifra");
    expect(cabecera).toContain("Una corrida a mano");
    expect(cabecera).not.toContain("muestra igual la línea de cifras");
  });
});

describe("vigilar-red.yml: ya no mira al portero de mainnet", () => {
  const texto = readFileSync(WORKFLOW, "utf8");

  it("no nombra la clave del portero de mainnet, ni en un paso ni en un comentario", () => {
    expect(texto).not.toContain("PORTERO_MAINNET_ADMIN_TOKEN");
  });

  it("no tiene el paso del portero de mainnet ni su revisión", () => {
    expect(texto.split(/\r?\n/).filter((r) => r.includes("name: Portero de mainnet"))).toHaveLength(0);
    expect(texto).not.toContain("vigilar-portero.mjs");
  });
});
