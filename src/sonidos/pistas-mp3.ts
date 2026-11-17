/**
 * El retardo del codificador de MP3 y lo que hace cada navegador con él.
 *
 * Un MP3 de LAME (o de ffmpeg) empieza con unos 1.100 muestras de silencio, unos 25 ms: 576 del codificador y 529 que
 * atrasa el filtro de cualquier decodificador. La cabecera del archivo (un cuadro Xing o Info) dice cuántas son, y el
 * navegador que la lee las recorta al decodificar: el primer sonido del archivo queda en la muestra 0. Una pista de
 * música cuenta con eso, porque el inicio de cada sección es un número fijo del JSON. Si un navegador no las recorta,
 * todo el audio cae unos 25 ms más tarde que lo escrito: los empalmes entre secciones siguen alineados, pero cada
 * bucle toma un trozo de más del colchón de antes del primer tiempo.
 *
 * Chrome y Firefox lo recortan (medido el 13 de noviembre de 2026 con las nueve pistas, 45 archivos: cero muestras de
 * diferencia contra ffmpeg). De Safari no hay medida, y acá se mide en cada equipo, al decodificar: se compara lo que
 * duró lo decodificado con lo que debería durar según la cabecera.
 */

/** Lo que dice la cabecera Xing o Info de un MP3 de LAME. */
export interface CabeceraMp3 {
  /** Cuadros de audio del archivo. */
  cuadros: number;
  /** Muestras por cuadro: 1152 en MPEG 1 y 576 en MPEG 2 y 2.5. */
  porCuadro: number;
  /** Muestras por segundo del archivo. */
  tasa: number;
  /** Silencio con que el codificador empieza el archivo, en muestras. */
  retardo: number;
  /** Silencio con que lo termina, en muestras. */
  relleno: number;
}

/** Lo que atrasa el filtro de síntesis de un decodificador de MP3, en muestras. */
const RETARDO_DEL_DECODIFICADOR = 529;
/** Cuánto puede diferir lo decodificado de lo esperado sin que cuente (un redondeo al cambiar de frecuencia), en segundos. */
const TOLERANCIA = 0.0004;

const TASAS: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Lee la cabecera Xing o Info de un MP3, con el retardo y el relleno del codificador. `null` si el archivo no tiene esa
 * cabecera (otro codificador, o no es un MP3): entonces no se corrige nada. No toca los bytes.
 */
export function leerCabeceraMp3(datos: ArrayBuffer): CabeceraMp3 | null {
  try {
    const d = new DataView(datos);
    const texto = (desde: number, n: number): string => {
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(desde + i));
      return s;
    };
    // La etiqueta ID3 del principio, si hay: su largo viene en cuatro números de siete bits.
    let p = 0;
    if (texto(0, 3) === "ID3") p = 10 + (((d.getUint8(6) & 0x7f) << 21) | ((d.getUint8(7) & 0x7f) << 14) | ((d.getUint8(8) & 0x7f) << 7) | (d.getUint8(9) & 0x7f));
    // El primer cuadro de audio: once unos seguidos y campos que existan. El cuadro Xing o Info es el primero de LAME.
    for (const tope = Math.min(d.byteLength - 4, p + 4096); p < tope; p++) {
      if (d.getUint8(p) !== 0xff || (d.getUint8(p + 1) & 0xe0) !== 0xe0) continue;
      const version = (d.getUint8(p + 1) >> 3) & 3;
      const capa = (d.getUint8(p + 1) >> 1) & 3;
      const iTasa = (d.getUint8(p + 2) >> 2) & 3;
      const tasa = TASAS[version]?.[iTasa];
      if (capa !== 1 || tasa === undefined) continue;
      const mono = ((d.getUint8(p + 3) >> 6) & 3) === 3;
      const mpeg1 = version === 3;
      const marca = p + (mpeg1 ? (mono ? 21 : 36) : mono ? 13 : 21);
      const etiqueta = texto(marca, 4);
      if (etiqueta !== "Xing" && etiqueta !== "Info") return null;
      const banderas = d.getUint32(marca + 4);
      // Sin el número de cuadros no hay con qué comparar.
      if (!(banderas & 1)) return null;
      const cuadros = d.getUint32(marca + 8);
      let q = marca + 12;
      if (banderas & 2) q += 4;
      if (banderas & 4) q += 100;
      if (banderas & 8) q += 4;
      // Después de los campos de Xing sigue la etiqueta de LAME: nueve letras de versión y, 21 bytes adentro, retardo y relleno
      // en doce bits cada uno.
      const retardo = (d.getUint8(q + 21) << 4) | (d.getUint8(q + 22) >> 4);
      const relleno = ((d.getUint8(q + 22) & 0x0f) << 8) | d.getUint8(q + 23);
      const porCuadro = mpeg1 ? 1152 : 576;
      // Sin retardo ni relleno el archivo no trae esos datos (o no hay nada que recortar), y con números que no caben no se confía.
      if (cuadros < 1 || (retardo === 0 && relleno === 0) || retardo + relleno >= cuadros * porCuadro) return null;
      return { cuadros, porCuadro, tasa, retardo, relleno };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cuántos segundos corrió un navegador el audio de un MP3 hacia adelante al decodificarlo: 0 si recortó el silencio del
 * codificador, como Chrome y Firefox. Se saca de lo que duró lo decodificado (`duracion`, en segundos) contra lo que
 * dura el archivo según su cabecera: recortado por los dos lados, o sin recortar nada. Con cualquier otra cosa (un
 * decodificador que solo recorta el principio, o uno que no conocemos) no se corrige, igual que sin esta comprobación.
 */
export function corrimientoDeDecodificacion(cabecera: CabeceraMp3 | null, duracion: number): number {
  if (!cabecera || !Number.isFinite(duracion)) return 0;
  const { cuadros, porCuadro, tasa, retardo, relleno } = cabecera;
  const bruto = cuadros * porCuadro;
  if (Math.abs(duracion - (bruto - retardo - relleno) / tasa) <= TOLERANCIA) return 0;
  if (Math.abs(duracion - bruto / tasa) <= TOLERANCIA) return (retardo + RETARDO_DEL_DECODIFICADOR) / tasa;
  return 0;
}
