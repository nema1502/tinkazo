// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fijarParaEspectadores, fijoPara } from "./espectador-fijo";

/**
 * Desde que el QR del espectador se ve, el juego y el ritmo de ese sorteo quedan (`espectador-fijo.ts`): quien ya
 * escaneó juega con los del enlace, y si la sala los cambiaba, el celular coronaba antes que ella.
 */

describe("el juego y el ritmo de un sorteo que se mira en celulares", () => {
  it("nada fijo hasta que el QR se ve; después, los del enlace, para esa ronda y hasta el resultado", () => {
    expect(fijoPara({ round: 10 }, false)).toBeNull();
    const aviso = vi.fn();
    document.addEventListener("tinkazo:espectadores", aviso);
    fijarParaEspectadores(10, "race", "rapido");
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(fijoPara({ round: 10 }, false)).toEqual({ juego: "race", ritmo: "rapido" });
    // Con el resultado puesto, verlo de nuevo con otro juego es libre: el sorteo ya salió.
    expect(fijoPara({ round: 10 }, true)).toBeNull();
    // Otro sorteo (Siguiente premio, otra lista) los suelta.
    expect(fijoPara({ round: 11 }, false)).toBeNull();
    expect(fijoPara(null, false)).toBeNull();
    document.removeEventListener("tinkazo:espectadores", aviso);
  });
});
