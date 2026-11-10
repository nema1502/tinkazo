/**
 * Pedidos por dirección y por hora, en memoria y sin guardar la dirección tal cual: una IPv4 es ella misma y una
 * IPv6 es su bloque /64 (una sola conexión reparte millones de direcciones). Si el Worker se reinicia, vuelve todo
 * a cero, y cada nodo de Cloudflare tiene el suyo: no es la defensa de nada que valga dinero (las monedas no lo
 * valen), es una molestia para el guion torpe. Copia de `workers/patrocinio/src/por-ip.ts`: son dos scripts y no
 * comparten código.
 */

const HORA_MS = 3_600_000;
const LIMPIAR_DESDE = 5000;

export function grupoDeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4?.[1]) return v4[1];
  const doble = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = doble && cola ? cola.split(":") : [];
  const bloques = doble ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${bloques
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

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
