/**
 * Pedidos por dirección y por hora, en memoria y sin guardar la dirección tal cual: en IPv6 se
 * agrupa por su bloque /64 (ver `grupoDeIp`). Si el Worker se reinicia, vuelve todo a cero, y
 * cada nodo de Cloudflare tiene el suyo: no es la defensa del dinero (esa es el tope en XLM y la
 * regla de límite de Cloudflare delante del Worker, ver README.md), sino una molestia para el script torpe.
 *
 * Cada ruta usa su propio contador: consultar el cupo mucho no le gasta pedidos a quien paga.
 */
import { grupoDeIp } from "./config";

const HORA_MS = 3_600_000;
const LIMPIAR_DESDE = 5000;

export class PorIp {
  private readonly cuentas = new Map<string, { n: number; vence: number }>();

  constructor(private readonly reloj: () => number = () => Date.now()) {}

  /** Anota un pedido de `ip`; false si ya pasó de `tope` en la hora. */
  toca(ip: string, tope: number): boolean {
    const ahora = this.reloj();
    const clave = grupoDeIp(ip);
    const f = this.cuentas.get(clave);
    if (!f || f.vence < ahora) {
      if (this.cuentas.size > LIMPIAR_DESDE) for (const [k, v] of this.cuentas) if (v.vence < ahora) this.cuentas.delete(k);
      this.cuentas.set(clave, { n: 1, vence: ahora + HORA_MS });
      return true;
    }
    f.n += 1;
    return f.n <= tope;
  }
}
