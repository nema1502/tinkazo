/**
 * Un SQLite de prueba con la forma de `ctx.storage.sql` de un Durable Object, hecho con
 * `node:sqlite`. Así las pruebas de unidad corren el SQL de verdad, sin red ni workerd.
 * No entra en el Worker.
 *
 * `transaccion` hace lo que `ctx.storage.transactionSync` en el objeto: todo o nada, y una
 * adentro de otra se deshace con la de afuera (con puntos de guardado).
 */
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "./cupos";

export function sqlDePrueba(db: DatabaseSync = new DatabaseSync(":memory:")): Sql & { db: DatabaseSync } {
  let profundidad = 0;
  return {
    db,
    exec(consulta, ...enlaces) {
      const st = db.prepare(consulta);
      const filas = /^\s*(select|with|pragma)/i.test(consulta) ? (st.all(...(enlaces as never[])) as Array<Record<string, unknown>>) : (st.run(...(enlaces as never[])), []);
      return { toArray: () => filas };
    },
    transaccion<T>(fn: () => T): T {
      const punto = `t${++profundidad}`;
      db.exec(`SAVEPOINT ${punto}`);
      try {
        const v = fn();
        db.exec(`RELEASE ${punto}`);
        return v;
      } catch (e) {
        db.exec(`ROLLBACK TO ${punto}`);
        db.exec(`RELEASE ${punto}`);
        throw e;
      } finally {
        profundidad--;
      }
    },
  };
}

/**
 * El mismo SQLite de prueba, donde toda consulta que cumpla `falla` lanza como lo haría una base llena o rota. Sirve para ver
 * que lo que se crea o se escribe al arrancar no tumba al objeto. Cambia `exec` del `sql` que recibe y lo devuelve.
 */
export function sqlQueFallaEn(falla: RegExp, sql: ReturnType<typeof sqlDePrueba> = sqlDePrueba()): ReturnType<typeof sqlDePrueba> {
  const exec = sql.exec;
  sql.exec = (consulta, ...enlaces) => {
    if (falla.test(consulta)) {
      throw new Error("SQLITE_FULL: database or disk is full");
    }
    return exec(consulta, ...enlaces);
  };
  return sql;
}
