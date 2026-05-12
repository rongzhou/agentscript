import tool Crypto from "node:crypto"

main agent NodeCryptoExample {
    role "Run Identifier"
    description "Demonstrate importing a Node built-in module as an AgentScript tool."

    main func(input {
        label: string
    }) {
        run_id = Crypto.randomUUID()
        digest = Crypto.hash("sha256", input.label, "hex")

        return {
            label: input.label,
            run_id: run_id,
            digest: digest
        }
    }
}
