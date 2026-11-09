/*
 * Del lado de la página: junta los lienzos del estadio en un solo cuadro vertical
 * y lo entrega como JPEG. Solo el dibujo del juego: nada de la interfaz del sitio.
 */
(() => {
  const C = window.__clip;
  const estadio = () => document.getElementById("stadium");
  const visible = () => { const s = estadio(); return !!s && s.style.display === "block"; };
  const nextTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const sleep = (ms) => new Promise((r) => C.real.setTimeout(r, ms));
  let comp = null, ctx = null;

  /** Los lienzos que se ven, de abajo hacia arriba (el 3D debajo, PixiJS encima). */
  function lienzos() {
    const e = estadio();
    if (!e) return [];
    return [...e.querySelectorAll("canvas")]
      .filter((c) => c.width > 0 && c.height > 0 && c.style.visibility !== "hidden" && c.style.display !== "none" && getComputedStyle(c).visibility !== "hidden")
      .map((c, i) => ({ c, z: Number(getComputedStyle(c).zIndex) || 0, i }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map((x) => x.c);
  }

  C.preparar = async (w, h) => {
    comp = document.createElement("canvas"); comp.width = w; comp.height = h;
    ctx = comp.getContext("2d", { alpha: false });
    let n = 0;
    while (!visible()) { C.paso(1); n++; await sleep(5); if (n > 3000) throw new Error("el estadio no abrió"); }
    return { arranque: C.virt() / 1000 };
  };
  C.visible = visible;
  C.cartel = () => { const cv = estadio() && estadio().querySelector("#pixi-canvas"); return !!(cv && cv.dataset && cv.dataset.cartel); };
  C.texto = () => { const cm = document.getElementById("commentary"); return cm ? (cm.textContent || "").trim() : ""; };
  C.lienzos = () => lienzos().map((c) => ({ id: c.id, w: c.width, h: c.height }));

  /** Pinta los lienzos en el cuadro, a todo el tamaño (cubre el cuadro, centrado). */
  C.componer = () => {
    const w = comp.width, h = comp.height;
    ctx.fillStyle = "#171126"; ctx.fillRect(0, 0, w, h);
    for (const c of lienzos()) ctx.drawImage(c, 0, 0, w, h);
  };
  C.jpeg = (calidad = 0.95, ancho = 0) => {
    if (!ancho) return comp.toDataURL("image/jpeg", calidad).slice(23);
    const t = document.createElement("canvas"); t.width = ancho; t.height = Math.round(ancho * comp.height / comp.width);
    t.getContext("2d").drawImage(comp, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.8).slice(23);
  };
  C.suelta = nextTask;
})();
