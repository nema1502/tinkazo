import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PorIp, cupoPorHora } from "./por-ip";
import { ALTAS_POR_IP_HORA } from "./rutas-altas";

describe("el tope por dirección", () => {
  it("corta al pasar el tope y vuelve a la hora", () => {
    let ahora = 0;
    const c = new PorIp(() => ahora);
    for (let i = 1; i <= 240; i++) expect(c.toca("1.2.3.4", 240), `pedido ${i}`).toBe(true);
    expect(c.toca("1.2.3.4", 240)).toBe(false);
    expect(c.toca("5.6.7.8", 240)).toBe(true);
    ahora += 3_600_001;
    expect(c.toca("1.2.3.4", 240)).toBe(true);
  });

  it("una IPv6 cuenta por su bloque /64", () => {
    const c = new PorIp(() => 0);
    expect(c.toca("2800:1:2:3::1", 1)).toBe(true);
    expect(c.toca("2800:1:2:3:ffff::9", 1)).toBe(false);
  });

  it("dos contadores no se pisan: consultar el cupo no le gasta pedidos a quien paga", () => {
    const cupo = new PorIp(() => 0);
    const pago = new PorIp(() => 0);
    for (let i = 0; i < 500; i++) cupo.toca("9.9.9.9", 600);
    expect(pago.toca("9.9.9.9", 240)).toBe(true);
  });
});

describe("las consultas del cupo por dirección (GET /v1/patrocinio/cupo)", () => {
  it("en mainnet, 3.000 por hora, como las altas: todo un stand sale por la misma wifi", () => {
    expect(cupoPorHora("mainnet")).toBe(3000);
    expect(cupoPorHora("mainnet")).toBe(ALTAS_POR_IP_HORA);
    // Un stand de 100 personas que miran el cupo 25 veces cada una en la hora sigue sellando y sorteando.
    const c = new PorIp(() => 0);
    for (let i = 1; i <= 2500; i++) expect(c.toca("200.87.1.1", cupoPorHora("mainnet")), `consulta ${i}`).toBe(true);
  });

  it("en testnet no cambia: 600", () => {
    expect(cupoPorHora("testnet")).toBe(600);
    expect(cupoPorHora("")).toBe(600);
  });

  it("la ruta del Worker usa ese tope según la red, y no una cifra fija", () => {
    const texto = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const inicio = texto.indexOf('url.pathname === "/v1/patrocinio/cupo"');
    expect(inicio, "la ruta GET /v1/patrocinio/cupo").toBeGreaterThan(-1);
    // La ruta entera: hasta la llave que la cierra, con la sangría del bloque.
    const fin = texto.indexOf("\n    }", inicio);
    expect(fin, "el cierre de la ruta").toBeGreaterThan(inicio);
    const ruta = texto.slice(inicio, fin);
    expect(ruta).toMatch(/cupoPorIp\.toca\(ip, cupoPorHora\(env\.RED\b/);
    // El único tope de la ruta es ese: ninguna cifra fija al lado.
    expect([...ruta.matchAll(/cupoPorIp\.toca\(/g)]).toHaveLength(1);
    expect(ruta).not.toMatch(/cupoPorIp\.toca\(ip, \d/);
  });
});
