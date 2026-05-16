import type { NamedContractType, ContractObjectExpr, ContractTypeExpr } from "../ast/types.js";
import { isContractTypeName } from "../language/contract.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function collectContractDiagnostics(contract: ContractObjectExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const fields = new Set<string>();

  for (const field of contract.fields) {
    if (fields.has(field.name)) {
      diagnostics.push(error("DUPLICATE_CONTRACT_FIELD", `Duplicate contract field '${field.name}'`, field.range));
    }
    fields.add(field.name);
    diagnostics.push(...collectContractTypeDiagnostics(field.type));
  }

  return diagnostics;
}

function collectContractTypeDiagnostics(type: ContractTypeExpr): SemanticDiagnostic[] {
  if (type.kind === "ListContractType") {
    return collectContractTypeDiagnostics(type.itemType);
  }
  return collectNamedContractTypeDiagnostics(type);
}

function collectNamedContractTypeDiagnostics(type: NamedContractType): SemanticDiagnostic[] {
  if (!isContractTypeName(type.name)) {
    return [error("UNKNOWN_CONTRACT_TYPE", `Unsupported contract type '${type.name}'`, type.range)];
  }
  return [];
}
