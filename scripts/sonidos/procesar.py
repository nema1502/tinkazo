"""Procesa los sonidos crudos del servicio de generación y deja los archivos del banco.

Uso (desde la raíz del repositorio):
    python -I scripts/sonidos/procesar.py <carpeta de crudos> [juego | juego/id ...]

Los crudos son `<carpeta>/<juego>/<id>-v<N>.mp3` (los baja `generar.mjs`). Por cada id elige la mejor variante por
medición, recorta el silencio, saca lo que está por debajo de 90 Hz, normaliza la sonoridad (RMS de -18 dBFS en lo que suena,
pico máximo de -1,5 dBFS), le agrega armónicos a los golpes que viven abajo de 200 Hz (un proyector no los reproduce), mide la
altura de las notas de los instrumentos, codifica a mp3 mono de 64 kbps en `public/sonidos/` y reescribe
`src/sonidos/archivos.ts`. Hace falta `ffmpeg` en el PATH, y numpy y scipy.
"""
import os, sys, glob, subprocess, json, argparse

import numpy as np

SR = 44100
def decodificar(ruta, canales=1):
    p = subprocess.run(["ffmpeg","-v","error","-i",ruta,"-ac",str(canales),"-ar",str(SR),"-f","f32le","-"],capture_output=True)
    x = np.frombuffer(p.stdout, dtype=np.float32)
    return x.reshape(-1, canales) if canales>1 else x

def codificar(x, salida, kbps, canales=1):
    raw = x.astype(np.float32).tobytes()
    cmd = ["ffmpeg","-v","error","-y","-f","f32le","-ar",str(SR),"-ac",str(canales),"-i","-","-codec:a","libmp3lame","-b:a",f"{kbps}k","-ac",str(canales),salida]
    subprocess.run(cmd, input=raw, check=True)

def hp(x, fc):
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(2, fc/(SR/2), "highpass", output="sos"), x).astype(np.float32)

def db(v): return 20*np.log10(max(v,1e-9))

def pitch(x):
    """Frecuencia fundamental por autocorrelacion normalizada en los primeros 0,5 s tras el ataque."""
    n = int(0.5*SR)
    pk = np.argmax(np.abs(x))
    seg = x[max(0,pk-int(0.02*SR)):][:n]
    seg = seg - seg.mean()
    if len(seg) < 4096: return None, 0
    w = seg*np.hanning(len(seg))
    nfft = 1<<int(np.ceil(np.log2(len(w)*2)))
    S = np.fft.rfft(w, nfft)
    ac = np.fft.irfft(np.abs(S)**2)[:len(w)]
    ac /= ac[0]+1e-12
    lo, hi = int(SR/2200), int(SR/90)
    k = lo+np.argmax(ac[lo:hi])
    # refinar parabolicamente
    if 1<k<len(ac)-1:
        a,b,c = ac[k-1],ac[k],ac[k+1]; d = (a-2*b+c)
        k = k + (0.5*(a-c)/d if d else 0)
    return SR/k, float(ac[int(round(k))])




def emitir(idx, OUT, destino):
    ok = {}
    for k,v in sorted(idx.items()):
        j,i = k.split("/")
        n = v["n"]
        files = [f"{OUT}/{j}/{i}.mp3"] if n==1 else [f"{OUT}/{j}/{i}-{x+1}.mp3" for x in range(n)]
        if all(os.path.exists(f) for f in files): ok[k]=v
    L = ["// Generado por scripts/sonidos/procesar.py: no se edita a mano.",
         "// Cada archivo de `public/sonidos/`, con sus variantes (`n`), su peso en KB, su duración y, si es una nota, su altura medida (`hz`).",
         "",
         "export interface Archivo {",
         "  /** Cuántas variantes tiene (`nombre-1.mp3`, `nombre-2.mp3`...; con una sola, `nombre.mp3`). */",
         "  n: number;",
         "  /** Peso de cada variante, en KB. */",
         "  kb: number[];",
         "  /** Duración de cada variante, en segundos. */",
         "  dur: number[];",
         "  /** La altura de la nota de un instrumento, en hercios. */",
         "  hz?: number;",
         "}",
         "",
         "export const ARCHIVOS: Record<string, Archivo> = {"]
    for k,v in ok.items():
        hz = f", hz: {v['hz']}" if "hz" in v else ""
        L.append(f'  "{k}": {{ n: {v["n"]}, kb: {json.dumps(v["kb"])}, dur: {json.dumps(v["dur"])}{hz} }},')
    L.append("};")
    open(destino,"w",encoding="utf8",newline="\n").write("\n".join(L)+"\n")
    print(len(ok),"archivos en el indice")

MAXD = {"default":1.2,"ganador":2.8,"rotura":2.2,"campana":2.2,"llegada":1.4,"zumbido":1.2,"viento":3.0,"colibri":1.5,"caramelos":0.9,"boca":1.0,
 "bronce":0.9,"impacto":1.2,"kalimba":0.9,"madera":0.45,"zampona":0.9,"silbido":0.6,"casco":0.3,"clavija":0.12,"ficha":0.35,"pisada":0.25,"tum":0.5,
 "redoble":0.7,"resoplido":0.6,"tropiezo":0.8,"palo":0.45,"traqueteo":0.6,"soga":0.45,"corte":0.35,"choque":0.6,"roce":0.2,"cae":0.9,"grillo":0.25,
 "torre":0.6,"apagon":0.8,"cable":0.6,"bombo":0.45,"redoblante":0.3,"paso":0.35,"tum":0.5}
KEEP = {"casco":3,"clavija":3,"ficha":2,"roce":2,"pisada":2,"palo":2,"grillo":2,"choque":2,"caramelos":2,"traqueteo":2,"tropiezo":2}
CICLO = {"viento","colibri"}
TARGET_RMS = -18.0; PEAK_MAX = -1.5
GANADOR_RMS = -13.0

PEDIDO = {"kalimba-lo":131,"kalimba-hi":523,"madera-lo":196,"madera-hi":1046,"campana-lo":196,"campana-hi":523,"zampona-lo":196,"zampona-hi":1046,"bronce-lo":196,"bronce-hi":523}
def estimadores(x):
    a, cl = pitch(x)
    pk = np.argmax(np.abs(x)); seg = x[pk:][:int(0.4*SR)]; seg = seg*np.hanning(len(seg))
    n = 1<<17; S = np.abs(np.fft.rfft(seg, n)); fr = np.fft.rfftfreq(n, 1/SR)
    H = S.copy()
    for k in (2,3,4): H[:len(S)//k] *= S[::k][:len(S)//k]
    m = (fr>80)&(fr<2200)
    return [abs(a) if a else 0, fr[np.argmax(np.where(m,S,0))], fr[np.argmax(np.where(m,H,0))]], cl

def consenso(x, pedido):
    e, cl = estimadores(x)
    best = None
    for i in range(3):
        for j in range(i+1,3):
            if e[i]>0 and abs(np.log2(e[i]/e[j]))<0.04:
                v = (e[i]+e[j])/2
                if best is None or abs(np.log2(v/pedido))<abs(np.log2(best/pedido)): best = v
    if best is None:
        best = min([v for v in e if v>0], key=lambda v: abs(np.log2(v/pedido)))
    return best, cl

def analizar(x):
    amp = np.abs(x); m = amp.max()
    act = x[amp > m*10**(-30/20)]
    rms = np.sqrt(np.mean(act**2)) if len(act) else 1e-6
    # parte de la energia sobre 200 Hz
    X = np.abs(np.fft.rfft(x*np.hanning(len(x))))**2
    fr = np.fft.rfftfreq(len(x), 1/SR)
    share = X[fr>200].sum()/max(X.sum(),1e-12)
    return rms, share

def preparar(ruta, maxd, ciclo=False, fade=0.04):
    x = decodificar(ruta)
    if len(x) < 2000: return None
    amp = np.abs(x); m = amp.max()
    if m < 1e-4: return None
    idx = np.where(amp > m*10**(-42/20))[0]
    ini = max(0, idx[0]-int(0.003*SR)); x = x[ini:]
    amp = np.abs(x); idx = np.where(amp > m*10**(-46/20))[0]
    fin = idx[-1]+int(0.02*SR) if len(idx) else len(x)
    x = x[:min(fin, int(maxd*SR))].copy()
    x = hp(x, 90)
    if ciclo:
        X = int(0.2*SR)
        if len(x) > 3*X:
            t = np.linspace(0, np.pi/2, X)
            y = x[:-X].copy(); y[:X] = x[:X]*np.sin(t) + x[-X:]*np.cos(t)
            x = y
    else:
        fi = int(0.002*SR); fo = min(int(fade*SR), len(x)//2)
        x[:fi] *= np.linspace(0,1,fi); x[-fo:] *= np.linspace(1,0,fo)
    return x

def normalizar(x, ganador=False):
    rms, share = analizar(x)
    g = 10**(TARGET_RMS/20)/rms
    pico = np.abs(x).max()*g
    if pico > 10**(PEAK_MAX/20): g *= 10**(PEAK_MAX/20)/pico
    y = x*g
    if ganador:
        # El remate del ganador tiene que sentirse: un limitador suave sube lo que suena sin pasar de -2 dBFS de pico.
        techo = 10**(-2.0/20)
        lo, hi = 1.0, 12.0
        for _ in range(24):
            G = (lo+hi)/2
            z = techo*np.tanh(G*y/techo)
            r, _ = analizar(z.astype(np.float32))
            if db(r) < GANADOR_RMS: lo = G
            else: hi = G
        y = (techo*np.tanh(hi*y/techo)).astype(np.float32)
    return y

def sosten(x):
    """Cuánto se mantiene el remate entre 0,3 y 2 s, en dB bajo su máximo (más cerca de 0 es más sostenido)."""
    n = int(0.1*SR)
    e = np.array([np.sqrt(np.mean(x[i:i+n]**2)) for i in range(0, max(1, len(x)-n), n)])
    tramo = e[3:20] if len(e) > 3 else e
    return float(20*np.log10(max(np.mean(tramo), 1e-9)/max(e.max(), 1e-9)))

def arranque(x):
    """Segundos hasta que la energía llega a 6 dB del máximo (en ventanas de 50 ms): un remate tiene que arrancar con el golpe."""
    n = int(0.05*SR)
    e = np.array([np.sqrt(np.mean(x[i:i+n]**2)) for i in range(0, max(1, len(x)-n), n//2)])
    return float(np.argmax(e > e.max()*0.5)*(n//2)/SR)

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(RAIZ, "public", "sonidos")
CRU = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
INDICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "indice.json")

indice = {}
informe = []
ids = {}
for juego in sorted(os.listdir(CRU)):
    if juego in ("prueba",): continue
    for f in sorted(glob.glob(f"{CRU}/{juego}/*-v*.mp3")):
        nombre = os.path.basename(f)
        # La música no se procesa acá ni viaja con el repositorio (`public/sonidos/LICENCIA.md`).
        if nombre.startswith("musica"): continue
        id_ = nombre.rsplit("-v",1)[0]
        ids.setdefault((juego,id_), []).append(f)
solo = sys.argv[2:]
for (juego,id_), fs in sorted(ids.items()):
    if solo and f"{juego}/{id_}" not in solo and juego not in solo: continue
    base = id_.rsplit("-",1)[0] if id_.endswith(("-lo","-hi")) else id_
    maxd = MAXD.get(base, MAXD["default"])
    cands = []
    for f in fs:
        x = preparar(f, maxd, ciclo=base in CICLO)
        if x is None: continue
        rms, share = analizar(x)
        if not id_.endswith(("-lo","-hi")) and share < 0.4:
            # Un golpe que vive abajo de 200 Hz no sale por el parlante de un proyector: armonicos con saturacion suave.
            for drive in (2,3,5,8,12):
                y = np.tanh(drive*x/ max(np.abs(x).max(),1e-6))
                y = hp(y.astype(np.float32), 120)
                r2, sh2 = analizar(y)
                if sh2 >= 0.4: break
            x = y.astype(np.float32); rms, share = r2, sh2
        hz, cl = consenso(x, PEDIDO[id_]) if id_ in PEDIDO else (None,0)
        cands.append(dict(f=f,x=x,rms=rms,share=share,hz=hz,cl=cl))
    if not cands:
        informe.append(f"{juego}/{id_}: sin candidatos"); continue
    esvoz = id_ in PEDIDO
    if esvoz:
        ped = PEDIDO.get(id_)
        if ped:
            cands.sort(key=lambda c: (abs(np.log2(c["hz"]/ped))>0.25, -c["cl"]))
        else:
            cands.sort(key=lambda c: -c["cl"])
        cands = cands[:1]
    else:
        if id_ == "ganador":
            # El remate arranca con el golpe: gana la variante que llega antes a su fuerza.
            cands.sort(key=lambda c: (round(arranque(c["x"]), 1), -round(sosten(c["x"]))))
            # Y sin silencio ni preparación antes del golpe: se recorta hasta 60 ms antes de que llegue a la mitad de su fuerza.
            for c in cands:
                a = arranque(c["x"])
                if a > 0.06: c["x"] = c["x"][int((a-0.06)*SR):]
        else:
            cands.sort(key=lambda c: -c["share"])
        cands = cands[:KEEP.get(id_,1)]
    n = len(cands)
    os.makedirs(f"{OUT}/{juego}", exist_ok=True)
    kbs = []; durs=[]
    for i,c in enumerate(cands):
        y = normalizar(c["x"], ganador=(id_ == "ganador"))
        salida = f"{OUT}/{juego}/{id_}{'-'+str(i+1) if n>1 else ''}.mp3"
        codificar(y, salida, 64)
        kbs.append(round(os.path.getsize(salida)/1024,1)); durs.append(round(len(y)/SR,2))
    entry = dict(n=n, kb=kbs, dur=durs)
    if esvoz: entry["hz"] = round(cands[0]["hz"],1)
    indice[f"{juego}/{id_}"] = entry
    informe.append(f"{juego}/{id_}: n={n} kb={kbs} dur={durs} " + (f"hz={entry['hz']} cl={cands[0]['cl']:.2f}" if esvoz else f"share200={cands[0]['share']:.2f}"))
print("\n".join(informe))
prev = {}
if os.path.exists(INDICE): prev = json.load(open(INDICE))
prev.update(indice); json.dump(prev, open(INDICE,"w"), indent=1)
emitir(prev, OUT, os.path.join(RAIZ, "src", "sonidos", "archivos.ts"))
