import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYAZA_PUBLIC_KEY = process.env.PAYAZA_API_KEY!;
const encodedKey = Buffer.from(PAYAZA_PUBLIC_KEY).toString("base64");
const WHAPI_TOKEN = process.env.WHAPI_API_TOKEN!;
const WHAPI_CHANNEL = process.env.WHAPI_CHANNEL_ID!;

interface Context {
  selectedProduceId?: string;
  selectedFarmerId?: string;
  quantity?: number;
  totalAmount?: number;
  deliveryLocation?: string;
  category?: string;
  produceList?: any[];
  selectedProduce?: any;
}

const CATEGORIES: Record<string, string[]> = {
  "1": ["Cocoa Beans", "Palm Oil"],
  "2": ["Plantain", "Plantain Suckers"],
  "3": ["Cassava Tubers", "Garri (White)", "Garri (Yellow)"],
  "4": ["Yam Tubers", "Yam (Seed)"],
  "5": ["Cabanero Pepper", "Dried Pepper Flakes"],
};

const CATEGORY_NAMES: Record<string, string> = {
  "1": "🍫 Cocoa & Oil Palm",
  "2": "🍌 Plantain",
  "3": "🍠 Cassava & Garri",
  "4": "🥔 Yam",
  "5": "🌶️ Pepper & Spices",
};

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { from, body: messageText } = extractMessage(payload);

    if (!from || !messageText) {
      return NextResponse.json({ ok: true });
    }

    const phone = normalizePhone(from);
    const text = messageText.trim();

    let { data: conv } = await supabase
      .from("wa_conversations")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!conv) {
      const { data: newConv } = await supabase
        .from("wa_conversations")
        .insert({ phone, current_step: "menu", context: {} })
        .select()
        .single();
      conv = newConv;
    }

    await supabase
      .from("wa_conversations")
      .update({ last_active_at: new Date().toISOString() })
      .eq("phone", phone);

    const context: Context = conv.context || {};
    const step = conv.current_step;
    const lowerText = text.toLowerCase();

    let reply: string;
    let nextStep = step;
    let nextContext: Context = { ...context };

    if (lowerText === "menu" || text === "0" || lowerText === "start") {
      reply = getMainMenu();
      nextStep = "menu";
      nextContext = {};
    } else if (step === "menu") {
      if (text === "1") {
        reply = getCategoryMenu();
        nextStep = "browse_category";
        nextContext = {};
      } else if (text === "2") {
        reply = `🌾 *Sell Your Produce on Farmads*\n\nTo register as a farmer, please reply with your full name.\n\nOr type *MENU* to go back.`;
        nextStep = "register_name";
        nextContext = {};
      } else if (text === "3") {
        const { data: orders } = await supabase
          .from("orders")
          .select("*, produce(name), farmers(full_name)")
          .eq("buyer_phone", phone)
          .order("created_at", { ascending: false })
          .limit(3);

        if (!orders || orders.length === 0) {
          reply = `📦 You have no active orders.\n\nType *1* to browse produce and place your first order!`;
          nextStep = "menu";
          nextContext = {};
        } else {
          reply = `📦 *Your Recent Orders*\n\n`;
          orders.forEach((o: any, i: number) => {
            reply += `${i + 1}. ${o.produce?.name || "Produce"} — ₦${o.total_amount?.toLocaleString()} (${o.status})\n`;
          });
          reply += `\nType *MENU* to return.`;
          nextStep = "menu";
          nextContext = {};
        }
      } else {
        reply = `❓ I didn't understand that.\n\n` + getMainMenu();
        nextStep = "menu";
        nextContext = {};
      }
    } else if (step === "browse_category") {
      if (CATEGORIES[text]) {
        const { data: produce } = await supabase
          .from("produce")
          .select("id, name, variety, price_per_kg, quantity_available_kg, unit, farmers(full_name, location)")
          .eq("is_available", true)
          .in("name", CATEGORIES[text])
          .order("price_per_kg", { ascending: true });

        if (!produce || produce.length === 0) {
          reply = `😔 No produce available in this category right now.\n\n` + getCategoryMenu();
          nextStep = "browse_category";
          nextContext = {};
        } else {
          reply = `📋 *${CATEGORY_NAMES[text]}* — Available Now\n\n`;
          produce.forEach((p: any, i: number) => {
            reply += `${i + 1}. *${p.name}* (${p.variety})\n   💰 ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n   📍 ${p.farmers?.location || "Nigeria"} | 👤 ${p.farmers?.full_name || "Farmer"}\n   📦 ${p.quantity_available_kg.toLocaleString()}${p.unit} available\n\n`;
          });
          reply += `Reply with the number of the item you want, or type *MENU*.`;
          nextStep = "browse_produce";
          nextContext = { category: text, produceList: produce };
        }
      } else {
        reply = `❓ Please reply with a number 1-5.\n\n` + getCategoryMenu();
        nextStep = "browse_category";
        nextContext = {};
      }
    } else if (step === "browse_produce") {
      const idx = parseInt(text) - 1;
      const list = context.produceList || [];
      if (idx < 0 || idx >= list.length) {
        reply = `❓ Invalid selection. Please reply with a valid number.`;
        nextStep = "browse_produce";
      } else {
        const produce = list[idx];
        nextContext.selectedProduce = produce;
        nextContext.selectedProduceId = produce.id;
        nextContext.selectedFarmerId = produce.farmer_id;
        reply = `🌾 *${produce.name}*\n\nVariety: ${produce.variety}\nPrice: ₦${produce.price_per_kg.toLocaleString()}/${produce.unit}\nAvailable: ${produce.quantity_available_kg.toLocaleString()}${produce.unit}\nFarmer: ${produce.farmers?.full_name} (${produce.farmers?.location})\n\nReply with the quantity in ${produce.unit} you want to buy, or type *MENU*.`;
        nextStep = "enter_quantity";
      }
    } else if (step === "enter_quantity") {
      const qty = parseFloat(text);
      const produce = context.selectedProduce;
      if (isNaN(qty) || qty <= 0) {
        reply = `❓ Please enter a valid number for quantity.`;
        nextStep = "enter_quantity";
      } else if (qty > produce.quantity_available_kg) {
        reply = `⚠️ Only ${produce.quantity_available_kg}${produce.unit} available. Please enter a lower quantity.`;
        nextStep = "enter_quantity";
      } else {
        const total = qty * produce.price_per_kg;
        reply = `🛒 *Order Summary*\n\nItem: ${produce.name}\nQuantity: ${qty}${produce.unit}\nUnit Price: ₦${produce.price_per_kg.toLocaleString()}/${produce.unit}\n*Total: ₦${total.toLocaleString()}*\n\nReply *YES* to confirm, or *MENU* to cancel.`;
        nextStep = "confirm_order";
        nextContext = { ...context, quantity: qty, totalAmount: total };
      }
    } else if (step === "confirm_order") {
      if (lowerText !== "yes") {
        reply = `❌ Order cancelled. Type *MENU* to browse more produce.`;
        nextStep = "menu";
        nextContext = {};
      } else {
        reply = `📍 Please enter your delivery location (e.g., "Wuse 2, Abuja").`;
        nextStep = "enter_delivery_location";
      }
    } else if (step === "enter_delivery_location") {
      reply = `💳 *Payment Options*\n\nYour order is ready for payment.\n\nReply *1* for Payaza Secure Pay (Card/Transfer/USSD)\nReply *2* for Bank Transfer (manual)\n\nType *MENU* to cancel.`;
      nextStep = "payment";
      nextContext = { ...context, deliveryLocation: text };
    } else if (step === "payment") {
      const produce = context.selectedProduce;
      const qty = context.quantity || 0;
      const total = context.totalAmount || 0;
      const location = context.deliveryLocation || "";

      if (text === "1") {
        const { data: order } = await supabase
          .from("orders")
          .insert({
            buyer_phone: phone,
            farmer_id: context.selectedFarmerId,
            produce_id: context.selectedProduceId,
            quantity_kg: qty,
            total_amount: total,
            delivery_location: location,
            status: "pending",
          })
          .select()
          .single();

        const payazaLink = await createPayazaPaymentLink({
          amount: total,
          reference: `FARMADS-${order.id.slice(0, 8)}`,
          customerEmail: `${phone}@farmads.ng`,
          customerName: phone,
          description: `${produce.name} x ${qty}${produce.unit} from Farmads`,
        });

        await supabase
          .from("orders")
          .update({
            payaza_reference: `FARMADS-${order.id.slice(0, 8)}`,
            payaza_payment_link: payazaLink,
          })
          .eq("id", order.id);

        reply = `✅ *Order Created!*\n\nOrder ID: #${order.id.slice(0, 8).toUpperCase()}\nItem: ${produce.name} x ${qty}${produce.unit}\nTotal: ₦${total.toLocaleString()}\nDelivery: ${location}\n\nClick to pay securely:\n${payazaLink}\n\nOnce paid, you'll receive confirmation. Type *MENU*.`;
        nextStep = "order_complete";
        nextContext = {};
      } else if (text === "2") {
        reply = `🏦 *Bank Transfer Details*\n\nAccount Name: Farmads Nigeria Ltd\nAccount Number: 1234567890\nBank: GTBank\nAmount: ₦${total.toLocaleString()}\n\nSend proof to this number. Type *MENU* when done.`;
        nextStep = "order_complete";
        nextContext = {};
      } else {
        reply = `❓ Please reply *1* for Payaza or *2* for Bank Transfer.`;
        nextStep = "payment";
      }
    } else if (step === "register_name") {
      reply = `✅ Thanks ${text}! Please share your farm location (e.g., "Ikom, Cross River").`;
      nextStep = "register_location";
    } else if (step === "register_location") {
      reply = `✅ Location saved. Please share your bank details (Bank Name, Account Number, Account Name) for payouts.`;
      nextStep = "register_bank";
    } else if (step === "register_bank") {
      reply = `🎉 *Registration Complete!*\n\nYour farm profile is under review. You'll be notified once verified.\n\nType *MENU* to continue.`;
      nextStep = "menu";
      nextContext = {};
    } else {
      reply = getMainMenu();
      nextStep = "menu";
      nextContext = {};
    }

    await supabase
      .from("wa_conversations")
      .update({ current_step: nextStep, context: nextContext })
      .eq("phone", phone);

    await sendWhatsAppMessage(phone, reply);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "ok" });
}

async function createPayazaPaymentLink(params: {
  amount: number;
  reference: string;
  customerEmail: string;
  customerName: string;
  description: string;
}) {
  try {
    const res = await fetch(
      "https://api.payaza.africa/live/merchant-collection/checkout/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Payaza ${encodedKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: params.amount,
          currency: "NGN",
          reference: params.reference,
          customer: {
            email: params.customerEmail,
            name: params.customerName,
          },
          description: params.description,
          callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/payaza-callback`,
        }),
      }
    );
    const data = await res.json();
    return data.data?.checkout_url || "https://payaza.africa";
  } catch (err) {
    console.error("Payaza error:", err);
    return "https://payaza.africa";
  }
}

async function sendWhatsAppMessage(to: string, text: string) {
  try {
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
  } catch (err) {
    console.error("WhatsApp send error:", err);
  }
}

function getMainMenu() {
  return `🌾 *Welcome to Farmads.ng* — AI-Powered Agricultural Marketplace\n\nWhat would you like to do?\n\n*1* 🛒 Buy Fresh Produce\n*2* 🌾 Sell Your Produce\n*3* 📦 Track My Orders\n\nReply with a number.`;
}

function getCategoryMenu() {
  return `📋 *Browse Produce by Category*\n\n*1* 🍫 Cocoa & Oil Palm\n*2* 🍌 Plantain\n*3* 🍠 Cassava & Garri\n*4* 🥔 Yam\n*5* 🌶️ Pepper & Spices\n\nReply with a number (1-5) or type *MENU*.`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0/, "234").replace(/^\+/, "");
}

function extractMessage(payload: any) {
  return {
    from: payload.from || payload.sender?.phone,
    body: payload.body?.text || payload.text?.body || payload.message || payload.body,
    type: payload.type || "text",
  };
      }
                 
