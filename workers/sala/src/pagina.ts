/**
 * La página del celular: `s.tinkazo.app/<id>#<clave>`.
 *
 * La sirve este mismo Worker, con su CSS y su JS adentro: abre rápido con mala
 * señal, no depende del sitio ni de Vercel y no necesita CORS. Mide menos de
 * 15 KB con compresión (se mide en `sala.test.ts`).
 *
 * Cifra el nombre en el celular con la clave del fragmento (AES-GCM, 16 bytes),
 * como los enlaces cortos: el fragmento no llega al servidor, así que el
 * servidor guarda bytes que no puede leer.
 */

/** Las letras que no se ven y las que cambian el orden del texto: no entran en un nombre (`stripInvisiblesByLine` en el sitio). */
const INVISIBLES = "[\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f\\\\u00ad\\\\u034f\\\\u061c\\\\u115f\\\\u1160\\\\u17b4\\\\u17b5\\\\u180b-\\\\u180f\\\\u200b-\\\\u200f\\\\u2028-\\\\u202f\\\\u205f-\\\\u206f\\\\u3164\\\\ufe00-\\\\ufe0f\\\\ufeff\\\\uffa0\\\\ufff9-\\\\ufffb]";

/**
 * El cifrado y la huella, en JavaScript plano: van dentro de la página y se prueban contra `src/sala/cifra.ts`.
 * Lo cifrado que se manda es `[1][IV de 12 bytes][cifrado]` en base64url. La huella es HMAC-SHA-256 del nombre
 * normalizado, con una llave derivada de la clave del QR, y se manda en base64url sin relleno.
 */
export const CIFRA_JS = `
function b64(u){var s="";for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
function deB64(s){var x=s.replace(/-/g,"+").replace(/_/g,"/");var bin=atob(x+"=".repeat((4-x.length%4)%4));var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
async function cifrar(clave,texto){var raw=deB64(clave);if(raw.length!==16)throw new Error("clave");var k=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);var iv=crypto.getRandomValues(new Uint8Array(12));var ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:iv},k,new TextEncoder().encode(texto)));var out=new Uint8Array(13+ct.length);out[0]=1;out.set(iv,1);out.set(ct,13);return b64(out)}
var INV_H=new RegExp("${INVISIBLES}","g");
function normalizarNombreParaHuella(s){return s.replace(INV_H,"").replace(/\\s+/g," ").trim().normalize("NFC").trim().toLowerCase()}
async function huellaNombre(clave,texto){var raw=deB64(clave);if(raw.length!==16)throw new Error("clave");var sep=new TextEncoder().encode("Tinkazo/sala/huella-de-nombre/v1");var material=new Uint8Array(sep.length+raw.length);material.set(sep);material.set(raw,sep.length);var derivada=new Uint8Array(await crypto.subtle.digest("SHA-256",material));var k=await crypto.subtle.importKey("raw",derivada,{name:"HMAC",hash:"SHA-256"},false,["sign"]);var h=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(normalizarNombreParaHuella(texto)));return b64(new Uint8Array(h))}
`.trim();

/** Los textos, en los dos idiomas. «Sin tecnicismos»: nada de claves, cifrados ni servidores. */
export const TEXTOS = {
  es: {
    titulo: "Sumate a la ronda",
    guia: "Escribí tu nombre o apodo y aparece en la pantalla grande.",
    campo: "Tu nombre o apodo",
    boton: "Sumarme",
    aviso: "Tu nombre o apodo se ve en la pantalla grande del stand, en una ronda de ejemplo, y se borra cuando cierran la sala o a las 10 horas. Para sumarte no hace falta nada: ni cuenta, ni aplicación. Solamente el registro de equipos de un evento con cupón pide una cuenta: quien anota a su equipo entra con Google, porque el cupón va a esa cuenta.",
    terminos: "Términos",
    listo: "Listo, ya estás en la ronda",
    listoB: "Mirá la pantalla grande. Si no te ves, tocá Corregir mi nombre o avisale a quien atiende.",
    hace: "Hacé el tuyo, gratis",
    ya: "Desde este celular te anotaste como {nombre}.",
    corregir: "Corregir mi nombre",
    repetido: "Si ese nombre es el tuyo, ya estás en la ronda. Si es de otra persona, sumá tu apellido o un apodo.",
    correcciones: "Ya corregiste tu nombre varias veces. Pedile ayuda a quien atiende.",
    recuerda: "Este celular recuerda tu nombre hasta 12 horas para no anotarte dos veces.",
    sinRecuerdo: "Este celular no puede recordar tu nombre. Desde acá no vas a poder corregirlo después.",
    incompleto: "Este enlace está incompleto. Escaneá el QR de la pantalla otra vez.",
    cerrada: "Este QR ya se cerró. Pedí el nuevo en el stand.",
    llena: "La sala está llena.",
    rapido: "Hay mucha gente sumándose. Esperá un momento y probá de nuevo.",
    red: "No hay conexión. Probá de nuevo en un momento.",
    vacio: "Escribí tu nombre o apodo.",
    enlace: "En la pantalla no se muestran enlaces. Escribí solo tu nombre.",
    otroError: "No pudimos sumarte. Probá de nuevo.",
    lang: "es",
  },
  en: {
    titulo: "Join the round",
    guia: "Type your name or nickname and it shows up on the big screen.",
    campo: "Your name or nickname",
    boton: "Join",
    aviso: "Your name or nickname shows on the booth's big screen, in a sample round, and is deleted when the room is closed or after 10 hours. Joining needs nothing: no account, no app. Only an event's team registration with a coupon needs an account: whoever signs up their team signs in with Google, because the coupon goes to that account.",
    terminos: "Terms",
    listo: "Done, you are in the round",
    listoB: "Watch the big screen. If you don't see yourself, tap Correct my name or tell whoever is running the booth.",
    hace: "Make your own, free",
    ya: "From this phone, you joined as {nombre}.",
    corregir: "Correct my name",
    repetido: "If that name is yours, you are already in the round. If it belongs to someone else, add your last name or a nickname.",
    correcciones: "You've corrected your name several times. Ask whoever is running the booth for help.",
    recuerda: "This phone remembers your name for up to 12 hours so you don't join twice.",
    sinRecuerdo: "This phone cannot remember your name. You will not be able to correct it from here later.",
    incompleto: "This link is incomplete. Scan the QR on the screen again.",
    cerrada: "This QR is closed. Ask for the new one at the booth.",
    llena: "The room is full.",
    rapido: "Lots of people are joining. Wait a moment and try again.",
    red: "No connection. Try again in a moment.",
    vacio: "Type your name or nickname.",
    enlace: "Links are not shown on the screen. Type just your name.",
    otroError: "We couldn't add you. Try again.",
    lang: "en",
  },
} as const;

/** La página para una sala. El id solo se usa en el cliente, desde la dirección; no va escrito en el HTML. */
export function paginaCelular(): string {
  const t = JSON.stringify(TEXTOS).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Tinkazo</title>
<style>
:root{--fondo:#fff6e9;--tinta:#191919;--tarjeta:#fff;--sombra:#191919;--primario:#ffc629;--enlace:#4b2fd0;--suave:#5a5348;--rosa:#e93d9c}
@media(prefers-color-scheme:dark){
:root{
--fondo:#171126;
--tinta:#f6efe2;
--tarjeta:#221a33;
--sombra:#f6efe2;
--primario:#ffd24d;
--enlace:#b4a4ff;
--suave:#cfc6b4;
--rosa:#ff5cb3
}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--fondo);color:var(--tinta);font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 16px}
main{width:100%;max-width:440px;background:var(--tarjeta);border:3px solid var(--tinta);box-shadow:6px 6px 0 var(--sombra);padding:22px 20px}
.marca{font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:22px;margin:0 0 14px}
.marca{display:flex;align-items:center;gap:.35em}
.marca svg{width:1.15em;height:1.15em;fill:var(--tinta);flex:none}
.marca b{color:var(--rosa)}
h1{font-size:28px;line-height:1.15;margin:0 0 8px;font-weight:900}
p{margin:0 0 14px}
label{display:block;font-weight:800;margin:0 0 6px}
input{width:100%;font:inherit;font-size:20px;padding:12px;border:3px solid var(--tinta);background:var(--fondo);color:var(--tinta);border-radius:0;min-height:52px}
button,.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:12px;font:inherit;font-weight:900;font-size:20px;background:var(--primario);color:#191919;border:3px solid var(--tinta);box-shadow:4px 4px 0 var(--sombra);cursor:pointer;text-decoration:none;border-radius:0}
button:active,.btn:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--sombra)}
button[disabled]{opacity:.6}
.suave{background:transparent;box-shadow:none;border-width:2px;color:var(--tinta);font-size:17px;min-height:48px}
.aviso{font-size:16px;color:var(--suave);margin:14px 0 0}
.aviso a{color:var(--enlace);display:inline-flex;align-items:center;min-height:44px}
#msg{min-height:1.4em;font-weight:700;margin:10px 0 0;font-size:17px}
#msg.mal{color:#b3261e}@media(prefers-color-scheme:dark){#msg.mal{color:#ff8a80}}
[hidden]{display:none!important}
:focus-visible{outline:4px solid var(--enlace);outline-offset:2px}
</style>
</head>
<body>
<main>
<p class="marca"><svg viewBox="-1 -3 24 28" aria-hidden="true">
<rect x="2" y="11" width="16" height="7"/>
<rect x="15" y="3" width="4" height="10"/>
<rect x="14" y="0" width="8" height="4"/>
<rect x="20" y="-2" width="2" height="3"/>
<rect x="3" y="18" width="2.5" height="6"/>
<rect x="8" y="18" width="2.5" height="6"/>
<rect x="12.5" y="18" width="2.5" height="6"/>
<rect x="16" y="18" width="2.5" height="6"/>
<rect x="0" y="9" width="3" height="4"/>
</svg><span>Tinka<b>zo</b></span></p>
<section id="form">
<h1 id="t"></h1>
<p id="g"></p>
<form id="f" autocomplete="off" novalidate>
<label for="n" id="l"></label>
<input id="n" name="n" maxlength="40" autocapitalize="words" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
<button id="b" type="submit"></button>
</form>
<p id="msg" role="status" aria-live="polite"></p>
<p class="aviso" id="a"></p>
<p class="aviso"><a id="tm" href="https://tinkazo.app/terminos.html" rel="noopener"></a></p>
</section>
<section id="hecho" hidden>
<h1 id="ht"></h1>
<p id="hy"></p>
<p id="hb"></p>
<a class="btn" id="h" href="https://tinkazo.app/" rel="noopener"></a>
<button class="suave" id="o" type="button"></button>
</section>
<p class="aviso" id="sr" role="status" hidden></p>
</main>
<script>
(function(){
${CIFRA_JS}
var TX=${t};
var L=/^en/i.test((new URLSearchParams(location.search).get("lang")||navigator.language||"es"))?"en":"es";
var X=TX[L];
document.documentElement.lang=X.lang;
function $(i){return document.getElementById(i)}
$("t").textContent=X.titulo;$("g").textContent=X.guia;$("l").textContent=X.campo;$("b").textContent=X.boton;$("a").textContent=X.aviso+" "+X.recuerda;$("tm").textContent=X.terminos;
$("ht").textContent=X.listo;$("hb").textContent=X.listoB;$("h").textContent=X.hace;$("o").textContent=X.corregir;$("sr").textContent=X.sinRecuerdo;
var id=location.pathname.replace(/^\\/+|\\/+$/g,"");
var clave=location.hash.slice(1);
var INV=new RegExp("${INVISIBLES}","g");
function dec(m,mal){var e=$("msg");e.textContent=m;e.className=mal?"mal":""}
if(!/^[A-Za-z0-9_-]{22}$/.test(clave)||!/^[0-9A-Za-z]{8}$/.test(id)){dec(X.incompleto,1);$("n").disabled=true;$("b").disabled=true}
function limpiar(s){return s.replace(INV,"").replace(/\\s+/g," ").trim()}
function conEnlace(s){return /https?:|www\\.|\\w\\.(com|net|org|app|io|bo|me|ly|co)\\b|@\\w+\\.\\w/i.test(s)}
var CLAVE_LOCAL="tk-sala:"+id;
var recuerdo=null;
function sinGuardar(){$("sr").hidden=false;$("a").textContent=X.aviso}
function guardar(){try{localStorage.setItem(CLAVE_LOCAL,JSON.stringify(recuerdo))}catch(_){sinGuardar()}}
function limpiarRecuerdos(){try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);if(!k||k.indexOf("tk-sala:")!==0)continue;try{var x=JSON.parse(localStorage.getItem(k)||"null");if(!x||typeof x.hora!=="number"||Date.now()-x.hora>43200000)localStorage.removeItem(k)}catch(_){localStorage.removeItem(k)}}}catch(_){sinGuardar()}}
function cargar(){try{var x=JSON.parse(localStorage.getItem(CLAVE_LOCAL)||"null");if(x&&typeof x.llave==="string"&&/^[A-Za-z0-9_-]{22}$/.test(x.llave)&&typeof x.nombre==="string"&&typeof x.hora==="number"&&Date.now()-x.hora<=43200000)return x}catch(_){}return null}
function asegurarLlave(){if(recuerdo)return recuerdo.llave;recuerdo={llave:b64(crypto.getRandomValues(new Uint8Array(16))),nombre:"",hora:Date.now()};guardar();return recuerdo.llave}
function mostrarHecho(){$("form").hidden=true;$("hecho").hidden=false;$("hy").textContent=X.ya.replace("{nombre}",recuerdo?recuerdo.nombre:"")}
function revisarAlCargar(){
fetch("/v1/sala/"+id+"/publico").then(function(r){
if(r.status!==404)return;
dec(X.cerrada,1);
$("n").disabled=true;
$("b").disabled=true;
}).catch(function(){});
}
limpiarRecuerdos();recuerdo=cargar();if(recuerdo&&recuerdo.nombre)mostrarHecho();
if(!(recuerdo&&recuerdo.nombre)&&!$("b").disabled)revisarAlCargar();
$("f").addEventListener("submit",async function(e){
e.preventDefault();
var b=$("b");if(b.disabled)return;
var nombre=limpiar($("n").value);
if(!nombre){dec(X.vacio,1);return}
if(conEnlace(nombre)){dec(X.enlace,1);return}
nombre=Array.from(nombre).slice(0,40).join("");
b.disabled=true;dec("",0);
try{
var llave=asegurarLlave();recuerdo.hora=Date.now();guardar();
var d=await cifrar(clave,nombre);var h=await huellaNombre(clave,nombre);
var r=await fetch("/v1/sala/"+id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({d:d,h:h,llave:llave})});
if(r.status===201||r.status===200){recuerdo.nombre=nombre;recuerdo.hora=Date.now();guardar();b.disabled=false;$("n").value="";mostrarHecho();$("h").focus();return}
var er=await r.json().catch(function(){return{}});
if(r.status===404){recuerdo=null;try{localStorage.removeItem(CLAVE_LOCAL)}catch(_){sinGuardar()}}
var k=r.status===404?X.cerrada:r.status===409?X.repetido:r.status===429?(er.error==="llena"?X.llena:er.error==="correcciones"?X.correcciones:X.rapido):X.otroError;
dec(k,1);
}catch(_){dec(X.red,1)}
b.disabled=false;
});
$("o").addEventListener("click",function(){$("hecho").hidden=true;$("form").hidden=false;$("n").value=recuerdo?recuerdo.nombre:"";dec("",0);$("n").focus()});
})();
</script>
</body>
</html>
`;
}
