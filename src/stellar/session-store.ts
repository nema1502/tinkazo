/**
 * Which kind of session the user had, so a reload does not log them out.
 *
 * Only the KIND is stored, never a key or address: the guest secret already
 * lives in its own localStorage entry and Freighter / Pollar own their state.
 * Kept free of config/state imports so it runs under Node.
 */

export type SessionKind = "guest" | "freighter" | "google";

const KINDS: readonly SessionKind[] = ["guest", "freighter", "google"];

const keyFor = (network: string): string => `tinkazo.session.kind.${network}`;

export function saveSessionKind(kind: SessionKind, network: string): void {
  try {
    localStorage.setItem(keyFor(network), kind);
  } catch {
    /* blocked storage: the session just will not survive a reload */
  }
}

export function loadSessionKind(network: string): SessionKind | null {
  try {
    const raw = localStorage.getItem(keyFor(network));
    return KINDS.find((k) => k === raw) ?? null;
  } catch {
    return null;
  }
}

export function clearSessionKind(network: string): void {
  try {
    localStorage.removeItem(keyFor(network));
  } catch {
    /* nothing to clear */
  }
}

export interface RestoreInput {
  kind: SessionKind | null;
  guestStored: boolean;
  guestAvailable: boolean;
  /** Freighter already granted this site access: restoring will not prompt. */
  freighterAllowed: boolean;
}

/** Which session to restore silently on load, or null to stay logged out. */
export function pickRestore(i: RestoreInput): SessionKind | null {
  switch (i.kind) {
    case "guest":
      return i.guestStored && i.guestAvailable ? "guest" : null;
    case "freighter":
      return i.freighterAllowed ? "freighter" : null;
    case "google":
      return "google";
    default:
      return null;
  }
}
