/**
 * Un SQLite de prueba con la forma de `ctx.storage.sql` de un Durable Object, hecho con
 * `node:sqlite`. Así las pruebas de unidad corren el SQL de verdad, sin red ni workerd.
 * No entra en el Worker.
 */
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "./cupos";

export function sqlDePrueba(db: DatabaseSync = new DatabaseSync(":memory:")): Sql & { db: DatabaseSync } {
  return {
    db,
    exec(consulta, ...enlaces) {
      const st = db.prepare(consulta);
      const filas = /^\s*(select|with)/i.test(consulta) ? (st.all(...(enlaces as never[])) as Array<Record<string, unknown>>) : (st.run(...(enlaces as never[])), []);
      return { toArray: () => filas };
    },
  };
}
