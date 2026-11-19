import { defineHandler } from "nitro";
import { createSheetsAuthorizationUrl, createState, setSheetsStateCookie } from "../../../utils/google-sheets";

export default defineHandler((event) => {
  const state = createState();
  setSheetsStateCookie(event, state);
  return { url: createSheetsAuthorizationUrl(state) };
});
