import { SQLITE_SCHEME, schemePrefix } from "./schemes.js";

export function uriScheme(uri: string): string {
  try {
    const parsed = new URL(uri);
    return parsed.protocol.endsWith(":") ? parsed.protocol.slice(0, -1) : parsed.protocol;
  } catch {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri);
    return match?.[1] ?? "";
  }
}

export interface SqliteUriParts {
  rawPath: string;
  rawNamespace: string;
}

export function splitSqliteUri(uri: string): SqliteUriParts {
  const raw = uri.slice(schemePrefix(SQLITE_SCHEME).length);
  const hashIndex = raw.indexOf("#");
  return {
    rawPath: hashIndex >= 0 ? raw.slice(0, hashIndex) : raw,
    rawNamespace: hashIndex >= 0 ? raw.slice(hashIndex + 1) : "",
  };
}
