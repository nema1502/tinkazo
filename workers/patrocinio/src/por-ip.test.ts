import { describe, expect, it } from "vitest";
import { PorIp } from "./por-ip";

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
