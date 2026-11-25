import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lo que dicen en público la guía de contribución, la política de seguridad, la plantilla
 * de pedido y los formularios de issue tiene que ser cierto, y cada regla escrita tiene
 * que poder cumplirse. Estas pruebas leen los archivos como texto.
 */
const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const contribuir = leer("CONTRIBUTING.md");
const seguridad = leer("SECURITY.md");
const plantilla = leer(".github/pull_request_template.md");
const falla = leer(".github/ISSUE_TEMPLATE/falla.yml");
const trabajo = leer(".github/ISSUE_TEMPLATE/trabajo.yml");
const config = leer(".github/ISSUE_TEMPLATE/config.yml");
const paquete = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };

const URL_REPARTO = "https://github.com/nema1502/tinkazo/issues/277";

describe("CONTRIBUTING.md", () => {
  it("el ejemplo de commit cumple el límite de 72 caracteres que pide", () => {
    const ejemplo = /Por ejemplo: `([^`]+)`/.exec(contribuir);
    expect(ejemplo).not.toBeNull();
    expect([...ejemplo![1]!].length).toBeLessThanOrEqual(72);
  });

  it("dice que la aprobación de la corrida se pide en cada pedido de afuera", () => {
    expect(contribuir).not.toMatch(/La primera vez que alguien de afuera/);
    expect(contribuir).toMatch(/apruebe cada corrida/);
  });

  it("avisa que el enlace de un comprobante no se sube", () => {
    expect(contribuir).toMatch(/enlaces de comprobantes/);
  });

  it("cada comando de pnpm que nombra existe en package.json", () => {
    const nombrados = [...contribuir.matchAll(/pnpm ([a-z][\w:-]*)/g)].map((m) => m[1]!);
    const propios = new Set(["install"]);
    const faltan = nombrados.filter((n) => !propios.has(n) && !(n in paquete.scripts));
    expect(nombrados.length).toBeGreaterThan(0);
    expect(faltan).toEqual([]);
  });

  it("cada guion de scripts/ que nombra existe", () => {
    const nombrados = [...contribuir.matchAll(/node (scripts\/[\w.-]+)/g)].map((m) => m[1]!);
    const faltan = nombrados.filter((r) => {
      try {
        leer(r);
        return false;
      } catch {
        return true;
      }
    });
    expect(faltan).toEqual([]);
  });

  it("enlaza el reparto del trabajo con su dirección completa", () => {
    expect(contribuir).toContain(URL_REPARTO);
  });
});

describe("lo que despliega unir a main", () => {
  it("la guía no dice que unir a main no despliega nada: el sitio sale a producción", () => {
    expect(contribuir).not.toMatch(/no despliega ningún servicio/);
    expect(contribuir).toMatch(/Unir un pedido a `main` publica el sitio en tinkazo\.app/);
    expect(contribuir).toMatch(/servicios de `workers\/`/);
  });

  it("la plantilla no sugiere que Nada es lo normal ni que unir es inocuo", () => {
    expect(plantilla).not.toMatch(/no despliega ningún servicio/);
    expect(plantilla).toMatch(/publica el sitio en tinkazo\.app/);
    expect(plantilla).toMatch(/Escribí Nada solo si/);
  });
});

describe("falla.yml", () => {
  it("no pide pegar el enlace del comprobante en un issue público", () => {
    expect(falla).not.toMatch(/el enlace de su comprobante\./);
    expect(falla).toMatch(/No pegues el enlace del comprobante/);
  });

  it("la casilla cuenta el enlace del comprobante como dato de otras personas", () => {
    expect(falla).toMatch(/label: No puse secretos, llaves, enlaces de comprobantes ni datos de otras personas/);
  });

  it("acepta una falla que se vio una sola vez", () => {
    expect(falla).toMatch(/pasó una sola vez/);
  });
});

describe("trabajo.yml", () => {
  it("avisa en el selector que es solo para el equipo", () => {
    expect(trabajo).toMatch(/^name: .*solo equipo/m);
  });

  it("es público como los otros y lo dice en su descripción", () => {
    expect(trabajo).toMatch(/^description: .*Si sos de afuera/m);
  });

  it("enlaza el reparto con su dirección completa y no con el número suelto", () => {
    expect(trabajo).toContain(URL_REPARTO);
    expect(trabajo).not.toMatch(/issue 277/);
  });
});

describe("pull_request_template.md", () => {
  it("no trae respuestas prellenadas que se firman sin querer", () => {
    expect(plantilla).not.toMatch(/^Nada\.\s*$/m);
    expect(plantilla).not.toMatch(/^Refs #\s*$/m);
  });
});

describe("SECURITY.md y config.yml", () => {
  it("no prometen leer ni seguir cada aviso", () => {
    expect(seguridad).not.toMatch(/Leemos cada aviso/);
    expect(seguridad).not.toMatch(/Te mantenemos al tanto/);
    expect(seguridad).toMatch(/no podemos asegurarlo/);
  });

  it("no prometen plazos en días ni recompensas", () => {
    expect(seguridad).not.toMatch(/\b\d+\s*(días|dias|horas|semanas|days|hours|weeks)\b/i);
    expect(seguridad).toMatch(/No ofrecemos recompensas/);
    expect(seguridad).not.toMatch(/\b(recompensa|premio) de\b/i);
  });

  it("no mandan a un botón de aviso privado que no está activado", () => {
    expect(seguridad).not.toMatch(/Reportar una vulnerabilidad/);
    expect(seguridad).not.toMatch(/Report a vulnerability/);
    expect(config).not.toMatch(/en privado/);
    expect(config).toMatch(/hola@tinkazo\.app/);
  });
});
