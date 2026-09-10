import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { gatewayConfigSchema, type GatewayConfig } from "./schema.js";

export function parseGatewayConfig(raw: unknown): GatewayConfig {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid gateway config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function loadGatewayConfig(path: string): Promise<GatewayConfig> {
  const text = await readFile(path, "utf8");
  const raw: unknown = extname(path) === ".json" ? JSON.parse(text) : parseYaml(text);
  return parseGatewayConfig(raw);
}
