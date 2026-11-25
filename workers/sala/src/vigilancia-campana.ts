/**
 * La parte de la vigilancia de firmas que vive en la sala (issue #168): cada alta nueva de campaña pasó por una sesión de
 * Google, y en la vigilancia del recinto esas altas se cuentan como activaciones explicadas. El patrón es el de
 * `workers/patrocinio/src/vigilancia.ts` (funciones puras, sin nada de la plataforma); acá lo que se guarda por día es
 * solo la cantidad: nunca el token, el id de la persona (ni su huella), la cuenta ni el nombre.
 *
 * El piso de créditos de #168 no corre acá: en la sala no existe el concepto de créditos. Quede anotado como pieza del
 * issue #182.
 */
import type { Ejecutar } from "./registro";

/** Las tablas de la vigilancia. Se crean junto con las demás de la sala de campaña. */
export function crearTablasDeVigilancia(sql: Ejecutar): void {
  sql("CREATE TABLE IF NOT EXISTS campana_activaciones (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
}

/**
 * Anota una alta nueva como activación explicada del día. Solo entra una vez por persona: el reingreso (otro celular, otra
 * pestaña) no llama al proveedor ni vuelve a explicar una firma, así que no se anota.
 *
 * Dos cuidados, porque la persona ya quedó anotada cuando esto corre. Uno: las salas creadas antes de que existiera esta
 * tabla no la tienen (las tablas se crean al crear la sala), así que se asegura acá, al usarla. Dos: el conteo es
 * vigilancia, no parte del alta, y nunca lanza: si falla, el alta sigue y se pierde solo esa cifra.
 */
export function anotarAltaDeCampana(sql: Ejecutar, dia: string): void {
  try {
    crearTablasDeVigilancia(sql);
    sql("INSERT INTO campana_activaciones (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1", dia);
  } catch (error) {
    console.log(JSON.stringify({ evento: "conteo-de-altas-fallo", motivo: error instanceof Error ? error.name : "desconocido" }));
  }
}

/** Cuántas altas de campaña explican firmas, por día. Solo cifras: ningún dato de persona. */
export function activacionesDeCampana(sql: Ejecutar): Record<string, number> {
  crearTablasDeVigilancia(sql);
  const filas = sql<{ dia: string; n: number }>("SELECT dia, n FROM campana_activaciones ORDER BY dia");
  const dias: Record<string, number> = {};
  for (const fila of filas) dias[fila.dia] = fila.n;
  return dias;
}
