export interface Disposable {
  close(): Promise<void>;
}

export function isDisposable<T>(value: T): value is T & Disposable {
  return typeof value === "object" && value !== null && "close" in value && typeof value.close === "function";
}
