import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Api from "https://api.example.com"

main agent ApiExtractor {
    model Qwen
    role "Data Engineer"
    description "Call an API endpoint and extract normalized structured data from the response."

    main func(input {
        url string
    }) {
        response = Api.get({
            url: input.url,
            timeout: 10000
        })

        use input.url
        use response < 8k

        generate({ input: "Extract normalized data from the API response", limit: 1200 }) -> {
            records list[json]
            fields list[string]
            warnings list[string]
            summary string
        }
    }
}
