import { parseGatewayConfig } from "../../src/config/load.js";

export function gatewayConfig(raw: Record<string, unknown>) {
  return parseGatewayConfig(raw);
}
