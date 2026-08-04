import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.includes("your-")) throw new Error(`Missing env: ${name}`);
  return v;
}

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const WHAPI_TOKEN = getEnv("WHAPI_API_TOKEN");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return res.status(200).json({ status: "ok" });
  if (req.method !== "POST") return res.status(405).end();

  try {
    const p = req.body;
    console.log("Payaza callback:", { ref: p.merchant_reference, status: p.status });

    if (!p.merchant_reference) return res.status(200).json({ received: true });

    const { data: order, error: oe } = await supabase
      .from("orders").select("*, produce(name, unit), farmers(full_name, phone, location)")
      .eq("payaza_reference", p.merchant_reference).single();

    if (oe || !order) { console.error("Order not found"); return res.status(200).json({ received: true }); }
    if (order.status !== "pending") { console.log("Already processed"); return res.status(200).json({ received: true }); }

    const expected = Number(order.total_amount) || 0;
    const received = Number(p.request_amount ?? p.amount_received) || 0;
    if (Math.abs(expected - received) > 1) {
      console.error(`Amount mismatch: expected ₦${expected}, got ₦${received}`);
      return res.status(200).json({ received: true });
    }

    const success = p.status === "Completed" || p.transaction_status === "Funds Received" || p.amount_validation === "EXACT";
    if (!success) { console.log("Not successful:", p.status); return res.status(200).json({ received: true }); }

    await supabase.from("orders").update({
      status: "paid", paid_at: new Date().toISOString(),
      payaza_transaction_reference: p.transaction_reference
    }).eq("id", order.id);

    // Notify buyer
    await sendWA(order.buyer_phone,
      `🎉 *Payment Confirmed!*\n\nOrder #${order.id.slice(0,8).toUpperCase()}\n${order.produce?.name||"Produce"} x ${order.quantity_kg}${order.produce?.unit||"kg"}\n₦${order.total_amount?.toLocaleString()} — PAID ✅\n\nDelivery: ${order.delivery_location}\n\nType *MENU*.`
    );

    // Notify farmer
    if (order.farmers?.phone) {
      await sendWA(order.farmers.phone,
        `🌾 *New Farmads Order!*\n\n#${order.id.slice(0,8).toUpperCase()}\n${order.produce?.name||"Produce"} x ${order.quantity_kg}${order.produce?.unit||"kg"}\n₦${order.total_amount?.toLocaleString()}\nTo: ${order.delivery_location}\nPayaza: Confirmed ✅\n\nPrepare for pickup.`
      );
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Callback error:", err);
    return res.status(200).json({ received: true });
  }
}

async function sendWA(to: string, body: string) {
  try {
    const phone = to.replace(/@.*/, "").replace(/\D/g, "");
    await fetch(`https://gate.whapi.cloud/messages/text?token=${WHAPI_TOKEN}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, body, typing_time: 0 })
    });
  } catch (e) { console.error("WA send failed:", e); }
                                                     }
                   
