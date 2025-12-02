import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ message: "API is working", timestamp: new Date().toISOString() });
}

