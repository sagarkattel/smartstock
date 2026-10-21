import { NextResponse } from "next/server";
import { callBackend } from "@/server/backend";
import { clearSessionCookie, getSessionToken, isSameOrigin } from "@/server/session";

/**
 * Forwards the browser's data requests to the FastAPI backend and adds the session token, so the
 * token and the backend address never reach the browser (spec §4). Only the endpoints the screens
 * use are allowed. Large file uploads do not come through here: the browser sends them straight to
 * the one-time upload address the backend hands out (spec §8.12).
 */
const ALLOWED_AREAS = ["meta", "home", "history", "forecast", "app1", "app2a", "app2b", "app3", "models", "admin"];
const ALLOWED_AUTH = { "auth/me": ["GET"], "auth/profile": ["PUT"], "auth/password": ["POST"] };

function fail(status, detail, code) {
  return NextResponse.json({ detail, code }, { status });
}

async function forward(request, { params }, method) {
  const { path } = await params;
  const segments = path.map((s) => decodeURIComponent(s));
  const joined = segments.join("/");

  const cleanSegments = segments.every((s) => s !== "" && s !== "." && s !== ".." && !s.includes("/"));
  const authRule = ALLOWED_AUTH[joined];
  const allowed = authRule
    ? authRule.includes(method)
    : ALLOWED_AREAS.includes(segments[0]) && !(segments[0] === "admin" && segments[1] === "upload") && method !== "PUT";
  if (!cleanSegments || !allowed) return fail(404, "Unknown address.", "not_found");
  if (method !== "GET" && !isSameOrigin(request)) return fail(403, "Request origin not allowed.", "bad_origin");

  const token = getSessionToken(request);
  if (!token) return fail(401, "Please sign in.", "not_authenticated");

  let body;
  if (method !== "GET") {
    body = await request.json().catch(() => undefined);
    if (body === undefined) return fail(400, "Send a JSON body.", "invalid_input");
  }

  const result = await callBackend(`/${segments.map(encodeURIComponent).join("/")}`, {
    method,
    token,
    body,
    search: request.nextUrl.search,
  });

  const response = NextResponse.json(
    result.body ?? { detail: "Unexpected response from the SmartStock service.", code: "bad_backend_response" },
    { status: result.body ? result.status : 502 },
  );
  // The backend says the session is over: drop the cookie so the next page load goes to Login.
  if (result.status === 401) clearSessionCookie(response);
  return response;
}

export const GET = (request, context) => forward(request, context, "GET");
export const POST = (request, context) => forward(request, context, "POST");
export const PUT = (request, context) => forward(request, context, "PUT");
