import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ventanas from "../scripts/marca/videos/ventanas.json";
import { T } from "./i18n";
import {
  CLIPS,
  GUIONES,
  INSTAGRAM,
  INSTAGRAM_URL,
  KIT_BASE,
  KIT_PUBLICADO,
  LOGOS_ANIMADOS,
  PASOS_CAPCUT,
  SEG_CIERRE,
  WEB,
  PASO_GRABAR,
  archivoBucle,
  pasosActuales,
  archivoGuion,
  archivoSubtitulos,
  guionComoTexto,
  subtitulosSrt,
  tiempoSrt,
  urlKit,
} from "./marca-creadores";
import { TEXTOS_CREADORES } from "./marca-creadores-textos";

const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
// Lo mismo que acepta el Worker (workers/musica/src/kit.ts) como nombre de archivo del kit.
const NOMBRE_KIT = /^[a-z0-9][a-z0-9._-]{0,79}\.(?:mp4|webm|mov|png|jpg|webp|svg|srt|txt|zip|json)$/;
const PROHIBIDAS = /·|drand|hash|bls|firma|webgl|worker|bytes|casino|apost|jackpot|azar|suerte|dados|cartas|fichas|tragamonedas|raffle/i;

const TEXTO_VISIBLE = (): string[] => [
  ...Object.values(TEXTOS_CREADORES.es),
  ...Object.values(TEXTOS_CREADORES.en),
  ...PASOS_CAPCUT.flatMap((p) => [p.es, p.en]),
  ...CLIPS.flatMap((c) => [c.nombre.es, c.nombre.en]),
  ...GUIONES.flatMap((g) => [
    g.titulo.es, g.titulo.en, g.gancho.es, g.gancho.en, g.voz.es, g.voz.en, g.cierre.es, g.cierre.en, g.toque.es, g.toque.en, g.hashtags,
    ...g.momentos.flatMap((m) => [m.es, m.en]),
    ...g.pantalla.flatMap((l) => [l.es, l.en]),
  ]),
];

describe("el kit para creadores", () => {
  it("hay diez guiones y diez clips, uno por juego del kit, y coinciden con lo que graba grabar-clips", () => {
    const juegos = Object.keys(ventanas.juegos).sort();
    expect(juegos).toHaveLength(10);
    expect(GUIONES.map((g) => g.juego).sort()).toEqual(juegos);
    expect(CLIPS.map((c) => c.juego).sort()).toEqual(juegos);
    for (const c of CLIPS) {
      const v = (ventanas.juegos as Record<string, { archivo: string; desde: number; hasta: number }>)[c.juego];
      expect(c.archivo, c.juego).toBe(`tinkazo-${v?.archivo}-9x16.mp4`);
      // La duración de la ficha es la de la ventana grabada más el segundo quieto del cartel, de 8 a 15 segundos.
      expect(c.seg, c.juego).toBeCloseTo((v?.hasta ?? 0) - (v?.desde ?? 0) + 1, 1);
      // El cartel sale antes del final, y el texto en pantalla del guion termina antes del cartel.
      expect(c.cartel, c.juego).toBeLessThan(c.seg - 1);
      expect(c.seg).toBeGreaterThanOrEqual(8);
      expect(c.seg).toBeLessThanOrEqual(15);
    }
  });

  it("lo que dice la sección depende de si los clips se pueden bajar: hoy solo guiones, y el paso 1 coherente con cada estado", () => {
    for (const lang of ["es", "en"] as const) {
      const hoy = TEXTOS_CREADORES[lang].crB, listo = TEXTOS_CREADORES[lang].crBListo;
      // Sin clips publicados, la bajada no promete clips para bajar: dice que llegan pronto.
      expect(hoy).toMatch(lang === "es" ? /llegan pronto/ : /coming soon/);
      expect(hoy).not.toMatch(lang === "es" ? /acá tenés un clip|Todo se baja/ : /here is a vertical clip|All free to download/);
      expect(listo).toMatch(lang === "es" ? /clip vertical de cada juego/ : /vertical clip of every game/);
      // Paso 1: sin clips, grabar la pantalla; con clips, bajar el clip.
      expect(pasosActuales(false)[0]?.[lang]).toBe(PASO_GRABAR[lang]);
      expect(pasosActuales(true)[0]?.[lang]).toBe(PASOS_CAPCUT[0]?.[lang]);
      expect(pasosActuales(false)).toHaveLength(PASOS_CAPCUT.length);
      // Sin clips, ningún paso manda a bajar algo que todavía no está.
      for (const p of pasosActuales(false)) expect(p.es).not.toMatch(/Bajá el clip|poné el logo de cierre|elegí el clip/);
    }
  });

  it("los guiones no tapan el cartel, no huelen a apuesta y el gancho no contradice el contador", () => {
    for (const g of GUIONES) {
      const c = CLIPS.find((x) => x.juego === g.juego)!;
      for (const l of g.pantalla) expect(l.hasta, `${g.juego}: ${l.es}`).toBeLessThan(c.cartel + 0.05);
      for (const lang of ["es", "en"] as const) {
        const todo = [g.titulo[lang], g.gancho[lang], g.voz[lang], g.cierre[lang], ...g.pantalla.map((x) => x[lang]), ...g.momentos.map((x) => x[lang])].join(" ");
        expect(todo).not.toMatch(/era el tuyo|was it yours|casi|almost|se movió|it moved|un gajo más|one more slice/i);
      }
    }
    const carrera = GUIONES.find((g) => g.juego === "race")!;
    expect(carrera.cierre.es).toContain("¿Y si era tu nombre?");
    expect(carrera.cierre.en).toContain("What if it was your name?");
    // En la piñata el contador dice seis al empezar: el gancho no dice cuántos quedan.
    const pinata = GUIONES.find((g) => g.juego === "pinata")!;
    expect(pinata.gancho.es).not.toMatch(/quedan dos/i);
    expect(pinata.pantalla[0]?.es).not.toMatch(/quedan dos/i);
  });

  it("cada clip tiene su versión en bucle, con el mismo nombre y -bucle al final", () => {
    for (const c of CLIPS) expect(archivoBucle(c), c.juego).toBe(c.archivo.replace("-9x16.mp4", "-9x16-bucle.mp4"));
  });

  it("los clips de las ventanas no arrancan antes del segundo que pide el fundido de la versión en bucle", () => {
    for (const [j, v] of Object.entries(ventanas.juegos as Record<string, { desde: number }>)) expect(v.desde, j).toBeGreaterThanOrEqual(1);
  });

  it("todos los archivos del kit tienen un nombre que el Worker entrega, sin repetirse", () => {
    const nombres = [
      ...CLIPS.flatMap((c) => [c.archivo, archivoBucle(c)]),
      ...LOGOS_ANIMADOS.map((l) => l.archivo),
      ...GUIONES.flatMap((g) => (["es", "en"] as const).flatMap((l) => [archivoGuion(g, l), archivoSubtitulos(g, l)])),
    ];
    for (const n of nombres) expect(n, n).toMatch(NOMBRE_KIT);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(urlKit("a.mp4")).toBe("https://m.tinkazo.app/kit/a.mp4");
    expect(KIT_BASE.endsWith("/kit/")).toBe(true);
  });

  it("los videos están publicados en m.tinkazo.app/kit/, y los enlaces salen del módulo, no del HTML", () => {
    expect(KIT_PUBLICADO).toBe(true);
    const html = leer("marca.html");
    expect(html).toMatch(/id="cr-descargas" hidden/);
    expect(html).toMatch(/id="cr-aviso"[^>]*hidden/);
    // Sin enlaces a m.tinkazo.app escritos a mano en el HTML: salen del módulo, y solo con la constante en true.
    expect(html).not.toContain("m.tinkazo.app");
  });

  it("el logo animado trae entrada y cierre (en los dos idiomas) con fondo oscuro, claro, verde y transparente", () => {
    expect(LOGOS_ANIMADOS).toHaveLength(12);
    for (const fondo of ["oscuro", "claro", "verde", "alfa"]) {
      expect(LOGOS_ANIMADOS.some((l) => l.tipo === "entrada" && l.fondo === fondo), fondo).toBe(true);
      for (const idioma of ["es", "en"]) expect(LOGOS_ANIMADOS.some((l) => l.tipo === "salida" && l.idioma === idioma && l.fondo === fondo), `${idioma} ${fondo}`).toBe(true);
    }
    expect(LOGOS_ANIMADOS.filter((l) => l.fondo === "alfa").every((l) => l.archivo.endsWith(".webm"))).toBe(true);
    expect(SEG_CIERRE).toBeGreaterThanOrEqual(2);
    expect(SEG_CIERRE).toBeLessThanOrEqual(3.5);
  });

  it("la dirección y Instagram son los de siempre, con k", () => {
    expect(WEB).toBe("tinkazo.app");
    expect(INSTAGRAM).toBe("@tinkazo.app");
    expect(INSTAGRAM_URL).toBe("https://www.instagram.com/tinkazo.app/");
    for (const g of GUIONES) {
      expect(`${g.cierre.es} ${g.cierre.en}`, g.juego).toMatch(/tinkazo\.app/);
      expect(g.hashtags, g.juego).toMatch(/^#tinkazo /);
    }
  });
});

describe("los guiones", () => {
  it("cada uno trae gancho en los dos primeros segundos, texto en pantalla ordenado y dentro del clip, y todo en es y en", () => {
    for (const g of GUIONES) {
      const clip = CLIPS.find((c) => c.juego === g.juego);
      expect(clip, g.juego).toBeTruthy();
      const l0 = g.pantalla[0];
      expect(l0?.desde, g.juego).toBe(0);
      expect(l0?.hasta, `${g.juego}: el gancho cabe en los dos primeros segundos`).toBeLessThanOrEqual(2.5);
      expect(l0?.es, g.juego).toBe(g.gancho.es);
      expect(l0?.en, g.juego).toBe(g.gancho.en);
      let fin = 0;
      for (const l of g.pantalla) {
        expect(l.desde, `${g.juego} ${l.es}`).toBeGreaterThanOrEqual(fin);
        expect(l.hasta, `${g.juego} ${l.es}`).toBeGreaterThan(l.desde);
        expect(l.hasta, `${g.juego} ${l.es}`).toBeLessThanOrEqual((clip?.seg ?? 0) + 0.01);
        expect(l.es.length).toBeGreaterThan(0);
        expect(l.en).not.toBe(l.es);
        fin = l.hasta;
      }
      expect(g.pantalla.length).toBeGreaterThanOrEqual(3);
      expect(g.momentos.length).toBeGreaterThanOrEqual(3);
      for (const campo of [g.titulo, g.gancho, g.voz, g.cierre, g.toque]) {
        expect(campo.es.length).toBeGreaterThan(10);
        expect(campo.en, `${g.juego}: ${campo.es}`).not.toBe(campo.es);
      }
    }
  });

  it("lo que lee el texto en pantalla es corto (cabe en una pantalla vertical sin saturar)", () => {
    for (const g of GUIONES) for (const l of g.pantalla) {
      expect(l.es.length, `${g.juego}: ${l.es}`).toBeLessThanOrEqual(70);
      expect(l.en.length, `${g.juego}: ${l.en}`).toBeLessThanOrEqual(70);
    }
  });

  it("ningún texto visible huele a apuesta ni a casino, ni usa el punto medio, ni tecnicismos", () => {
    for (const t of TEXTO_VISIBLE()) expect(t, t).not.toMatch(PROHIBIDAS);
  });

  it("el guion como texto lleva todas las partes y los pasos de CapCut, en cada idioma", () => {
    for (const g of GUIONES) {
      const es = guionComoTexto(g, "es");
      expect(es).toContain("GANCHO (0 a 2 s)");
      expect(es).toContain(g.gancho.es);
      expect(es).toContain("CÓMO ARMARLO EN CAPCUT");
      expect(es).toContain("tinkazo.app @tinkazo.app");
      const en = guionComoTexto(g, "en");
      expect(en).toContain("HOOK (0 to 2 s)");
      expect(en).toContain("PUTTING IT TOGETHER IN CAPCUT");
      expect(en).toContain(g.cierre.en);
      expect(en).not.toContain(g.gancho.es);
      expect(en).not.toMatch(/\d a \d/);
      // Sin clips, el guion manda a grabar el ejemplo; con los clips publicados, nombra el archivo y nada más.
      expect(guionComoTexto(g, "es", false)).toContain(`?demo=${g.juego}`);
      if (KIT_PUBLICADO) expect(es).not.toContain("se publica pronto");
      expect(guionComoTexto(g, "es", true)).not.toContain("se publica pronto");
      expect(guionComoTexto(g, "es", true)).toContain(PASOS_CAPCUT[0]!.es);
    }
    expect(PASOS_CAPCUT.length).toBeGreaterThanOrEqual(8);
  });

  it("los subtítulos SRT tienen el formato de siempre", () => {
    expect(tiempoSrt(0)).toBe("00:00:00,000");
    expect(tiempoSrt(2.4)).toBe("00:00:02,400");
    expect(tiempoSrt(65.25)).toBe("00:01:05,250");
    for (const g of GUIONES) {
      const srt = subtitulosSrt(g, "es");
      const bloques = srt.trim().split("\n\n");
      expect(bloques).toHaveLength(g.pantalla.length);
      bloques.forEach((b, i) => {
        const [n, t, ...texto] = b.split("\n");
        expect(n).toBe(String(i + 1));
        expect(t).toMatch(/^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
        expect(texto.join(" ")).toBe(g.pantalla[i]?.es);
      });
    }
  });
});

describe("la sección de marca.html", () => {
  const html = leer("marca.html");

  it("está en la página, con sus títulos y sus contenedores, y todo con clave de traducción en es y en", () => {
    expect(html).toContain('id="creadores"');
    for (const id of ["cr-clips", "cr-logos", "cr-pasos", "cr-guiones", "cr-estado"]) expect(html, id).toContain(`id="${id}"`);
    for (const clave of ["crT", "crB", "crAviso", "crClipsT", "crClipsB", "crLogosT", "crLogosB", "crGuiaT", "crGuiaB", "crSegurasT", "crSeguras", "crUsoT", "crUso", "crGuionesT", "crGuionesB"]) {
      expect(html, clave).toContain(`data-i="${clave}"`);
      expect(TEXTOS_CREADORES.es[clave], clave).toBeTruthy();
      expect(TEXTOS_CREADORES.en[clave], clave).toBeTruthy();
      expect(T.es[clave], `${clave} en el diccionario es`).toBe(TEXTOS_CREADORES.es[clave]);
      expect(T.en[clave], `${clave} en el diccionario en`).toBe(TEXTOS_CREADORES.en[clave]);
      expect(TEXTOS_CREADORES.en[clave], clave).not.toBe(TEXTOS_CREADORES.es[clave]);
    }
    // El texto de respaldo del markup es el del diccionario en español: no se separan.
    for (const clave of ["crT", "crB", "crSeguras", "crUso"]) expect(html, clave).toContain(TEXTOS_CREADORES.es[clave] as string);
  });

  it("cada rótulo que pinta el código existe en los dos idiomas", () => {
    const codigo = leer("src/marca-creadores-ui.ts");
    const claves = [...codigo.matchAll(/texto\("([A-Za-z0-9]+)"\)/g)].map((m) => m[1] as string);
    expect(claves.length).toBeGreaterThan(10);
    for (const k of new Set(claves)) {
      expect(TEXTOS_CREADORES.es[k], `es.${k}`).toBeTruthy();
      expect(TEXTOS_CREADORES.en[k], `en.${k}`).toBeTruthy();
    }
  });

  it("la zona segura que se dice en la página es la de los pasos y los guiones", () => {
    expect(TEXTOS_CREADORES.es.crSeguras).toContain("15 %");
    expect(TEXTOS_CREADORES.es.crSeguras).toContain("65 %");
    expect(PASOS_CAPCUT[3]?.es).toContain("15 % y el 65 %");
  });
});
