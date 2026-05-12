# `use one of ...`

本文档定义 AgentScript 中 `use one of` 如何在一个 context 位置声明若干候选 source，让 context 选择本身成为可学习、可优化的变量。

Context 选择的基础模型见 [`use ... as ...`](./use-as.md)。整体设计总纲见 [Context Engineering](./context-engineering.md)。

## 目的

`use one of` 不是另一套 prompt 机制。它是对 `use` 的聚焦扩展：允许一条 `use` 声明**多个可选的 source**，并通过命名变体（variant）让作者和优化器共享一份关于"如何选择"的契约。

```text
use one of {
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k selected
} as "evidence"
```

含义是：

```text
这个 context 位置是一个可学习的选择点。
候选之间是平行关系，任何时候只选一个作为 "evidence" context。
尾缀 selected 标记默认被选中的候选；未标时取第一个。
```

它解决一个具体问题：**agent 的质量主要取决于上下文组织，而不是提示词措辞**。把"上下文选择"提成一等可学习变量，让优化器在一个结构化、可枚举、跨模型稳定的搜索空间里工作，而不是去优化脆弱的提示词片段。

## 推荐语法

```text
use one of {
    name1: expr1
    name2: expr2 max budget2
    name3: expr3 max budget3 selected
    name4: empty
} as label
```

每个变体的语法形式固定：

```text
identifier ":" (use-expression | "empty") [ "selected" ]
```

其中 use-expression 就是普通 `use` 里 `as label` 之前的部分（`expr` 或 `expr max budget`）。变体之间用换行分隔，与 contract block 约定一致。

尾缀 `selected` 是可选的单词修饰符，紧跟在候选值之后，用于显式标记默认选中的候选。一个 `use one of` 中最多只能有一个候选带 `selected`。

完整示例：

```text
main agent Researcher {
    model Qwen
    role "Senior Researcher"
    description "Answer with selected evidence."

    main func(input { question: string }) {
        lessons = Lessons.query({ kind: "how-to" })
        docs = Search.search(input.question)

        use input.question as "user question"

        use one of {
            none:        empty
            lesson_only: lessons max 2k
            doc_only:    docs.summary max 4k
            combined:    [lessons, docs.top3] max 4k selected
        } as "evidence"

        generate({ input: "Answer from evidence" }) -> {
            ok: boolean
            answer
        }
    }
}
```

本例显式声明：evidence 这段 context 有四种可能——不加、只加 lessons、只加 search docs、两者合并。作者把 `combined` 标记为 `selected`，表示"没有额外信号时默认用 combined"。优化器未来可以把 `selected` 移动到其它候选，或者插入新的候选并重新标记。

## 与普通 `use` 的关系

`use one of` 的**语义仍是 `use`**。它只是在声明侧让一个 context slot 绑定多个候选，运行时由显式 variant 选择或默认策略选择一个候选，最终等价于一条普通 `use`——或者在候选是 `empty` 时，等价于"在此位置不声明任何 use"。

因此一切 `use` 的基本语义仍然成立：

- `as label` 仍然是 context section 标签，不是表达式。
- 求值仍然延迟到可见 `generate` 构造 prompt 时。
- scope 规则不变——`use one of` 出现在哪一层（agent / function / block），可见范围就在哪一层。
- 被选中的候选仍然要遵守"不能 use runtime capability"的规则（tool / llm / agent / memory / function binding 不能作为候选表达式的根引用）。

这条规则的另一个方向也成立：**所有 `use` 也可以被视为 `use one of` 的单候选特例**。这只是心智模型，语言不强制改写。

## 候选的约束

候选位于同一个 `use one of { ... }` 之内，**必须满足下列约束**：

### label 共享

label 写在 `}` 之后，由所有候选共享：

```text
use one of {
    compact: scratch.digest max 500
    verbose: scratch.summary max 4k
} as "evidence"
```

候选内部**不能**再写 `as ...`：

```text
// 非法
use one of {
    compact: scratch.digest max 500 as "short-evidence"    // NO
    verbose: scratch.summary max 4k as "long-evidence"     // NO
} as "evidence"
```

理由：`use one of` 强化"一个 context slot，多个 source"的心智模型。label 命名语义一致，变体只改"取什么"，不改"这段 context 对 generate 的角色"。

### budget 各自带

每个候选可以独立声明 `max budget`：

```text
use one of {
    compact: scratch.digest max 500
    verbose: scratch.summary max 4k
} as "evidence"
```

budget 是候选的一部分——不同候选往往对应不同的数据体积偏好。未写 budget 的候选按"不限制"处理，与普通 `use` 一致。

### `empty` 变体

候选槽位可以写成保留字 `empty`，表示**该变体被选中时，此位置不声明任何 context**：

```text
use one of {
    none: empty
    verbose: scratch.summary max 4k
} as "evidence"
```

语义：

- 若运行时选中 `none` 变体，则该 `use one of` 对可见的 `generate` 来说**相当于没有出现**——不会向 prompt 注入 "evidence" section，也不会产生 context item。
- 若选中 `verbose` 变体，行为与 `use scratch.summary max 4k as "evidence"` 完全相同。

`empty` 只能出现在 `use one of { ... }` 的候选值槽位；不能出现在其它表达式位置，也不能与 `max budget` 或 `as label` 组合。`empty` 可以带 `selected` 修饰：`none: empty selected` 表示作者希望默认不加这条 context。

### `selected` 标记

候选可以在末尾加关键字 `selected`，标记该候选为默认选中：

```text
use one of {
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k selected
    grounded: scratch.summary max 2k
} as "evidence"
```

规则：

- 一个 `use one of` 里**最多只能有一个**候选带 `selected`。写了两个 `selected` 应被视为语义错误。
- `selected` 是候选值的尾缀修饰符，跟在 `expr` / `expr max budget` / `empty` 之后。
- 未标注任何 `selected` 时，默认选中**第一个候选**。见"变体选择"一节。
- 标注 `selected` 的候选可以是 `empty`：`none: empty selected` 合法。
- `selected` 只影响默认选择；trial 模式下 runtime hint 可以覆盖它。

`selected` 存在的意义：

- **作者意图显式**：让 agent 作者可以显式标出 default，而不依赖源码里的书写顺序。
- **优化器友好**：优化产物只需要把 `selected` 从一个候选移到另一个候选。diff 是一个 token。
- **可视可读**：看到 `selected` 就知道"当前生效的是哪个"，不用心算"第几个"。

### `none` 是变体名的约定

变体名（`:` 左侧）是标识符，用户可以任意命名。推荐社区约定：

- **`none`** 作为 `empty` 变体的命名（visual 上与 AgentScript 的 `none` null literal 对应，一眼可读）。
- 也可以用 `skip` / `off` / `omit` 等；语言不强制。

```text
// 推荐
use one of {
    none: empty
    long: scratch.summary max 4k
} as "evidence"

// 合法但不推荐
use one of {
    skip: empty
    long: scratch.summary max 4k
} as "evidence"
```

变体名是**该 `use one of` 本地**的标识符，不会进入作用域，不会遮蔽外层变量，也不能在其它表达式里被引用。同一 agent 中多个 `use one of` 可以使用相同的变体名。

### 类型不要求相同

候选表达式的类型**不要求一致**。一个候选可以返回 string，另一个可以返回 list，第三个可以返回 object，还可以有 `empty`。所有非 empty 候选最终都走 `use` 的统一 sanitize 和 render 流程，以 JSON-safe 表示渲染进 prompt。

### 候选数量

候选数量必须 ≥ 2。`empty` 也算一个候选；因此 `{ none: empty, long: X }` 是合法的最小 `use one of`。

```text
// 非法：只有一个候选
use one of {
    only: scratch.summary max 4k
} as "evidence"
```

没有选择空间的 `use one of` 没有存在必要，parser 和 runtime 都应把它视为错误，引导用户改写为 `use X as L`。

## 变体选择

一次 `generate` 构造 prompt 之前，每个可见的 `use one of` 必须能被解析到一个**单一候选**。决定候选的优先级（从高到低）：

1. **运行时选择 hint**：`ExecuteOptions.variant` 传入了 per-site 的变体名映射（用于优化器 agent 进行 trial）。
2. **源码中的 `selected`**：候选列表里某个候选带了 `selected` 修饰。
3. **第一个候选**：如果既没有 runtime hint 也没有 `selected`，选择源码中出现的第一个候选。

优先级顺序的关键在于：runtime hint 必须能**压过** `selected`。原因是优化器做 trial 时，它要在搜索空间里枚举各个变体——如果 `selected` 不能被覆盖，trial 就只能跑当前选中的那一个，搜索无效。

这三条规则共同保证：

- 未优化版本的 `.as` 文件运行时行为完全确定（`selected` 存在 → 取 `selected`；否则 → 取第一个）。
- 优化器不需要侵入 runtime，只需在 trial 时传入 variant map，最终通过 source-to-source 变换把 `selected` 写到"胜出"的候选上。
- 审计 trace 永远知道实际选择了哪个候选、选择来源是什么。

写作惯例：

- 希望默认"不加这段 context"：`none: empty selected` 或把 `none: empty` 放在第一位。
- 希望默认"加上某个保守版本"：给该候选加 `selected`，或放在第一位。
- `selected` 优于位置约定，因为它明确标出作者意图，且不受 reorder 影响。

## 具体化

优化器的产物是一个**具体化的 `.as` 文件**。具体化有两种等价形态：

### 保留结构的具体化（推荐）

优化器保留完整的 `use one of` 结构，只把 `selected` 标记移到胜出的候选上：

```text
// 优化前
use one of {
    none:     empty
    compact:  scratch.digest max 500 selected
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k
} as "evidence"

// 优化后：selected 移动到 grounded
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k selected
} as "evidence"
```

diff 是 `selected` 的一次移动加一段可选注释：

```text
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    // picked 2026-05-11 against fixtures/evidence-eval.json (F1 0.82, baseline 0.71)
    grounded: scratch.summary max 2k selected
} as "evidence"
```

这种形态明示"该位置仍是选择点"，保留全部候选，可被**再次优化**（新候选可以注入、trial 后重新移动 `selected`）。推荐作为默认优化产物。

### 扁平化的具体化

优化器把 `use one of` 崩塌成普通 `use`：

```text
// 扁平化
use scratch.summary max 2k as "evidence"  // optimizer: grounded variant (F1 0.82)
```

如果优化器选中的是 `empty` 变体，扁平化产物就是**完全移除这条 `use`**：

```text
// 优化前
use one of {
    none: empty selected
    long: scratch.summary max 4k
} as "evidence"

// 扁平化（optimizer kept none）
// 此处 use 被移除。
```

这种形态读起来像普通手写 AgentScript，适合作为生产版本的最终形态，但会丢失"这里曾是选择点"的信号，不能被再次优化。

两种形态都是合法的 `.as` 源代码。优化器工具链可以二选一生成，默认应选保留结构。语言本身只要求语法合法。

## Scope 可见性

`use one of` 的 scope 规则与 `use` 完全一致：

- **Agent-level**：写在 agent body 顶部（和 `model` / `role` 并列），对该 agent 所有 function 可见。
- **Function-level**：写在 function body 中，对本函数及其 block 子作用域可见。
- **Block-level**：写在 `if` / `for` / `loop` / `repeat` / `parallel for` body 中，局部可见。

Agent-level `use one of` 的约束也和 agent-level `use` 相同——只能引用 agent 顶层可解析的名字（通常是 `import file`），不能依赖 function 参数或局部变量，不能包含 call expression。下例合法：

```text
import file ShortPlaybook from "./playbook.short.md"
import file LongPlaybook  from "./playbook.long.md"

main agent Researcher {
    model Fast
    role "Researcher"
    description "Answer with playbook discipline."

    use one of {
        none:  empty
        short: ShortPlaybook selected
        long:  LongPlaybook max 4k
    } as "playbook"

    main func(input) {
        generate({ input: input.question }) -> { text }
    }
}
```

Agent-level `use one of` 是**声明式**的 context 选择点，和 agent `role` 一样属于 agent 身份的一部分。不同特化版本的 Researcher 等价于不同"人格"——同一个问题，短 playbook 和长 playbook 给出的风格不同，甚至可以完全不带 playbook。

## 不能作为候选的表达式

runtime capability 仍然不能出现在任何候选的根引用中：

```text
// 非法：tool / memory / llm / agent / function binding 不是 prompt context
use one of {
    cached: lessons max 2k
    live:   Search.search(input.question)   // Search 是 tool binding，Search.search(...) 是 call
} as "evidence"
```

理由和普通 `use` 相同：

- 候选可以引用 *data*，但不能把 capability 本身或 capability 的 call 直接写成候选。
- 需要动态数据时，沿用"call then use"模式：先把调用结果存进局部变量，再让变量成为候选。

```text
// 合法写法
live_docs = Search.search(input.question)

use one of {
    none:   empty
    cached: lessons max 2k
    live:   live_docs max 4k selected
} as "evidence"
```

## Prompt 渲染

被选中的非 empty 候选渲染方式与普通 `use` 完全一致：

```text
Context:
[evidence]
source: scratch.summary
[
  { "fact": "..." }
]
```

被选中的 `empty` 变体**不渲染任何 section**——等同于该 `use one of` 在源码中不存在。`source` 使用被选中候选的表达式文本。prompt 中**不暴露**变体名、候选数量、是否存在其它候选、哪个候选带了 `selected`。这保证：

- 模型看到的 prompt 永远是"一个 context slot 一个 source"的结构，不受优化过程影响。
- 同一个 agent 在优化前后，prompt 的结构不变，只是选择的 source 不同（或完全缺席）。
- 跨模型迁移时不会因为 prompt 结构不同而失稳。

## Trace 要求

`use one of` 的 trace event 在普通 `use` 事件上扩展 variant 选择信息。

非 empty 变体被选中：

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "label": "evidence",
    "budget": { "amount": 2, "unit": "k" },
    "variant": {
      "picked": "grounded",
      "available": ["none", "compact", "verbose", "grounded"],
      "reason": "selected",
      "empty": false
    }
  }
}
```

`empty` 变体被选中：

```json
{
  "kind": "use",
  "data": {
    "source": null,
    "label": "evidence",
    "budget": null,
    "variant": {
      "picked": "none",
      "available": ["none", "compact", "verbose", "grounded"],
      "reason": "first",
      "empty": true
    }
  }
}
```

`variant.reason` 描述选择来源：

- `"trial"` — 由 `ExecuteOptions.variant` 传入。
- `"selected"` — 源码中某候选带了 `selected` 修饰。
- `"first"` — 既无 trial hint 也无 `selected`，取第一个候选。
- `"specialized"` — 源程序已经是单候选（扁平化形态后的退化情况，仅当 `use one of` 只剩一个候选时发生；推荐的保留结构 specialization 不产生这种情况）。

`generate` 事件的 built context item 不新增字段——它仍然只记录"实际进入 prompt 的 source 和值"。被 empty 变体命中的 `use one of` 根本不会产生 context item。变体信息在 `use` event 上完整可审计，足以让外部工具重建"这个 generate 用的哪个变体组合"，包括哪些 slot 被显式跳过。

## 优化器契约

优化器不进入语言核心。它是用户空间的 agent 或脚本，通过两个契约与 `use one of` 交互：

1. **读**：解析 `.as` 源程序，枚举所有 `use one of` 位点及其候选名（包括 `empty` 候选），作为搜索空间。可选地读取每个位点当前的 `selected` 候选作为 baseline。
2. **写**：对每种候选组合运行程序（trial）、评估，最终生成一份 specialized `.as`——推荐保留结构并把 `selected` 移到胜出候选。

运行时不直接参与优化，只提供两项最小支持：

- `ExecuteOptions.variant`：一次执行可以传入 `{ site_id: variant_name }` 映射，让某个 `use one of` 的候选选择可在 trial 期切换。该映射**压过源码里的 `selected`**。`site_id` 的具体格式由实现决定（通常是源文件路径 + 函数名 + 位置）。
- `use` trace event 的 `variant` 字段：让优化器能回溯每次 trial 实际用了哪个候选、是否 empty、选择来源是什么。

这两项保证"优化"可以是 source-to-source 的纯函数：输入是 `.as` + 评估信号，输出是新的 `.as`（候选集合不变，`selected` 的位置变了）。运行时永远只执行具体程序，不感知优化过程。

评估信号（fixtures、memory、LLM-as-judge 等）完全由优化器 agent 自行组织，不是语言特性。

## 设计检查清单

修改或使用 `use one of` 前，应检查：

- 候选是否至少有 2 个？`empty` 算一个候选，但单候选（含只写 `empty` 的情况）仍然非法。
- 候选是否共享 label？label 是否只写在 `}` 之后，而不是候选内部？
- `empty` 是否只出现在候选值槽位，而不是其它表达式位置？
- `selected` 是否最多出现一次？是否紧跟在候选值之后？
- 未提供 `selected` 时，是否能确定性地选到第一个候选？第一个候选是否反映了作者希望的 default？
- runtime hint（trial）是否能压过 `selected`？
- 候选表达式是否仍然不引用 runtime capability 作为根？
- `use one of` 的 scope 规则是否仍与普通 `use` 一致？
- trace 是否记录了 variant 选择、候选列表、empty 标记和选择来源 reason？
- specialized 后的源程序是否仍是合法的 AgentScript 源代码？empty 变体被选中时，扁平化产物是否完全移除了该 `use`？
- 模型看到的 prompt 结构是否不因优化过程变化？

## 设计意图

`use` 把 prompt context 的"选择"提成了一等语言概念。`use one of` 在同一原语上再加一层：**选择本身也是可以被学习的变量**。

- 没有为优化引入新的原语：语言核心仍然是 `use` 和 `generate`。
- 没有为"加不加一段 context"引入新的语法修饰符；加不加由普通 `empty` 变体表达，统一到同一机制。
- 优化产物的 diff 是一个 `selected` 标记的移动——最小、最可读、最可审计。
- 优化空间是**结构化、可枚举、跨模型稳定**的——选择 A 还是 B（或 none），比优化"这段指令应该怎么措辞"稳得多。
- 未优化版本是完全确定的可运行程序——`selected` 或第一个候选就是 agent 作者的 default choice。
- 优化产物也是 AgentScript 源码——审计、diff、版本控制、再次优化都沿用现有工具。
- 优化器不是 framework 的一部分，而是用户空间的 agent——使用 AgentScript 自己的 `use` / `generate` / `memory` / `parallel for` 组合就能实现。

这条路对应的定位是：

```text
Agent context as code, and learnable context selection as code.
Learning does not hide in runtime. Learning produces code.
```
