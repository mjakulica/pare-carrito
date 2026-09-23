// Recupera los productos (items) de pedidos y compras que quedaron vacios en el servidor.
//
// Por que: los pedidos viejos viajan a los dispositivos sin productos (vista rapida) y, hasta la
// v34, si un dispositivo modificaba uno de esos pedidos, el servidor guardaba la copia vacia
// encima de la completa. Este script toma los productos de uno o mas respaldos y los devuelve a
// los pedidos que hoy estan vacios. No toca ningun pedido que ya tenga productos.
//
// Respaldos que acepta (se pueden pasar varios; para cada pedido se usa el primero que lo tenga):
//   - los .sql.gz / .sql que guarda deploy.sh en /root/backups-pare-carrito
//   - un backup .json exportado desde la app (Backup -> Exportar) con el historial completo
//
// Uso en el VPS (desde /opt/pare-carrito/pare-carrito-sas-server):
//   docker compose run --rm -v /root/backups-pare-carrito:/backups api \
//     node src/recuperar-productos.js /backups/db_20260905_101500.sql.gz
// Revisar lo que informa y, si esta bien, repetir agregando --aplicar al final.

const fs = require("fs");
const zlib = require("zlib");
const { Pool } = require("pg");

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const archivos = args.filter((a) => !a.startsWith("--"));
if (!archivos.length) {
  console.error("Uso: node src/recuperar-productos.js <respaldo.sql.gz|respaldo.json> [otro...] [--aplicar]");
  process.exit(1);
}

// Formato de texto de COPY de Postgres: \\ \n \t \r \b \f \v, octal \NNN y hexa \xHH.
function unescapeCopy(value) {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c !== "\\") { out += c; continue; }
    const n = value[i + 1];
    if (n === undefined) break;
    if (n === "n") { out += "\n"; i += 1; }
    else if (n === "t") { out += "\t"; i += 1; }
    else if (n === "r") { out += "\r"; i += 1; }
    else if (n === "b") { out += "\b"; i += 1; }
    else if (n === "f") { out += "\f"; i += 1; }
    else if (n === "v") { out += "\v"; i += 1; }
    else if (n === "x" && /^[0-9a-fA-F]{1,2}/.test(value.slice(i + 2, i + 4))) {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(value.slice(i + 2, i + 4))[0];
      out += String.fromCharCode(parseInt(hex, 16)); i += 1 + hex.length;
    } else if (/[0-7]/.test(n)) {
      const oct = /^[0-7]{1,3}/.exec(value.slice(i + 1, i + 4))[0];
      out += String.fromCharCode(parseInt(oct, 8)); i += oct.length;
    } else { out += n; i += 1; }
  }
  return out;
}

// Del dump saca la fila 'main' de app_state y devuelve su columna data (el estado entero).
function estadoDesdeDump(texto) {
  const inicio = /^COPY (?:public\.)?app_state \(([^)]*)\) FROM stdin;$/m.exec(texto);
  if (!inicio) throw new Error("el dump no tiene la tabla app_state");
  const columnas = inicio[1].split(",").map((c) => c.trim().replace(/"/g, ""));
  const colId = columnas.indexOf("id");
  const colData = columnas.indexOf("data");
  const resto = texto.slice(inicio.index + inicio[0].length + 1);
  for (const linea of resto.split("\n")) {
    if (linea === "\\.") break;
    const campos = linea.split("\t");
    if (unescapeCopy(campos[colId]) === "main") return JSON.parse(unescapeCopy(campos[colData]));
  }
  throw new Error("el dump no tiene la fila 'main' de app_state");
}

function leerRespaldo(ruta) {
  const crudo = fs.readFileSync(ruta);
  const texto = ruta.endsWith(".gz") ? zlib.gunzipSync(crudo).toString("utf8") : crudo.toString("utf8");
  if (ruta.endsWith(".json")) {
    const json = JSON.parse(texto);
    return json && json.data && Array.isArray(json.data.orders) ? json.data : json;
  }
  return estadoDesdeDump(texto);
}

const vacio = (row) => !Array.isArray(row && row.items) || row.items.length === 0;

(async () => {
  const fuentes = archivos.map((ruta) => {
    const estado = leerRespaldo(ruta);
    const conItems = (lista) => new Map((Array.isArray(lista) ? lista : [])
      .filter((row) => row && row.id && !vacio(row)).map((row) => [String(row.id), row]));
    const fuente = { ruta, orders: conItems(estado.orders), purchases: conItems(estado.purchases) };
    console.log("Respaldo " + ruta + ": " + fuente.orders.size + " pedidos y " + fuente.purchases.size + " compras con productos.");
    return fuente;
  });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://parecarrito:parecarrito@localhost:5432/parecarrito" });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const fila = await db.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!fila.rows.length) throw new Error("no hay estado guardado en app_state");
    const data = fila.rows[0].data;
    const resumen = {};
    ["orders", "purchases"].forEach((clave) => {
      const recuperados = [];
      const sinFuente = [];
      (Array.isArray(data[clave]) ? data[clave] : []).forEach((row) => {
        if (!row || !row.id || !vacio(row)) return;
        const importe = Math.abs(Number(clave === "orders" ? row.totalAmount : row.totalCost) || 0);
        const fuente = fuentes.find((f) => f[clave].has(String(row.id)));
        if (!fuente) {
          // Una compra sin items (gasto, flete, pago) es normal; un pedido sin items con importe no.
          if (clave === "orders" && importe > 0.001) sinFuente.push(row);
          return;
        }
        const original = fuente[clave].get(String(row.id));
        row.items = original.items;
        if (!(importe > 0.001)) {
          ["subtotalAmount", "ivaAmount", "totalAmount", "totalCost"].forEach((campo) => {
            if (original[campo] !== undefined) row[campo] = original[campo];
          });
        }
        delete row.__itemsStripped;
        delete row.itemsCount;
        recuperados.push({ row, ruta: fuente.ruta });
      });
      resumen[clave] = { recuperados, sinFuente };
    });

    const nombre = { orders: "pedidos", purchases: "compras" };
    ["orders", "purchases"].forEach((clave) => {
      const { recuperados, sinFuente } = resumen[clave];
      console.log("\n" + nombre[clave].toUpperCase() + ": " + recuperados.length + " se pueden recuperar.");
      const porFecha = {};
      recuperados.forEach(({ row }) => { porFecha[row.date] = (porFecha[row.date] || 0) + 1; });
      Object.keys(porFecha).sort().forEach((fecha) => console.log("  " + fecha + ": " + porFecha[fecha]));
      recuperados.slice(0, 15).forEach(({ row, ruta }) => console.log("  " + row.id + " (" + row.date + ", cliente " + (row.clientId || row.providerId || "-") + "): " + row.items.length + " productos  <- " + ruta));
      if (recuperados.length > 15) console.log("  ... y " + (recuperados.length - 15) + " mas");
      if (sinFuente.length) {
        const fechas = sinFuente.map((row) => String(row.date || "")).sort();
        console.log("  " + sinFuente.length + " " + nombre[clave] + " siguen vacios (ningun respaldo los tiene con productos), del " + fechas[0] + " al " + fechas[fechas.length - 1] + ". Proba con un respaldo mas viejo.");
      }
    });

    const total = resumen.orders.recuperados.length + resumen.purchases.recuperados.length;
    if (!aplicar || !total) {
      await db.query("ROLLBACK");
      console.log(total ? "\nNo se cambio nada. Si esta bien, repeti el comando agregando --aplicar." : "\nNo hay nada para recuperar con estos respaldos.");
      return;
    }
    await db.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'recuperar-productos' WHERE id = 'main'", [data]);
    await db.query("INSERT INTO state_history (data, updated_by) VALUES ($1, 'recuperar-productos')", [data]);
    await db.query("COMMIT");
    console.log("\nListo: se recuperaron " + resumen.orders.recuperados.length + " pedidos y " + resumen.purchases.recuperados.length + " compras. Los dispositivos lo reciben en la proxima sincronizacion.");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("No se pudo recuperar: " + error.message);
    process.exitCode = 1;
  } finally {
    db.release();
    await pool.end();
  }
})();
