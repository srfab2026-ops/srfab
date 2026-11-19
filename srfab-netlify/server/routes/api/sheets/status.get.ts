import { defineHandler } from "nitro";
import { readSheetsSession } from "../../../utils/google-sheets";

export default defineHandler((event) => {
  const session = readSheetsSession(event);
  return session
    ? { connected: true, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${session.spreadsheetId}/edit` }
    : { connected: false };
});
