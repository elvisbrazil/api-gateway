import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && VALID_ID.test(incoming) ? incoming : randomUUID();
}
