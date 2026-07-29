const { google } = require("googleapis");
const config = require("./config");

// Xizmat hisobi (service account) kaliti orqali Google Sheetsga ulanish
function getAuth() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Ustunlar: Sana | Filial | Ismi | TelegramID | Holat | Vaqt | Sabab | Tuzatish_holati | RequestId
async function appendRow(row) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// RequestId bo'yicha qatorni topib, tuzatish holatini va vaqtni yangilaydi
async function updateRowByRequestId(requestId, updates) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:I`,
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[8] === requestId);
  if (rowIndex === -1) return false;

  const rowNumber = rowIndex + 1; // sheets 1-based
  const current = rows[rowIndex];
  const updated = [...current];
  if (updates.vaqt) updated[5] = updates.vaqt;
  if (updates.holat) updated[7] = updates.holat;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [updated] },
  });
  return true;
}

async function getTodayRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:I`,
  });
  const rows = res.data.values || [];
  const today = new Date().toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent" });
  return rows.filter((r) => r[0] === today);
}

module.exports = { appendRow, updateRowByRequestId, getTodayRows };
