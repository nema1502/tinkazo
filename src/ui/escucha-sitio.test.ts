import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La página de escucha abre en el sitio construido y en la vista previa, no solo con el servidor de desarrollo, para
 * que quien elige la música la escuche en el celular y en el parlante del proyector. Pero sigue siendo una mesa de
 * trabajo: sin ningún enlace desde el sitio, fuera del mapa del sitio y sin que la indexen los buscadores.
 */

const leer = (ruta: string): string => readFileSync(resolve(process.cwd(), ruta), "utf8");

describe("la página de escucha en el build", () => {
  it("vive en la raíz, como las otras páginas, y no queda copia suelta en src", () => {
    expect(existsSync(resolve(process.cwd(), "escucha.html"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "src/ui/escucha.html"))).toBe(false);
  });

  it("está en las entradas del build", () => {
    expect(leer("vite.config.ts")).toMatch(/escucha: resolve\(__dirname, "escucha\.html"\),/);
  });

  it("carga su código desde la raíz del sitio, para que el build lo empaquete", () => {
    expect(leer("escucha.html")).toMatch(/<script type="module" src="\/src\/ui\/escucha\.ts"><\/script>/);
  });

  it("los buscadores no la indexan: noindex en la página y en la cabecera", () => {
    expect(leer("escucha.html")).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/);
    const cabeceras = JSON.parse(leer("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const propia = cabeceras.headers.find((h) => h.source === "/escucha.html");
    expect(propia?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
  });

  it("ninguna página del sitio la enlaza, ni el mapa del sitio la lista", () => {
    const raiz = readdirSync(process.cwd()).filter((f) => f.endsWith(".html") && f !== "escucha.html");
    for (const archivo of raiz) expect(leer(archivo), archivo).not.toMatch(/escucha\.html|[?&]escucha=/);
    expect(leer("public/sitemap.xml")).not.toContain("escucha");
    expect(leer("public/robots.txt")).not.toContain("escucha");
  });

  it("con colores de la marca en los dos temas y blancos de toque de 44 píxeles", () => {
    const html = leer("escucha.html");
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(html).toMatch(/:root\[data-theme="dark"\]/);
    expect(html).toMatch(/background: var\(--fondo\)/);
    expect(html).toMatch(/min-height: 44px/);
  });

  it("los enlaces de la página también son blancos de toque de 44 píxeles", () => {
    expect(leer("escucha.html")).toMatch(/\.nota a \{[^}]*display: inline-block;[^}]*min-height: 44px;/);
  });
});
