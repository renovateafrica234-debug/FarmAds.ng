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

    let reply: string;
    let nextStep = step;
    let nextContext: Context = { ...context };

    if (text.toLowerCase() === "menu" || text === "0" || text.toLowerCase() === "start") {
      reply = getMainMenu();
      nextStep = "menu";
      nextContext = {};
    } else if (step === "menu") {
      const result = await handleMenu(text, phone);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "browse_category") {
      const result = await handleBrowseCategory(text, context);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "browse_produce") {
      const result = await handleBrowseProduce(text, context);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "enter_quantity") {
      const result = await handleEnterQuantity(text, context);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "confirm_order") {
      const result = await handleConfirmOrder(text, context);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "enter_delivery_location") {
      const result = await handleDeliveryLocation(text, context);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "payment") {
      const result = await handlePayment(text, context, phone);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
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

// ─── STEP HANDLERS ─────────────────────────────────────────────────

async function handleMenu(text: string, phone: string) {
  const t = text.trim();
  if (t === "1") {
    return { reply: getCategoryMenu(), nextStep: "browse_category", context: {} };
  }
  if (t === "2") {
    return {
      reply: `🌾 *Sell Your Produce on Farmads*\n\nTo register as a farmer, please reply with your full name.\n\nOr type *MENU* to go back.`,
      nextStep: "register_name",
      context: {},
    };
  }
  if (t === "3") {
    const { data: orders } = await supabase
      .from("orders")
      .select("*, produce(name), farmers(full_name)")
      .eq("buyer_phone", phone)
      .order("created_at", { ascending: false })
      .limit(3);

    if (!orders || orders.length === 0) {
      return {
        reply: `📦 You have no active orders.\n\nType *1* to browse produce and place your first order!`,
        nextStep: "menu",
        context: {},
      };
    }

    let reply = `📦 *Your Recent Orders*\n\n`;
    orders.forEach((o: any, i: number) => {
      reply += `${i + 1}. ${o.produce?.name || "Produce"} — ₦${o.total_amount?.toLocaleString()} (${o.status})\n`;
    });
    reply += `\nType *MENU* to return.`;
    return { reply, nextStep: "menu", context: {} };
  }

  return {
    reply: `❓ I didn't understand that.\n\n` + getMainMenu(),
    nextStep: "menu",
    context: {},
  };
}

async function handleBrowseCategory(text: string, context: Context) {
  if (CATEGORIES[text]) {
    const { data: produce } = await supabase
      .from("produce")
      .select("id, name, variety, price_per_kg, quantity_available_kg, unit, farmers(full_name, location)")
      .eq("is_available", true)
      .in("name", CATEGORIES[text])
      .order("price_per_kg", { ascending: true });

    if (!produce || produce.length === 0) {
      return {
        reply: `😔 No produce available in this category right now.\n\n` + getCategoryMenu(),
        nextStep: "browse_category",
        context: {},
      };
    }

    let reply = `📋 *${CATEGORY_NAMES[text]}* — Available Now\n\n`;
    produce.forEach((p: any, i: number) => {
      reply += `${i + 1}. *${p.name}* (${p.variety})\n   💰 ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n   📍 ${p.farmers?.location || "Nigeria"} | 👤 ${p.farmers?.full_name || "Farmer"}\n   📦 ${p.quantity_available_kg.toLocaleString()}${p.unit} available\n\n`;
    });
    reply += `Reply with the number of the item you want, or type *MENU*.`;

    return {
      reply,
      nextStep: "browse_produce",
      context: { category: text, produceList: produce },
    };
  }

  return {
    reply: `❓ Please reply with a number 1-5.\n\n` + getCategoryMenu(),
    nextStep: "browse_category",
    context: {},
  };
}

async function handleBrowseProduce(text: string, context: Context) {
  const idx = parseInt(text) - 1;
  const list = context.produceList || [];

  if (idx < 0 || idx >= list.length) {
    return {
      reply: `❓ Invalid selection. Please reply with a valid number.`,
      nextStep: "browse_produce",
      context,
    };
  }

  const produce = list[idx];
  context.selectedProduce = produce;
  context.selectedProduceId = produce.id;
  context.selectedFarmerId = produce.farmer_id;

  const reply =
    `🌾 *${produce.name}*\n\n` +
    `Variety: ${produce.variety}\n` +
    `Price: ₦${produce.price_per_kg.toLocaleString()}/${produce.unit}\n` +
    `Available: ${produce.quantity_available_kg.toLocaleString()}${produce.unit}\n` +
    `Farmer: ${produce.farmers?.full_name} (${produce.farmers?.location})\n\n` +
    `Reply with the quantity in ${produce.unit} you want to buy, or type *MENU*.`;

  return {
    reply,
    nextStep: "enter_quantity",
    context,
  };
}

async function handleEnterQuantity(text: string, context: Context) {
  const qty = parseFloat(text);
  const produce = context.selectedProduce;

  if (isNaN(qty) || qty <= 0) {
    return {
      reply: `❓ Please enter a valid number for quantity.`,
      nextStep: "enter_quantity",
      context,
    };
  }

  if (qty > produce.quantity_available_kg) {
    return {
      reply: `⚠️ Only ${produce.quantity_available_kg}${produce.unit} available. Please enter a lower quantity.`,
      nextStep: "enter_quantity",
      context,
    };
  }

  const total = qty * produce.price_per_kg;

  return {
    reply:
      `🛒 *Order Summary*\n\n` +
      `Item: ${produce.name}\n` +
      `Quantity: ${qty}${produce.unit}\n` +
      `Unit Price: ₦${produce.price_per_kg.toLocaleString()}/${produce.unit}\n` +
      `*Total: ₦${total.toLocaleString()}*\n\n` +
      `Reply *YES* to confirm, or *MENU* to cancel.`,
    nextStep: "confirm_order",
    context: { ...context, quantity: qty, totalAmount: total },
  };
}

async function handleConfirmOrder(text: string, context: Context) {
  if (text.toLowerCase() !== "yes") {
    return {
      reply: `❌ Order cancelled. Type *MENU* to browse more produce.`,
      nextStep: "menu",
      context: {},
    };
  }

  return {
    reply: `📍 Please enter your delivery location (e.g., "Wuse 2, Abuja").`,
    nextStep: "enter_delivery_location",
    context,
  };
}

async function handleDeliveryLocation(text: string, context: Context) {
  return {
    reply:
      `💳 *Payment Options*\n\n` +
      `Your order is ready for payment.\n\n` +
      `Reply *1* for Payaza Secure Pay (Card/Transfer/USSD)\n` +
      `Reply *2* for Bank Transfer (manual)\n\n` +
      `Type *MENU* to cancel.`,
    nextStep: "payment",
    context: { ...context, deliveryLocation: text },
  };
}

async function handlePayment(text: string, context: Context, phone: string) {
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

    return {
      reply:
        `✅ *Order Created!*\n\n` +
        `Order ID: #${order.id.slice(0, 8).toUpperCase()}\n` +
        `Item: ${produce.name} x ${qty}${produce.unit}\n` +
        `Total: ₦${total.toLocaleString()}\n` +
        `Delivery: ${location}\n\n` +
        `Click to pay securely:\n${payazaLink}\n\n` +
        `Once paid, you'll receive confirmation. Type *MENU*.`,
      nextStep: "order_complete",
      context: {},
    };
  }

  if (text === "2") {
    return {
      reply:
        `🏦 *Bank Transfer Details*\n\n` +
        `Account Name: Farmads Nigeria Ltd\n` +
        `Account Number: 1234567890\n` +
        `Bank: GTBank\n` +
        `Amount: ₦${total.toLocaleString()}\n\n` +
        `Send proof to this number. Type *MENU* when done.`,
      nextStep: "order_complete",
      context: {},
    };
  }

  return {
    reply: `❓ Please reply *1* for Payaza or *2* for Bank Transfer.`,
    nextStep: "payment",
    context,
  };
}

// ─── PAYAZA ────────────────────────────────────────────────────────

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

// ─── WHATSAPP ──────────────────────────────────────────────────────

async function sendWhatsAppMessage(to: string, text: string) {
  try {
    await fetch(`https://api.whapi.cloud/messages/text/${WHAPI_CHANNEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHAPI_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: normalizePhone(to),
        body: text,
      }),
    });
  } catch (err) {
    console.error("WhatsApp send error:", err);
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────

function getMainMenu() {
  return (
    `🌾 *Welcome to Farmads.ng* — AI-Powered Agricultural Marketplace\n\n` +
    `What would you like to do?\n\n` +
    `*1* 🛒 Buy Fresh Produce\n` +
    `*2* 🌾 Sell Your Produce\n` +
    `*3* 📦 Track My Orders\n\n` +
    `Reply with a number.`
  );
}

function getCategoryMenu() {
  return (
    `📋 *Browse Produce by Category*\n\n` +
    `*1* 🍫 Cocoa & Oil Palm\n` +
    `*2* 🍌 Plantain\n` +
    `*3* 🍠 Cassava & Garri\n` +
    `*4* 🥔 Yam\n` +
    `*5* 🌶️ Pepper & Spices\n\n` +
    `Reply with a number (1-5) or type *MENU*.`
  );
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
