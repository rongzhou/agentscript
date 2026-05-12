import type { ContractObjectExpr, ContractTypeExpr } from "../ast/types.js";
import { contractTypeJsonSchema } from "../language/contract.js";
import type { JsonObject } from "./types.js";

export function contractToSchema(contract: ContractObjectExpr): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];

  for (const field of contract.fields) {
    properties[field.name] = contractTypeToSchema(field.type);
    required.push(field.name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function contractTypeToSchema(type: ContractTypeExpr): JsonObject {
  if (type.kind === "ListContractType") {
    return { type: "array", items: contractTypeToSchema(type.itemType) };
  }
  return contractTypeJsonSchema(type.name);
}
