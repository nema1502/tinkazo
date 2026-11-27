import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterAll, describe, expect, it } from "vitest";
import { leerCampanaFirmada } from "../../workers/sala/src/campana";
import { verificarFirma } from "../../workers/sala/src/firma";
import { validarCampanaParaElFirmador, validarCampanaParaFirmar } from "./validar-campana";

const modulo = (await import(
  /* @vite-ignore */ new URL("../../scripts/campana-firmar.mjs", import.meta.url).href
)) as unknown as {
  firmarCampana: (
    secretoHex: string,
    textoCrudo: string,
    ahora: number,
    validar: typeof validarCampanaParaFirmar | undefined,
    opciones?: { conComision?: boolean },
  ) => { texto: string; firma: string };
  dentroDe: (ruta: string, carpeta: string) => boolean;
  llaveFueraDelRepositorio: (destino: string, raices?: string[]) => void;
  firmadaFueraDelRepositorio: (destino: string, raices?: string[]) => void;
  raicesDelRepositorio: (raiz?: string) => string[];
};
const { firmarCampana, dentroDe, llaveFueraDelRepositorio, firmadaFueraDelRepositorio, raicesDelRepositorio } = modulo;
const secreto = ed25519.utils.randomSecretKey();
const secretoHex = Buffer.from(secreto).toString("hex");
const publicaHex = Buffer.from(ed25519.getPublicKey(secreto)).toString("hex");
const AHORA = 1_800_000_000_000;

/** Una campaña completa, como la lee el sitio: la sala y la pantalla la aceptan. */
function completa(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    evento: "feria-del-libro",
    red: "testnet",
    estado: "abierta",
    empresa: { nombre: "Empresa de ejemplo", logo: null, color: "verde" },
    lugar: { es: "Evento de ejemplo", en: "Sample event" },
    zona: "America/La_Paz",
    premios: ["400000000", "200000000"],
    abre_ms: AHORA - 3_600_000,
    cierra_ms: AHORA + 3_600_000,
    sorteo_ms: AHORA + 7_200_000,
    recibir_hasta_ms: AHORA + 30 * 86_400_000,
    entrada: "google",
    pasos: [
      {
        tipo: "instagram",
        url: "https://www.instagram.com/ejemplo",
        texto: { es: "Seguí a {empresa}", en: "Follow {empresa}" },
      },
    ],
    bases: { es: "Participar es gratis.", en: "Taking part is free." },
    anotadas: 0,
    contrato: null,
    promo: null,
    comprobante: null,
    ...cambios,
  };
}

const cruda = (cambios: Record<string, unknown> = {}): string => JSON.stringify(completa(cambios), null, 2);
const firmar = (cambios: Record<string, unknown> = {}) =>
  firmarCampana(secretoHex, cruda(cambios), AHORA, validarCampanaParaFirmar);

describe("el script que firma campañas", () => {
  it("lo que firma lo acepta la verificación con la llave pública y la lectura de la sala", () => {
    const firmada = firmar();
    expect(firmada.texto).toBe(JSON.stringify(JSON.parse(cruda())));
    expect(verificarFirma(firmada.texto, firmada.firma, publicaHex)).toBe(true);
    expect(leerCampanaFirmada(firmada, publicaHex, AHORA)).toMatchObject({ ok: true, premios: 2, evento: "feria-del-libro" });
  });

  it("rechaza un cierre pasado y una campaña sin evento", () => {
    expect(() => firmar({ cierra_ms: AHORA })).toThrow(/cierra_ms/);
    expect(() => firmar({ evento: undefined })).toThrow(/evento/);
  });

  it("sin validador no firma, porque firmar a ciegas es lo que esto evita", () => {
    expect(() => firmarCampana(secretoHex, cruda(), AHORA, undefined)).toThrow(/validador/);
  });

  it("no firma con una llave privada que no tiene la forma de una llave", () => {
    for (const mala of ["", "abc", "z".repeat(64), "A".repeat(64), "a".repeat(63)]) {
      expect(() => firmarCampana(mala, cruda(), AHORA, validarCampanaParaFirmar), mala).toThrow(/llave privada/);
    }
  });

  describe("no firma lo que la sala rechazaría después", () => {
    it("una campaña sin sorteo_ms", () => {
      expect(() => firmar({ sorteo_ms: undefined })).toThrow(/la sala rechazaría.*sorteo_ms/);
    });

    it("un sorteo_ms que no es un entero positivo", () => {
      for (const malo of [0, -5, 1.5, "mañana", null]) {
        expect(() => firmar({ sorteo_ms: malo }), String(malo)).toThrow(/rechazaría.*sorteo_ms/);
      }
    });

    it("sin premios, con más de diez o con un monto que no es un entero", () => {
      for (const premios of [undefined, [], Array(11).fill("100000"), ["abc"], [400000000]]) {
        expect(() => firmar({ premios }), JSON.stringify(premios)).toThrow(/rechazaría.*premios/);
      }
    });

    it("una cuenta de quien sella que no es una cuenta de Stellar", () => {
      expect(() => firmar({ organizadora: "no" })).toThrow(/la sala rechazaría.*organizadora/);
      expect(() => firmar({ organizadora: Keypair.random().publicKey() })).not.toThrow();
    });
  });

  describe("no firma lo que el sitio rechazaría después", () => {
    it("un enlace de red que no es de esa red", () => {
      const pasos = [{ tipo: "instagram", url: "https://ejemplo.com/perfil", texto: { es: "Seguinos", en: "Follow us" } }];
      expect(() => firmar({ pasos })).toThrow(/el sitio rechazaría.*pasos\.url/);
    });

    it("un enlace que no es https", () => {
      const pasos = [{ tipo: "enlace", url: "http://ejemplo.com", texto: { es: "Mirá", en: "Look" } }];
      expect(() => firmar({ pasos })).toThrow(/pasos\.url/);
    });

    it("sin nombre de la empresa, o con espacios sobrando", () => {
      expect(() => firmar({ empresa: { nombre: "", logo: null, color: null } })).toThrow(/empresa\.nombre/);
      expect(() => firmar({ empresa: { nombre: " Empresa ", logo: null, color: null } })).toThrow(/empresa\.nombre/);
    });

    it("unas bases vacías", () => {
      expect(() => firmar({ bases: { es: "", en: "" } })).toThrow(/bases/);
    });

    it("horas que no van en orden", () => {
      expect(() => firmar({ sorteo_ms: AHORA + 3_600_000 })).not.toThrow();
      expect(() => firmar({ sorteo_ms: AHORA + 1_000 })).toThrow(/horas/);
      expect(() => firmar({ abre_ms: AHORA + 10_000_000 })).toThrow(/horas/);
    });

    it("un premio menor que un centavo", () => {
      expect(() => firmar({ premios: ["1"] })).toThrow(/premios/);
    });

    it("una campaña de mainnet se valida aunque la copia que corre el guion abra en testnet", () => {
      expect(() => firmar({ red: "mainnet" })).not.toThrow();
      expect(() => firmar({ red: "futurenet" })).toThrow(/red/);
    });
  });

  it("dentroDe distingue un archivo interno de una carpeta vecina con el mismo prefijo", () => {
    const carpeta = resolve("carpeta-de-prueba");
    expect(dentroDe(join(carpeta, "archivo"), carpeta)).toBe(true);
    expect(dentroDe(join(`${carpeta}-vecina`, "archivo"), carpeta)).toBe(false);
  });
});

describe("la llave privada nunca queda dentro del repositorio", () => {
  const base = mkdtempSync(join(tmpdir(), "tinkazo-firmar-"));
  afterAll(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // Una carpeta de trabajo de git puede quedar tomada un rato en Windows: es de la carpeta temporal y se limpia sola.
    }
  });

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=prueba", "-c", "user.email=prueba@example.com", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  it("un destino dentro de una carpeta del repositorio se rechaza y uno afuera no", () => {
    const repo = join(base, "repo");
    mkdirSync(join(repo, "carpeta"), { recursive: true });
    const afuera = join(base, "afuera");
    mkdirSync(afuera);
    const raices = [realpathSync(repo)];
    expect(() => llaveFueraDelRepositorio(join(repo, "llave.hex"), raices)).toThrow(/fuera del repositorio/);
    expect(() => llaveFueraDelRepositorio(join(repo, "carpeta", "llave.hex"), raices)).toThrow(/fuera del repositorio/);
    expect(() => llaveFueraDelRepositorio(join(afuera, "llave.hex"), raices)).not.toThrow();
  });

  it("un destino que llega al repositorio por un enlace simbólico o una junction también se rechaza", () => {
    const repo = join(base, "repo-enlazado");
    mkdirSync(repo);
    const enlace = join(base, "enlace");
    try {
      symlinkSync(repo, enlace, "junction");
    } catch {
      // Sin permiso para crear enlaces en esta máquina: no hay nada que comprobar.
      return;
    }
    expect(() => llaveFueraDelRepositorio(join(enlace, "llave.hex"), [realpathSync(repo)])).toThrow(/fuera del repositorio/);
  });

  it("las carpetas del repositorio incluyen esta copia de trabajo", () => {
    const raices = raicesDelRepositorio();
    expect(raices.length).toBeGreaterThan(0);
    expect(raices).toContain(realpathSync(resolve(process.cwd())));
  });

  it("en una copia de trabajo anidada bajo el repositorio principal, el principal también cuenta", () => {
    let hayGit = true;
    try {
      git(base, "--version");
    } catch {
      hayGit = false;
    }
    if (!hayGit) return;
    const principal = join(base, "principal");
    mkdirSync(principal);
    git(principal, "init", "-q");
    git(principal, "commit", "-q", "--allow-empty", "-m", "inicio");
    const anidada = join(principal, ".copias", "trabajo");
    git(principal, "worktree", "add", "-q", anidada);
    const raices = raicesDelRepositorio(anidada);
    expect(raices).toContain(realpathSync(anidada));
    expect(raices).toContain(realpathSync(principal));
    // Una llave en la carpeta del repositorio principal pasaría el control si solo se mirara la copia anidada.
    expect(() => llaveFueraDelRepositorio(join(principal, "llave.hex"), raices)).toThrow(/fuera del repositorio/);
  });

  it("el archivo firmado tampoco se escribe dentro del repositorio: quien lo tiene primero crea la sala del evento", () => {
    const repo = join(base, "repo-firmadas");
    mkdirSync(join(repo, "campanas"), { recursive: true });
    const afuera = join(base, "firmadas-afuera");
    mkdirSync(afuera);
    const raices = [realpathSync(repo)];
    expect(() => firmadaFueraDelRepositorio(join(repo, "campanas", "evento.firmada.json"), raices)).toThrow(
      /el archivo firmado tiene que quedar fuera del repositorio/,
    );
    expect(() => firmadaFueraDelRepositorio(join(afuera, "evento.firmada.json"), raices)).not.toThrow();
  });

  it("el guion mira dónde va el archivo firmado antes de leer la llave y de firmar", () => {
    const fuente = readFileSync(join(process.cwd(), "scripts", "campana-firmar.mjs"), "utf8");
    const cuerpo = /async function firmarArchivo[\s\S]*?\n\}/.exec(fuente)?.[0] ?? "";
    const control = cuerpo.indexOf("firmadaFueraDelRepositorio(salida)");
    expect(control).toBeGreaterThan(-1);
    expect(control).toBeLessThan(cuerpo.indexOf("readFileSync(archivoLlave"));
    expect(control).toBeLessThan(cuerpo.indexOf("firmarCampana("));
  });
});

describe("el cobro de la comisión al firmar", () => {
  it("con el cobro prendido, un premio con fracción de centavo no se firma", () => {
    const campana = JSON.stringify(completa({ premios: ["1000000001"] }));
    expect(() => firmarCampana(secretoHex, campana, AHORA, validarCampanaParaFirmar, { conComision: true })).toThrow(/centavos justos/);
  });

  it("con el cobro prendido, premios en centavos justos se firman", () => {
    const campana = JSON.stringify(completa({ premios: ["1000000000", "1000000000"] }));
    expect(firmarCampana(secretoHex, campana, AHORA, validarCampanaParaFirmar, { conComision: true }).texto).toContain("1000000000");
  });

  it("sin el cobro prendido, firma como siempre", () => {
    const campana = JSON.stringify(completa({ premios: ["1000000001"] }));
    expect(firmarCampana(secretoHex, campana, AHORA, validarCampanaParaFirmar).texto).toContain("1000000001");
  });
});

describe("el premio en mano al firmar", () => {
  const EN_MANO = { es: "Auriculares", en: "Headphones" };
  const MANO = { identidad: "persona", premio_en_mano: EN_MANO, premios: ["0", "0"] };

  const firmarComoTinkazo = (cambios: Record<string, unknown> = {}) =>
    firmarCampana(secretoHex, cruda(cambios), AHORA, validarCampanaParaElFirmador);

  it("firma una campaña de personas con premio en mano, y la sala y el sitio la leen", () => {
    const firmada = firmarComoTinkazo(MANO);
    expect(verificarFirma(firmada.texto, firmada.firma, publicaHex)).toBe(true);
    expect(leerCampanaFirmada(firmada, publicaHex, AHORA)).toMatchObject({ ok: true, premios: 2, identidad: "persona" });
    expect(JSON.parse(firmada.texto)).toMatchObject({ premio_en_mano: EN_MANO, premios: ["0", "0"] });
  });

  it("no firma una campaña de personas con premios en dólares", () => {
    expect(() => firmarComoTinkazo({ identidad: "persona" })).toThrow(/premio_en_mano/);
    expect(() => firmarComoTinkazo({ identidad: "persona", premios: ["400000000"] })).toThrow(/premio_en_mano/);
  });

  it("una campaña de cuentas sigue firmándose con sus montos", () => {
    expect(() => firmarComoTinkazo({})).not.toThrow();
    expect(() => firmarComoTinkazo({ identidad: undefined, premios: ["400000000"] })).not.toThrow();
  });

  it("no firma un premio en mano que la sala o el sitio rechazarían", () => {
    expect(() => firmarComoTinkazo({ ...MANO, identidad: undefined })).toThrow(/premio_en_mano/);
    expect(() => firmarComoTinkazo({ ...MANO, premios: ["400000000", "0"] })).toThrow(/premios/);
    expect(() => firmarComoTinkazo({ ...MANO, premio_en_mano: { es: "a".repeat(61), en: "b" } })).toThrow(/premio_en_mano/);
    expect(() => firmarComoTinkazo({ ...MANO, premio_en_mano: { es: "   ", en: "b" } })).toThrow(/premio_en_mano/);
    expect(() => firmarComoTinkazo({ identidad: undefined, premios: ["0"] })).toThrow(/premios/);
  });

  it("el validador dice por qué una campaña de personas con dólares no se firma", () => {
    expect(validarCampanaParaElFirmador(cruda({ identidad: "persona" }), AHORA)).toMatchObject({
      ok: false,
      quien: "firmador",
      campo: "premio_en_mano",
    });
    expect(() => firmarComoTinkazo({ identidad: "persona" })).toThrow(/Tinkazo no firma esta campaña: revisá el campo premio_en_mano/);
  });

  it("la validación del armador sigue aceptando lo que leen la sala y el sitio: solo el firmador cierra esta puerta", () => {
    expect(validarCampanaParaFirmar(cruda({ identidad: "persona" }), AHORA)).toEqual({ ok: true });
  });
});
