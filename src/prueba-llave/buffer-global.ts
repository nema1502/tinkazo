import { Buffer } from "buffer/";

/**
 * El kit usa `Buffer` como global en el nivel superior de varios de sus módulos y no lo importa. El paquete de enlaces
 * lo pone en `window`, pero el orden en que se evalúan los módulos no está garantizado. Por eso este es el PRIMER import
 * de `puente-kit.ts`: los imports con efecto se evalúan en el orden escrito.
 *
 * Va con barra final (`buffer/`) para que el armado lo tome del paquete de npm y no lo trate como un módulo de Node.
 */
const global = globalThis as unknown as { Buffer?: unknown };
global.Buffer ??= Buffer;
