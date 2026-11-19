/**
 * Lo mínimo de `cloudflare:workers` que usan los objetos de la sala, para probarlos en Node. Lo toman las pruebas con
 * `vi.mock("cloudflare:workers", ...)`: nunca entra en el Worker.
 */
export class DurableObject<E = unknown> {
  readonly ctx: unknown;
  readonly env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
