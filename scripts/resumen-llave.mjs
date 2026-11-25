#!/usr/bin/env node
/**
 * El resumen en Markdown del archivo de medidas de la prueba de la llave, para el resumen de la corrida.
 *
 *   node scripts/resumen-llave.mjs medidas-llave.json [codigo-de-salida]
 *
 * Las cifras son de la red de prueba y no son el precio de otra red: el resumen lo dice arriba.
 */
import { existsSync, readFileSync } from "node:fs";

const [archivo = "medidas-llave.json", codigo = ""] = process.argv.slice(2);
const leyenda = { 0: "dio bien", 1: "la prueba falló", 2: "no se pudo medir" };
const texto = (n) => (typeof n === "number" ? n.toLocaleString("es") : "sin dato");
const xlm = (s) => (typeof s === "number" ? `${(s / 10_000_000).toFixed(7)}` : "sin dato");

const salida = ["## Prueba de la llave", "", `Código de salida del recorrido: ${codigo === "" ? "sin dato" : `${codigo} (${leyenda[codigo] ?? "otro"})`}.`, ""];
if (!existsSync(archivo)) {
  salida.push("El recorrido no dejó el archivo de medidas.");
  console.log(salida.join("\n"));
  process.exit(0);
}
const d = JSON.parse(readFileSync(archivo, "utf8"));
salida.push(`> ${d.aviso}`, "");
salida.push("| Paso | Total en XLM de prueba | Inclusión | Alquiler | Instrucciones | Bytes escritos |", "| --- | --- | --- | --- | --- | --- |");
for (const [nombre, paso] of [["Crear la cuenta", d.cuenta], ["Sellar", d.sello], ["Sortear", d.sorteo], ["Segundo sello", d.otroAparato?.segundoSello ? { cobro: d.otroAparato.segundoSello } : null]]) {
  const c = paso?.cobro;
  salida.push(c ? `| ${nombre} | ${xlm(c.totalStroops)} | ${xlm(c.inclusionStroops)} | ${xlm(c.alquiler)} | ${texto(c.declarado?.instrucciones)} | ${texto(c.declarado?.bytesEscritos)} |` : `| ${nombre} | sin dato | | | | |`);
}
salida.push("");
salida.push(`Verificación del comprobante: ${d.verificacion ? `${d.verificacion.estado}` : "sin dato"}.`);
salida.push(`Otro aparato: ${d.otroAparato ? d.otroAparato.resultado : "no se probó"}.`);
if (d.otroAparato) {
  for (const [nombre, e] of [["Búsqueda en el historial", d.otroAparato.entradas?.historial], ["Búsqueda en el RPC", d.otroAparato.entradas?.rpc]]) {
    const en = e?.entrada;
    salida.push(`- ${nombre}: ${e?.ok ? "entró" : `no entró (${e?.estado ?? "sin estado"})`}${en ? `, fuente ${en.fuente}, ledger ${en.ledgerDeNacimiento ?? "sin dato"}, ${texto(en.segundosBuscando)} s buscando, ${en.desbloqueos ?? "sin dato"} desbloqueos` : ""}.`);
  }
  salida.push(`- Llave sin cuenta: ${d.otroAparato.sinCuenta?.estado ?? "sin estado"}.`);
}
salida.push(`Segundos del recorrido: ${texto(d.segundos)}.`);
if (Array.isArray(d.fallas) && d.fallas.length) {
  salida.push("", "Fallas:");
  for (const f of d.fallas) salida.push(`- ${f.paso}: ${f.motivo}${f.detalle ? ` (${f.detalle})` : ""}${f.conFoco === false ? ", sin foco" : ""}`);
}
console.log(salida.join("\n"));
