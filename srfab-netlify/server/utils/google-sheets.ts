import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createError, getCookie, getRequestURL, setCookie } from "nitro/h3";
import { useRuntimeConfig } from "nitro";

type Event = Parameters<typeof getCookie>[0];
export type SheetsSession = { refreshToken: string; spreadsheetId: string };

function config() {
  const runtime = useRuntimeConfig();
  const clientId = runtime.googleClientId as string;
  const clientSecret = runtime.googleClientSecret as string;
  const redirectUri = runtime.googleRedirectUri as string;
  const cookieKey = runtime.googleCookieKey as string;
  if (!clientId || !clientSecret || !redirectUri || !cookieKey || cookieKey.length < 32) {
    throw createError({ statusCode: 503, statusMessage: "Google Sheets is not configured" });
  }
  return { clientId, clientSecret, redirectUri, cookieKey };
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function createSheetsAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function createState() {
  return randomBytes(32).toString("base64url");
}

export function setSheetsStateCookie(event: Event, state: string) {
  setCookie(event, "srfab_sheets_state", state, {
    httpOnly: true,
    secure: getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/api/sheets",
    maxAge: 600,
  });
}

export function readSheetsState(event: Event) {
  return getCookie(event, "srfab_sheets_state");
}

export function clearSheetsStateCookie(event: Event) {
  setCookie(event, "srfab_sheets_state", "", { httpOnly: true, secure: getRequestURL(event).protocol === "https:", sameSite: "lax", path: "/api/sheets", maxAge: 0 });
}

export async function exchangeAuthorizationCode(code: string) {
  const { clientId, clientSecret, redirectUri } = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const tokens = await response.json() as { refresh_token?: string };
  if (!response.ok || !tokens.refresh_token) {
    throw createError({ statusCode: 502, statusMessage: "Google did not return an offline access token" });
  }
  return tokens.refresh_token;
}

export function encryptSession(session: SheetsSession) {
  const { cookieKey } = config();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(cookieKey), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function readSheetsSession(event: Event): SheetsSession | null {
  const value = getCookie(event, "srfab_sheets");
  if (!value) return null;
  try {
    const { cookieKey } = config();
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(cookieKey), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()) as SheetsSession;
  } catch {
    return null;
  }
}

export function setSheetsCookie(event: Event, session: SheetsSession) {
  setCookie(event, "srfab_sheets", encryptSession(session), {
    httpOnly: true,
    secure: getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearSheetsCookie(event: Event) {
  setCookie(event, "srfab_sheets", "", { httpOnly: true, secure: getRequestURL(event).protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
}

async function getAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const result = await response.json() as { access_token?: string };
  if (!response.ok || !result.access_token) {
    throw createError({ statusCode: 401, statusMessage: "Google authorization expired; reconnect your account" });
  }
  return result.access_token;
}

export async function createSalesSpreadsheet(refreshToken: string) {
  const accessToken = await getAccessToken(refreshToken);
  const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ properties: { title: "SR FAB Sales" }, sheets: [{ properties: { title: "Bills" } }] }),
  });
  const result = await response.json() as { spreadsheetId?: string };
  if (!response.ok || !result.spreadsheetId) {
    throw createError({ statusCode: 502, statusMessage: "Could not create your Google spreadsheet" });
  }
  const headerRange = encodeURIComponent("Bills!A1:I1");
  const headerResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}/values/${headerRange}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ values: [["Bill ID", "Date", "Time", "Bill number", "Customer name", "Mobile number", "Payment method", "Total (INR)", "Items"]] }),
  });
  if (!headerResponse.ok) throw createError({ statusCode: 502, statusMessage: "Could not prepare the Google spreadsheet" });
  return result.spreadsheetId;
}

export async function appendBill(session: SheetsSession, bill: { id: string; createdAt: number; no: number; customer: string; mobile: string; method: string; total: number; items: string }) {
  const accessToken = await getAccessToken(session.refreshToken);
  const spreadsheet = encodeURIComponent(session.spreadsheetId);
  const idRange = encodeURIComponent("Bills!A2:A");
  const existingResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}/values/${idRange}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!existingResponse.ok) throw createError({ statusCode: 502, statusMessage: "Could not check existing spreadsheet rows" });
  const existing = await existingResponse.json() as { values?: string[][] };
  if (existing.values?.some((row) => row[0] === bill.id)) return { saved: true, duplicate: true };

  const date = new Date(bill.createdAt);
  const values = [[bill.id, date.toLocaleDateString("en-IN"), date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), String(bill.no || ""), bill.customer, bill.mobile, bill.method, bill.total, bill.items]];
  const range = encodeURIComponent("Bills!A:I");
  const appendResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!appendResponse.ok) throw createError({ statusCode: 502, statusMessage: "Could not save this bill to Google Sheets" });
  return { saved: true, duplicate: false };
}
