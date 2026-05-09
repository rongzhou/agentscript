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
  shape?: ShapeObjectExpr;
}

export type Stmt =
  | ConfigStmt
  | UseStmt
  | AssignStmt
  | ExprStmt
  | IfStmt
  | ForInStmt
  | LoopUntilStmt
  | RepeatStmt
  | ReturnStmt;

export interface ConfigStmt extends NodeBase {
  kind: "ConfigStmt";
  key: ConfigKey;
  value: Expr;
}

export interface UseStmt extends NodeBase {
  kind: "UseStmt";
  value: Expr;
  budget?: Budget;
  label?: string;
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
  itemName: string;
  itemRange: SourceRange;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
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
  | ShapeObjectExpr
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

export interface ShapeObjectExpr extends NodeBase {
  kind: "ShapeObjectExpr";
  fields: ShapeField[];
}

export interface ShapeField extends NodeBase {
  kind: "ShapeField";
  name: string;
  type: ShapeTypeExpr;
}

export type ShapeTypeExpr = NamedShapeType | ListShapeType;

export interface NamedShapeType extends NodeBase {
  kind: "NamedShapeType";
  name: "string" | "number" | "boolean" | "json" | "list";
}

export interface ListShapeType extends NodeBase {
  kind: "ListShapeType";
  itemType: ShapeTypeExpr;
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
  operator: "==" | "!=" | "<" | ">" | "+" | "-" | "and" | "or";
  left: Expr;
  right: Expr;
}

export interface GenerateExpr extends NodeBase {
  kind: "GenerateExpr";
  options: GenerateOptionsExpr;
  returnShape?: ShapeObjectExpr;
}

export interface ParallelForExpr extends NodeBase {
  kind: "ParallelForExpr";
  itemName: string;
  itemRange: SourceRange;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
}

export interface GenerateOptionsExpr extends NodeBase {
  kind: "GenerateOptionsExpr";
  properties: ObjectProperty[];
  input?: Expr;
  attempts?: NumberExpr;
  maxOutput?: Budget;
  temperature?: NumberExpr;
  think?: BooleanExpr | StringExpr;
  strict?: BooleanExpr;
  debug?: BooleanExpr;
}

export interface Budget {
  amount: number;
  unit?: string;
}
