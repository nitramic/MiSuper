// Heuristic parser for supermarket receipt OCR text (es-AR / es-ES oriented).
// OCR is noisy, so this aims for "good enough starting point", the user reviews before saving.

const PRICE_RE = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}|\d+)\s*$/;
const SKIP_WORDS = [
  "subtotal", "total", "efectivo", "vuelto", "cambio", "tarjeta", "debito",
  "credito", "iva", "cuit", "cae", "gracias", "cajero", "caja", "ticket",
  "factura", "responsable", "razon social", "domicilio", "consumidor final",
  "cliente", "descuento", "bonificacion", "puntos", "items", "articulos",
  "recibido", "medio de pago", "resto", "pesos"
];

function normalizeNumber(str) {
  if (!str) return null;
  let s = str.trim();
  // formats like 1.234,56 or 1,234.56 or 1234.56 or 1234,56
  if (/\d[.,]\d{3}[.,]\d{2}$/.test(s) || /\d{1,3}(?:\.\d{3})+,\d{2}/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/,\d{2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function looksLikeSkipLine(lowerLine) {
  return SKIP_WORDS.some((w) => lowerLine.includes(w));
}

export function parseReceiptText(rawText) {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const items = [];
  let total = null;
  let date = null;

  // date detection dd/mm/yyyy or dd-mm-yyyy or yyyy-mm-dd
  const dateRe1 = /(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/;
  const dateRe2 = /(\d{4})-(\d{2})-(\d{2})/;
  for (const line of lines) {
    let m = line.match(dateRe2);
    if (m) {
      date = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
    m = line.match(dateRe1);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = "20" + y;
      date = `${y}-${mo}-${d}`;
      break;
    }
  }

  for (const line of lines) {
    const lower = line.toLowerCase();

    const priceMatch = line.match(PRICE_RE);
    if (!priceMatch) continue;

    const price = normalizeNumber(priceMatch[1]);
    if (price === null) continue;

    if (looksLikeSkipLine(lower)) {
      if (lower.includes("total") && !lower.includes("subtotal") && (total === null || price > total)) {
        total = price;
      }
      continue;
    }

    // strip the trailing price to get the product name
    let name = line.slice(0, priceMatch.index).trim();
    // remove leading quantity codes / bullet characters / leading numbers like "2 x" or "EAN codes"
    name = name.replace(/^[\-*#]+/, "").trim();
    name = name.replace(/^\d{6,}\s*/, "").trim(); // barcode-like leading digits
    let qty = 1;
    const qtyMatch = name.match(/^(\d+(?:[.,]\d+)?)\s*[xX]\s*/);
    if (qtyMatch) {
      qty = parseFloat(qtyMatch[1].replace(",", "."));
      name = name.slice(qtyMatch[0].length).trim();
    }

    if (name.length < 2) continue;
    if (price <= 0 || price > 999999) continue;

    items.push({ name, qty, price });
  }

  if (total === null && items.length > 0) {
    total = Math.round(items.reduce((s, it) => s + it.price, 0) * 100) / 100;
  }

  return {
    date: date || new Date().toISOString().slice(0, 10),
    items,
    total: total || 0,
  };
}
