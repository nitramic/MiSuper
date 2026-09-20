// Google Drive backup, using Google Identity Services (OAuth token flow) +
// the Drive REST API directly from the browser. Scope is drive.file: the app
// can only see/edit files it created itself, never the rest of the user's Drive.

export const DRIVE_CLIENT_ID = "PONER_CLIENT_ID_AQUI.apps.googleusercontent.com";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FILENAME = "misuper-backup.json";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

export function isConfigured() {
  return !!DRIVE_CLIENT_ID && !DRIVE_CLIENT_ID.startsWith("PONER_CLIENT_ID");
}

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiry;
}

function ensureTokenClient() {
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // overridden per call, see connect()
    });
  }
  return tokenClient;
}

export function connect() {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    client.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      localStorage.setItem("misuper_drive_connected", "1");
      resolve();
    };
    const alreadyConnectedBefore = localStorage.getItem("misuper_drive_connected");
    client.requestAccessToken({ prompt: alreadyConnectedBefore ? "" : "consent" });
  });
}

async function ensureToken() {
  if (isConnected()) return accessToken;
  await connect();
  return accessToken;
}

async function findBackupFileId(token) {
  const cachedId = localStorage.getItem("misuper_drive_file_id");
  if (cachedId) return cachedId;

  const q = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("No se pudo buscar el backup en Drive (" + res.status + ")");
  const data = await res.json();
  const file = data.files && data.files[0];
  if (file) {
    localStorage.setItem("misuper_drive_file_id", file.id);
    return file.id;
  }
  return null;
}

export async function backupToDrive(jsonString) {
  const token = await ensureToken();
  const fileId = await findBackupFileId(token);

  const metadata = { name: BACKUP_FILENAME, mimeType: "application/json" };
  const boundary = "misuper_" + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    jsonString +
    `\r\n--${boundary}--`;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error("Error subiendo a Drive (" + res.status + ")");
  const data = await res.json();
  localStorage.setItem("misuper_drive_file_id", data.id);
  localStorage.setItem("misuper_drive_last_sync", new Date().toISOString());
  return data.id;
}

export async function restoreFromDrive() {
  const token = await ensureToken();
  const fileId = await findBackupFileId(token);
  if (!fileId) throw new Error("Todavía no hay ningún backup guardado en Drive.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Error descargando de Drive (" + res.status + ")");
  return res.json();
}

export function getLastSync() {
  return localStorage.getItem("misuper_drive_last_sync");
}

export function forgetConnection() {
  accessToken = null;
  tokenExpiry = 0;
  localStorage.removeItem("misuper_drive_connected");
  localStorage.removeItem("misuper_drive_file_id");
  localStorage.removeItem("misuper_drive_last_sync");
}
