/**
 * La foto de hoy de las campañas de cuentas: lo que hacen, paso por paso, antes de que existan las campañas de personas.
 * Las pruebas de la foto anotan un recorrido en líneas de texto y lo comparan, línea por línea, con un archivo grabado. Si
 * algo de una campaña de cuentas cambia, aunque sea una coma, la comparación falla y dice cuál es la línea.
 *
 * Solo lo usan las pruebas. Para volver a grabar un archivo, solo contra el código de antes del cambio: `GRABAR_FOTO=1`.
 * Sin el archivo, la prueba deja el recorrido en el registro, en trozos de texto con prefijo `FOTO64`, para poder grabarlo
 * desde la revisión automática, y falla.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect } from "vitest";

/** El recorrido de una prueba: cada clave es una escena y sus líneas son lo que pasó, en orden. */
export type Foto = Record<string, string[]>;

/** Las tablas de textos: sección, clave y valor. */
export type FotoDeTextos = Record<string, Record<string, string>>;

const grabando = (): boolean => process.env.GRABAR_FOTO === "1";

/** Deja lo que se iba a grabar en el registro, en trozos, cuando todavía no hay archivo. */
function dejarEnElRegistro(nombre: string, contenido: unknown): void {
  const crudo = Buffer.from(JSON.stringify(contenido)).toString("base64");
  for (let i = 0; i * 900 < crudo.length; i++) {
    console.log(`FOTO64 ${nombre} ${String(i).padStart(5, "0")} ${crudo.slice(i * 900, (i + 1) * 900)}`);
  }
}

/** Compara un recorrido con su archivo, línea por línea y con las mismas escenas. */
export function compararConLaFoto(archivo: string, nombre: string, ahora: Foto): void {
  if (grabando()) {
    writeFileSync(archivo, `${JSON.stringify(ahora, null, 1)}\n`);
    return;
  }
  if (!existsSync(archivo)) dejarEnElRegistro(nombre, ahora);
  expect(existsSync(archivo), `falta el archivo de la foto ${nombre}`).toBe(true);
  const base = JSON.parse(readFileSync(archivo, "utf8")) as Foto;
  for (const escena of Object.keys(base)) {
    const antes = base[escena] ?? [];
    const ahoraDe = ahora[escena] ?? [];
    expect(ahoraDe.length, `${nombre}, ${escena}: cantidad de líneas`).toBe(antes.length);
    antes.forEach((linea, i) => expect(ahoraDe[i], `${nombre}, ${escena}, línea ${i}`).toBe(linea));
  }
  expect(Object.keys(ahora).sort(), `${nombre}: escenas`).toEqual(Object.keys(base).sort());
}

/**
 * Compara tablas de textos con su archivo. Cada clave de la foto tiene que seguir con el mismo valor. Una clave nueva es
 * bienvenida: lo que no puede pasar es que una de hoy desaparezca o cambie.
 */
export function compararTextosConLaFoto(archivo: string, nombre: string, ahora: FotoDeTextos): void {
  if (grabando()) {
    writeFileSync(archivo, `${JSON.stringify(ahora, null, 1)}\n`);
    return;
  }
  if (!existsSync(archivo)) dejarEnElRegistro(nombre, ahora);
  expect(existsSync(archivo), `falta el archivo de la foto ${nombre}`).toBe(true);
  const base = JSON.parse(readFileSync(archivo, "utf8")) as FotoDeTextos;
  for (const [seccion, claves] of Object.entries(base)) {
    for (const [clave, valor] of Object.entries(claves)) {
      expect(ahora[seccion]?.[clave], `${nombre}, ${seccion}.${clave}`).toBe(valor);
    }
  }
}
