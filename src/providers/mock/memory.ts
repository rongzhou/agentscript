import type { MemoryAddRequest, MemoryProvider, MemoryQueryRequest, RuntimeValue } from "../../runtime/types.js";

export class MockMemoryProvider implements MemoryProvider {
  private readonly records: RuntimeValue[] = [];

  async add(request: MemoryAddRequest): Promise<RuntimeValue> {
    const record = {
      id: String(this.records.length + 1),
      created_at: "mock",
      updated_at: "mock",
      record: request.record,
    };
    this.records.push(record);
    return record;
  }

  async query(_request: MemoryQueryRequest): Promise<RuntimeValue> {
    return [...this.records].reverse();
  }
}
