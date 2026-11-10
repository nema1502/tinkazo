/**
 * Escanear el código QR de la cuenta con la cámara, sin ninguna librería: el navegador trae el detector
 * (`BarcodeDetector`, en Chrome de Android y de escritorio). Donde no está, `puedeEscanear()` da false y la pantalla
 * deja solo pegar la cuenta.
 */

interface Detector {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (o: { formats: string[] }) => Detector;

const ctor = (): DetectorCtor | undefined => (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

export const puedeEscanear = (): boolean => !!ctor() && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * Abre la cámara trasera en `video` y llama a `alLeer` con el primer QR que ve. Devuelve cómo parar. Si la cámara no
 * se puede abrir, llama a `alFallar` y no deja nada abierto.
 */
export async function escanear(video: HTMLVideoElement, alLeer: (texto: string) => void, alFallar: () => void): Promise<() => void> {
  const Detector = ctor();
  if (!Detector) {
    alFallar();
    return () => undefined;
  }
  let flujo: MediaStream;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    alFallar();
    return () => undefined;
  }
  const detector = new Detector({ formats: ["qr_code"] });
  let vivo = true;
  const parar = (): void => {
    vivo = false;
    for (const pista of flujo.getTracks()) pista.stop();
    video.srcObject = null;
  };
  video.srcObject = flujo;
  video.setAttribute("playsinline", "true");
  await video.play().catch(() => undefined);
  const mirar = async (): Promise<void> => {
    if (!vivo) return;
    try {
      const r = await detector.detect(video);
      const texto = r[0]?.rawValue;
      if (texto) {
        parar();
        alLeer(texto);
        return;
      }
    } catch {
      /* un cuadro sin código: se sigue */
    }
    setTimeout(() => void mirar(), 250);
  };
  void mirar();
  return parar;
}
