import { describe, expect, it } from "vitest";
import { PorIp, grupoDeIp } from "./por-ip";

describe("el tope por dirección", () => {
  it("corta al pasar el tope y vuelve a la hora", () => {
    let ahora = 0;
    const c = new PorIp(() => ahora);
    for (let i = 1; i <= 60; i++) expect(c.toca("1.2.3.4", 60), `pedido ${i}`).toBe(true);
    expect(c.toca("1.2.3.4", 60)).toBe(false);
    expect(c.toca("5.6.7.8", 60)).toBe(true);
    ahora += 3_600_001;
    expect(c.toca("1.2.3.4", 60)).toBe(true);
  });
  it("una IPv6 cuenta por su bloque /64, y una IPv4 escrita como IPv6 es esa IPv4", () => {
    const c = new PorIp(() => 0);
    expect(c.toca("2800:1:2:3::1", 1)).toBe(true);
    expect(c.toca("2800:1:2:3:ffff::9", 1)).toBe(false);
    expect(grupoDeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});
