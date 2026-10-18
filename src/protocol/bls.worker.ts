import { verifyRound } from "./drand";

/**
 * La verificación de la firma de una ronda, en un hilo aparte.
 *
 * Es la misma `verifyRound` de `drand.ts`, sin copia: este archivo solo la
 * llama fuera del hilo de la página. Ver `firma.ts`.
 */

interface Pedido {
  id: number;
  round: number;
  signature: string;
}

const hilo = self as unknown as {
  onmessage: ((e: MessageEvent<Pedido>) => void) | null;
  postMessage(m: { id: number; ok: boolean }): void;
};

hilo.onmessage = (e) => {
  const { id, round, signature } = e.data;
  hilo.postMessage({ id, ok: verifyRound(round, signature) });
};
