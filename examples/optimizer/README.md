# Optimizer Example

This example shows the V6 optimizer toolchain running as ordinary AgentScript.
The optimizer inspects a target program, runs one trial with a selected
`use one of` variant, and writes a specialization preview.

Run from the repository root:

```bash
npm run agentscript -- examples/optimizer/optimizer.as examples/optimizer/triage.as \
  --mock \
  --request "Checkout is failing with 500 errors in production" \
  --selection '{"examples/optimizer/triage.as#Triage.main[style]":"detailed"}' \
  --write preview \
  --trial-trace none
```

Switch `--write preview` to `--write copy --output /tmp/triage.optimized.as` to
write an optimized copy without touching the target.
