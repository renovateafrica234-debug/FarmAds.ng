import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.includes("your-")) throw new Error(`Missing env: ${name}`);
  return v;
}

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const WHAPI_TOKEN = getEnv("WHAPI_API_TOKEN");
const PAYSTACK_KEY = getEnv("PAYSTACK_SECRET_KEY");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return res.status(200).json({ status: "ok" });
  if (req.method !== "POST") return res.status(405).end();

  try {
    const p = req.body;
    console.log("Paystack callback:", { ref: p.reference || p.data?.reference, status: p.status || p.data?.status });

    // Paystack sends webhook as { event, data: { reference, status, ... } }
    const reference = p.data?.reference || p.reference || "";
    const status = p.data?.status || p.status || "";
    const amount = p.data?.amount || p.amount || 0;
    
    if (!reference) return res.status(200).json({ received: true });

    // Find order by paystack reference
    const { data: order, error: oe } = await supabase.from("orders").select("*, produce(name, unit), farmers(full_name, phone, location)").eq("paystack_reference", reference).single();
    if (oe || !order) { console.error("Order not found"); return res.status(200).json({ received: true }); }
    if (order.status !== "pending") { console.log("Already processed"); return res.status(200).json({ received: true }); }

    // Verify with Paystack API (defense against spoofed webhooks)
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { "Authorization": `Bearer ${PAYSTACK_KEY}` }
    });
    const verifyData = await verifyRes.json();
    
    const isSuccess = verifyData.status === true && verifyData.data?.status === "success";
    
    if (!isSuccess) { 
      console.log("Payment not successful:", verifyData.data?.status); 
      return res.status(200).json({ received: true }); 
    }

    // Update order to paid
    await supabase.from("orders").update({ 
      status: "paid", 
      paid_at: new Date().toISOString(), 
      paystack_transaction_reference: reference 
    }).eq("id", order.id);

    await sendWA(order.buyer_phone, `✅ *Payment Confirmed!*\n\nOrder #${order.id.slice(0,8).toUpperCase()}\n${order.produce?.name||"Product"} x ${order.quantity_kg}${order.produce?.unit||"kg"}\n₦${order.total_amount?.toLocaleString()} — PAID ✅\n\nDelivery: ${order.delivery_location}\n\nType *MENU*.`);
    
    if (order.farmers?.phone) await sendWA(order.farmers.phone, `🌾 *New Farmads Order!*\n\n#${order.id.slice(0,8).toUpperCase()}\n${order.produce?.name||"Product"} x ${order.quantity_kg}${order.produce?.unit||"kg"}\n₦${order.total_amount?.toLocaleString()}\nTo: ${order.delivery_location}\nPaystack: Confirmed ✅\n\nPrepare for pickup.`);

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
      method: "POST", 
      headers: { "Content-Type": "application/json" }, 
      body: JSON.stringify({ to: phone, body, typing_time: 0 }) 
    });
  } catch (e) { console.error("WA send failed:", e); }
      }
                                   
