import { avatar } from "../avatar";
import { esc } from "../dom";
import { CLAVES_DE_VIA, tituloDelChip, type EstadoCuenta } from "./cuenta-estado";

/**
 * El chip de la cuenta, el de la cabecera (26 de octubre de 2026).
 *
 * Alguien usó tinkazo.app y no se notaba si había iniciado sesión ni con qué
 * cuenta. Ahora la cabecera lleva siempre uno de tres chips, y se ven distintos
 * a primera vista:
 *
 * - **Entrar**: sin cuenta. Secundario (sin el magenta ni el amarillo de la casa):
 *   la acción principal de la página es otra.
 * - **Conectando… / Retomando…**: algo está pasando (la ventana de Google, o la
 *   sesión que vuelve). `aria-busy`, y sin la G ni nada que invite a tocar.
 * - **Dentro**: la cara (la foto, la letra o el dibujo de la casa) con un ✓, el
 *   nombre de pila y por dónde entró. El correo nunca.
 *
 * Lo dibujan la herramienta (`wallet-ui.ts`) y las páginas de lectura
 * (`pagina.ts`), que no cargan el diccionario entero: por eso los textos entran
 * por `tx` y no se importan de ninguna parte. Qué estado toca lo decide
 * `cuenta-estado.ts`, sin DOM.
 */

export type Texto = (clave: string) => string;

export interface OpcionesDelChip {
  tx: Texto;
  /** Un enlace en lugar de un botón: las páginas de lectura, que no tienen el panel de la cuenta. */
  enlace?: string;
  /** Lo que se lee como nombre cuando la página no sabe quién es (las de lectura no guardan nada de quien entró). */
  titulo?: string;
  /** Acaba de entrar: aparece con un pulso corto. */
  recien?: boolean;
}

/** Una persona, para "Entrar" y para la cara de una página que no sabe quién es. */
const PERSONA =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';

/** El ✓ de "ya entraste". */
const VISTO =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 6.4l2.3 2.3 4.9-5"/></svg>';

type Dentro = Extract<EstadoCuenta, { estado: "dentro" }>;

/** La cara: la foto de la cuenta; sin foto, la letra del nombre; sin letra, el dibujo de la casa (el de las personas de la lista). */
function cara(e: Dentro): HTMLElement {
  const marco = document.createElement("span");
  marco.className = "cc-cara";
  const poner = (): void => {
    marco.querySelector(".hello-face")?.remove();
    if (e.inicial) {
      const letra = document.createElement("span");
      letra.className = "hello-face cc-letra";
      letra.setAttribute("aria-hidden", "true");
      letra.textContent = e.inicial;
      marco.prepend(letra);
    } else if (e.direccion) {
      const img = document.createElement("img");
      img.className = "hello-face";
      img.alt = "";
      img.src = avatar(e.direccion, 56);
      marco.prepend(img);
    } else {
      const icono = document.createElement("span");
      icono.className = "hello-face cc-icono";
      icono.setAttribute("aria-hidden", "true");
      icono.innerHTML = PERSONA;
      marco.prepend(icono);
    }
  };
  if (e.foto) {
    const img = document.createElement("img");
    img.className = "hello-face";
    img.alt = "";
    // Google a veces rechaza la foto cuando no llega el origen, y entonces el navegador pinta el icono de imagen
    // rota: se cambia por la letra o por el dibujo de la casa.
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", poner, { once: true });
    img.src = e.foto;
    marco.appendChild(img);
  } else poner();
  // El ✓, dibujado y no escrito: a 10 px una letra no se lee, y un dibujo sí.
  const ok = document.createElement("i");
  ok.className = "cc-ok";
  ok.setAttribute("aria-hidden", "true");
  ok.innerHTML = VISTO;
  marco.appendChild(ok);
  return marco;
}

/**
 * El chip, listo para ponerle su clic. Un botón (o un enlace con `enlace`), de 44 px de alto como mínimo. Con la
 * cuenta adentro lleva las clases de siempre (`hello`, `hello-face`), que miran los auditores y el panel.
 */
export function crearChip(e: EstadoCuenta, o: OpcionesDelChip): HTMLElement {
  const { tx } = o;
  // Conectando y retomando no son un botón: no hay nada que tocar, solo algo que está pasando (y se anuncia con calma).
  const ocupado = e.estado === "conectando" || e.estado === "retomando";
  const el = document.createElement(ocupado ? "span" : o.enlace ? "a" : "button");
  if (el instanceof HTMLButtonElement) el.type = "button";
  if (o.enlace && el instanceof HTMLAnchorElement) el.href = o.enlace;
  // `ocupado` es el estilo común de "Conectando…" y "Retomando…" (styles.css): sin él la palabra no se escondía en un
  // celular parado y la cuenta caía a una fila de más.
  el.className = `cuenta-chip ${e.estado}${ocupado ? " ocupado" : ""}`;
  el.dataset.estado = e.estado;

  if (e.estado === "fuera") {
    el.classList.add("mini");
    el.innerHTML = `<span class="cc-ico" aria-hidden="true">${PERSONA}</span><span class="cc-t">${esc(tx("cuentaEntrar"))}</span>`;
    el.setAttribute("aria-label", tx("cuentaEntrarAria"));
    return el;
  }

  if (e.estado === "conectando" || e.estado === "retomando") {
    const texto = tx(e.estado === "conectando" ? "connecting" : "cuentaRetomando");
    el.classList.add("mini");
    el.setAttribute("role", "status");
    el.setAttribute("aria-busy", "true");
    el.setAttribute("aria-label", texto);
    el.innerHTML = `<span class="cc-gira" aria-hidden="true"></span><span class="cc-t">${esc(texto)}</span>`;
    return el;
  }

  // Dentro.
  el.classList.add("hello", "mini");
  if (o.recien) el.classList.add("recien");
  const via = CLAVES_DE_VIA[e.via];
  const titulo = o.titulo ?? tituloDelChip(e);
  const nombre =
    typeof titulo === "string"
      ? titulo
      : titulo.tipo === "nombre" || titulo.tipo === "direccion"
        ? titulo.texto
        : titulo.tipo === "via"
          ? tx(via.larga)
          : e.via === "email"
            ? tx("cuentaCorreo")
            : tx("cuentaTuya");
  const larga = tx(via.larga);
  // La cuenta de prueba y Freighter ya se llaman por su vía: no se repite debajo.
  const repite = nombre === larga;
  el.appendChild(cara(e));
  const txt = document.createElement("span");
  txt.className = repite ? "cc-txt sin-via" : "cc-txt";
  // Cuando el nombre es la propia vía ("Cuenta de prueba") lleva las dos versiones, la larga y la corta ("Prueba"), y el CSS
  // muestra la que entra en cada ancho: la entera se cortaba a "Cuenta …" en la fila de una línea.
  txt.innerHTML = repite
    ? `<b class="cc-nombre"><span class="cc-via-l">${esc(larga)}</span><span class="cc-via-c">${esc(tx(via.corta))}</span></b>`
    : `<b class="cc-nombre">${esc(nombre)}</b>` +
      `<small class="cc-via"><span class="cc-via-l">${esc(larga)}</span><span class="cc-via-c">${esc(tx(via.corta))}</span></small>`;
  el.appendChild(txt);
  // Un botón dice qué es y qué hace; un enlace ya se lee por su texto.
  // Sin repetir: "Tu cuenta: Cuenta de prueba. Cuenta de prueba." se leía dos veces.
  if (!o.enlace) el.setAttribute("aria-label", repite ? tx("cuentaAriaSola").replace("{n}", nombre) : tx("cuentaAria").replace("{n}", nombre).replace("{v}", larga));
  return el;
}
