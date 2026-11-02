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

/**
 * El cifrado, en JavaScript plano: va dentro de la página y se prueba contra
 * `src/sala/cifra.ts` (el lado de la pantalla). Lo que se manda es
 * `[1][IV de 12 bytes][cifrado]` en base64url.
 */
export const CIFRA_JS = `
function b64(u){var s="";for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
function deB64(s){var x=s.replace(/-/g,"+").replace(/_/g,"/");var bin=atob(x+"=".repeat((4-x.length%4)%4));var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
async function cifrar(clave,texto){var raw=deB64(clave);if(raw.length!==16)throw new Error("clave");var k=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);var iv=crypto.getRandomValues(new Uint8Array(12));var ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:iv},k,new TextEncoder().encode(texto)));var out=new Uint8Array(13+ct.length);out[0]=1;out.set(iv,1);out.set(ct,13);return b64(out)}
`.trim();

/** Los textos, en los dos idiomas. «Sin tecnicismos»: nada de claves, cifrados ni servidores. */
export const TEXTOS = {
  es: {
    titulo: "Sumate a la ronda",
    guia: "Escribí tu nombre o apodo y aparece en la pantalla grande.",
    campo: "Tu nombre o apodo",
    boton: "Sumarme",
    aviso: "Tu nombre o apodo se ve en la pantalla grande del stand, en una ronda de ejemplo, y se borra cuando cierran la sala o a las 10 horas.",
    terminos: "Términos",
    listo: "¡Listo!",
    listoB: "Mirá la pantalla. Si no aparecés enseguida, avisale a quien atiende.",
    hace: "Hacé el tuyo, gratis",
    otro: "Sumar a otra persona",
    incompleto: "Este enlace está incompleto. Escaneá el QR de la pantalla otra vez.",
    cerrada: "Esta sala ya terminó. Pedí que te muestren el QR de la próxima.",
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
    aviso: "Your name or nickname shows on the booth's big screen, in a sample round, and is deleted when the room is closed or after 10 hours.",
    terminos: "Terms",
    listo: "You're in!",
    listoB: "Look at the screen. If you don't show up right away, tell whoever is running the booth.",
    hace: "Make your own, free",
    otro: "Add someone else",
    incompleto: "This link is incomplete. Scan the QR on the screen again.",
    cerrada: "This room has ended. Ask to see the QR for the next one.",
    llena: "The room is full.",
    rapido: "Lots of people are joining. Wait a moment and try again.",
    red: "No connection. Try again in a moment.",
    vacio: "Type your name or nickname.",
    enlace: "Links are not shown on the screen. Type just your name.",
    otroError: "We couldn't add you. Try again.",
    lang: "en",
  },
} as const;

/** Las letras que no se ven y las que cambian el orden del texto: no entran en un nombre (`stripInvisiblesByLine` en el sitio). */
const INVISIBLES = "[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u2028-\\u202f\\u205f-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]";

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
:root{--fondo:#fff4e6;--tinta:#191919;--tarjeta:#fff;--sombra:#191919;--primario:#ffc533;--enlace:#4b2fd0;--suave:#5a5348;--rosa:#e93d9c}
@media(prefers-color-scheme:dark){:root{--fondo:#1d1a16;--tinta:#fff4e6;--tarjeta:#2a2620;--sombra:#000;--primario:#ffc533;--enlace:#b4a4ff;--suave:#cfc6b8;--rosa:#ff5cb3}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--fondo);color:var(--tinta);font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 16px}
main{width:100%;max-width:440px;background:var(--tarjeta);border:3px solid var(--tinta);box-shadow:6px 6px 0 var(--sombra);padding:22px 20px}
.marca{font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:22px;margin:0 0 14px}
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
<p class="marca">Tinka<b>zo</b></p>
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
<p id="hb"></p>
<a class="btn" id="h" href="https://tinkazo.app/" rel="noopener"></a>
<button class="suave" id="o" type="button"></button>
</section>
</main>
<script>
(function(){
${CIFRA_JS}
var TX=${t};
var L=/^en/i.test((new URLSearchParams(location.search).get("lang")||navigator.language||"es"))?"en":"es";
var X=TX[L];
document.documentElement.lang=X.lang;
function $(i){return document.getElementById(i)}
$("t").textContent=X.titulo;$("g").textContent=X.guia;$("l").textContent=X.campo;$("b").textContent=X.boton;$("a").textContent=X.aviso;$("tm").textContent=X.terminos;
$("ht").textContent=X.listo;$("hb").textContent=X.listoB;$("h").textContent=X.hace;$("o").textContent=X.otro;
var id=location.pathname.replace(/^\\/+|\\/+$/g,"");
var clave=location.hash.slice(1);
var INV=new RegExp("${INVISIBLES}","g");
function dec(m,mal){var e=$("msg");e.textContent=m;e.className=mal?"mal":""}
if(!/^[A-Za-z0-9_-]{22}$/.test(clave)||!/^[0-9A-Za-z]{8}$/.test(id)){dec(X.incompleto,1);$("n").disabled=true;$("b").disabled=true}
function limpiar(s){return s.replace(INV,"").replace(/\\s+/g," ").trim()}
function conEnlace(s){return /https?:|www\\.|\\w\\.(com|net|org|app|io|bo|me|ly|co)\\b|@\\w+\\.\\w/i.test(s)}
$("f").addEventListener("submit",async function(e){
e.preventDefault();
var b=$("b");if(b.disabled)return;
var nombre=limpiar($("n").value);
if(!nombre){dec(X.vacio,1);return}
if(conEnlace(nombre)){dec(X.enlace,1);return}
nombre=Array.from(nombre).slice(0,40).join("");
b.disabled=true;dec("",0);
try{
var d=await cifrar(clave,nombre);
var r=await fetch("/v1/sala/"+id,{method:"POST",headers:{"Content-Type":"text/plain"},body:d});
if(r.status===201){b.disabled=false;$("form").hidden=true;$("hecho").hidden=false;$("n").value="";$("h").focus();return}
var k=r.status===404?X.cerrada:r.status===429?((await r.json().catch(function(){return{}})).error==="llena"?X.llena:X.rapido):X.otroError;
dec(k,1);
}catch(_){dec(X.red,1)}
b.disabled=false;
});
$("o").addEventListener("click",function(){$("hecho").hidden=true;$("form").hidden=false;dec("",0);$("n").focus()});
})();
</script>
</body>
</html>
`;
}
