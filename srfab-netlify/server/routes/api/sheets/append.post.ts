import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { appendBill, readSheetsSession } from "../../../utils/google-sheets";

export default defineHandler(async (event) => {
  const session = readSheetsSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Connect Google Sheets first" });

  const body = await readBody<Record<string, unknown>>(event);
  const id = typeof body?.id === "string" ? body.id.slice(0, 80) : "";
  const createdAt = Number(body?.createdAt);
  const billNo = Number(body?.billNo);
  const total = Number(body?.total);
  const method = body?.method;
  const customer = typeof body?.customer === "string" ? body.customer.slice(0, 160) : "";
  const mobile = typeof body?.mobile === "string" ? body.mobile.replace(/[^\d+() -]/g, "").slice(0, 32) : "";
  const items = typeof body?.items === "string" ? body.items.slice(0, 3000) : "";

  if (!id || !Number.isFinite(createdAt) || !Number.isFinite(billNo) || !Number.isFinite(total) || total <= 0 || (method !== "Cash" && method !== "UPI")) {
    throw createError({ statusCode: 400, statusMessage: "Bill details are incomplete" });
  }
  return appendBill(session, { id, createdAt, no: billNo, customer, mobile, method, total, items });
});
