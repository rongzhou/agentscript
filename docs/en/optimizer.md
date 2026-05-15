# Optimizer Toolchain

AgentScript can run an optimizer program against a target program:

```bash
agentscript optimizer.as target.as --mock --trace-level none
```

In optimizer mode, the second positional argument becomes `input.target`.
Additional `--key value` and `--key=value` flags become optimizer input fields
with `-` converted to `_`. Runtime limits such as `--max-trials`,
`--max-llm-calls`, `--max-seconds`, `--run-dir`, and trace flags are reserved
for the runner and are not passed into input.

Import the built-in toolchain with:

```agentscript
import tool Optimizer from "host://optimizer"
```

## Methods

- `Optimizer.inspect({ target })` parses and analyzes the target without
  executing it. It returns variant sites, baseline selection, a snapshot id, and
  warnings.
- `Optimizer.trial({ target, input, selection, snapshot_id, trace })` runs the
  target through normal `executeAgent` and reports the result, picked variants,
  unreached selections, usage, warnings, and optional trace data.
- `Optimizer.specialize({ target, selection, snapshot_id, write, output })`
  rewrites source selections. `write: "preview"` returns a diff only,
  `"copy"` writes an optimized copy, and `"in_place"` updates changed files.

Site ids are label based:

```text
path/to/file.as#Agent.func[label]
```

Repeated labels in the same scope receive an ordinal suffix such as
`[label#2]`.

See `examples/optimizer/` for a complete mockable example.
