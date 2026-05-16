# Meta Architect Example

This example shows an AgentScript program using `host://architect` to turn a
natural-language requirement into an AgentSpec draft, validate it, optionally
repair it, compile it to `.as` source, and analyze the generated source.

Run the structural flow with mock LLM output:

```bash
agentscript examples/meta/architect.as --mock --input '{"request":"Build a docs assistant that searches documentation and returns answers with citations","target_name":"DocsAssistant","model_uri":"ollama://localhost:11434/qwen3.6"}'
```

Real end-to-end generation requires a configured model provider for the `Qwen`
URI or a locally edited model import.

`model_uri` is passed to the meta-agent as a prompt hint. The generated
AgentSpec still comes from the model output, so review `spec.model.uri` before
compiling or running generated agents.
