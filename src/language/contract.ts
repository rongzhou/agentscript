import type { ContractTypeName } from "../ast/types.js";

const CONTRACT_TYPE_KEYS = new Set<ContractTypeName>(["string", "number", "boolean", "json", "list"]);

type ContractJsonSchema = Record<string, string>;

interface ContractTypeSpec {
  jsonSchema: ContractJsonSchema;
}

const CONTRACT_TYPE_SPECS: Record<ContractTypeName, ContractTypeSpec> = {
  string: {
    jsonSchema: { type: "string" },
  },
  number: {
    jsonSchema: { type: "number" },
  },
  boolean: {
    jsonSchema: { type: "boolean" },
  },
  json: {
    jsonSchema: {},
  },
  list: {
    jsonSchema: { type: "array" },
  },
};

export function isContractTypeName(value: string): value is ContractTypeName {
  return CONTRACT_TYPE_KEYS.has(value as ContractTypeName);
}

export function contractTypeJsonSchema(name: ContractTypeName): ContractJsonSchema {
  return CONTRACT_TYPE_SPECS[name].jsonSchema;
}
