import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WHAPI_TOKEN = process.env.WHAPI_API_TOKEN!;
const WHAPI_CHANNEL = process.env.WHAPI_CHANNEL_ID!;

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { reference, status, amount } = payload;

    if (!reference || !status) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("*, produce(name), farmers(phone)")
      .eq("payaza_reference", reference)
      .single();

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (status === "success" || status === "completed") {
      await supabase
        .from("orders")
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("id", order.id);

      await sendWhatsApp(order.buyer_phone,
        `✅ *Payment Confirmed!*\n\n` +
        `Order #${order.id.slice(0, 8).toUpperCase()} paid.\n` +
        `Amount: ₦${amount?.toLocaleString() || order.total_amount.toLocaleString()}\n\n` +
        `The farmer will prepare your ${order.produce?.name} for delivery. 🚚`
      );

      await sendWhatsApp(order.farmers?.phone,
        `🌾 *New Order on Farmads!*\n\n` +
        `Order #${order.id.slice(0, 8).toUpperCase()}\n` +
        `Item: ${order.produce?.name}\n` +
        `Quantity: ${order.quantity_kg}kg\n` +
        `Total: ₦${order.total_amount.toLocaleString()}\n` +
        `Delivery: ${order.delivery_location}\n\n` +
        `Payment confirmed. Please prepare for pickup. ✅`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Callback error:", err);
    return NextResponse.json({ ok: true });
  }
}

async function sendWhatsApp(to: string, text: string) {
  await fetch(`https://api.whapi.cloud/messages/text/${WHAPI_CHANNEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: to.replace(/\D/g, "").replace(/^0/, "234").replace(/^\+/, ""),
      body: text,
    }),
  });
        }
    
