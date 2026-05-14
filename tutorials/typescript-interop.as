import tool Crypto from "node:crypto"

main agent TypeScriptInterop {
    role "Interop example"
    description "Use a Node built-in module from AgentScript and return JSON-safe data."

    main func(input {
        label: string
        payload: json
    }) {
        run_id = Crypto.randomUUID()
        digest = Crypto.hash("sha256", input.label, "hex")

        return {
            label: input.label,
            payload: input.payload,
            run_id: run_id,
            digest: digest
        }
    }
}
