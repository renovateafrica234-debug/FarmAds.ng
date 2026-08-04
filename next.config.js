import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Environment Validation ─────────────────────────────────────────
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WHAPI_TOKEN = requireEnv("WHAPI_API_TOKEN");
const WHAPI_CHANNEL = requireEnv("WHAPI_CHANNEL_ID");
const PAYAZA_KEY = requireEnv("PAYAZA_API_KEY");
const APP_URL = requireEnv("NEXT_PUBLIC_APP_URL");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const payazaAuth = `Payaza ${Buffer.from(PAYAZA_KEY).toString("base64")}`;

// ─── Types ───────────────────────────────────────────────────────────
interface Context {
  selectedProduceId?: string;
  selectedFarmerId?: string;
  quantity?: number;
  totalAmount?: number;
  deliveryLocation?: string;
  produceList?: any[];
  selectedProduce?: any;
}

// ─── Constants ──────────────────────────────────────────────────────
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

// ─── Main Handler ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { from, body: messageText } = extractMessage(payload);

    if (!from || !messageText || typeof messageText !== "string") {
      return NextResponse.json({ ok: true });
    }

    const phone = normalizePhone(from);
    const text = messageText.trim();

    // Get or create conversation
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
      reply =
        `💳 *Payment Options*\n\n` +
        `Your order is ready for payment.\n\n` +
        `Reply *1* for Payaza Secure Pay (Card/Transfer/USSD)\n` +
        `Reply *2* for Bank Transfer (manual)\n\n` +
        `Type *MENU* to cancel.`;
      nextStep = "payment";
      nextContext = { ...context, deliveryLocation: text };
    } else if (step === "payment") {
      const result = await handlePayment(text, context, phone);
      reply = result.reply;
      nextStep = result.nextStep;
      nextContext = result.context;
    } else if (step === "register_name") {
      reply = `✅ Thanks ${sanitize(text)}! Please share your farm location (e.g., "Ikom, Cross River").`;
      nextStep = "register_location";
    } else if (step === "register_location") {
      reply = `✅ Location saved. Please share your bank details (Bank Name, Account Number, Account Name) for payouts.`;
      nextStep = "register_bank";
    } else if (step === "register_bank") {
      reply =
        `🎉 *Registration Complete!*\n\n` +
        `Your farm profile is under review. You'll be notified once verified.\n\n` +
        `Type *MENU* to continue.`;
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

// ─── Step Handlers ─────────────────────────────────────────────────
async function handleMenu(text: string, phone: string) {
  if (text === "1") {
    return { reply: getCategoryMenu(), nextStep: "browse_category", context: {} };
  }
  if (text === "2") {
    return {
      reply:
        `🌾 *Sell Your Produce on Farmads*\n\n` +
        `To register as a farmer, please reply with your full name.\n\n` +
        `Or type *MENU* to go back.`,
      nextStep: "register_name",
      context: {},
    };
  }
  if (text === "3") {
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
      reply += `${i + 1}. *${p.name}* (${p.variety})\n`;
      reply += `   💰 ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n`;
      reply += `   📍 ${p.farmers?.location || "Nigeria"} | 👤 ${p.farmers?.full_name || "Farmer"}\n`;
      reply += `   📦 ${p.quantity_available_kg.toLocaleString()}${p.unit} available\n\n`;
    });
    reply += `Reply with the number of the item you want, or type *MENU*.`;

    return {
      reply,
      nextStep: "browse_produce",
      context: { produceList: produce },
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

  if (isNaN(idx) || idx < 0 || idx >= list.length) {
    return {
      reply: `❓ Invalid selection. Please reply with a valid number.`,
      nextStep: "browse_produce",
      context,
    };
  }

  const produce = list[idx];

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
    context: {
      ...context,
      selectedProduce: produce,
      selectedProduceId: produce.id,
      selectedFarmerId: produce.farmer_id,
    },
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

async function handlePayment(text: string, context: Context, phone: string) {
  const produce = context.selectedProduce;
  const qty = context.quantity || 0;
  const total = context.totalAmount || 0;
  const location = context.deliveryLocation || "";

  if (text === "1") {
    const { data: order, error: order
        
