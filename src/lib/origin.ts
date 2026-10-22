export function requireSameOrigin(request: Request): Response | null {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin) return null;

  let requestOrigin: string;
  let suppliedOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    return Response.json({ error: "Request origin is invalid." }, { status: 403 });
  }
  if (suppliedOrigin !== requestOrigin) {
    return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  return null;
}
