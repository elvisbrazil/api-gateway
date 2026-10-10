import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function stripHopByHop(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const listed = new Set(
    (headers.connection ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && !listed.has(name)) result[name] = value;
  }
  return result;
}

export function upstreamRequestHeaders(
  request: FastifyRequest,
  headers: IncomingHttpHeaders,
): IncomingHttpHeaders {
  const result = stripHopByHop(headers);
  delete result["x-user-id"];
  delete result["x-user-scopes"];
  if (request.user) {
    result["x-user-id"] = request.user.id;
    result["x-user-scopes"] = request.user.scopes.join(" ");
  }

  const forwardedFor = headers["x-forwarded-for"];
  result["x-forwarded-for"] = forwardedFor ? `${String(forwardedFor)}, ${request.ip}` : request.ip;
  result["x-forwarded-proto"] = request.protocol;
  result["x-forwarded-host"] = request.headers.host ?? request.hostname;
  result["x-request-id"] = request.id;
  return result;
}

export function downstreamResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = stripHopByHop(headers);
  delete result["x-request-id"];
  return result;
}
