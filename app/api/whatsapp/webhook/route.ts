import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("Incoming WhatsApp message:", JSON.stringify(body, null, 2));
  
  // TODO: Add your bot logic here
  return NextResponse.json({ ok: true });
}

// Whapi verification on setup
export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "ok" });
}

