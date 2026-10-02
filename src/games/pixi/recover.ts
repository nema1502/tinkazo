/**
 * Recovery after the GPU drops what the canvas had drawn (pure, no Pixi).
 *
 * On mobile the WebGL context can be lost while the tab is hidden. Two cases:
 * - the tab comes back with the context intact (`onReturn`, cheap path);
 * - the context was lost and restored (`onRestore`, heavy path).
 * `visibilitychange` can fire before the restore, so while the context is lost
 * a visible tab waits for the restore instead of recovering on a dead context.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (e: any) => void;

interface Listenable {
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
}

export interface RecoveryHandlers {
  onReturn: () => void;
  onRestore: () => void;
}

export const RECOVER_WINDOW_MS = 250;

export function watchRecovery(
  target: Listenable,
  doc: Listenable & { readonly visibilityState: string },
  { onReturn, onRestore }: RecoveryHandlers,
  now: () => number = () => Date.now(),
): () => void {
  let lost = false;
  let disposed = false;
  let last = -Infinity;
  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* a failing callback must not break the other listeners */
    }
  };
  const onLost: Listener = (e) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored: Listener = () => {
    lost = false;
    if (!disposed) safe(onRestore);
  };
  const onVisibility: Listener = () => {
    if (disposed || lost || doc.visibilityState !== "visible") return;
    const t = now();
    if (t - last < RECOVER_WINDOW_MS) return;
    last = t;
    safe(onReturn);
  };
  target.addEventListener("webglcontextlost", onLost);
  target.addEventListener("webglcontextrestored", onRestored);
  doc.addEventListener("visibilitychange", onVisibility);
  return (): void => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener("webglcontextlost", onLost);
    target.removeEventListener("webglcontextrestored", onRestored);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
