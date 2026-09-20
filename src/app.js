import { saveTicket, deleteTicket, getAllTickets, importTickets, upsertKnownProduct, getKnownProducts, newId } from "./db.js";
import { parseReceiptText } from "./parser.js";
import { fileToImageCanvases, runOCR } from "./ocr.js";
import { findBestMatch } from "./fuzzy.js";
import * as drive from "./drive.js";

// ---------- Tab navigation ----------
const tabButtons = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".view");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    views.forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
    if (btn.dataset.view === "tickets") renderTicketsList();
    if (btn.dataset.view === "dashboard") renderDashboard();
  });
});

// ---------- Scan flow ----------
const previewArea = document.getElementById("preview-area");
const ocrCard = document.getElementById("ocr-progress-card");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const reviewCard = document.getElementById("review-card");

let currentDraft = null; // { date, items, total, rawText }

document.getElementById("input-camera").addEventListener("change", handleFileInput);
document.getElementById("input-file").addEventListener("change", handleFileInput);

async function handleFileInput(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  previewArea.innerHTML = "";
  reviewCard.hidden = true;

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    previewArea.appendChild(img);
  } else {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "📄 " + file.name;
    previewArea.appendChild(p);
  }

  ocrCard.hidden = false;
  progressFill.style.width = "0%";
  progressText.textContent = "Preparando…";

  try {
    const canvases = await fileToImageCanvases(file);
    const rawText = await runOCR(canvases, (status, progress) => {
      progressFill.style.width = Math.round(progress * 100) + "%";
      progressText.textContent = translateStatus(status) + " " + Math.round(progress * 100) + "%";
    });
    ocrCard.hidden = true;

    const parsed = parseReceiptText(rawText);
    currentDraft = { ...parsed, rawText, store: "" };
    showReview();
  } catch (err) {
    ocrCard.hidden = true;
    alert("No se pudo procesar el archivo: " + err.message);
    console.error(err);
  }
}

function translateStatus(status) {
  const map = {
    "loading tesseract core": "Cargando motor OCR",
    "initializing tesseract": "Iniciando OCR",
    "loading language traineddata": "Cargando idioma",
    "initializing api": "Preparando",
    "recognizing text": "Leyendo ticket",
  };
  return map[status] || status;
}

// ---------- Review form ----------
const fieldStore = document.getElementById("field-store");
const fieldDate = document.getElementById("field-date");
const fieldTotal = document.getElementById("field-total");
const itemsTbody = document.getElementById("items-tbody");
const rawOcrText = document.getElementById("raw-ocr-text");

async function showReview() {
  reviewCard.hidden = false;
  fieldStore.value = currentDraft.store || "";
  fieldDate.value = currentDraft.date;
  fieldTotal.value = currentDraft.total.toFixed(2);
  rawOcrText.textContent = currentDraft.rawText;
  itemsTbody.innerHTML = "";

  const knownProducts = await getKnownProducts();
  let correctionsMade = 0;
  currentDraft.items.forEach((item) => {
    const match = findBestMatch(item.name, knownProducts);
    if (match && match.name !== item.name) {
      addItemRow({ ...item, name: match.name }, true);
      correctionsMade++;
    } else {
      addItemRow(item, false);
    }
  });
  if (currentDraft.items.length === 0) addItemRow({ name: "", qty: 1, price: 0 }, false);

  if (correctionsMade > 0) {
    console.info(`Diccionario personal: ${correctionsMade} producto(s) auto-corregido(s).`);
  }
  reviewCard.scrollIntoView({ behavior: "smooth" });
}

function addItemRow(item, autoCorrected) {
  const tr = document.createElement("tr");
  const hint = autoCorrected ? ' title="Corregido con tu diccionario personal" style="background:#f0fdf4"' : "";
  tr.innerHTML = `
    <td><input type="text" class="it-name"${hint} value="${escapeAttr(item.name)}" placeholder="Producto" /></td>
    <td><input type="number" step="0.01" class="it-qty" value="${item.qty}" /></td>
    <td><input type="number" step="0.01" class="it-price" value="${item.price}" /></td>
    <td><button class="row-del" title="Eliminar">✕</button></td>
  `;
  tr.querySelector(".row-del").addEventListener("click", () => tr.remove());
  itemsTbody.appendChild(tr);
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}

document.getElementById("btn-add-item").addEventListener("click", () => {
  addItemRow({ name: "", qty: 1, price: 0 });
});

document.getElementById("btn-recalc-total").addEventListener("click", () => {
  const rows = collectItems();
  const sum = rows.reduce((s, it) => s + it.qty * it.price, 0);
  fieldTotal.value = sum.toFixed(2);
});

function collectItems() {
  const rows = [...itemsTbody.querySelectorAll("tr")];
  return rows
    .map((tr) => ({
      name: tr.querySelector(".it-name").value.trim(),
      qty: parseFloat(tr.querySelector(".it-qty").value) || 1,
      price: parseFloat(tr.querySelector(".it-price").value) || 0,
    }))
    .filter((it) => it.name.length > 0);
}

document.getElementById("btn-discard").addEventListener("click", () => {
  reviewCard.hidden = true;
  previewArea.innerHTML = "";
  currentDraft = null;
});

document.getElementById("btn-save-ticket").addEventListener("click", async () => {
  const items = collectItems();
  if (items.length === 0) {
    if (!confirm("No hay productos cargados. ¿Guardar igual solo con el total?")) return;
  }
  const ticket = {
    id: newId(),
    store: fieldStore.value.trim() || "Sin nombre",
    date: fieldDate.value || new Date().toISOString().slice(0, 10),
    items,
    total: parseFloat(fieldTotal.value) || 0,
    createdAt: new Date().toISOString(),
  };
  await saveTicket(ticket);
  for (const item of items) {
    await upsertKnownProduct(item.name);
  }
  reviewCard.hidden = true;
  previewArea.innerHTML = "";
  currentDraft = null;
  alert("Ticket guardado ✅");
  document.querySelector('[data-view="tickets"]').click();
});

// ---------- Tickets list ----------
const ticketsList = document.getElementById("tickets-list");
const filterMonth = document.getElementById("filter-month");
filterMonth.addEventListener("change", renderTicketsList);

async function renderTicketsList() {
  const all = await getAllTickets();
  const month = filterMonth.value;
  const filtered = month ? all.filter((t) => t.date.startsWith(month)) : all;

  ticketsList.innerHTML = "";
  if (filtered.length === 0) {
    ticketsList.innerHTML = '<p class="muted">No hay tickets guardados todavía.</p>';
    return;
  }

  for (const t of filtered) {
    const div = document.createElement("div");
    div.className = "ticket-card";
    const itemsPreview = t.items.slice(0, 3).map((i) => i.name).join(", ");
    const more = t.items.length > 3 ? ` +${t.items.length - 3} más` : "";
    div.innerHTML = `
      <div class="ticket-card-head">
        <strong>${escapeHtml(t.store)}</strong>
        <span>$${t.total.toFixed(2)}</span>
      </div>
      <div class="ticket-card-sub">
        <input type="date" class="ticket-date-edit" value="${t.date}" />
        · ${t.items.length} productos
      </div>
      <div class="ticket-items-mini">${escapeHtml(itemsPreview)}${more}</div>
      <div class="ticket-card-actions">
        <button class="btn-secondary btn-del">Eliminar</button>
      </div>
    `;
    div.querySelector(".btn-del").addEventListener("click", async () => {
      if (confirm("¿Eliminar este ticket?")) {
        await deleteTicket(t.id);
        renderTicketsList();
      }
    });
    div.querySelector(".ticket-date-edit").addEventListener("change", async (e) => {
      const newDate = e.target.value;
      if (!newDate) return;
      t.date = newDate;
      await saveTicket(t);
      renderTicketsList();
    });
    ticketsList.appendChild(div);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Backup: export / import ----------
async function buildBackupPayload() {
  const tickets = await getAllTickets();
  return {
    app: "misuper",
    exportedAt: new Date().toISOString(),
    tickets,
  };
}

document.getElementById("btn-export").addEventListener("click", async () => {
  const payload = await buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `misuper-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById("input-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const tickets = Array.isArray(payload) ? payload : payload.tickets;
    if (!Array.isArray(tickets)) throw new Error("Formato de backup inválido");
    if (!confirm(`Se van a importar ${tickets.length} tickets. Los que ya existan (mismo id) se van a actualizar. ¿Continuar?`)) return;
    const count = await importTickets(tickets);
    alert(`Backup importado: ${count} tickets ✅`);
    renderTicketsList();
    renderDashboard();
  } catch (err) {
    alert("No se pudo importar el backup: " + err.message);
    console.error(err);
  }
});

// ---------- Google Drive backup ----------
const driveStatus = document.getElementById("drive-status");
const driveSyncActions = document.getElementById("drive-sync-actions");
const driveLastSync = document.getElementById("drive-last-sync");
const btnDriveConnect = document.getElementById("btn-drive-connect");

function refreshDriveUI() {
  if (!drive.isConfigured()) {
    driveStatus.textContent = "Todavía no configurado (falta el Client ID de Google).";
    btnDriveConnect.disabled = true;
    return;
  }
  if (drive.isConnected()) {
    driveStatus.textContent = "Conectado a Google Drive ✅";
    driveSyncActions.hidden = false;
  } else {
    driveStatus.textContent = "No conectado.";
    driveSyncActions.hidden = true;
  }
  const last = drive.getLastSync();
  driveLastSync.textContent = last ? "Última sincronización: " + new Date(last).toLocaleString() : "";
}

btnDriveConnect.addEventListener("click", async () => {
  try {
    await drive.connect();
    refreshDriveUI();
    alert("Conectado a Google Drive ✅. Ahora podés sincronizar.");
  } catch (err) {
    alert("No se pudo conectar con Google: " + err.message);
    console.error(err);
  }
});

document.getElementById("btn-drive-backup").addEventListener("click", async () => {
  try {
    const payload = await buildBackupPayload();
    await drive.backupToDrive(JSON.stringify(payload));
    refreshDriveUI();
    alert("Backup subido a Google Drive ✅");
  } catch (err) {
    alert("No se pudo subir el backup: " + err.message);
    console.error(err);
  }
});

document.getElementById("btn-drive-restore").addEventListener("click", async () => {
  try {
    const payload = await drive.restoreFromDrive();
    const tickets = Array.isArray(payload) ? payload : payload.tickets;
    if (!Array.isArray(tickets)) throw new Error("Formato de backup inválido");
    if (!confirm(`Se van a importar ${tickets.length} tickets desde Drive. Los que ya existan (mismo id) se van a actualizar. ¿Continuar?`)) return;
    const count = await importTickets(tickets);
    alert(`Restaurado desde Drive: ${count} tickets ✅`);
    renderTicketsList();
    renderDashboard();
  } catch (err) {
    alert("No se pudo restaurar desde Drive: " + err.message);
    console.error(err);
  }
});

refreshDriveUI();

// ---------- Dashboard ----------
const dashboardMonth = document.getElementById("dashboard-month");
dashboardMonth.addEventListener("change", renderDashboard);

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}
dashboardMonth.value = currentMonthStr();
filterMonth.value = currentMonthStr();

async function renderDashboard() {
  const all = await getAllTickets();
  const month = dashboardMonth.value || currentMonthStr();
  const monthTickets = all.filter((t) => t.date.startsWith(month));

  const total = monthTickets.reduce((s, t) => s + t.total, 0);
  const itemCount = monthTickets.reduce((s, t) => s + t.items.length, 0);
  const avg = monthTickets.length ? total / monthTickets.length : 0;

  document.getElementById("stat-total").textContent = "$" + total.toFixed(2);
  document.getElementById("stat-tickets").textContent = monthTickets.length;
  document.getElementById("stat-items").textContent = itemCount;
  document.getElementById("stat-avg").textContent = "$" + avg.toFixed(2);

  renderMonthsChart(all, month);
  renderTopProducts(monthTickets);
}

function renderMonthsChart(all, currentMonth) {
  const canvas = document.getElementById("chart-months");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const months = [];
  const base = new Date(currentMonth + "-01T00:00:00");
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }

  const totals = months.map((m) =>
    all.filter((t) => t.date.startsWith(m)).reduce((s, t) => s + t.total, 0)
  );
  const max = Math.max(...totals, 1);

  const padding = 30;
  const w = (canvas.width - padding * 2) / months.length;
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#6b7280";

  months.forEach((m, i) => {
    const barH = (totals[i] / max) * (canvas.height - 50);
    const x = padding + i * w + w * 0.15;
    const barW = w * 0.7;
    const y = canvas.height - 25 - barH;
    ctx.fillStyle = m === currentMonth ? "#16a34a" : "#a7d8b8";
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = "#6b7280";
    ctx.fillText(m.slice(5), x, canvas.height - 8);
    if (totals[i] > 0) {
      ctx.fillText(Math.round(totals[i]), x, y - 4);
    }
  });
}

function renderTopProducts(monthTickets) {
  const map = new Map();
  for (const t of monthTickets) {
    for (const it of t.items) {
      const key = it.name.trim().toLowerCase();
      if (!key) continue;
      const cur = map.get(key) || { name: it.name, count: 0, total: 0 };
      cur.count += 1;
      cur.total += it.qty * it.price;
      map.set(key, cur);
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 15);

  const tbody = document.getElementById("top-products-tbody");
  tbody.innerHTML = "";
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Sin datos este mes</td></tr>';
    return;
  }
  for (const p of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.count}</td><td>$${p.total.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  }
}

renderDashboard();

// ---------- PWA service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  });
}
