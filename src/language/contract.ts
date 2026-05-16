import type { ContractTypeName } from "../ast/types.js";

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
  switch (value) {
    case "string":
    case "number":
    case "boolean":
    case "json":
    case "list":
      return true;
    default:
      return false;
  }
}

export function contractTypeJsonSchema(name: ContractTypeName): ContractJsonSchema {
  return CONTRACT_TYPE_SPECS[name].jsonSchema;
}
