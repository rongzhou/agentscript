export function uriScheme(uri: string): string {
  try {
    const parsed = new URL(uri);
    return parsed.protocol.endsWith(":") ? parsed.protocol.slice(0, -1) : parsed.protocol;
  } catch {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri);
    return match?.[1] ?? "";
  }
}
