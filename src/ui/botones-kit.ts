import { JUEGOS, clavesDe } from "../games/pixi/kit/catalogo";

/**
 * Un botón en el selector por cada juego del kit que no tenga ya el suyo en el
 * markup (`index.html` trae los diez de siempre).
 *
 * Los que nacieron apagados (`selector: false`) quedan **ocultos**: el botón
 * existe, para que `?demo=<id>` encuentre su juego y `audit-game` lo vea
 * ("apagado"), pero nadie lo puede elegir. Un juego encendido queda a la vista
 * al final de la lista, con la captura del juego en cada tema
 * (`public/juegos/selector/<id>.webp` y `-light.webp`; el CSS muestra la del tema).
 * El texto sale del diccionario por convención
 * (`game<Id>`, ver `clavesDe`); `setLang` lo pinta, así que esto corre antes.
 */
export function crearBotonesDelKit(doc: Document = document): HTMLButtonElement[] {
  const caja = doc.getElementById("gamepick");
  if (!caja) return [];
  const nuevos: HTMLButtonElement[] = [];
  for (const j of JUEGOS) {
    if (doc.getElementById(`g-${j.id}`)) continue;
    const boton = doc.createElement("button");
    boton.id = `g-${j.id}`;
    boton.type = "button";
    if (j.selector) {
      for (const [clase, sufijo] of [["sel-osc", ""], ["sel-cla", "-light"]] as const) {
        const img = doc.createElement("img");
        img.className = `sel-img ${clase}`;
        img.src = `/juegos/selector/${j.id}${sufijo}.webp`;
        img.width = 320;
        img.height = 180;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        boton.append(img);
      }
    }
    const nombre = doc.createElement("span");
    nombre.dataset.i = clavesDe(j.id).boton;
    nombre.textContent = j.id;
    boton.append(nombre);
    if (!j.selector) {
      // Oculto de las dos maneras: ni una regla de CSS le devuelve la vista.
      boton.hidden = true;
      boton.style.display = "none";
    }
    caja.append(boton);
    nuevos.push(boton);
  }
  return nuevos;
}
