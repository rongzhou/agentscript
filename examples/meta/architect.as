import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Architect from "host://architect"

main agent AgentScriptArchitect {
    model Qwen
    role "AgentScript meta-agent architect"
    description "Generate AgentScript agents from natural-language requirements."

    main func(input {
        request: string
        target_name: string
        model_uri: string
    }) {
        use input.request as "user agent requirement"
        use input.target_name as "target agent name"
        use input.model_uri as "preferred model uri"

        draft = generate({
            input: "Design an AgentSpec from the user's requirement and return exactly one AgentSpec JSON object in the `spec` field. First infer the smallest useful agent design: what inputs the caller must provide, whether external tools are needed, what intermediate tool results should be computed, what context the model needs, and what structured output the caller expects. Do not force a tool when the task can be handled from user input alone; use tools only when the request needs retrieval, external data, actions, memory, or integration. Choose pattern \"linear\" for single-pass agents. A request that searches, retrieves, classifies, summarizes, extracts, rewrites, or calls one or more known tools once before answering is still linear. Choose pattern \"react\" only when the user explicitly needs an iterative loop where the model repeatedly reasons, chooses the next tool action, observes results, and decides whether to continue. The AgentSpec must use exactly this schema family, not JSON Schema or OpenAPI. Required top-level keys are version, pattern, agent, model, inputs, tools, locals, model_context, generation, output, assumptions. Set version to \"0.1\". Use target_name exactly as agent.name when it is a valid UpperCamelCase identifier. agent has name, role, description. model is { import_name: \"Qwen\", uri: input.model_uri }. inputs is an object map such as { question: { type: \"string\", required: true } }, never an array and never JSON Schema properties/required. AgentSpec field types are only string, number, boolean, json, list[string], list[number], list[boolean], and list[json]; never use array, object, integer, or text as a type. Reference strings must always include their namespace prefix: input.<field> for input fields and local.<name> for locals; bare field names like email_body or question are invalid references. tools is an array; each tool has import_name, uri, and methods; each method is an object with name and purpose, never a string. If a needed tool URI is not specified, choose a conservative placeholder URI that describes the integration, such as mcp://docs for documentation search or mcp://search for web/search retrieval, and record that assumption. locals is an array of computed tool calls; it may be empty. Each local has name and source. Every tool_call source must contain all four fields: kind: \"tool_call\", tool: <tool import_name>, method: <declared method name>, and args: { ... }. source.kind belongs inside source. Tool call args values are reference strings such as \"input.question\" or \"local.previous_result\". model_context is a non-empty array of objects, never strings. Each model_context object has source and label, plus optional max: { source: \"input.<field>\" or \"local.<name>\", label: \"short human label\", max: \"8k\" }. Do not use name or budget fields in model_context. Include the user's primary request input and any relevant local tool results. model_context.max, when present, is a string budget matching digits with optional k, such as \"4k\" or \"8000\", never a number. generation.input is a natural-language instruction that tells the model how to use the declared context and satisfy the output contract; never set it to \"input.question\" or another reference string. generation.max_output is an integer like 1200, never \"2k\". output is { fields: { ... } } where fields reflect the requested deliverable; include citations, confidence, missing_information, or other fields only when useful for the stated task. assumptions is an array of strings describing unavoidable guesses, never an object. Before returning, silently verify: every top-level required key exists; every model_context item has source and label; every reference starts with input. or local.; every local tool call has kind, tool, method, and args; every tool method is an object; all field types are supported AgentSpec types. Return missing_requirements as a string array for important missing details, but still produce a reasonable spec when possible.",
            max_output: 9000
        }) -> {
            spec: json
            assumptions: list[string]
            missing_requirements: list[string]
        }

        validation = Architect.validateSpec({
            spec: draft.spec
        })

        repaired = draft.spec
        repair_summary = "no repair needed"

        if not validation.ok {
            use draft.spec as "draft AgentSpec"
            use validation as "validation diagnostics"

            repair = generate({
                input: "Repair only the AgentSpec JSON object. Preserve the user's intent and the draft's design choices unless they violate AgentSpec; do not change the agent into a different example just to pass validation. If the draft used react but the request only needs single-pass retrieval, classification, summarization, extraction, rewriting, or known tool calls before one final answer, repair it to pattern \"linear\" instead of inventing a react block. Do not use JSON Schema fields such as input, properties, required arrays, steps, output.properties, or fields arrays. Required top-level keys are version, pattern, agent, model, inputs, tools, locals, model_context, generation, output, assumptions. version must be \"0.1\". agent must include name, role, description. model must include import_name and uri; use import_name \"Qwen\" and uri input.model_uri. inputs and output.fields must be objects, not arrays. Reference strings must always start with input. or local.; convert bare sources such as email_body to input.email_body when they refer to inputs. tools, locals, and model_context must be arrays; tools and locals may be empty when no external tool is needed, but model_context must contain at least one input or local reference. model_context entries must be objects with source and label, plus optional max; never use string entries, name, or budget in model_context. locals[*].source.kind must be exactly \"tool_call\"; do not put kind on the local object itself. Tool methods must be objects with name and purpose, not strings. Tool call args values must be strings such as \"input.question\" or \"local.relevant_docs\". model_context.max, when present, must be a string like \"8k\" or \"8000\", not a number. generation.input must be a natural-language instruction describing how to use the declared context and produce the requested output, not \"input.question\" or another reference string. generation.max_output must be an integer like 1200, not \"2k\". assumptions must be an array of strings, not an object. output.fields values must use AgentSpec types: string, number, boolean, json, list[string], list[number], list[boolean], list[json]. Return a complete corrected spec and a brief repair_summary.",
                max_output: 9000
            }) -> {
                spec: json
                repair_summary: string
            }

            repaired = repair.spec
            repair_summary = repair.repair_summary
        }

        compiled = Architect.compileSpec({
            spec: repaired
        })

        if not compiled.ok {
            use repaired as "repaired AgentSpec"
            use compiled as "compile diagnostics"

            repair_compile = generate({
                input: "The repaired AgentSpec still failed validation during compileSpec. Repair the same AgentSpec again using the compile diagnostics while preserving the user's requested agent behavior. Return a complete valid AgentSpec only in spec. Remember: pattern is linear unless the user explicitly needs an iterative reason-act-observe loop; simple search/retrieval before answering is linear; all references must start with input. or local.; methods is an array of objects with name and purpose; locals[*].source.kind is exactly \"tool_call\"; model_context is a non-empty array of objects with source and label plus optional max, not strings and not name/budget; model_context.max is a string budget like \"8k\"; generation.input is a natural-language instruction, not a reference string; generation.max_output is an integer; assumptions is an array of strings; inputs and output.fields are objects; tools, locals, and model_context are arrays.",
                max_output: 9000
            }) -> {
                spec: json
                repair_summary: string
            }

            repaired = repair_compile.spec
            repair_summary = repair_compile.repair_summary
            compiled = Architect.compileSpec({
                spec: repaired
            })
        }

        source = ""
        analysis = {
            ok: false,
            diagnostics: []
        }

        if compiled.ok {
            source = compiled.source
            analysis = Architect.analyzeSource({
                source: source
            })
        }

        use source max 4k as "generated AgentScript source"
        use compiled as "compile result"
        use analysis as "source analysis result"

        review = generate({
            input: "Summarize the generated agent. Explain what it does, what enters model context, the output contract, and any assumptions.",
            max_output: 1200
        }) -> {
            summary: string
            model_context_summary: list[string]
            output_fields: list[string]
        }

        return {
            summary: review.summary,
            source: source,
            validation_ok: validation.ok,
            compile_ok: compiled.ok,
            analysis_ok: analysis.ok,
            assumptions: draft.assumptions,
            model_context_summary: review.model_context_summary,
            output_fields: review.output_fields,
            repair_summary: repair_summary
        }
    }
}
