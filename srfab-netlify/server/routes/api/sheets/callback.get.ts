import { defineHandler } from "nitro";
import { createError, getQuery, sendRedirect } from "nitro/h3";
import { clearSheetsStateCookie, createSalesSpreadsheet, exchangeAuthorizationCode, readSheetsState, setSheetsCookie } from "../../../utils/google-sheets";

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const state = readSheetsState(event);
  clearSheetsStateCookie(event);
  if (!state || query.state !== state || typeof query.code !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Google authorization could not be verified" });
  }
  const refreshToken = await exchangeAuthorizationCode(query.code);
  const spreadsheetId = await createSalesSpreadsheet(refreshToken);
  setSheetsCookie(event, { refreshToken, spreadsheetId });
  return sendRedirect(event, "/?sheets=connected");
});
