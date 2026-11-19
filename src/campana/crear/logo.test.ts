import { describe, expect, it } from "vitest";
import { achicarLogo, base64DeBytes, blobDeLogo, MAXIMO_DEL_LOGO, medidasDeVectorial, type DepsDelLogo } from "./logo";

interface Dibujo {
  ancho: number;
  alto: number;
  tipo: string;
  calidad: number;
  blanco: boolean;
}

/** Dependencias falsas: el peso de lo que se dibuja crece con la superficie y con la calidad. */
function depsFalsas(
  medidas: { ancho: number; alto: number },
  o: { sinWebp?: boolean; pesoPorPixel?: number } = {},
): { deps: DepsDelLogo<string>; dibujos: Dibujo[] } {
  const dibujos: Dibujo[] = [];
  const deps: DepsDelLogo<string> = {
    abrir: async () => ({ imagen: "imagen", ...medidas }),
    dibujar: async (_imagen, ancho, alto, tipo, calidad, blanco) => {
      dibujos.push({ ancho, alto, tipo, calidad, blanco });
      const escrito = o.sinWebp && tipo === "image/webp" ? "image/png" : tipo;
      const peso = Math.round(ancho * alto * (o.pesoPorPixel ?? 0.4) * (escrito === "image/png" ? 1.5 : calidad));
      return new Blob([new Uint8Array(peso)], { type: escrito });
    },
    bytes: async (blob) => new Uint8Array(await blob.arrayBuffer()),
  };
  return { deps, dibujos };
}

const archivo = (tipo = "image/png", bytes = 1000): Blob => new Blob([new Uint8Array(bytes)], { type: tipo });

describe("achicarLogo", () => {
  it("una imagen de 4000 por 3000 sale de 40 KB o menos en webp", async () => {
    const { deps } = depsFalsas({ ancho: 4000, alto: 3000 });
    const logo = await achicarLogo(archivo(), deps);
    expect(logo?.tipo).toBe("image/webp");
    expect(atob(logo?.datos ?? "").length).toBeLessThanOrEqual(MAXIMO_DEL_LOGO);
  });

  it("un navegador que no escribe webp la deja en png", async () => {
    const { deps } = depsFalsas({ ancho: 300, alto: 300 }, { sinWebp: true, pesoPorPixel: 0.1 });
    const logo = await achicarLogo(archivo(), deps);
    expect(logo?.tipo).toBe("image/png");
  });

  it("si ninguna medida entra devuelve null", async () => {
    const { deps } = depsFalsas({ ancho: 4000, alto: 3000 }, { pesoPorPixel: 20 });
    expect(await achicarLogo(archivo(), deps)).toBeNull();
  });

  it("una imagen de 80 por 80 no se agranda", async () => {
    const { deps, dibujos } = depsFalsas({ ancho: 80, alto: 80 });
    await achicarLogo(archivo(), deps);
    expect(dibujos[0]).toMatchObject({ ancho: 80, alto: 80 });
  });

  it("mantiene la proporción al achicar", async () => {
    const { deps, dibujos } = depsFalsas({ ancho: 2000, alto: 1000 });
    await achicarLogo(archivo(), deps);
    expect(dibujos[0]).toMatchObject({ ancho: 512, alto: 256 });
  });

  it("un archivo de más de 15 MB no se abre", async () => {
    const { deps, dibujos } = depsFalsas({ ancho: 100, alto: 100 });
    const enorme = { size: 16 * 1024 * 1024, type: "image/png" } as Blob;
    expect(await achicarLogo(enorme, deps)).toBeNull();
    expect(dibujos).toHaveLength(0);
  });

  it("una imagen que no se abre o no tiene medidas devuelve null", async () => {
    const { deps } = depsFalsas({ ancho: 0, alto: 0 });
    expect(await achicarLogo(archivo(), deps)).toBeNull();
    expect(await achicarLogo(archivo(), { ...deps, abrir: async () => null })).toBeNull();
  });

  it("un vectorial de 48 por 48 sale a 512", async () => {
    const { deps, dibujos } = depsFalsas({ ancho: 48, alto: 48 }, { pesoPorPixel: 0.01 });
    await achicarLogo(archivo("image/svg+xml"), deps);
    expect(dibujos[0]).toMatchObject({ ancho: 512, alto: 512 });
  });

  it("con fondo blanco se dibuja sobre blanco, sin transparencia", async () => {
    const { deps, dibujos } = depsFalsas({ ancho: 100, alto: 100 });
    await achicarLogo(archivo(), deps, { blanco: true });
    expect(dibujos.every((d) => d.blanco)).toBe(true);
    const sin = depsFalsas({ ancho: 100, alto: 100 });
    await achicarLogo(archivo(), sin.deps);
    expect(sin.dibujos.every((d) => !d.blanco)).toBe(true);
  });
});

describe("medidasDeVectorial", () => {
  it("saca la proporción del viewBox cuando no tiene medidas propias", () => {
    expect(medidasDeVectorial('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"></svg>')).toEqual({ ancho: 120, alto: 60 });
  });

  it("usa su ancho y su alto si no hay viewBox", () => {
    expect(medidasDeVectorial('<svg width="48" height="24"></svg>')).toEqual({ ancho: 48, alto: 24 });
  });

  it("sin ninguna de las dos da null", () => {
    expect(medidasDeVectorial("<svg></svg>")).toBeNull();
  });
});

describe("base64DeBytes", () => {
  it("escribe los bytes conocidos como los escribe btoa", () => {
    expect(base64DeBytes(new Uint8Array([72, 111, 108, 97]))).toBe(btoa("Hola"));
  });

  it("escribe más de un tramo de bytes igual que btoa", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(base64DeBytes(bytes)).toBe(btoa(String.fromCharCode(...bytes.subarray(0, 0x8000)) + String.fromCharCode(...bytes.subarray(0x8000))));
  });

  it("un logo guardado con datos rotos no tira: da null", () => {
    expect(blobDeLogo({ tipo: "image/png", datos: "esto no es base64 %%%" })).toBeNull();
  });

  it("el logo guardado vuelve a ser un blob con los mismos bytes", async () => {
    const blob = blobDeLogo({ tipo: "image/png", datos: btoa("Hola") });
    expect(blob?.type).toBe("image/png");
    expect(await blob?.text()).toBe("Hola");
  });
});
