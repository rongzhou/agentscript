export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface NodeBase {
  kind: string;
  range: SourceRange;
}

export interface Program extends NodeBase {
  kind: "Program";
  imports: ImportDecl[];
  agents: AgentDecl[];
}

export type ImportResourceKind = "tool" | "llm" | "file" | "agent" | "memory";

export interface ImportDecl extends NodeBase {
  kind: "ImportDecl";
  resourceKind: ImportResourceKind;
  name: string;
  uri: string;
}

export interface AgentDecl extends NodeBase {
  kind: "AgentDecl";
  name: string;
  isMain: boolean;
  config: ConfigDecl[];
  uses: UseDecl[];
  functions: FuncDecl[];
}

export type ConfigKey = "model" | "role" | "description";

export interface ConfigDecl extends NodeBase {
  kind: "ConfigDecl";
  key: ConfigKey;
  value: Expr;
}

export interface FuncDecl extends NodeBase {
  kind: "FuncDecl";
  name: string;
  isMain: boolean;
  params: FuncParam[];
  body: Stmt[];
}

export interface FuncParam extends NodeBase {
  kind: "FuncParam";
  name: string;
  contract?: ContractObjectExpr;
}

export type Stmt =
  | ConfigDecl
  | UseDecl
  | AssignStmt
  | ExprStmt
  | IfStmt
  | ForInStmt
  | LoopUntilStmt
  | RepeatStmt
  | ReturnStmt;

export interface UseStmt extends NodeBase {
  kind: "UseStmt";
  value: Expr;
  budget?: Budget;
  label?: string;
}

export type UseDecl = UseStmt | UseOneOfStmt;

export interface UseOneOfStmt extends NodeBase {
  kind: "UseOneOfStmt";
  candidates: UseOneOfCandidate[];
  label: string;
}

export interface UseOneOfCandidate extends NodeBase {
  kind: "UseOneOfCandidate";
  name: string;
  value?: Expr;
  budget?: Budget;
  selected: boolean;
}

export interface AssignStmt extends NodeBase {
  kind: "AssignStmt";
  target: Expr;
  operator: "=" | "+=" | "-=";
  value: Expr;
}

export interface ExprStmt extends NodeBase {
  kind: "ExprStmt";
  expr: Expr;
}

export interface IfStmt extends NodeBase {
  kind: "IfStmt";
  condition: Expr;
  thenBody: Stmt[];
  elseBody?: Stmt[];
}

export interface ForInStmt extends NodeBase {
  kind: "ForInStmt";
  item: ItemBinding;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
}

export interface ItemBinding {
  name: string;
  range: SourceRange;
}

export interface LoopUntilStmt extends NodeBase {
  kind: "LoopUntilStmt";
  condition: Expr;
  maxIterations: number;
  body: Stmt[];
}

export interface RepeatStmt extends NodeBase {
  kind: "RepeatStmt";
  maxAttempts: number;
  body: Stmt[];
}

export interface ReturnStmt extends NodeBase {
  kind: "ReturnStmt";
  value: Expr;
}

export type Expr =
  | IdentifierExpr
  | StringExpr
  | NumberExpr
  | BooleanExpr
  | NullExpr
  | ListExpr
  | ObjectExpr
  | ContractObjectExpr
  | MemberExpr
  | IndexExpr
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | GenerateExpr
  | ParallelForExpr;

export interface IdentifierExpr extends NodeBase {
  kind: "IdentifierExpr";
  name: string;
}

export interface StringExpr extends NodeBase {
  kind: "StringExpr";
  value: string;
}

export interface NumberExpr extends NodeBase {
  kind: "NumberExpr";
  value: number;
  raw: string;
}

export interface BooleanExpr extends NodeBase {
  kind: "BooleanExpr";
  value: boolean;
}

export interface NullExpr extends NodeBase {
  kind: "NullExpr";
}

export interface ListExpr extends NodeBase {
  kind: "ListExpr";
  items: Expr[];
}

export interface ObjectExpr extends NodeBase {
  kind: "ObjectExpr";
  properties: ObjectProperty[];
}

export interface ObjectProperty extends NodeBase {
  kind: "ObjectProperty";
  key: string;
  value: Expr;
}

export interface ContractObjectExpr extends NodeBase {
  kind: "ContractObjectExpr";
  fields: ContractField[];
}

export interface ContractField extends NodeBase {
  kind: "ContractField";
  name: string;
  type: ContractTypeExpr;
}

export type ContractTypeName = "string" | "number" | "boolean" | "json" | "list";

export type ContractTypeExpr = NamedContractType | ListContractType;

export interface NamedContractType extends NodeBase {
  kind: "NamedContractType";
  name: ContractTypeName;
}

export interface ListContractType extends NodeBase {
  kind: "ListContractType";
  itemType: ContractTypeExpr;
}

export interface MemberExpr extends NodeBase {
  kind: "MemberExpr";
  object: Expr;
  property: string;
}

export interface IndexExpr extends NodeBase {
  kind: "IndexExpr";
  object: Expr;
  index: Expr;
}

export interface CallExpr extends NodeBase {
  kind: "CallExpr";
  callee: Expr;
  args: Expr[];
}

export interface UnaryExpr extends NodeBase {
  kind: "UnaryExpr";
  operator: "not";
  value: Expr;
}

export interface BinaryExpr extends NodeBase {
  kind: "BinaryExpr";
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "and" | "or";
  left: Expr;
  right: Expr;
}

export interface GenerateExpr extends NodeBase {
  kind: "GenerateExpr";
  options: GenerateOptionsExpr;
  returnContract?: ContractObjectExpr;
}

export interface ParallelForExpr extends NodeBase {
  kind: "ParallelForExpr";
  item: ItemBinding;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
}

export interface GenerateOptionsExpr extends NodeBase {
  kind: "GenerateOptionsExpr";
  properties: ObjectProperty[];
  maxOutput?: Budget;
  maxOutputRange?: SourceRange;
}

export interface Budget {
  amount: number;
  unit?: string;
}
