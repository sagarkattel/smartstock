import { NextResponse } from "next/server";
import { clearSessionCookie, isSameOrigin } from "@/server/session";

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Request origin not allowed.", code: "bad_origin" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
