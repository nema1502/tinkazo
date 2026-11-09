/**
 * La carpeta privada donde van los videos (fuera del repositorio): `--salida <carpeta>` o la variable
 * KIT_VIDEOS_DIR. No hay valor por defecto a propósito: los videos nunca se versionan y la carpeta no
 * puede quedar escrita en el código.
 */
export function carpetaDeSalida(args) {
  const i = args.indexOf("--salida");
  const carpeta = i >= 0 ? args[i + 1] : process.env.KIT_VIDEOS_DIR;
  if (!carpeta) {
    console.error("Falta la carpeta de salida: --salida <carpeta> o la variable KIT_VIDEOS_DIR (una carpeta fuera del repositorio).");
    process.exit(2);
  }
  return carpeta;
}
