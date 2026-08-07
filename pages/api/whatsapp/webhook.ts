import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.includes("your-")) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const WHAPI_TOKEN = getEnv("WHAPI_API_TOKEN");
const PAYSTACK_KEY = getEnv("PAYSTACK_SECRET_KEY");
const APP_URL = getEnv("NEXT_PUBLIC_APP_URL");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES: Record<string, string[]> = {
  "1": ["Cocoa Beans", "Palm Oil"],
  "2": ["Plantain", "Plantain Suckers"],
  "3": ["Cassava Tubers", "Garri (White)", "Garri (Yellow)"],
  "4": ["Yam Tubers", "Yam (Seed)"],
  "5": ["Cabanero Pepper", "Dried Pepper Flakes"],
};

const CAT_NAMES: Record<string, string> = {
  "1": "🍫 Cocoa & Oil Palm",
  "2": "🍌 Plantain",
  "3": "🍠 Cassava & Garri",
  "4": "🌾 Yam",
  "5": "🌶️ Pepper & Spices",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return res.status(200).json({ status: "ok" });
  if (req.method !== "POST") return res.status(405).end();

  try {
    const payload = req.body;
    const from = payload?.messages?.[0]?.from || payload?.from || "";
    const bodyText = payload?.messages?.[0]?.text?.body || payload?.body || "";

    if (!from || !bodyText) return res.status(200).json({ ok: true });

    const phone = from.replace(/@.*/, "").replace(/\D/g, "");
    const text = bodyText.trim();

    let { data: conv } = await supabase.from("wa_conversations").select("*").eq("phone", phone).single();
    if (!conv) {
      const { data: nc } = await supabase.from("wa_conversations").insert({ phone, current_step: "menu", context: {} }).select().single();
      conv = nc;
    }

    await supabase.from("wa_conversations").update({ last_active_at: new Date().toISOString() }).eq("phone", phone);

    const ctx = conv.context || {};
    const step = conv.current_step;
    const lower = text.toLowerCase();

    let reply = "";
    let nextStep = step;
    let nextCtx = { ...ctx };

    if (lower === "menu" || text === "0" || lower === "start") {
      reply = menu(); nextStep = "menu"; nextCtx = {};
    } else if (step === "menu") {
      if (text === "1") { reply = catMenu(); nextStep = "browse_category"; nextCtx = {}; }
      else if (text === "2") { reply = "🌾 *Sell on Farmads*\n\nReply with your full name.\n\nType *MENU* to go back."; nextStep = "register_name"; nextCtx = {}; }
      else if (text === "3") {
        const { data: orders } = await supabase.from("orders").select("*, produce(name), farmers(full_name)").eq("buyer_phone", phone).order("created_at", { ascending: false }).limit(3);
        if (!orders?.length) reply = "📦 No active orders.\n\nType *1* to browse.";
        else { reply = "📦 *Your Orders*\n\n"; orders.forEach((o: any, i: number) => { reply += `${i+1}. ${o.produce?.name||"Product"} — ₦${o.total_amount?.toLocaleString()} (${o.status})\n`; }); reply += "\nType *MENU*."; }
        nextStep = "menu"; nextCtx = {};
      } else { reply = menu(); nextStep = "menu"; nextCtx = {}; }
    } else if (step === "browse_category") {
      if (CATEGORIES[text]) {
        const { data: produce } = await supabase.from("produce").select("id, name, variety, price_per_kg, quantity_available_kg, unit, min_order_kg, farmer_id, farmers(full_name, location, phone)").eq("is_available", true).in("name", CATEGORIES[text]).order("price_per_kg", { ascending: true });
        if (!produce?.length) { reply = "😔 No product.\n\n" + catMenu(); nextStep = "browse_category"; }
        else {
          reply = `📋 *${CAT_NAMES[text]}*\n\n`;
          produce.forEach((p: any, i: number) => { reply += `${i+1}. *${p.name}* (${p.variety})\n  💰 ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n  📍 ${p.farmers?.location||"Nigeria"} | 👤 ${p.farmers?.full_name||"Farmer"}\n  📦 ${p.quantity_available_kg}${p.unit} avail\n\n`; });
          reply += "Reply item number or *MENU*.";
          nextStep = "browse_product"; nextCtx = { productList: produce };
        }
      } else { reply = "❓ Reply 1-5.\n\n" + catMenu(); nextStep = "browse_category"; }
    } else if (step === "browse_product") {
      const idx = parseInt(text) - 1;
      const list = ctx.productList || [];
      if (isNaN(idx) || idx < 0 || idx >= list.length) { reply = "❓ Invalid. Reply 1-" + list.length + "."; nextStep = "browse_product"; }
      else {
        const p = list[idx];
        reply = `🌾 *${p.name}*\n\nVariety: ${p.variety}\nPrice: ₦${p.price_per_kg.toLocaleString()}/${p.unit}\nAvail: ${p.quantity_available_kg}${p.unit}\nMin: ${p.min_order_kg||1}${p.unit}\nFarmer: ${p.farmers?.full_name} (${p.farmers?.location})\n\nReply quantity in ${p.unit}, or *MENU*.`;
        nextStep = "enter_quantity"; nextCtx = { ...ctx, selectedProduct: p, selectedProductId: p.id, selectedFarmerId: p.farmer_id };
      }
    } else if (step === "enter_quantity") {
      const qty = parseFloat(text);
      const p = ctx.selectedProduct;
      if (isNaN(qty) || qty <= 0) reply = "❓ Enter a valid number.";
      else if (qty < (p.min_order_kg||1)) reply = `⚠️ Min order is ${p.min_order_kg||1}${p.unit}.`;
      else if (qty > p.quantity_available_kg) reply = `⚠️ Only ${p.quantity_available_kg}${p.unit} available.`;
      else {
        const total = qty * p.price_per_kg;
        reply = `🛒 *Order Summary*\n\nItem: ${p.name}\nQty: ${qty}${p.unit}\nUnit: ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n*Total: ₦${total.toLocaleString()}*\n\nReply *YES* to confirm, or *MENU*.`;
        nextStep = "confirm_order"; nextCtx = { ...ctx, quantity: qty, totalAmount: total };
      }
    } else if (step === "confirm_order") {
      if (text.toLowerCase() !== "yes") { reply = "❌ Cancelled. Type *MENU*."; nextStep = "menu"; nextCtx = {}; }
      else { reply = "🚚 Enter delivery location (e.g. Wuse 2, Abuja)."; nextStep = "enter_delivery_location"; }
    } else if (step === "enter_delivery_location") {
      reply = "💳 *Payment Options*\n\nReply *1* for Paystack (Card/Transfer/USSD)\nReply *2* for Bank Transfer (manual)\n\nType *MENU* to cancel.";
      nextStep = "payment"; nextCtx = { ...ctx, deliveryLocation: text };
    } else if (step === "payment") {
      const p = ctx.selectedProduct; const qty = ctx.quantity||0; const total = ctx.totalAmount||0; const loc = ctx.deliveryLocation||"";
      if (text === "1") {
        console.log("INSERT ORDER DEBUG:", {
          buyer_phone: phone,
          farmer_id: ctx.selectedFarmerId,
          produce_id: ctx.selectedProductId,
          quantity_kg: qty,
          total_amount: total,
          delivery_location: loc,
        });

        const { data: order, error: oe } = await supabase.from("orders").insert({
          buyer_phone: phone,
          farmer_id: ctx.selectedFarmerId,
          produce_id: ctx.selectedProductId,
          quantity_kg: qty,
          total_amount: total,
          delivery_location: loc,
          status: "pending"
        }).select().single();

        if (oe || !order) {
          console.error("ORDER INSERT ERROR:", JSON.stringify(oe, null, 2));
          reply = "❌ Order failed. Try later.";
          nextStep = "menu";
          nextCtx = {};
        } else {
          console.log("ORDER CREATED:", order.id);
          const ref = `FMD-${order.id.slice(0,11)}`;
          const paystackRes = await fetch("https://api.paystack.co/paymentrequest", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${PAYSTACK_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              customer: phone,
              amount: total * 100,
              description: `${p.name} x ${qty}${p.unit}`,
              callback_url: `${APP_URL}/api/whatsapp/paystack-callback`,
            }),
          });
          const paystackData = await paystackRes.json();
          console.log("PAYSTACK RESPONSE:", JSON.stringify(paystackData, null, 2));

          let link = "";
          if (paystackData.status && paystackData.data) {
            link = paystackData.data.request_code
              ? `https://paystack.com/pay/${paystackData.data.request_code}`
              : paystackData.data.url || "";
          }

          await supabase.from("orders").update({
            paystack_reference: ref,
            paystack_payment_link: link
          }).eq("id", order.id);

          if (!link) {
            reply = `✅ *Order Created!*\n\n#${order.id.slice(0,8).toUpperCase()}\n${p.name} x ${qty}${p.unit}\nTotal: ₦${total.toLocaleString()}\nDelivery: ${loc}\n\n⚠️ Payment link generation failed. Type *MENU*.`;
          } else {
            reply = `✅ *Order Created!*\n\n#${order.id.slice(0,8).toUpperCase()}\n${p.name} x ${qty}${p.unit}\nTotal: ₦${total.toLocaleString()}\nDelivery: ${loc}\n\nPay: ${link}\n\nType *MENU*.`;
          }
          nextStep = "order_complete"; nextCtx = {};
        }
      } else if (text === "2") {
        reply = `🏦 *Bank Transfer*\n\nBank: First Bank\nAcct: Farmads Nigeria Ltd\nAcct No: 1234567890\nAmount: ₦${total.toLocaleString()}\n\nReply with tx ref when done.\nType *MENU*.`;
        nextStep = "order_complete"; nextCtx = {};
      } else { reply = "❓ Reply *1* for Paystack or *2* for Bank Transfer.\n\nType *MENU*."; nextStep = "payment"; }
    } else if (step === "order_complete") {
      reply = "✅ Order complete! Type *MENU* to order again."; nextStep = "menu"; nextCtx = {};
    } else if (step === "register_name") {
      reply = `✅ Thanks ${text}! Share your farm location.`; nextStep = "register_location"; nextCtx = { ...ctx, farmerName: text };
    } else if (step === "register_location") {
      reply = "✅ Location saved. Share bank details (Bank, Acct No, Acct Name)."; nextStep = "register_bank"; nextCtx = { ...ctx, farmerLocation: text };
    } else if (step === "register_bank") {
      reply = "⏳ *Registration Complete!*\n\nProfile under review.\n\nType *MENU*."; nextStep = "menu"; nextCtx = {};
    } else {
      reply = menu(); nextStep = "menu"; nextCtx = {};
    }

    await supabase.from("wa_conversations").update({ current_step: nextStep, context: nextCtx }).eq("phone", phone);

    try {
      await fetch(`https://gate.whapi.cloud/messages/text?token=${WHAPI_TOKEN}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, body: reply, typing_time: 0 })
      });
    } catch (e) { console.error("Whapi send failed:", e); }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: true });
  }
}

function menu() {
  return `🌾 *Welcome to Farmads!*\n\nReply with a number:\n*1* — Browse Produce 🛒\n*2* — Sell as Farmer 👨‍🌾\n*3* — My Orders 📦\n\nType *MENU* anytime.`;
}
function catMenu() {
  return `📋 *Browse Categories*\n\n*1* — 🍫 Cocoa & Oil Palm\n*2* — 🍌 Plantain\n*3* — 🍠 Cassava & Garri\n*4* — 🌾 Yam\n*5* — 🌶️ Pepper & Spices\n\nType *MENU* to go back.`;
                                                                           }
    
