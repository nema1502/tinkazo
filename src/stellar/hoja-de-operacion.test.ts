import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La hoja de operación del portero de mainnet (`docs/operacion.md`) y el README del portero (`workers/patrocinio/README.md`)
 * dicen lo mismo, y lo que hace el código del portero y del sitio, en lo que se usa el día de un evento: la regla de
 * límite de Cloudflare (una sola), qué limita las consultas del cupo, qué hacer si el acceso de alguien quedó en otra
 * cuenta y cómo se arma la clave de la vigilancia por hora. Se leen los archivos tal como están escritos.
 */

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8");
const hoja = leer("docs/operacion.md");
const readme = leer("workers/patrocinio/README.md");
const porIp = leer("workers/patrocinio/src/por-ip.ts");
const rutasAltas = leer("workers/patrocinio/src/rutas-altas.ts");
const wrangler = leer("workers/patrocinio/wrangler.toml");
const flujo = leer("src/ui/cuenta-lista-flujo.ts");
const estadoDelPaso = leer("src/ui/cuenta-lista-estado.ts");
const paso = leer("src/ui/cuenta-lista.ts");
const vigilancia = leer(".github/workflows/vigilar-portero.yml");

/** Un número como se escribe en los documentos: con punto de miles (3.000). */
const conPunto = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Las consultas del cupo por dirección y por hora, en mainnet y en testnet, como las fija `cupoPorHora`. */
function cupoPorHora(): { mainnet: string; testnet: string } {
  const m = /return red === "mainnet" \? (\d+) : (\d+);/.exec(porIp);
  if (!m) throw new Error("cupoPorHora cambió de forma: actualizar esta prueba");
  return { mainnet: conPunto(Number(m[1])), testnet: conPunto(Number(m[2])) };
}

/** La sección del README sobre la regla de límite de Cloudflare. */
function seccionDeLaRegla(): string {
  const desde = readme.indexOf("## La regla de límite de Cloudflare");
  expect(desde).toBeGreaterThan(-1);
  const hasta = readme.indexOf("\n## ", desde + 1);
  return readme.slice(desde, hasta < 0 ? undefined : hasta);
}

/** La línea de un texto que dice que el cupo no pasa por la regla. */
const lineaDelCupo = (texto: string): string => texto.split("\n").find((l) => l.includes("`GET /v1/patrocinio/cupo` no pasa por")) ?? "";

describe("la regla de límite de Cloudflare delante del portero de mainnet", () => {
  it("la hoja y el README describen una sola regla: las tres rutas, los dos porteros y un solo número", () => {
    const regla = hoja.split("\n").find((l) => l.includes("**La regla de límite de Cloudflare**")) ?? "";
    for (const [nombre, texto] of [
      ["hoja", regla],
      ["README", seccionDeLaRegla()],
    ] as const) {
      expect(texto, nombre).toMatch(/una sola/);
      expect(texto, nombre).toMatch(/el plan gratis de la zona deja una/);
      expect(texto, nombre).toContain("`p.tinkazo.app`");
      expect(texto, nombre).toContain("`pm.tinkazo.app`");
      expect(texto, nombre).toContain("`POST /v1/patrocinio`");
      expect(texto, nombre).toContain("`POST /v1/alta/estado` y `POST /v1/alta/cupon`");
      expect(texto, nombre).toContain("60 pedidos en 10 segundos");
      expect(texto, nombre).toContain("10 segundos");
      // Nada que pida un umbral que la zona no deja configurar: una regla, un número.
      expect(texto, nombre).not.toMatch(/\b20 (pedidos )?en 10 segundos/);
      expect(texto, nombre).not.toMatch(/240 por hora/);
    }
    // En el README, una sola tabla de campos.
    const seccion = seccionDeLaRegla();
    expect(seccion.match(/^\| Umbral \|/gm)).toHaveLength(1);
    expect(seccion.match(/^\| Expresión \|/gm)).toHaveLength(1);
    expect(seccion.match(/^\| Acción \|/gm)).toHaveLength(1);
  });

  it("las consultas del cupo no pasan por la regla: las limita el propio portero, con el número de `cupoPorHora`", () => {
    const n = cupoPorHora();
    for (const [nombre, texto] of [
      ["hoja", hoja],
      ["README", seccionDeLaRegla()],
    ] as const) {
      const linea = lineaDelCupo(texto);
      expect(linea, nombre).not.toBe("");
      expect(linea, nombre).toContain(n.mainnet);
      expect(linea, nombre).toContain("por dirección y por hora");
    }
    expect(lineaDelCupo(readme)).toContain(n.testnet);
    // Ninguna regla de Cloudflare sugerida para el cupo.
    expect(readme).not.toMatch(/uri\.path eq "\/v1\/patrocinio\/cupo"/);
  });
});

describe("el acceso que quedó en otra cuenta", () => {
  it("la hoja dice qué mirar en el registro, con lo que anota el portero, y cómo admitir a mano", () => {
    expect(rutasAltas).toContain('this.registrar("error-alta", { motivo: "cuenta-de-otro" })');
    const durante = hoja.slice(hoja.indexOf("## Durante el evento"), hoja.indexOf("## Después del evento"));
    expect(durante).toContain('`{"evento":"error-alta","motivo":"cuenta-de-otro"}`');
    expect(durante).toMatch(/node scripts\/cupones\.mjs admitir --cuenta G\.\.\. --sorteos \d+ --dias \d+ --ref \S+/);
    expect(durante).toContain("«Dejá tu cuenta lista»");
  });

  it("el comando para mirar el registro es el completo y es el del servicio de mainnet", () => {
    const durante = hoja.slice(hoja.indexOf("## Durante el evento"), hoja.indexOf("## Después del evento"));
    // La misma versión de wrangler que en el corte (la probada), desde workers/patrocinio y con el servicio de mainnet.
    const version = /npx wrangler@(\d+\.\d+\.\d+) deploy --config wrangler\.toml --env mainnet/.exec(hoja)?.[1];
    expect(version, "el corte con wrangler cambió de forma").toBeDefined();
    expect(durante).toContain(`npx wrangler@${version} tail --config wrangler.toml --env mainnet`);
    expect(durante).toContain("desde `workers/patrocinio`");
    expect(durante).toContain("sin `--env mainnet` se mira el servicio de la red de pruebas");
    // El servicio que el panel muestra es el de [env.mainnet]; el de arriba del archivo es el de Prueba.
    expect(wrangler).toMatch(/^\[env\.mainnet\]\r?\nname = "tinkazo-patrocinio-mainnet"/m);
    expect(durante).toContain("`tinkazo-patrocinio-mainnet`");
    expect(wrangler).toMatch(/^name = "tinkazo-patrocinio"\r?$/m);
  });

  it("primero se prueba sellar; si el paso pide activar o proteger no se admite a mano; solo si faltan sorteos o acceso, sí", () => {
    const durante = hoja.slice(hoja.indexOf("## Durante el evento"), hoja.indexOf("## Después del evento"));
    const probar = durante.indexOf("**Que la persona pruebe sellar**");
    const noAdmitir = durante.indexOf("pidiendo activar o proteger la cuenta, no se admite a mano");
    const admitir = durante.indexOf("**Solo si el sello sale porque a esa cuenta no le quedan sorteos o todavía no tiene acceso**");
    expect(probar).toBeGreaterThan(-1);
    expect(noAdmitir).toBeGreaterThan(probar);
    expect(admitir).toBeGreaterThan(noAdmitir);
    // Admitir va después de las dos cosas de arriba, y una sola vez.
    const comando = durante.indexOf("node scripts/cupones.mjs admitir");
    expect(comando).toBeGreaterThan(admitir);
    expect(durante.match(/node scripts\/cupones\.mjs admitir/g)).toHaveLength(1);
    expect(durante).toContain("sigue en el modo Prueba");
    expect(durante).toContain("aparta créditos sin servir");
  });

  it("lo que dice el orden es lo que hace el sitio: el acceso en otra cuenta no tiene arreglo en el paso, y sellar no lo abre si la cuenta está lista", () => {
    // El servidor lo dice como cuenta-de-otro y el paso no ofrece más que pasar a Prueba.
    expect(paso).toContain('if (e.clave === "altaErrCuentaDeOtro") return "ninguno";');
    expect(estadoDelPaso).toMatch(/if \(arreglo === "ninguno"\) return e\.puedePasarAPrueba \? boton\("pasar-a-prueba"/);
    // Mientras falte el acceso, la parte de activar no se da por lista: el paso no se completa.
    expect(estadoDelPaso).toContain('p === "activar" ? e.activacion === "lista" && !faltaElAcceso(e)');
    // Con la cuenta activada y protegida, sellar sigue de largo: el portero mira su libro, no el paso.
    expect(flujo).toMatch(/if \(local\.activacion === "lista" && local\.proteccion === "lista"\) return true;/);
    // Y el sello de una cuenta que no está en el libro (o sin sorteos) falla en el portero.
    expect(rutasAltas).toContain("cuenta-de-otro");
  });
});

describe("la clave de la vigilancia por hora", () => {
  /** El renglón del README de la vigilancia del portero de mainnet, con sus pasos. */
  const vigilanciaReadme = (): string => {
    const desde = readme.indexOf("- **La vigilancia del portero de mainnet**");
    expect(desde).toBeGreaterThan(-1);
    const hasta = readme.indexOf("\n## ", desde);
    return readme.slice(desde, hasta < 0 ? undefined : hasta);
  };

  it("el README dice los pasos del Environment en orden, con el nombre que lee el workflow", () => {
    const nombre = /secrets\.(PORTERO_MAINNET_ADMIN_TOKEN)\b/.exec(vigilancia)?.[1];
    expect(nombre, "el workflow no lee la clave").toBeDefined();
    const texto = vigilanciaReadme();
    const crear = texto.indexOf("Crear el Environment `vigilancia`");
    const ramas = texto.indexOf("«ramas elegidas»");
    const cargar = texto.indexOf(`Cargar ahí la clave, con el nombre \`${nombre}\``);
    const borrar = texto.indexOf(`Borrar \`${nombre}\` de los secretos del repositorio`);
    expect(crear).toBeGreaterThan(-1);
    expect(ramas).toBeGreaterThan(crear);
    expect(texto.slice(ramas, cargar)).toContain("`main`");
    expect(cargar).toBeGreaterThan(ramas);
    expect(borrar).toBeGreaterThan(cargar);
    // Por qué importa cada paso.
    expect(texto).toContain("cualquier rama que nombre el Environment");
    expect(texto).toContain("cualquier workflow de cualquier rama la puede leer");
    // El workflow corre en ese Environment, y es el único que lee la clave.
    expect(vigilancia).toMatch(/^ {4}environment:\s*vigilancia\s*$/m);
  });

  it("no dice que el workflow no hace nada sin la clave en el Environment: con una copia en el repositorio, la toma de ahí", () => {
    const texto = vigilanciaReadme();
    expect(texto).not.toMatch(/mientras esa clave no esté en el Environment/);
    expect(texto).toContain("ni en el Environment ni entre los secretos del repositorio");
    expect(texto).toContain("la toma de ahí");
  });

  it("la hoja manda a esos pasos, antes del evento", () => {
    const antes = hoja.slice(hoja.indexOf("## Antes del evento"), hoja.indexOf("## Durante el evento"));
    expect(antes).toContain("`vigilar-portero.yml`");
    expect(antes).toContain("Environment `vigilancia`");
    expect(antes).toContain("`PORTERO_MAINNET_ADMIN_TOKEN`");
    expect(antes).toContain("solo `main`");
    expect(antes).toContain("sin copia entre los secretos del repositorio");
    expect(antes).toContain("workers/patrocinio/README.md");
  });
});
