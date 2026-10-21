import { NextResponse } from "next/server";
import { callBackend } from "@/server/backend";
import { isSameOrigin, setSessionCookie } from "@/server/session";

function fail(status, detail, code) {
  return NextResponse.json({ detail, code }, { status });
}

// Signs in against the backend (POST /auth/login) and keeps its token in an httpOnly cookie.
export async function POST(request) {
  if (!isSameOrigin(request)) return fail(403, "Request origin not allowed.", "bad_origin");

  const input = await request.json().catch(() => null);
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!username || !password || username.length > 100 || password.length > 200) {
    return fail(400, "Enter your username and password.", "invalid_input");
  }

  const { status, body } = await callBackend("/auth/login", { method: "POST", body: { username, password } });

  if (status !== 200 || typeof body?.token !== "string") {
    // Pass the backend's own message through (wrong password, too many attempts, service down).
    const detail = typeof body?.detail === "string" ? body.detail : "Sign-in failed. Try again.";
    return fail(status >= 400 ? status : 502, detail, body?.code ?? "sign_in_failed");
  }

  const response = NextResponse.json({ name: body.name });
  const secondsLeft = typeof body.expires_at === "number" ? Math.floor(body.expires_at - Date.now() / 1000) : 0;
  setSessionCookie(response, body.token, secondsLeft);
  return response;
}
