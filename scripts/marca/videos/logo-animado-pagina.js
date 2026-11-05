/*
 * El logo animado, del lado de la página: una función pura del tiempo. dibujar(t) pinta el cuadro
 * del segundo t sobre un lienzo de 1080 x 1920. Nada de Math.random ni de reloj: el mismo t da
 * el mismo cuadro. La geometría (la llama, las letras y los textos como trazos) llega en window.GEO,
 * armada por logo-animado.mjs con las mismas fuentes y el mismo icono que el resto de la marca.
 */
(() => {
  const W = 1080, H = 1920;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  document.body.append(cv);
  const c = cv.getContext("2d");
  const GEO = window.GEO;

  const PALETAS = {
    oscuro: { fondo: "#171126", llama: "#ff5cb3", tinta: "#f6efe2", acento: "#ff5cb3", placa: "#ffd24d", sombra: "#f6efe2", confeti: ["#ffd24d", "#ff8b3d", "#17c3b2", "#9b7bff", "#ff5cb3"] },
    claro: { fondo: "#fff6e9", llama: "#e93d9c", tinta: "#191919", acento: "#e93d9c", placa: "#ffc629", sombra: "#191919", confeti: ["#ffc629", "#ff7a1a", "#00a896", "#6c4ce0", "#e93d9c"] },
    // Para recortar: verde puro de croma y ningún acento que se le parezca.
    verde: { fondo: "#00ff00", llama: "#e93d9c", tinta: "#191919", acento: "#e93d9c", placa: "#ffc629", sombra: "#191919", confeti: ["#ffc629", "#ff7a1a", "#6c4ce0", "#e93d9c", "#191919"] },
    // Transparente: letras claras con contorno oscuro, que se leen sobre cualquier video.
    alfa: { fondo: null, llama: "#ff5cb3", tinta: "#f6efe2", acento: "#ff5cb3", placa: "#ffd24d", sombra: "#171126", contorno: "#171126", confeti: ["#ffd24d", "#ff8b3d", "#17c3b2", "#9b7bff", "#ff5cb3"] },
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const salida = (x) => 1 - (1 - x) ** 3;
  const atras = (x) => { const k = 1.70158, d = k + 1; return 1 + d * (x - 1) ** 3 + k * (x - 1) ** 2; };
  const rebote = (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };
  // Un azar que sale del número de pieza, no del reloj.
  const hash = (i, s = 0) => { let h = (i * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}z`;

  /** Pinta un trazado con el relleno, y debajo el contorno si la paleta lo pide. */
  function pintar(path, color, P, grosor = 0) {
    if (P.contorno) {
      c.lineJoin = "round"; c.strokeStyle = P.contorno; c.lineWidth = grosor || 16;
      c.stroke(path);
    }
    c.fillStyle = color; c.fill(path);
  }

  // La llama: nueve rectángulos del icono. Las patas son las de 18 a 24.
  const LL = GEO.llama; // [{r:[x,y,w,h], pata:i|-1}]
  const CAJA = GEO.caja; // {x:0,y:-2,w:22,h:26}

  /**
   * La llama de pie con la base de las patas en (px, py). alto: píxeles de pantalla. sx, sy: apachurre desde los pies.
   * paso: 0..1 para que las patas alternen (dos y dos), y mover: el rebote del cuerpo.
   */
  function llama(P, { px, py, alto, sx = 1, sy = 1, rot = 0, paso = 0, oreja = 0 }) {
    const k = alto / CAJA.h;
    c.save();
    c.translate(px, py);
    c.rotate(rot);
    c.scale(sx, sy);
    const base = (CAJA.y + CAJA.h) * k; // el borde de abajo de la caja
    const p = new Path2D();
    for (const { r: [x, y, w, h], pata, orejaR } of LL) {
      let dy = 0, dh = 0;
      // dos patas suben un poco, las otras dos quedan: se ve que trota
      if (pata >= 0) { const sube = (pata % 2 === 0 ? paso : -paso); dh = -clamp(sube, 0, 1) * 1.4; }
      const oy = orejaR ? oreja * 0.8 : 0;
      p.addPath(new Path2D(rect((x - CAJA.w / 2) * k, (y - CAJA.y) * k - base + dy * k + oy * k, w * k, (h + dh) * k)));
    }
    pintar(p, P.llama, P, alto * 0.05);
    c.restore();
  }

  /** Una palabra hecha de trazos, con la caja de cada letra para animarlas una por una. */
  function palabra(P, glifos, { x, y, esc, t0, sep = 0.06, colorDe, dur = 0.34, alto = 90 }) {
    glifos.forEach((g, i) => {
      const u = clamp((tiempo - (t0 + i * sep)) / dur);
      if (u <= 0) return;
      const s = atras(u);
      const dy = (1 - salida(u)) * alto;
      c.save();
      c.translate(x + g.cx * esc, y + g.cy * esc + dy);
      c.scale(esc * s, esc * s);
      c.translate(-g.cx, -g.cy);
      const path = new Path2D(g.d);
      pintar(path, colorDe(g, i), P, P.contorno ? 16 / esc : 0);
      c.restore();
    });
  }

  let tiempo = 0;

  /** Los cuadraditos de confeti que salen del punto de aterrizaje: píxeles, como la llama. */
  function confeti(P, { t0, x, y, n = 26, dur = 1.1 }) {
    const u = tiempo - t0;
    if (u < 0 || u > dur) return;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI * (0.05 + 0.9 * hash(i, 1));
      const v = 520 + 620 * hash(i, 2);
      const lado = 16 + Math.floor(hash(i, 3) * 3) * 8;
      const px = x + Math.cos(ang) * v * u * 0.8 + (hash(i, 4) - 0.5) * 60;
      const py = y + Math.sin(ang) * v * u + 900 * u * u;
      const vida = 1 - clamp((u - dur * 0.65) / (dur * 0.35));
      if (vida <= 0) continue;
      c.save();
      c.translate(px, py);
      c.rotate(Math.round(u * (3 + hash(i, 5) * 4)) * (Math.PI / 2)); // gira a saltos, como pixel art
      c.scale(vida, vida);
      const p = new Path2D(rect(-lado / 2, -lado / 2, lado, lado));
      pintar(p, P.confeti[i % P.confeti.length], P, 6);
      c.restore();
    }
  }

  /** La placa de la dirección: rectángulo con borde, sombra dura y un giro de un par de grados. */
  function placa(P, tex, { cx, cy, u, ancho, rot, color }) {
    if (u <= 0) return;
    const e = atras(clamp(u));
    const pad = 36;
    const esc = (ancho - pad * 2) / tex.ancho;
    const alto = tex.cap * esc + pad * 2;
    c.save();
    c.translate(cx, cy + (1 - salida(clamp(u))) * 260);
    c.rotate(rot);
    c.scale(e, e);
    const sombra = 14;
    const fondo = (dx, dy, col) => { c.fillStyle = col; c.fillRect(-ancho / 2 + dx, -alto / 2 + dy, ancho, alto); };
    fondo(sombra, sombra, P.sombra);
    fondo(0, 0, color || P.placa);
    c.lineWidth = 8; c.strokeStyle = P.sombra === "#f6efe2" ? "#171126" : "#191919";
    c.strokeRect(-ancho / 2, -alto / 2, ancho, alto);
    c.translate(-tex.ancho * esc / 2, tex.cap * esc / 2);
    c.scale(esc, esc);
    c.fillStyle = "#191919";
    c.fill(new Path2D(tex.d));
    c.restore();
  }

  /** Un renglón suelto, centrado. */
  function renglon(P, tex, { cx, cy, u, ancho, color }) {
    if (u <= 0) return;
    const esc = ancho / tex.ancho;
    c.save();
    c.globalAlpha = clamp(u * 1.5);
    c.translate(cx - ancho / 2, cy + tex.cap * esc / 2 + (1 - salida(clamp(u))) * 30);
    c.scale(esc, esc);
    const p = new Path2D(tex.d);
    pintar(p, color, P, P.contorno ? 10 / esc : 0);
    c.restore();
  }

  /**
   * El cuadro del segundo t. modo: "entrada" (la llama cae y las letras saltan) o "salida"
   * (el logo ya está, y suben la dirección y Instagram). lang: es o en, para la frase de la salida.
   */
  window.dibujar = (t, modo, paleta, lang = "es") => {
    tiempo = t;
    const P = PALETAS[paleta];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (P.fondo) { c.fillStyle = P.fondo; c.fillRect(0, 0, W, H); }
    const salidaModo = modo === "salida";
    // Los tiempos: la salida arranca con el logo ya puesto (un golpe corto para que no aparezca de la nada).
    const tl = salidaModo ? t + 1.35 : t; // la salida es la entrada vista desde el segundo 1,35

    const cx = W / 2;
    const esc = GEO.palabra.escala; // de la unidad de la fuente a píxeles: la palabra mide 820
    const baseY = salidaModo ? 770 : 900; // la línea de abajo de la palabra
    const llamaAlto = salidaModo ? 320 : 400;
    const pies = baseY - GEO.palabra.cap * esc - (salidaModo ? 40 : 60); // donde apoya la llama
    // ── la llama: cae, rebota y se apachurra al aterrizar; después trota en el lugar
    const caida = clamp(tl / 0.5);
    const yLlama = pies - (1 - rebote(caida)) * 1100;
    const aterriza = tl - 0.5; // desde el golpe
    let sx = 1, sy = 1;
    if (aterriza > 0 && aterriza < 0.45) {
      const q = aterriza / 0.45;
      const onda = Math.sin(q * Math.PI * 2.4) * (1 - q);
      sy = 1 - 0.22 * onda; sx = 1 + 0.18 * onda;
    }
    // un saltito a 1,3 s
    const saltito = clamp((tl - 1.3) / 0.45);
    const alzada = Math.sin(saltito * Math.PI) * 70;
    const trote = tl > 0.9 ? Math.sin(tl * 12) : 0;
    const pasoPatas = tl > 0.5 ? Math.max(0, trote) : 0;
    const orejita = tl > 0.9 ? Math.sin(tl * 9 + 1) * 0.6 : 0;
    // sombra de contacto en el piso: un renglón de píxeles
    if ((paleta === "oscuro" || paleta === "claro") && caida >= 1) {
      c.fillStyle = paleta === "claro" ? "rgba(25,25,25,.12)" : "rgba(0,0,0,.28)";
      const ancho = llamaAlto * (22 / 26) * (1 - alzada / 260);
      c.fillRect(cx - ancho / 2, pies + 6, ancho, 18);
    }
    llama(P, { px: cx, py: yLlama - alzada, alto: llamaAlto, sx, sy, paso: pasoPatas, oreja: orejita });
    confeti(P, { t0: 0.5, x: cx, y: pies - 40 });
    confeti(P, { t0: 1.3, x: cx, y: pies - 40, n: 10, dur: 0.7 });

    // ── la palabra: las letras saltan de a una, con ZO en el color de la llama
    palabra(P, GEO.palabra.glifos, {
      x: cx - (GEO.palabra.ancho * esc) / 2, y: baseY, esc, t0: 0.62, sep: 0.065,
      colorDe: (g) => (g.ch === "Z" || g.ch === "O" ? P.acento : P.tinta),
      alto: 90,
    });

    // ── la salida: la dirección y la cuenta de Instagram suben en placas; la frase va abajo
    if (salidaModo) {
      const u1 = (tl - 1.75) / 0.45;
      const u2 = (tl - 2.0) / 0.45;
      const u3 = (tl - 2.35) / 0.5;
      placa(P, GEO.web, { cx, cy: 920, u: u1, ancho: 860, rot: -0.025, color: P.placa });
      placa(P, GEO.insta, { cx, cy: 1090, u: u2, ancho: 860, rot: 0.02, color: P.acento === "#ff5cb3" ? "#ff5cb3" : "#e93d9c" });
      GEO.frase[lang].forEach((linea, i) => renglon(P, linea, { cx, cy: 1215 + i * 62, u: u3 - i * 0.12, ancho: Math.min(940, linea.ancho * (40 / linea.cap)), color: P.tinta }));
    }
    return true;
  };
  window.PNG = (alfa) => cv.toDataURL("image/png").slice(22);
})();
