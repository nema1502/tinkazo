/**
 * Quién está adentro, sin DOM ni textos (26 de octubre de 2026).
 *
 * Alguien usó tinkazo.app y no se notaba si había iniciado sesión ni con qué
 * cuenta: fuera era ausencia (no había nada en la cabecera) y dentro, una caja
 * chica con el nombre. Ahora la cabecera lleva siempre el estado de la cuenta,
 * con tres formas: **Entrar**, **Conectando… / Retomando…** y **dentro**, con la
 * cara, el nombre de pila y por dónde entró. Este archivo decide cuál es y qué
 * lleva; `cuenta-chip.ts` lo dibuja, en la herramienta y en las páginas de
 * lectura, que no cargan el diccionario entero: por eso acá no hay textos, solo
 * claves.
 *
 * Privacidad: el correo completo nunca va en la cabecera ni en lo que se
 * proyecte; el panel lo muestra tapado (`l•••@gmail.com`).
 */

/** Por dónde entró la persona. */
export type Via = "google" | "email" | "freighter" | "prueba";

/** Lo que la cabecera necesita saber de la sesión, sin el resto. */
export interface SesionVista {
  /** La etiqueta de la cuenta: "Google", "Email", "Freighter" o "Cuenta de prueba". */
  label: string;
  address: string;
  /** El nombre, solo si la cuenta lo trae (Google): el correo no cuenta como nombre. */
  name?: string;
  /** La foto, si la cuenta la trae. */
  avatar?: string;
  /** El correo de la cuenta de Google o de correo. Nunca se muestra entero. */
  mail?: string;
}

export type EstadoCuenta =
  | { estado: "fuera" }
  | { estado: "retomando" }
  | { estado: "conectando" }
  | {
      estado: "dentro";
      via: Via;
      /** El nombre de pila, o vacío si la cuenta no lo trae (todavía): ahí la cabecera dice la vía. */
      nombre: string;
      /** La letra de la cara cuando no hay foto, o vacío (la cara es entonces el dibujo de la casa). */
      inicial: string;
      foto: string;
      direccion: string;
    };

/**
 * La marca que deja un botón que lleva a entrar desde otra página (el final de la demo, "Sortear con mi lista" del ensayo,
 * "Entrar" de la cabecera de las páginas de lectura): la herramienta, ya abierta, pide entrar (`pedirEntrar`). Vive en la pestaña.
 */
export const MARCA_INGRESAR = "tinkazo.ingresar";

/**
 * La vía de la sesión que quedó guardada en este navegador, sin cargar ninguna billetera: las páginas de lectura solo
 * saben esto. `kind` es el tipo de sesión guardado (`session-store.ts`) y `marcaPollar` por dónde entró con Pollar
 * (`tinkazo.pollar.intent`: Google o correo, que se guardan los dos como "google").
 */
export function viaDeLaSesionGuardada(kind: string | null, marcaPollar: string | null): Via | null {
  if (kind === "guest") return "prueba";
  if (kind === "freighter") return "freighter";
  if (kind === "google") return marcaPollar === "email" ? "email" : "google";
  return null;
}

/** La vía, por la etiqueta de la cuenta (`wallet.label`). */
export function viaDe(label: string): Via {
  if (label === "Google") return "google";
  if (label === "Email") return "email";
  if (label === "Freighter") return "freighter";
  return "prueba";
}

/** Si el texto es un correo: Pollar pone el correo como nombre cuando la cuenta no trae uno. */
export function esCorreo(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim());
}

/**
 * El nombre de pila: "Lucía Elena Flores Quispe" no entra en una cabecera, y un correo no es un nombre
 * (la cabecera diría "lucia@example.com" en una pantalla grande). Vacío si no hay con qué.
 */
export function nombreCorto(nombre: string | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio || esCorreo(limpio)) return "";
  return limpio.split(/\s+/)[0] ?? "";
}

/** `lucia@example.com` → `l•••@example.com`. Lo que no es un correo no se muestra. */
export function ocultarCorreo(correo: string | undefined): string {
  const c = (correo ?? "").trim();
  if (!esCorreo(c)) return "";
  const [usuario, dominio] = c.split("@") as [string, string];
  const primera = [...usuario][0] ?? "";
  return `${primera}•••@${dominio}`;
}

/** La letra de la cara: la primera del nombre o, sin nombre, la del correo. Vacío si no hay nada con letras. */
export function inicialDe(nombre: string | undefined, correo?: string): string {
  const fuente = (nombre ?? "").trim() && !esCorreo(nombre ?? "") ? (nombre ?? "") : (correo ?? "");
  const primera = [...fuente.trim()].find((c) => /\p{L}|\p{N}/u.test(c));
  return primera ? primera.toLocaleUpperCase() : "";
}

/**
 * El estado de la cuenta. Con una sesión abierta, dentro: aunque todavía diga "retomando" por la otra vía de
 * retomar (Google y la cuenta de prueba se retoman aparte), la cuenta que ya está manda.
 */
export function estadoCuenta(e: { sesion: SesionVista | null; retomando: boolean; conectando: boolean }): EstadoCuenta {
  const s = e.sesion;
  if (s) {
    const via = viaDe(s.label);
    const nombre = nombreCorto(s.name);
    return {
      estado: "dentro",
      via,
      nombre,
      // Sin foto ni nombre, la inicial sale del correo (la cuenta de correo); la prueba y Freighter no tienen: se dibuja la casa.
      inicial: via === "google" || via === "email" ? inicialDe(nombre, s.mail) : "",
      foto: s.avatar ?? "",
      direccion: s.address,
    };
  }
  if (e.conectando) return { estado: "conectando" };
  if (e.retomando) return { estado: "retomando" };
  return { estado: "fuera" };
}

/** Las claves de los textos de cada vía: la frase larga ("Entraste con Google") y la corta ("Google"). */
export const CLAVES_DE_VIA: Record<Via, { larga: string; corta: string }> = {
  google: { larga: "cuentaViaGoogle", corta: "cuentaViaGoogleC" },
  email: { larga: "cuentaViaCorreo", corta: "cuentaViaCorreoC" },
  freighter: { larga: "cuentaViaFreighter", corta: "cuentaViaFreighter" },
  prueba: { larga: "cuentaViaPrueba", corta: "cuentaViaPruebaC" },
};

/**
 * Qué se lee como nombre en la cabecera: el nombre de pila o, sin él, la cuenta (la vía) o la dirección corta
 * (Freighter). Nunca el correo.
 */
export function tituloDelChip(c: Extract<EstadoCuenta, { estado: "dentro" }>): { tipo: "nombre" | "tuCuenta" | "via" | "direccion"; texto: string } {
  if (c.nombre) return { tipo: "nombre", texto: c.nombre };
  if (c.via === "freighter") return { tipo: "direccion", texto: c.direccion.length > 12 ? `${c.direccion.slice(0, 4)}…${c.direccion.slice(-4)}` : c.direccion };
  if (c.via === "prueba") return { tipo: "via", texto: "" };
  return { tipo: "tuCuenta", texto: "" };
}

/** Lo que dice la página al entrar, una línea: qué cuenta y, si se sabe, quién. */
export function claveDelAviso(c: Extract<EstadoCuenta, { estado: "dentro" }>): string {
  if (c.via === "google") return c.nombre ? "cuentaAvisoGoogle" : "cuentaAvisoGoogleSin";
  if (c.via === "email") return "cuentaAvisoCorreo";
  if (c.via === "freighter") return "cuentaAvisoFreighter";
  return "cuentaAvisoPrueba";
}

/* ------------------------------------------------------------ el recordatorio suave */

/**
 * ¿Se le recuerda, mientras explora, que puede crear la cuenta? Solo en el ensayo y en la demo (no graban nada y no
 * piden cuenta), sin sesión, **una sola vez por sesión** y nunca entre el sello y el último resultado: ahí la
 * persona está mirando el sorteo y nada se le pone enfrente. Va en la banda que ya existe, como una frase más, sin
 * ventana ni color de la casa.
 *
 * "Una vez" es una vez que empieza y termina: mientras la persona sigue en la lista, la frase se queda (`esteAviso`);
 * al sellar se va y no vuelve en esa pestaña, ni al recargar (`yaSeAviso`, que guarda `aviso-cuenta.ts`).
 */
export function debeAvisar(e: {
  enEnsayoODemo: boolean;
  conSesion: boolean;
  /** Ya se le mostró antes en esta pestaña (guardado: vale aunque se recargue). */
  yaSeAviso: boolean;
  /** Se le está mostrando ahora, en esta visita a la página. */
  esteAviso: boolean;
  /** La lista está sellada y falta el último resultado (esperando, sorteando o mirando al ganador). */
  sellada: boolean;
  /** Hay una ventana abierta (ingreso, cuenta, tutorial): no se le suma nada encima. */
  ventanaAbierta: boolean;
}): boolean {
  if (!e.enEnsayoODemo || e.conSesion || e.sellada || e.ventanaAbierta) return false;
  return e.esteAviso || !e.yaSeAviso;
}
