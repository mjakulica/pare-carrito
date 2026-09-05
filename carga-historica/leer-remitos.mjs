// Lee los PDF de remitos y devuelve los pedidos con cantidades y precios reales.
// Uso:  npm i pdfjs-dist  &&  node leer-remitos.mjs Remitos_31082026.pdf [...] > remitos.json
import fs from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

async function paginasDe(archivo) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(archivo)), useSystemFonts: true }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    paginas.push({ num: n, items: tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({
      t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(vp.height - i.transform[5]) })) });
  }
  return paginas;
}

const num = (s) => {
  const t = String(s || "").replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
};
const RUIDO = /Pare Carrito|Responsable|Cuit:|Inicio de Act|Insumos frescos|Cofruthos|^Remito$|^\d{1,2}\/\d{1,2}\/\d{4}$/;
// Cada remito arranca con el codigo del cliente. Algunos clientes no tienen numero cargado y el
// PDF imprime solo el guion, asi que el numero es opcional y despues se resuelve por nombre.
const MARCA = /^(\d{3})?\s*-\s*$/;

// Los remitos vienen en dos formatos: 4 por hoja (2x2) y 2 por hoja (a lo alto). En vez de asumir
// uno, cada bloque se delimita por la posicion de su marca y las columnas se deducen de los
// encabezados "Precio unitario" / "Precio total" de ese mismo bloque.
export async function parseRemitos(archivo) {
  const paginas = await paginasDe(archivo);
  const remitos = [];
  for (const pg of paginas) {
    const marcas = pg.items.filter((i) => MARCA.test(i.t)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!marcas.length) continue;
    const xs = [...new Set(marcas.map((c) => c.x))].sort((a, b) => a - b);
    const ys = [...new Set(marcas.map((c) => c.y))].sort((a, b) => a - b);
    for (const cod of marcas) {
      const xSig = xs.find((x) => x > cod.x + 20);
      const ySig = ys.find((y) => y > cod.y + 20);
      const dentro = pg.items.filter((i) =>
        i.x >= cod.x - 18 && (xSig == null || i.x < xSig - 18) &&
        i.y >= cod.y - 8 && (ySig == null || i.y < ySig - 8));
      // El encabezado puede venir partido ("Cantidad") o unido ("Cantidad Descripción")
      const encCant = dentro.find((i) => /^Cantidad/.test(i.t));
      const encPU = dentro.find((i) => /Precio unitario/.test(i.t));
      const encPT = dentro.find((i) => /Precio total/.test(i.t));
      if (!encCant || !encPU || !encPT) continue;
      const nombre = dentro.filter((i) => i.y > cod.y - 6 && i.y < encCant.y - 5 && !RUIDO.test(i.t) && !MARCA.test(i.t))
        .sort((a, b) => b.y - a.y)[0];
      const fecha = dentro.find((i) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(i.t));

      const filas = new Map();
      dentro.filter((i) => i.y > encCant.y + 3).forEach((i) => {
        const k = Math.round(i.y / 5);
        if (!filas.has(k)) filas.set(k, []);
        filas.get(k).push(i);
      });
      const lineas = [];
      let total = null;
      for (const [, its] of [...filas.entries()].sort((a, b) => a[0] - b[0])) {
        const texto = its.map((i) => i.t).join(" ");
        if (/Total/i.test(texto)) {
          const v = its.filter((i) => i.x >= encPU.x - 25).map((i) => num(i.t)).filter((x) => x != null);
          if (v.length) total = v[v.length - 1];
          continue;
        }
        const izq = its.filter((i) => i.x < encPU.x - 25).sort((a, b) => a.x - b.x);
        const pu = its.filter((i) => i.x >= encPU.x - 25 && i.x < encPT.x - 25).map((i) => num(i.t)).find((v) => v != null);
        const pt = its.filter((i) => i.x >= encPT.x - 25).map((i) => num(i.t)).find((v) => v != null);
        if (!izq.length || pu == null) continue;
        const cant = num(izq[0].t);
        const desc = izq.slice(1).map((i) => i.t).join(" ").trim();
        if (cant == null || !desc) continue;
        lineas.push({ cantidad: cant, producto: desc, precioUnitario: pu, precioTotal: pt });
      }
      if (lineas.length) remitos.push({ clienteId: (cod.t.match(MARCA)[1] || ""), cliente: nombre ? nombre.t : "",
        fecha: fecha ? fecha.t : "", pagina: pg.num, lineas, totalImpreso: total });
    }
  }
  // Un pedido largo sigue en la columna/pagina siguiente: se une por cliente y se suman los totales
  const unidos = new Map();
  for (const r of remitos) {
    const k = r.clienteId || r.cliente;
    if (!unidos.has(k)) { unidos.set(k, r); continue; }
    const a = unidos.get(k);
    a.lineas = a.lineas.concat(r.lineas);
    if (r.totalImpreso != null) a.totalImpreso = (a.totalImpreso || 0) + r.totalImpreso;
    if (!a.cliente && r.cliente) a.cliente = r.cliente;
    a.continuado = true;
  }
  return [...unidos.values()];
}

if (process.argv.length > 2) {
  const todo = [];
  for (const arch of process.argv.slice(2)) {
    const rs = await parseRemitos(arch);
    rs.forEach((r) => todo.push({ ...r, archivo: arch.split("/").pop() }));
    console.error(`${arch}: ${rs.length} remitos, ${rs.reduce((s, r) => s + r.lineas.length, 0)} lineas`);
  }
  console.log(JSON.stringify(todo, null, 1));
}
