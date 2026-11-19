import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { montarPagos } from "./cobros-prueba";
import { ComprasQr } from "./compras";
import { type Env, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { AVISO_ESPERA_MS } from "./rutas-altas";
import { sqlDePrueba } from "./sqlite-prueba";

/**
 * Un aviso de carga por vez. Dos equipos de la misma persona (o dos pestañas sin un candado en común) que avisan juntos
 * crearían dos órdenes de carga y dos QR vivos. El portero guarda la hora del último aviso que dio el sí y, a menos de
 * 3 minutos de ese, contesta `409 cargando {permiso, reintentarEn}`: el sitio no crea otra orden de carga. El primer
 * aviso (`cargada`) sigue siendo el de la carga: el recargo, la reserva y los 30 minutos para anular cuentan desde ahí.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5" };
const montar = () => montarPagos(ABIERTA);
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

describe("el aviso de carga, de a uno", () => {
  it("el segundo aviso a menos de 3 minutos da 409 cargando; a los 3 minutos justos, otro sí, y la ventana cuenta desde ese", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    const primero = await m.cargar(ana.token, "alta");
    expect(primero).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "alta", cargada: true } } });
    const t0 = m.hora();
    const { permiso } = primero.cuerpo as { permiso: unknown };
    m.mover(60_000);
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "cargando", permiso, reintentarEn: t0 + AVISO_ESPERA_MS } });
    m.mover(AVISO_ESPERA_MS - 60_000 - 1);
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "cargando", reintentarEn: t0 + AVISO_ESPERA_MS } });
    // Los 409 no corren la ventana: a los 3 minutos justos del último sí, otro sí, igual al primero.
    m.mover(1);
    expect(await m.cargar(ana.token, "alta")).toEqual(primero);
    const t1 = m.hora();
    m.mover(60_000);
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "cargando", reintentarEn: t1 + AVISO_ESPERA_MS } });
    // El primer aviso sigue siendo el de la carga; el último queda aparte.
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ cargada: t0, avisada: t1 });
    expect(m.anotado.filter(([e]) => e === "compra-cargada")).toHaveLength(1);
    expect(JSON.stringify(m.anotado)).not.toContain("usr_ana");
  });

  it("dos equipos a la vez sin un candado en común: uno recibe el sí y el otro 409 cargando, así hay una sola orden de carga", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    const respuestas = await Promise.all([m.cargar(ana.token, "alta"), m.cargar(ana.token, "alta")]);
    expect(respuestas.map((r) => r.estado).sort()).toEqual([200, 409]);
    expect(respuestas.find((r) => r.estado === 409)?.cuerpo).toMatchObject({ motivo: "cargando", permiso: { producto: "alta", cargada: true } });
    expect(m.anotado.filter(([e]) => e === "compra-cargada")).toHaveLength(1);
  });

  it("lo de la compra va antes: dentro de los 3 minutos, otro producto sigue dando compra-en-curso y uno mal escrito, 400", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(await m.cargar(ana.token, "p10")).toMatchObject({ estado: 409, cuerpo: { motivo: "compra-en-curso" } });
    expect(await m.cargar(ana.token, "x")).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
  });

  it("una compra cargada por la versión anterior, sin la hora del último aviso, cuenta desde el primero", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    const t0 = m.hora();
    // Como la deja la versión anterior: con la carga anotada y sin el último aviso.
    m.sql.exec("UPDATE compras_qr SET avisada = NULL");
    m.mover(60_000);
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "cargando", reintentarEn: t0 + AVISO_ESPERA_MS } });
    m.mover(AVISO_ESPERA_MS);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ cargada: t0, avisada: m.hora() });
  });
});

describe("la hora del último aviso sobre los datos de un portero desplegado", () => {
  const T = Date.UTC(2026, 10, 14, 12, 0, 0);
  const CREAR_ANTES =
    "CREATE TABLE compras_qr (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, producto TEXT NOT NULL, creada INTEGER NOT NULL, desde INTEGER NOT NULL, reserva INTEGER NOT NULL, recargo INTEGER NOT NULL, primera INTEGER NOT NULL, nueva INTEGER NOT NULL, cargada INTEGER, cerrada INTEGER, motivo TEXT)";
  const DAR_ANTES = "INSERT INTO compras_qr (usuario, producto, creada, desde, reserva, recargo, primera, nueva, cargada, cerrada, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)";
  const CARGAR_ANTES = "UPDATE compras_qr SET cargada = ? WHERE id = ? AND cargada IS NULL";

  it("la columna se suma sin tocar las compras, correr dos veces no rompe, y la versión anterior sigue escribiendo y leyendo", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(CREAR_ANTES);
    db.prepare(DAR_ANTES).run("usr_ana", "alta", T, T, 530, 42_500_000, 1, 1);
    db.prepare(CARGAR_ANTES).run(T, 1);
    const sql = sqlDePrueba(db);
    new Cupos(sql);
    new Cupos(sql);
    expect(sql.exec("PRAGMA table_info(compras_qr)").toArray().map((f) => String(f.name))).toEqual([
      "id",
      "usuario",
      "producto",
      "creada",
      "desde",
      "reserva",
      "recargo",
      "primera",
      "nueva",
      "cargada",
      "cerrada",
      "motivo",
      "avisada",
    ]);
    const compras = new ComprasQr(sql, leerConfig({ RED: "mainnet" }));
    expect(compras.porId(1)).toMatchObject({ cargada: T, avisada: null });
    // La versión anterior, después de volver atrás: da y carga nombrando sus columnas, y lee con SELECT *.
    db.prepare(DAR_ANTES).run("usr_beto", "p10", T, T, 810, 42_500_000, 1, 1);
    db.prepare(CARGAR_ANTES).run(T + 1, 2);
    expect(sql.exec("SELECT * FROM compras_qr ORDER BY id").toArray()).toHaveLength(2);
    expect(compras.porId(2)).toMatchObject({ cargada: T + 1, avisada: null });
    // Y la nueva sobre esa fila: el primer aviso queda, el último se anota.
    compras.marcarCargada(2, T + 5);
    expect(compras.porId(2)).toMatchObject({ cargada: T + 1, avisada: T + 5 });
  });
});
