import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ── Environment Validation ──────────────────────────────────────────────────
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
const PAYAZA_KEY       = requireEnv("PAYAZA_API_KEY");
const APP_URL          = requireEnv("NEXT_PUBLIC_APP_URL");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ────────────────────────────────────────────────────────────────────
interface Context {
  selectedProduceId?: string;
  selectedFarmerId?: string;
  quantity?: number;
  totalAmount?: number;
  deliveryLocation?: string;
  produceList?: any[];
  selectedProduce?: any;
  farmerName?: string;
  farmerLocation?: string;
}

// ── Categories ───────────────────────────────────────────────────────────────
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

// ═════════════════════════════════════════════════════════════════════════════
// POST  /api/whatsapp/webhook
// ═════════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { from, body: messageText } = extractMessage(payload);

    if (!from || !messageText || typeof messageText !== "string") {
      return NextResponse.json({ ok: true });
    }

    const phone = normalizePhone(from);
    const text  = sanitize(messageText.trim());

    // Get or create conversation
    let { data: conv } = await supabase
      .from("wa_conversations")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!conv) {
      const { data: newConv, error: insertErr } = await supabase
        .from("wa_conversations")
        .insert({ phone, current_step: "menu", context: {} })
        .select()
        .single();

      if (insertErr || !newConv) {
        console.error("Failed to create conversation:", insertErr);
        return NextResponse.json({ ok: true });
      }
      conv = newConv;
    }

    // Touch last_active
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

    // Global reset
    if (lowerText === "menu" || text === "0" || lowerText === "start") {
      reply = getMainMenu();
      nextStep = "menu";
      nextContext = {};
    }
    else if (step === "menu") {
      const r = await handleMenu(text, phone);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    else if (step === "browse_category") {
      const r = await handleBrowseCategory(text, context);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    else if (step === "browse_produce") {
      const r = await handleBrowseProduce(text, context);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    else if (step === "enter_quantity") {
      const r = await handleEnterQuantity(text, context);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    else if (step === "confirm_order") {
      const r = await handleConfirmOrder(text, context);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    else if (step === "enter_delivery_location") {
      reply =
        `💳 *Payment Options*\n\n` +
        `Your order is ready for payment.\n\n` +
        `Reply *1* for Payaza Secure Pay (Card/Transfer/USSD)\n` +
        `Reply *2* for Bank Transfer (manual)\n\n` +
        `Type *MENU* to cancel.`;
      nextStep = "payment";
      nextContext = { ...context, deliveryLocation: sanitize(text) };
    }
    else if (step === "payment") {
      const r = await handlePayment(text, context, phone);
      reply = r.reply; nextStep = r.nextStep; nextContext = r.context;
    }
    // FIX: Added missing order_complete handler
    else if (step === "order_complete") {
      reply = `✅ Your order is complete! Type *MENU* to place another order.`;
      nextStep = "menu";
      nextContext = {};
    }
    else if (step === "register_name") {
      reply = `✅ Thanks ${sanitize(text)}! Please share your farm location (e.g., "Ikom, Cross River").`;
      nextStep = "register_location";
      nextContext = { ...context, farmerName: sanitize(text) };
    }
    else if (step === "register_location") {
      reply = `✅ Location saved. Please share your bank details (Bank Name, Account Number, Account Name) for payouts.`;
      nextStep = "register_bank";
      nextContext = { ...context, farmerLocation: sanitize(text) };
    }
    else if (step === "register_bank") {
      reply =
        `🎉 *Registration Complete!*\n\n` +
        `Your farm profile is under review. You'll be notified once verified.\n\n` +
        `Type *MENU* to continue.`;
      nextStep = "menu";
      nextContext = {};
    }
    else {
      reply = getMainMenu();
      nextStep = "menu";
      nextContext = {};
    }

    // Persist state
    const { error: updErr } = await supabase
      .from("wa_conversations")
      .update({ current_step: nextStep, context: nextContext })
      .eq("phone", phone);

    if (updErr) console.error("Failed to update conversation:", updErr);

    await sendWhatsAppMessage(phone, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}

// Health check for Whapi "Check webhook"
export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}

// ── Step Handlers ────────────────────────────────────────────────────────────

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
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*, produce(name), farmers(full_name)")
      .eq("buyer_phone", phone)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      console.error("Failed to fetch orders:", error);
      return {
        reply: `❌ Could not fetch your orders. Try again later.\n\nType *MENU* to return.`,
        nextStep: "menu",
        context: {},
      };
    }
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
    const { data: produce, error } = await supabase
      .from("produce")
      .select("id, name, variety, price_per_kg, quantity_available_kg, unit, min_order_kg, farmer_id, farmers(full_name, location, phone)")
      .eq("is_available", true)
      .in("name", CATEGORIES[text])
      .order("price_per_kg", { ascending: true });

    if (error) {
      console.error("Failed to fetch produce:", error);
      return {
        reply: `❌ Could not load produce. Try again.\n\n` + getCategoryMenu(),
        nextStep: "browse_category",
        context: {},
      };
    }
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
    return { reply, nextStep: "browse_produce", context: { produceList: produce } };
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
      reply: `❓ Invalid selection. Reply with a number from 1-${list.length}.`,
      nextStep: "browse_produce",
      context,
    };
  }

  const p = list[idx];
  const reply =
    `🌾 *${p.name}*\n\n` +
    `Variety: ${p.variety}\n` +
    `Price: ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n` +
    `Available: ${p.quantity_available_kg.toLocaleString()}${p.unit}\n` +
    `Min Order: ${(p.min_order_kg || 1).toLocaleString()}${p.unit}\n` +
    `Farmer: ${p.farmers?.full_name} (${p.farmers?.location})\n\n` +
    `Reply with the quantity in ${p.unit} you want, or type *MENU*.`;

  return {
    reply,
    nextStep: "enter_quantity",
    context: {
      ...context,
      selectedProduce: p,
      selectedProduceId: p.id,
      selectedFarmerId: p.farmer_id,
    },
  };
}

async function handleEnterQuantity(text: string, context: Context) {
  const qty = parseFloat(text);
  const p = context.selectedProduce;

  if (isNaN(qty) || qty <= 0) {
    return {
      reply: `❓ Please enter a valid number for quantity.`,
      nextStep: "enter_quantity",
      context,
    };
  }

  const minOrder = p.min_order_kg || 1;
  if (qty < minOrder) {
    return {
      reply: `⚠️ Minimum order is ${minOrder}${p.unit}. Please enter at least ${minOrder}.`,
      nextStep: "enter_quantity",
      context,
    };
  }

  if (qty > p.quantity_available_kg) {
    return {
      reply: `⚠️ Only ${p.quantity_available_kg}${p.unit} available. Please enter a lower quantity.`,
      nextStep: "enter_quantity",
      context,
    };
  }

  const total = qty * p.price_per_kg;
  return {
    reply:
      `🛒 *Order Summary*\n\n` +
      `Item: ${p.name}\n` +
      `Quantity: ${qty}${p.unit}\n` +
      `Unit Price: ₦${p.price_per_kg.toLocaleString()}/${p.unit}\n` +
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
  const qty   = context.quantity || 0;
  const total = context.totalAmount || 0;
  const location = context.deliveryLocation || "";

  if (text === "1") {
    const { data: order, error: orderErr } = await supabase
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

    if (orderErr || !order) {
      console.error("Order creation failed:", orderErr);
      return {
        reply: `❌ Could not create order. Please try again later.`,
        nextStep: "menu",
        context: {},
      };
    }

    const reference = `FMD-${order.id.slice(0, 11)}`;
    const payazaLink = createPayazaPaymentLink({
      amount: total,
      reference,
      customerEmail: `${phone}@farmads.ng`,
      customerName: phone,
      description: `${produce.name} x ${qty}${produce.unit} from Farmads`,
    });

    const { error: linkErr } = await supabase
      .from("orders")
      .update({ payaza_reference: reference, payaza_payment_link: payazaLink })
      .eq("id", order.id);

    if (linkErr) console.error("Failed to save Payaza link:", linkErr);

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
        `Bank: First Bank of Nigeria\n` +
        `Account: Farmads Nigeria Ltd\n` +
        `Account No: 1234567890\n` +
        `Amount: ₦${total.toLocaleString()}\n\n` +
        `Please transfer and reply with your transaction reference. We'll verify and confirm.\n\n` +
        `Type *MENU* when done.`,
      nextStep: "order_complete",
      context: {},
    };
  }

  return {
    reply: `❓ Please reply *1* for Payaza or *2* for Bank Transfer.\n\nType *MENU* to cancel.`,
    nextStep: "payment",
    context,
  };
}

// ── Helper Functions ─────────────────────────────────────────────────────────

function extractMessage(payload: any): { from: string; body: string } {
  if (payload.messages && Array.isArray(payload.messages) && payload.messages.length > 0) {
    const msg = payload.messages[0];
    return {
      from: msg.from || msg.chat_id || "",
      body: msg.text?.body || msg.body || "",
    };
  }
  if (payload.from && payload.body) return { from: payload.from, body: payload.body };
  if (payload.message) {
    return {
      from: payload.message.from || "",
      body: payload.message.body || payload.message.text || "",
    };
  }
  return { from: "", body: "" };
}

function normalizePhone(phone: string): string {
  return phone.replace(/@.*/, "").replace(/\D/g, "");
}

function sanitize(text: string): string {
  return text
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

function getMainMenu(): string {
  return (
    `🌾 *Welcome to Farmads!*\n\n` +
    `Your bridge from Nigerian farms to global markets.\n\n` +
    `Reply with a number:\n` +
    `*1* — Browse Produce 🛒\n` +
    `*2* — Sell as a Farmer 👨‍🌾\n` +
    `*3* — My Orders 📦\n\n` +
    `Type *MENU* anytime to return here.`
  );
}

function getCategoryMenu(): string {
  return (
    `📂 *Browse Categories*\n\n` +
    `Reply with a number:\n` +
    `*1* — 🍫 Cocoa & Oil Palm\n` +
    `*2* — 🍌 Plantain\n` +
    `*3* — 🍠 Cassava & Garri\n` +
    `*4* — 🥔 Yam\n` +
    `*5* — 🌶️ Pepper & Spices\n\n` +
    `Type *MENU* to go back.`
  );
}

function createPayazaPaymentLink(params: {
  amount: number;
  reference: string;
  customerEmail: string;
  customerName: string;
  description: string;
}): string {
  const baseUrl = "https://payment.payaza.africa/";
  const query = new URLSearchParams({
    merchant_key: PAYAZA_KEY,
    connection_mode: "live",
    checkout_amount: params.amount.toString(),
    currency_code: "NGN",
    email_address: params.customerEmail,
    first_name: (params.customerName || "Buyer").slice(0, 15),
    last_name: "Farmads",
    phone_number: params.customerName.replace(/\D/g, "").slice(-11) || "00000000000",
    transaction_reference: params.reference,
    redirect_url: `${APP_URL}/payment/success?ref=${encodeURIComponent(params.reference)}`,
  });
  const additionalDetails = JSON.stringify({ description: params.description });
  query.set("additional_details", additionalDetails);
  return `${baseUrl}?${query.toString()}`;
}

async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  try {
    const phone = normalizePhone(to);
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
  
