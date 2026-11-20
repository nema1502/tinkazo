import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/campana/crear.css", "utf8");
const general = readFileSync("src/styles.css", "utf8");
const campana = readFileSync("src/campana/campana.css", "utf8");

/** El contenido de las llaves de la primera regla con ese selector, en toda la hoja. */
function regla(selector: string, hoja = css): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*${escapado}\\s*\\{([^}]*)\\}`, "u").exec(hoja)?.[1] ?? "";
}

/** Lo que va dentro del bloque @media de laptop (min-width: 900px), con sus llaves anidadas. */
function bloqueDeLaptop(): string {
  const inicio = css.indexOf("@media (min-width: 900px) {");
  expect(inicio).toBeGreaterThan(0);
  let nivel = 0;
  for (let i = css.indexOf("{", inicio); i < css.length; i += 1) {
    if (css[i] === "{") nivel += 1;
    if (css[i] === "}") nivel -= 1;
    if (nivel === 0) return css.slice(css.indexOf("{", inicio) + 1, i);
  }
  return "";
}

describe("la página para armar campañas, en el celular", () => {
  it("el botón principal ocupa el ancho completo y mide 56 px o más", () => {
    const principal = regla(".ccp .primary");
    expect(principal).toMatch(/width:\s*100%\s*;/u);
    expect(principal).toMatch(/min-height:\s*(?:5[6-9]|[6-9]\d)px\s*;/u);
    expect(principal).toMatch(/font-size:\s*var\(--letra-prin\)\s*;/u);
  });

  it("la barra con el botón queda pegada abajo y respeta el borde de los celulares con muesca", () => {
    const barra = regla(".ccp-accion");
    expect(barra).toMatch(/position:\s*sticky\s*;/u);
    expect(barra).toMatch(/bottom:\s*0\s*;/u);
    expect(barra).toContain("env(safe-area-inset-bottom)");
  });

  it("el título usa clamp de 26 px, 8vw y 40 px", () => {
    expect(regla(".ccp-titulo")).toMatch(/font-size:\s*clamp\(26px,\s*8vw,\s*40px\)/u);
  });

  it("el resumen del premio usa clamp de 32 px, 10vw y 56 px", () => {
    expect(regla(".ccp-premio")).toMatch(/font-size:\s*clamp\(32px,\s*10vw,\s*56px\)/u);
  });

  it("usa todo el ancho menos 16 px por lado", () => {
    expect(regla(".ccp")).toMatch(/padding:\s*0 16px\s*;/u);
    expect(regla(".ccp")).toMatch(/width:\s*100%\s*;/u);
  });

  it("los blancos de toque miden 44 px o más", () => {
    for (const selector of [".ccp-circulo", ".ccp-mas-boton", ".ccp-secundario", ".ccp-enlace", ".ccp-pestana"]) {
      expect(regla(selector), selector).toMatch(/(?:min-)?height:\s*(?:4[4-9]|[5-9]\d)px\s*;/u);
    }
    expect(regla(".ccp-monto")).toMatch(/min-height:\s*(?:5[6-9]|[6-9]\d)px\s*;/u);
  });

  it("los seis círculos de paso se reparten el ancho para que entren en un celular de 360", () => {
    expect(regla(".ccp-circulo-item")).toMatch(/flex:\s*1\s*;/u);
    expect(regla(".ccp-circulo-item")).toMatch(/min-width:\s*0\s*;/u);
    expect(regla(".ccp-circulos")).toMatch(/min-width:\s*0\s*;/u);
  });

  it("el texto de en qué paso está queda solo para lectores de pantalla debajo de 900 px", () => {
    expect(regla(".ccp-paso-de")).toMatch(/position:\s*absolute\s*;/u);
    expect(regla(".ccp-paso-de")).toMatch(/clip:\s*rect\(0 0 0 0\)/u);
  });

  it("la vista a pantalla completa en el celular es fija y cubre toda la ventana", () => {
    const abierta = regla(".ccp-vista.ccp-vista-abierta");
    expect(abierta).toMatch(/position:\s*fixed\s*;/u);
    expect(abierta).toMatch(/inset:\s*0\s*;/u);
    expect(abierta).toMatch(/flex-direction:\s*column\s*;/u);
  });

  it("la barra de la vista tiene dos filas y las cuatro pestañas son una grilla de cuatro columnas iguales", () => {
    expect(regla(".ccp-vista-barra")).toMatch(/flex-direction:\s*column\s*;/u);
    expect(regla(".ccp-pestanas")).toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)/u);
  });

  it("el iframe de la vista abierta llena lo que queda y no resta un alto fijo", () => {
    expect(regla(".ccp-marco iframe")).toMatch(/flex:\s*1\s*;/u);
    expect(regla(".ccp-marco iframe")).toMatch(/min-height:\s*0\s*;/u);
    expect(css).not.toMatch(/calc\(100%\s*-\s*\d+px\)/u);
  });

  it("la regla de hidden queda arriba de todo y gana a cualquier otro display", () => {
    expect(/\.ccp \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/u.test(css)).toBe(true);
    expect(css.indexOf(".ccp [hidden]")).toBeLessThan(css.indexOf(".ccp {"));
  });

  it("ninguna clase ccp- está en la hoja general del sitio ni en la de la campaña", () => {
    const clases = new Set([...css.matchAll(/(?<![\w-])\.(ccp-[a-z0-9-]+)/gu)].map((m) => m[1] ?? ""));
    for (const clase of clases) {
      expect(general.includes(`.${clase}`), clase).toBe(false);
      expect(campana.includes(`.${clase}`), clase).toBe(false);
    }
  });

  it("no usa colores sueltos: todo sale de las variables del sitio, salvo el fondo del marco del celular", () => {
    const sueltos = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)].map((m) => m[0]);
    expect(sueltos).toEqual(["#fff"]);
  });

  it("apaga las animaciones para quien lo pide", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
  });
});

describe("la página para armar campañas, en una laptop", () => {
  const laptop = bloqueDeLaptop();

  it("desde 900 px son dos columnas que ocupan el alto completo, con dvh y su respaldo en vh", () => {
    expect(laptop).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*max-content\s*;/u);
    expect(laptop).toMatch(/height:\s*calc\(100vh - var\(--cmp-cab\)\)\s*;\s*height:\s*calc\(100dvh - var\(--cmp-cab\)\)\s*;/u);
  });

  it("la columna de la vista es auto, del ancho del marco ya escalado", () => {
    expect(laptop).toMatch(/\.ccp-marco \{[^}]*width:\s*calc\(390px \* var\(--ccp-escala, 1\)\)/u);
    expect(laptop).toMatch(/\.ccp-marco \{[^}]*height:\s*calc\(844px \* var\(--ccp-escala, 1\)\)/u);
    expect(laptop).toMatch(/\.ccp-marco iframe \{[^}]*transform:\s*scale\(var\(--ccp-escala, 1\)\)/u);
    expect(laptop).toMatch(/\.ccp-marco iframe \{[^}]*width:\s*390px\s*;\s*height:\s*844px/u);
  });

  it("las cuatro pestañas van en vertical al costado del marco", () => {
    expect(laptop).toMatch(/\.ccp-pestanas \{[^}]*flex-direction:\s*column/u);
    expect(laptop).toMatch(/\.ccp-vista \{[^}]*flex-direction:\s*row/u);
  });

  it("los montos son una grilla de cuatro columnas que llena el ancho, de 56 a 72 px de alto y con letra de 24 a 40 px", () => {
    expect(laptop).toMatch(/\.ccp-montos \{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/u);
    expect(laptop).toMatch(/\.ccp-monto \{[^}]*min-height:\s*clamp\(56px,\s*8\.5vh,\s*72px\)/u);
    expect(laptop).toMatch(/\.ccp-monto \{[^}]*font-size:\s*clamp\(24px,\s*2\.4vw,\s*40px\)/u);
  });

  it("los contadores y los campos miden 56 px o más con letra de 20 px", () => {
    expect(laptop).toMatch(/\.ccp-entrada, \.ccp-bases \{[^}]*min-height:\s*56px\s*;[^}]*font-size:\s*20px/u);
    expect(laptop).toMatch(/\.ccp-paso-contador \{[^}]*width:\s*clamp\(56px,\s*8vh,\s*72px\)\s*;[^}]*height:\s*clamp\(56px,\s*8vh,\s*72px\)/u);
  });

  it("el resumen del premio crece y el título también", () => {
    expect(laptop).toMatch(/\.ccp-premio \{[^}]*font-size:\s*clamp\(28px,\s*min\(3vw,\s*6vh\),\s*48px\)/u);
    expect(laptop).toMatch(/\.ccp-titulo \{[^}]*font-size:\s*clamp\(36px,\s*3\.4vw,\s*56px\)/u);
  });

  it("el paso arranca arriba con un espacio parejo y no reparte sus piezas a lo alto, y la barra queda abajo sin pegarse a la ventana", () => {
    expect(laptop).toMatch(/\.ccp-cuerpo \{[^}]*justify-content:\s*flex-start/u);
    expect(laptop).toMatch(/\.ccp-cuerpo \{[^}]*gap:\s*clamp\(16px,\s*3vh,\s*32px\)/u);
    expect(laptop).toMatch(/\.ccp-accion \{[^}]*position:\s*static/u);
  });

  it("el botón de ver la vista y el de volver no se muestran", () => {
    expect(laptop).toMatch(/\.ccp-ver-vista, \.ccp-volver \{\s*display:\s*none\s*;/u);
  });

  it("el texto de en qué paso está se ve", () => {
    expect(laptop).toMatch(/\.ccp-paso-de \{[^}]*position:\s*static/u);
  });

  it("la cabecera usa el ancho del panel y no el de una página angosta", () => {
    expect(laptop).toMatch(/\.pg-crear header \.bar \{[^}]*max-width:\s*none\s*;[^}]*padding:\s*0 24px/u);
  });

  it("las bases llenan la columna: el cuadro crece y se achica sin desplazar el paso", () => {
    expect(regla(".ccp-bases")).toMatch(/flex:\s*1 1 0\s*;/u);
    expect(laptop).toMatch(/\.ccp \.ccp-bases \{[^}]*min-height:\s*120px/u);
  });

  it("los campos de texto de 20 px usan la letra del sitio y Subir el logo pesa como los demás botones", () => {
    expect(laptop).toMatch(/\.ccp input\.ccp-entrada \{[^}]*font-size:\s*20px/u);
    expect(laptop).toMatch(/\.ccp-logo \.ccp-secundario \{[^}]*min-height:\s*56px/u);
  });
});

describe("lo que se corrigió después de mirar las capturas", () => {
  it("el pie no se muestra y la barra de abajo deja lugar para llevar un aviso a la vista", () => {
    expect(regla(".pg-crear footer")).toMatch(/display:\s*none\s*;/u);
    expect(css).toMatch(/html:has\(> body\.pg-crear\) \{[^}]*scroll-padding-bottom:\s*160px/u);
  });

  it("los campos de texto no usan la monoespaciada de los campos de texto del sitio", () => {
    expect(regla(".ccp input.ccp-entrada")).toMatch(/font:\s*inherit\s*;\s*font-size:\s*16px\s*;/u);
  });

  it("los botones de abajo van apilados: el principal a todo el ancho y su compañero debajo", () => {
    expect(regla(".ccp-botones")).toMatch(/display:\s*flex\s*;\s*flex-direction:\s*column\s*;/u);
    expect(regla(".ccp-botones .primary")).not.toMatch(/flex:/u);
    expect(regla(".ccp-botones .ccp-secundario")).not.toMatch(/flex:/u);
    expect(regla(".ccp .primary")).toMatch(/width:\s*100%\s*;/u);
  });

  it("una red que ya tiene su pedido se ve apretada y Probar mide 44 px", () => {
    expect(regla('.ccp-red[aria-pressed="true"]')).toMatch(/background:\s*var\(--teal\)/u);
    expect(regla(".ccp-probar")).toMatch(/min-height:\s*44px\s*;/u);
  });

  it("las miniaturas del logo son de 64 px en el celular", () => {
    expect(regla(".ccp-logo-fondo")).toMatch(/width:\s*64px\s*;\s*height:\s*64px/u);
  });

  it("las tres horas comparten filas para que los campos queden alineados", () => {
    expect(regla(".ccp-horas")).toMatch(/grid-template-rows:\s*auto auto auto\s*;/u);
    expect(regla(".ccp-horas > .ccp-campo")).toMatch(/grid-template-rows:\s*subgrid\s*;/u);
  });
});
