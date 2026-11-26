import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { listaDeLaCampana } from "../../workers/sala/src/campana";
import {
  campanaDePrueba,
  firmarParaLaPrueba,
  montarMundo,
  sesionDePrueba,
  type MundoDeSala,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia el recorrido. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * La paridad del modo cuenta: una campaña sin el campo de identidad responde, en cada ruta, exactamente lo mismo que
 * antes de que existiera el modo de personas. El archivo `campana-paridad-cuenta.base.json` lo grabó este mismo
 * recorrido contra la sala de la rama principal, sin ningún cambio: estado, cabeceras y cuerpo en bruto de cada
 * respuesta, y lo que la sala guarda por dentro (las tablas, las claves y los valores que no dependen del azar).
 * Si una respuesta cambia, aunque sea una cabecera, esta prueba falla.
 *
 * Para volver a grabar el archivo, solo contra el código de la rama principal: `GRABAR_PARIDAD=1`.
 *
 * Cómo se comprueba de dónde sale lo grabado: se saca el código de un commit de la rama principal a una carpeta aparte
 * (`git archive <commit> src workers docs package.json tsconfig.json vite.config.ts`), se copia esta prueba a `src/sala`, se
 * enlazan las dependencias y se corre con `GRABAR_PARIDAD=1`. El archivo que sale en esa carpeta se compara con este, sin contar
 * los fines de línea. El 25 de noviembre de 2026 se regrabó así desde el estado actual de la rama principal (691885bd) y desde el
 * punto donde nació esta rama (e7ab071d): las dos veces salió igual, byte por byte, a este archivo (SHA-256
 * 6a85d381191d35a0c58ec40f48de284d2409065bc6c2b6ee17ffb2c81a1dfd9a, con fines de línea LF). Por eso no depende de esta rama.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";
const BASE = join(dirname(fileURLToPath(import.meta.url)), "campana-paridad-cuenta.base.json");

const cuentaFija = (i: number): string => Keypair.fromRawEd25519Seed(Buffer.alloc(32, i)).publicKey();

interface Persona {
  usuario: string;
  token: string;
  cuenta: string;
  llave: string;
}

/** Una persona con su sesión en el proveedor de mentira, con una cuenta y una llave siempre iguales. */
function persona(mundo: MundoDeSala, n: number, contenido: Record<string, unknown> = {}): Persona {
  const usuario = `usuario${n}`;
  const token = sesionDePrueba(usuario);
  const cuenta = cuentaFija(n);
  mundo.proveedor.sesiones.set(token, { usuario, contenido: { wallet: cuenta, ...contenido } });
  return { usuario, token, cuenta, llave: `llave${n}`.padEnd(22, "x") };
}

/** Lo que dejan escrito las respuestas: todo lo que cambia entre corridas se reemplaza por un nombre fijo. */
class Rastro {
  readonly lineas: string[] = [];
  private id = "";
  private token = "";
  private pase = "";

  conocer(datos: { id?: string; token?: string; pase?: string }): void {
    if (datos.id !== undefined) this.id = datos.id;
    if (datos.token !== undefined) this.token = datos.token;
    if (datos.pase !== undefined) this.pase = datos.pase;
  }

  private limpiar(texto: string): string {
    let salida = texto.replace(/"firma":"[^"]*"/g, '"firma":"<FIRMA>"');
    for (const [valor, nombre] of [
      [this.id, "<ID>"],
      [this.token, "<TOKEN>"],
      [this.pase, "<PASE>"],
    ] as const) {
      if (valor !== "") salida = salida.split(valor).join(nombre);
    }
    return salida;
  }

  /** Anota una respuesta con todas sus cabeceras y su cuerpo en bruto. */
  async ver(paso: string, r: Response): Promise<string> {
    const cuerpo = await r.text();
    const cabeceras = [...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    this.lineas.push(`${paso} | ${r.status} | ${JSON.stringify(cabeceras)} | ${this.limpiar(cuerpo)}`);
    return cuerpo;
  }

  nota(paso: string, valor: unknown): void {
    this.lineas.push(`${paso} | ${this.limpiar(JSON.stringify(valor))}`);
  }
}

/** Lo que la sala guarda por dentro y no depende del azar: tablas, claves y valores fijos. */
function foto(mundo: MundoDeSala, id: string): unknown {
  const sala = `sala:${id}`;
  const q = (consulta: string) => mundo.ejecutar(sala, consulta);
  return {
    tablas: q("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
    claves: q("SELECT k FROM sala ORDER BY k").map((f) => f.k),
    datos: q(
      "SELECT k, v FROM sala WHERE k IN ('fase','cierra','premios','sorteo','lista','ganadoras','comprobante'," +
        "'organizadora','ronda_sello','evento','forma','via-google','via-sin-dato') ORDER BY k",
    ),
    equipos: q("SELECT n, cuenta, d, estado, v, llave FROM equipos ORDER BY n"),
    quitadas: q("SELECT cuenta, llave, motivo FROM campana_quitadas ORDER BY cuenta"),
    avisos: q("SELECT cuenta FROM campana_avisos ORDER BY cuenta"),
    personas: q("SELECT COUNT(*) AS c FROM personas"),
    reingresos: q("SELECT hora, n FROM campana_reingresos ORDER BY hora, n"),
    rechazos: q("SELECT ventana, n FROM campana_rechazos ORDER BY ventana, n"),
    rechazosFicha: q("SELECT ventana, n FROM campana_rechazos_ficha ORDER BY ventana, n"),
    ritmo: q("SELECT ventana, altas, envios FROM ritmo ORDER BY ventana, altas, envios"),
    correos: q("SELECT k, v FROM sala WHERE k LIKE 'correo:%' OR k LIKE 'confirmo:%' ORDER BY k"),
  };
}

/** Todo el recorrido de una campaña de cuenta, ruta por ruta. Solo anota: no afirma nada, para poder grabarlo y repetirlo. */
async function recorrido(mundo: MundoDeSala, conPase: boolean): Promise<string[]> {
  const rastro = new Rastro();
  const organizadora = cuentaFija(100);
  const archivo = (cambios: Record<string, unknown> = {}) =>
    firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, { organizadora, empresa: { nombre: "Empresa de ejemplo" }, ...cambios }));

  // Crear la campaña: los rechazos antes de la buena.
  await rastro.ver("crear: cuerpo vacío", await mundo.pedir("/v1/campana", { cuerpo: {} }));
  await rastro.ver("crear: firma mala", await mundo.pedir("/v1/campana", { cuerpo: { texto: archivo().texto, firma: "AAAA" } }));
  await rastro.ver("crear: vencida", await mundo.pedir("/v1/campana", { cuerpo: archivo({ cierra_ms: AHORA - 1 }) }));
  await rastro.ver("crear: sin premios", await mundo.pedir("/v1/campana", { cuerpo: archivo({ premios: [] }) }));
  await rastro.ver("crear: GET", await mundo.pedir("/v1/campana", { metodo: "GET" }));
  const buena = await mundo.pedir("/v1/campana", { cuerpo: archivo() });
  const creada = (await buena.clone().json()) as { id: string; token: string };
  // El id y el token cambian en cada corrida: se conocen antes de anotar la respuesta para que salgan con un nombre fijo.
  rastro.conocer({ id: creada.id, token: creada.token });
  await rastro.ver("crear: buena", buena);
  await rastro.ver("crear: repetida", await mundo.pedir("/v1/campana", { cuerpo: archivo() }));
  const id = creada.id;
  const auth = { Authorization: `Bearer ${creada.token}` };
  const sala = (resto: string): string => `/v1/sala/${id}${resto}`;

  // Lo público y los cambios de fase.
  await rastro.ver("archivo", await mundo.pedir(sala("/campana")));
  await rastro.ver("estado en lista", await mundo.pedir(sala("/campana/estado")));
  await rastro.ver("estado con token", await mundo.pedir(sala("/campana/estado"), { cabeceras: auth }));
  await rastro.ver("estado de una sala que no existe", await mundo.pedir("/v1/sala/inexistente/campana/estado"));
  await rastro.ver("fase: sin token", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" } }));
  await rastro.ver("fase: fase rara", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "x" }, cabeceras: auth }));
  await rastro.ver("fase: cierre torcido", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta", cierraMs: "x" }, cabeceras: auth }));
  await rastro.ver("fase: sellar sin sorteo", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "sellada" }, cabeceras: auth }));
  await rastro.ver("fase: cerrar desde lista", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth }));
  await rastro.ver("fase: cierre en el pasado", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta", cierraMs: AHORA }, cabeceras: auth }));
  await rastro.ver("alta con la lista sin abrir", await mundo.pedir(sala("/campana/alta"), { cuerpo: { token: persona(mundo, 90).token, d: "A".repeat(60), llave: persona(mundo, 90).llave } }));
  await rastro.ver("fase: abrir", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth }));
  await rastro.ver("fase: correr el cierre", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta", cierraMs: AHORA + 7_200_000 }, cabeceras: auth }));

  // El pase.
  await rastro.ver("pase: sin token", await mundo.pedir(sala("/campana/pase")));
  const pedidoPase = await mundo.pedir(sala("/campana/pase"), { cabeceras: auth });
  const pase = (JSON.parse(await pedidoPase.clone().text()) as { p: string }).p;
  rastro.conocer({ pase });
  await rastro.ver("pase: con token", pedidoPase);
  await rastro.ver("estado con pase", await mundo.pedir(sala(`/campana/estado?p=${pase}`)));
  await rastro.ver("estado con pase torcido", await mundo.pedir(sala("/campana/estado?p=corto")));

  const conIp = (ip: string) => ({ "CF-Connecting-IP": ip });
  const alta = (paso: string, cuerpo: Record<string, unknown>, ip = "190.129.10.20", origen?: string) =>
    mundo.pedir(sala("/campana/alta"), {
      cuerpo,
      cabeceras: { ...conIp(ip), ...(origen === undefined ? {} : { Origin: origen }) },
    }).then((r) => rastro.ver(paso, r));
  const celular = (p: Persona, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    token: p.token,
    d: "A".repeat(60),
    llave: p.llave,
    ...(conPase ? { p: pase } : {}),
    ...extra,
  });

  // El alta: cada forma de rechazo y cada forma de aceptación.
  const [ana, nora, beto, dora, eli] = [1, 2, 3, 4, 5].map((n) => persona(mundo, n)) as [Persona, Persona, Persona, Persona, Persona];
  await alta("alta: cuerpo vacío", {});
  await alta("alta: token sin forma", celular(ana, { token: "no" }));
  await alta("alta: nombre sin forma", celular(ana, { d: "corto" }));
  await alta("alta: llave sin forma", celular(ana, { llave: "corta" }));
  await alta("alta: pase sin forma", celular(ana, { p: "no vale!" }));
  await alta("alta: origen ajeno", celular(ana), "190.129.10.20", "https://otro.example.org");
  if (conPase) {
    await alta("alta: sin pase", { token: ana.token, d: "A".repeat(60), llave: ana.llave });
    await alta("alta: pase de otra sala", celular(ana, { p: "AAAAAAAAAAAA" }));
  }
  await alta("alta: sesión desconocida", celular(persona(mundo, 91), { token: sesionDePrueba("nadie") }));
  await alta("alta: ana", celular(ana));
  await alta("alta: ana otra vez", celular(ana));
  await alta("alta: ana desde otro celular", celular(ana, { llave: "otro-celular".padEnd(22, "x") }));
  await alta("alta: ana desde otro celular con nombre nuevo", celular(ana, { llave: "otro-celular".padEnd(22, "x"), d: "B".repeat(60) }));
  await alta("alta: nora", celular(nora));
  await alta("alta: beto", celular(beto));
  await alta("alta: otra vía", celular(persona(mundo, 6, { authProvider: "email" })));
  await alta("alta: sin dato de vía", celular(persona(mundo, 7, { authProvider: undefined })));
  await alta("alta: sesión sin cuenta", celular(persona(mundo, 8, { wallet: null })));
  mundo.proveedor.billeteras.set("usuario9", cuentaFija(9));
  await alta("alta: sesión sin cuenta que el proveedor sí conoce", celular(persona(mundo, 9, { wallet: null })));
  await alta("alta: sesión de otra app", celular(persona(mundo, 10, { applicationId: "otra-app" })));
  for (let i = 0; i < 7; i++) await alta(`alta: ficha mala ${i}`, celular(persona(mundo, 92), { token: sesionDePrueba("mala") }), "190.129.10.21");
  mundo.proveedor.caido = true;
  await alta("alta: proveedor caído", celular(persona(mundo, 11)));
  mundo.proveedor.caido = false;
  await alta("alta: dora", celular(dora));
  await alta("alta: eli", celular(eli));
  rastro.nota("foto tras las altas", foto(mundo, id));

  // La consulta propia.
  const yo = (paso: string, cuerpo: unknown) => mundo.pedir(sala("/campana/yo"), { cuerpo }).then((r) => rastro.ver(paso, r));
  await yo("yo: ana", { cuenta: ana.cuenta, llave: "otro-celular".padEnd(22, "x") });
  await yo("yo: ana con la llave de antes", { cuenta: ana.cuenta, llave: ana.llave });
  await yo("yo: nora", { cuenta: nora.cuenta, llave: nora.llave });
  await yo("yo: sin cuenta", { llave: nora.llave });
  await yo("yo: cuenta torcida", { cuenta: "G123", llave: nora.llave });
  await yo("yo: llave torcida", { cuenta: nora.cuenta, llave: "corta" });
  await yo("yo: cuerpo sin forma", null);
  await yo("yo: marca de correo", { cuenta: nora.cuenta, llave: nora.llave, c: true });
  await yo("yo: marca de correo torcida", { cuenta: nora.cuenta, llave: nora.llave, c: "si" });
  await rastro.ver("yo: sala inexistente", await mundo.pedir("/v1/sala/inexistente/campana/yo", { cuerpo: { cuenta: nora.cuenta, llave: nora.llave } }));

  // Lo que ve quien organiza y lo que la campaña cierra a los demás.
  await rastro.ver("anotadas: sin token", await mundo.pedir(sala("/equipos?desde=0")));
  await rastro.ver("anotadas: con token", await mundo.pedir(sala("/equipos?desde=0"), { cabeceras: auth }));
  await rastro.ver("anotadas: una sola", await mundo.pedir(sala("/equipos?desde=5"), { cabeceras: auth }));
  await rastro.ver("equipo por cuenta", await mundo.pedir(sala(`/equipos/${nora.cuenta}`)));
  await rastro.ver("registro de equipos: alta", await mundo.pedir(sala("/equipos"), { cuerpo: { cuenta: nora.cuenta, d: "A".repeat(60), llave: nora.llave } }));
  await rastro.ver("registro de equipos: config", await mundo.pedir(sala("/config"), { metodo: "PUT", cuerpo: { modo: "cupon", evento: "feria-del-libro", cuenta: organizadora }, cabeceras: auth }));
  await rastro.ver("registro de equipos: público", await mundo.pedir(sala("/publico")));
  await rastro.ver("nombres: alta", await mundo.pedir(sala(""), { cuerpo: { d: "A".repeat(40), h: "a".repeat(32), llave: "z".repeat(22) } }));
  await rastro.ver("nombres: lectura", await mundo.pedir(sala("/nombres?desde=0"), { cabeceras: auth }));
  await rastro.ver("página del celular", await mundo.pedir(`/${id}`));

  // Quitar.
  const quitar = (paso: string, cuerpo: unknown, cabeceras: Record<string, string> = auth) =>
    mundo.pedir(sala("/campana/quitar"), { cuerpo, cabeceras }).then((r) => rastro.ver(paso, r));
  await quitar("quitar: sin token", { n: 1, motivo: "otro" }, {});
  await quitar("quitar: motivo torcido", { n: 1, motivo: "xx" });
  await quitar("quitar: número torcido", { n: 0, motivo: "otro" });
  await quitar("quitar: quien no está", { n: 99, motivo: "otro" });
  await quitar("quitar: beto", { n: 3, motivo: "repetida" });
  await quitar("quitar: beto otra vez", { n: 3, motivo: "repetida" });
  await alta("alta: beto después de salir", celular(beto));
  await yo("yo: beto después de salir", { cuenta: beto.cuenta, llave: beto.llave });
  await rastro.ver("estado con una quitada", await mundo.pedir(sala("/campana/estado"), { cabeceras: auth }));

  // Cerrar y sellar.
  await rastro.ver("fase: cerrar", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth }));
  await alta("alta: con la lista cerrada", celular(persona(mundo, 12)));
  // La cuarta fila es la de la sesión sin cuenta que el proveedor sí conocía: queda afuera y la lista es la de cuatro.
  await quitar("quitar: con la lista cerrada", { n: 4, motivo: "otro" });
  await rastro.ver("fase: reabrir", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta", cierraMs: AHORA + 7_200_000 }, cabeceras: auth }));
  await alta("alta: eli reabierta", celular(eli));
  await rastro.ver("fase: cerrar de nuevo", await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth }));

  const orden = listaDeLaCampana([ana.cuenta, nora.cuenta, dora.cuenta, eli.cuenta]);
  const sello = {
    listHash: Buffer.from(listHash(orden)).toString("hex"),
    count: orden.length,
    numWinners: 2,
    sorteado: false,
    organizador: organizadora,
    ronda: RONDA,
  };
  const sellar = (paso: string, cuerpo: unknown, cabeceras: Record<string, string> = auth) =>
    mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo, cabeceras }).then((r) => rastro.ver(paso, r));
  lectura.valor = "red";
  await sellar("sellar: sin red", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello: null, ganadores: null };
  await sellar("sellar: sin sorteo en la red", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello: { ...sello, listHash: "00".repeat(32) }, ganadores: null };
  await sellar("sellar: lista distinta", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello: { ...sello, numWinners: 3 }, ganadores: null };
  await sellar("sellar: ganadores distintos", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello: { ...sello, organizador: cuentaFija(101) }, ganadores: null };
  await sellar("sellar: otra organizadora", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [0] };
  await sellar("sellar: ya sorteado", { fase: "sellada", sorteo: SORTEO });
  lectura.valor = { sello, ganadores: null };
  await sellar("sellar: sin token", { fase: "sellada", sorteo: SORTEO }, {});
  await sellar("sellar: sorteo torcido", { fase: "sellada", sorteo: "abc" });
  await sellar("sellar: bien", { fase: "sellada", sorteo: SORTEO });
  await sellar("sellar: otra vez", { fase: "sellada", sorteo: SORTEO });
  await alta("alta: con la lista sellada", celular(persona(mundo, 13)));
  await quitar("quitar: con la lista sellada", { n: 2, motivo: "otro" });
  await rastro.ver("estado sellada", await mundo.pedir(sala("/campana/estado")));
  await yo("yo: sellada", { cuenta: ana.cuenta, llave: "otro-celular".padEnd(22, "x") });
  rastro.nota("foto tras sellar", foto(mundo, id));

  // El resultado.
  const resultado = (paso: string, cuerpo: unknown, cabeceras: Record<string, string> = auth) =>
    mundo.pedir(sala("/campana/resultado"), { metodo: "PUT", cuerpo, cabeceras }).then((r) => rastro.ver(paso, r));
  await rastro.ver("resultado: antes", await mundo.pedir(sala("/campana/resultado")));
  await resultado("resultado: cuerpo torcido", { sorteo: SORTEO, comprobante: "otro" });
  await resultado("resultado: sin token", { sorteo: SORTEO, comprobante: COMPROBANTE }, {});
  lectura.valor = "red";
  await resultado("resultado: sin red", { sorteo: SORTEO, comprobante: COMPROBANTE });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: null };
  await resultado("resultado: sin sorteo", { sorteo: SORTEO, comprobante: COMPROBANTE });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [1] };
  await resultado("resultado: de menos", { sorteo: SORTEO, comprobante: COMPROBANTE });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [9, 0] };
  await resultado("resultado: fuera de la lista", { sorteo: SORTEO, comprobante: COMPROBANTE });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
  await resultado("resultado: bien", { sorteo: SORTEO, comprobante: COMPROBANTE });
  await resultado("resultado: otra vez", { sorteo: SORTEO, comprobante: COMPROBANTE });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [0, 2] };
  await resultado("resultado: otro distinto", { sorteo: SORTEO, comprobante: COMPROBANTE });
  await rastro.ver("resultado: público", await mundo.pedir(sala("/campana/resultado")));
  await rastro.ver("estado sorteada", await mundo.pedir(sala("/campana/estado")));

  const ganadoras = [orden[2], orden[0]];
  const porCuenta = new Map([ana, nora, dora, eli].map((p) => [p.cuenta, p]));
  for (const cuenta of orden) {
    const p = porCuenta.get(cuenta) as Persona;
    await yo(`yo: ${p.usuario} sorteada`, { cuenta: p.cuenta, llave: p.usuario === "usuario1" ? "otro-celular".padEnd(22, "x") : p.llave });
  }

  // Avisar a quien ganó.
  const avisar = (paso: string, cuerpo: unknown, cabeceras: Record<string, string> = auth) =>
    mundo.pedir(sala("/campana/avisar"), { cuerpo, cabeceras }).then((r) => rastro.ver(paso, r));
  await avisar("avisar: sin token", { cuenta: ganadoras[0] }, {});
  await avisar("avisar: cuenta torcida", { cuenta: "G123" });
  await avisar("avisar: sin cuenta", {});
  await avisar("avisar: quien no ganó", { cuenta: orden[1] });
  await avisar("avisar: ganadora", { cuenta: ganadoras[0] });
  await avisar("avisar: otra vez", { cuenta: ganadoras[0] });
  for (const cuenta of orden) {
    const p = porCuenta.get(cuenta) as Persona;
    await yo(`yo: ${p.usuario} avisada`, { cuenta: p.cuenta, llave: p.usuario === "usuario1" ? "otro-celular".padEnd(22, "x") : p.llave });
  }
  rastro.nota("foto final", foto(mundo, id));

  // Cerrar la sala.
  await rastro.ver("cerrar: sin token", await mundo.pedir(sala(""), { metodo: "DELETE" }));
  await rastro.ver("cerrar: con token", await mundo.pedir(sala(""), { metodo: "DELETE", cabeceras: auth }));
  await rastro.ver("después de cerrar: estado", await mundo.pedir(sala("/campana/estado")));
  await rastro.ver("después de cerrar: alta", await mundo.pedir(sala("/campana/alta"), { cuerpo: celular(persona(mundo, 14)) }));
  await rastro.ver("después de cerrar: yo", await mundo.pedir(sala("/campana/yo"), { cuerpo: { cuenta: ana.cuenta, llave: ana.llave } }));
  return rastro.lineas;
}

/** El aviso por correo con el Worker entero: a quién se busca y qué se manda, sin guardar nada de la persona. */
async function recorridoDelCorreo(mundo: MundoDeSala): Promise<string[]> {
  const rastro = new Rastro();
  const enviados: { to: string; subject: string }[] = [];
  mundo.env.CORREO = { send: async (m: { to: string; subject: string }) => (enviados.push({ to: m.to, subject: m.subject }), { messageId: "m1" }) };
  const sala0 = await mundo.pedir("/v1/campana", {
    cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, { empresa: { nombre: "Empresa de ejemplo" } })),
  });
  const { id, token } = (await sala0.json()) as { id: string; token: string };
  rastro.conocer({ id, token });
  const auth = { Authorization: `Bearer ${token}` };
  const sala = (resto: string): string => `/v1/sala/${id}${resto}`;
  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth });
  const gente = [1, 2, 3].map((n) => persona(mundo, n));
  for (const p of gente) {
    await mundo.pedir(sala("/campana/alta"), { cuerpo: { token: p.token, d: "A".repeat(60), llave: p.llave } });
    mundo.proveedor.usuarios.set(p.cuenta, [
      { id: p.usuario, first_name: "Ana", last_name: "Quispe", email: `${p.usuario}@example.org`, wallet_public_key: p.cuenta, providers: ["GOOGLE"] },
    ]);
  }
  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth });
  const orden = listaDeLaCampana(gente.map((p) => p.cuenta));
  const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
  lectura.valor = { sello, ganadores: null };
  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "sellada", sorteo: SORTEO }, cabeceras: auth });
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
  await rastro.ver("correo: resultado", await mundo.pedir(sala("/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth }));
  await mundo.esperarSegundoPlano();
  rastro.nota("correo: búsquedas", [...mundo.proveedor.busquedas].sort());
  rastro.nota("correo: enviados", enviados.map((m) => ({ to: m.to, subject: m.subject })).sort((a, b) => (a.to < b.to ? -1 : 1)));
  rastro.nota("correo: marcas", foto(mundo, id));
  await rastro.ver("correo: yo", await mundo.pedir(sala("/campana/yo"), { cuerpo: { cuenta: orden[2], llave: gente.find((p) => p.cuenta === orden[2])?.llave } }));
  return rastro.lineas;
}

describe("el modo cuenta responde igual que la rama principal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function correr(): Promise<Record<string, string[]>> {
    const sinPase = await recorrido(await montarMundo(), false);
    const conPase = await recorrido(await montarMundo({ PASE: "1" }), true);
    const correo = await recorridoDelCorreo(await montarMundo({ CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" }));
    return { sinPase, conPase, correo };
  }

  it("cada ruta de una campaña sin el campo responde lo mismo, con sus cabeceras y su cuerpo", async () => {
    const ahora = await correr();
    if (process.env.GRABAR_PARIDAD === "1") {
      writeFileSync(BASE, `${JSON.stringify(ahora, null, 1)}\n`);
      return;
    }
    if (!existsSync(BASE)) {
      // Sin el archivo grabado se deja el recorrido en el registro, en trozos, para poder grabarlo desde la revisión automática.
      const crudo = Buffer.from(JSON.stringify(ahora)).toString("base64");
      for (let i = 0; i * 900 < crudo.length; i++) console.log(`PARIDAD64 ${String(i).padStart(5, "0")} ${crudo.slice(i * 900, (i + 1) * 900)}`);
    }
    expect(existsSync(BASE), "falta el archivo grabado con la rama principal").toBe(true);
    const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, string[]>;
    for (const recorrida of Object.keys(base)) {
      const antes = base[recorrida] as string[];
      const ahoraDe = ahora[recorrida] ?? [];
      expect(ahoraDe.length, `${recorrida}: cantidad de pasos`).toBe(antes.length);
      antes.forEach((linea, i) => expect(ahoraDe[i], `${recorrida}, paso ${i}`).toBe(linea));
    }
    expect(Object.keys(ahora).sort()).toEqual(Object.keys(base).sort());
  }, 120_000);

  it("con los interruptores de personas prendidos, que es como queda producción, una campaña de cuentas responde lo mismo", async () => {
    if (process.env.GRABAR_PARIDAD === "1") return;
    const prendidos = { DIFERIDA: "1", GOOGLE_CLIENT_ID: "cliente-de-prueba.apps.example.org" };
    const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, string[]>;
    const ahora: Record<string, string[]> = {
      sinPase: await recorrido(await montarMundo(prendidos), false),
      conPase: await recorrido(await montarMundo({ ...prendidos, PASE: "1" }), true),
      correo: await recorridoDelCorreo(await montarMundo({ ...prendidos, CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" })),
    };
    for (const recorrida of Object.keys(base)) {
      const antes = base[recorrida] as string[];
      const ahoraDe = ahora[recorrida] ?? [];
      expect(ahoraDe.length, `${recorrida}: cantidad de pasos`).toBe(antes.length);
      antes.forEach((linea, i) => expect(ahoraDe[i], `${recorrida}, paso ${i}`).toBe(linea));
    }
  }, 120_000);

  it("el recorrido grabado tiene de verdad respuestas de todas las rutas", () => {
    if (process.env.GRABAR_PARIDAD === "1") return;
    const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, string[]>;
    const todo = Object.values(base).flat().join("\n");
    for (const paso of ["alta: ana |", "yo: nora |", "quitar: beto |", "sellar: bien |", "resultado: bien |", "avisar: ganadora |", "estado sorteada |"]) {
      expect(todo, paso).toContain(paso);
    }
  });
});
