import { describe, expect, it } from "vitest";
import { mp3Falso } from "./audio-falso";
import { corrimientoDeDecodificacion, leerCabeceraMp3, type CabeceraMp3 } from "./pistas-mp3";

/**
 * El retardo del codificador de MP3: se lee de la cabecera del archivo antes de decodificar, y se compara con lo que duró
 * lo decodificado para saber si el navegador recortó el silencio del principio. Los archivos son de mentira: solo los bytes de
 * la cabecera, sin audio.
 */

describe("leer la cabecera de un MP3", () => {
  it("lee los cuadros, el retardo y el relleno de un archivo de ffmpeg: ID3 chica, mono, 44,1 kHz", () => {
    const h = leerCabeceraMp3(mp3Falso({ id3: 34, cuadros: 1137, retardo: 576, relleno: 1420 }));
    expect(h).toEqual({ cuadros: 1137, porCuadro: 1152, tasa: 44100, retardo: 576, relleno: 1420 });
  });

  it("también estéreo, sin etiqueta ID3, con Xing en lugar de Info y a 48 kHz", () => {
    const h = leerCabeceraMp3(mp3Falso({ mono: false, etiqueta: "Xing", tasa: 1, cuadros: 300, retardo: 576, relleno: 603 }));
    expect(h).toEqual({ cuadros: 300, porCuadro: 1152, tasa: 48000, retardo: 576, relleno: 603 });
  });

  it("MPEG 2 y 2.5: 576 muestras por cuadro y otras frecuencias", () => {
    expect(leerCabeceraMp3(mp3Falso({ version: 2, tasa: 0, cuadros: 500 }))).toMatchObject({ porCuadro: 576, tasa: 22050, cuadros: 500 });
    expect(leerCabeceraMp3(mp3Falso({ version: 0, tasa: 2, mono: false, cuadros: 500 }))).toMatchObject({ porCuadro: 576, tasa: 8000 });
  });

  it("salta los campos opcionales del cuadro Xing (bytes, tabla y calidad) para llegar a la etiqueta de LAME", () => {
    const h = leerCabeceraMp3(mp3Falso({ banderas: 1 | 2 | 4 | 8, cuadros: 777, retardo: 600, relleno: 1500, largo: 6000 }));
    expect(h).toMatchObject({ cuadros: 777, retardo: 600, relleno: 1500 });
  });

  it("una etiqueta ID3 grande no la confunde", () => {
    expect(leerCabeceraMp3(mp3Falso({ id3: 3000, largo: 8000, cuadros: 42 }))).toMatchObject({ cuadros: 42, retardo: 576, relleno: 1000 });
  });

  it.each([
    ["un archivo vacío", () => new ArrayBuffer(0)],
    ["bytes que no son un MP3", () => new ArrayBuffer(4000)],
    ["una cabecera cortada a la mitad", () => mp3Falso().slice(0, 30)],
    ["un cuadro sin la marca Xing ni Info", () => mp3Falso({ etiqueta: "Zzzz" })],
    ["un cuadro Xing sin el número de cuadros", () => mp3Falso({ banderas: 0 })],
    ["sin retardo ni relleno", () => mp3Falso({ retardo: 0, relleno: 0 })],
    ["un retardo y un relleno que no caben en el archivo", () => mp3Falso({ cuadros: 1, retardo: 600, relleno: 1000 })],
    ["cero cuadros", () => mp3Falso({ cuadros: 0 })],
  ])("%s: no se saca nada y suena como antes", (_, hacer) => {
    expect(leerCabeceraMp3(hacer())).toBeNull();
  });

  it("no toca los bytes: se puede decodificar después", () => {
    const datos = mp3Falso({ id3: 34 });
    const antes = Array.from(new Uint8Array(datos));
    leerCabeceraMp3(datos);
    expect(Array.from(new Uint8Array(datos))).toEqual(antes);
  });
});

describe("cuánto corrió el navegador el audio al decodificar", () => {
  // 1.000 cuadros de 1.152 muestras a 44,1 kHz: 26,122 s en bruto y 26,087 s sin el silencio del codificador.
  const h: CabeceraMp3 = { cuadros: 1000, porCuadro: 1152, tasa: 44100, retardo: 576, relleno: 1000 };
  const bruto = 1000 * 1152;
  const validas = bruto - 576 - 1000;

  it("si recortó el principio y el final, como Chrome y Firefox, no corrió nada", () => {
    expect(corrimientoDeDecodificacion(h, validas / 44100)).toBe(0);
  });

  it("al cambiar de frecuencia (48 kHz) el redondeo de una muestra no cuenta", () => {
    for (const largo of [Math.round((validas * 48000) / 44100), Math.round((validas * 48000) / 44100) + 1, Math.round((validas * 48000) / 44100) - 1]) {
      expect(corrimientoDeDecodificacion(h, largo / 48000)).toBe(0);
    }
  });

  it("si no recortó nada, el audio cayó 1.105 muestras más tarde: 576 del codificador y 529 del decodificador", () => {
    const k = corrimientoDeDecodificacion(h, bruto / 44100);
    expect(k).toBeCloseTo(1105 / 44100, 9);
    expect(k * 1000).toBeGreaterThan(25);
    expect(k * 1000).toBeLessThan(25.1);
    // Lo mismo decodificado a 48 kHz.
    expect(corrimientoDeDecodificacion(h, Math.round((bruto * 48000) / 44100) / 48000)).toBeCloseTo(1105 / 44100, 9);
  });

  it("un decodificador que solo recorta el principio, o uno que no conocemos, no se corrige", () => {
    expect(corrimientoDeDecodificacion(h, (bruto - 1105) / 44100)).toBe(0);
    expect(corrimientoDeDecodificacion(h, 12.3)).toBe(0);
    expect(corrimientoDeDecodificacion(h, 0)).toBe(0);
    expect(corrimientoDeDecodificacion(h, Number.NaN)).toBe(0);
  });

  it("sin cabecera no se corrige nada", () => {
    expect(corrimientoDeDecodificacion(null, 26.1)).toBe(0);
  });
});
