import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value.includes("your-")) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SUPABASE_URL     = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WHAPI_TOKEN      = requireEnv("WHAPI_API_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface PayazaWebhookPayload {
  transaction_reference?: string;
  transaction_status?: string;
  transaction_fee?: number;
  amount_received?: number;
  merchant_reference?: string;
  status?: string;
  session_id?: string;
  channel?: string;
  currency_code?: string;
  request_amount?: number;
  amount_validation?: string;
  customer?: {
    email_address?: string;
    first_name?: string;
    last_name?: string;
    mobile_number?: string;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// POST  /api/whatsapp/payaza-callback
// ═════════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  try {
    const payload: PayazaWebhookPayload = await req.json();

    console.log("Payaza webhook:", {
      merchant_reference: payload.merchant_reference,
      status: payload.status,
      transaction_status: payload.transaction_status,
      request_amount: payload.request_amount,
      amount_received: payload.amount_received,
    });

    if (!payload.merchant_reference) {
      console.error("Payaza callback missing merchant_reference");
      return NextResponse.json({ received: true });
    }

    // ── 1. Lookup order ─────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*, produce(name, unit), farmers(full_name, phone, location)")
      .eq("payaza_reference", payload.merchant_reference)
      .single();

    if (orderErr || !order) {
      console.error("Order not found:", payload.merchant_reference, orderErr);
      return NextResponse.json({ received: true });
    }

    // ── 2. Replay / double-spend guard ──────────────────────────────────────
    if (order.status !== "pending") {
      console.log("Order already processed:", order.id, "status:", order.status);
      return NextResponse.json({ received: true });
    }

    // ── 3. Amount verification (±₦1 tolerance) ──────────────────────────────
    const expected = Number(order.total_amount) || 0;
    const received = Number(payload.request_amount ?? payload.amount_received) || 0;
    if (Math.abs(expected - received) > 1) {
      console.error(
        `Amount mismatch order ${order.id}: expected ₦${expected}, got ₦${received}`
      );
      return NextResponse.json({ received: true });
    }

    // ── 4. Status gate ──────────────────────────────────────────────────────
    const isSuccess =
      payload.status === "Completed" ||
      payload.transaction_status === "Funds Received" ||
      payload.amount_validation === "EXACT";

    if (!isSuccess) {
      console.log("Payment not successful:", payload.status, payload.transaction_status);
      return NextResponse.json({ received: true });
    }

    // ── 5. Mark paid ────────────────────────────────────────────────────────
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payaza_transaction_reference: payload.transaction_reference,
      })
      .eq("id", order.id);

    if (updErr) {
      console.error("Failed to mark order paid:", updErr);
      return NextResponse.json({ received: true });
    }

    // ── 6. Notify buyer ─────────────────────────────────────────────────────
    await sendWhatsAppMessage(
      order.buyer_phone,
      `🎉 *Payment Confirmed!*\n\n` +
      `Order #${order.id.slice(0, 8).toUpperCase()}\n` +
      `Item: ${order.produce?.name || "Produce"} x ${order.quantity_kg}${order.produce?.unit || "kg"}\n` +
      `Amount: ₦${order.total_amount?.toLocaleString()}\n` +
      `Status: PAID ✅\n\n` +
      `Your order is being prepared for delivery to:\n${order.delivery_location}\n\n` +
      `You'll receive updates soon. Type *MENU* to browse more.`
    );

    // ── 7. Notify farmer ────────────────────────────────────────────────────
    if (order.farmers?.phone) {
      await sendWhatsAppMessage(
        order.farmers.phone,
        `🌾 *New Order on Farmads!*\n\n` +
        `Order #${order.id.slice(0, 8).toUpperCase()}\n` +
        `Item: ${order.produce?.name || "Produce"} x ${order.quantity_kg}${order.produce?.unit || "kg"}\n` +
        `Amount: ₦${order.total_amount?.toLocaleString()}\n` +
        `Delivery to: ${order.delivery_location}\n` +
        `Payment: Confirmed via Payaza ✅\n\n` +
        `Please prepare for pickup.`
      );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Payaza callback fatal error:", err);
    return NextResponse.json({ received: true });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "ok" });
}

// ── Helper ───────────────────────────────────────────────────────────────────

async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  try {
    const phone = to.replace(/@.*/, "").replace(/\D/g, "");
    const res = await fetch(
      `https://gate.whapi.cloud/messages/text?token=${WHAPI_TOKEN}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: phone, body, typing_time: 0 }),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      console.error(`Whapi error ${res.status}:`, txt);
    }
  } catch (err) {
    console.error("WhatsApp send failed:", err);
  }
    }
        
