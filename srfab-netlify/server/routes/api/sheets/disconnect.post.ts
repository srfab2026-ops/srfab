import { defineHandler } from "nitro";
import { clearSheetsCookie } from "../../../utils/google-sheets";

export default defineHandler((event) => {
  clearSheetsCookie(event);
  return { connected: false };
});
