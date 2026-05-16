import type { ConfigKey } from "../ast/types.js";

export const MODEL_CONFIG_KEY = "model";
const ROLE_CONFIG_KEY = "role";
const DESCRIPTION_CONFIG_KEY = "description";

const STRING_CONFIG_KEYS = new Set<ConfigKey>([ROLE_CONFIG_KEY, DESCRIPTION_CONFIG_KEY]);
export const REQUIRED_GENERATE_CONFIG_KEYS: readonly ConfigKey[] = [
  MODEL_CONFIG_KEY,
  ROLE_CONFIG_KEY,
  DESCRIPTION_CONFIG_KEY,
];

export function isConfigKey(value: string): value is ConfigKey {
  return value === MODEL_CONFIG_KEY || value === ROLE_CONFIG_KEY || value === DESCRIPTION_CONFIG_KEY;
}

export function isStringConfigKey(value: ConfigKey): boolean {
  return STRING_CONFIG_KEYS.has(value);
}
