# WXT + React

This template should help get you started developing with React in WXT.

## Fact Check

Set these environment variables before running `npm run dev` or `npm run build`:

- `WXT_TAVILY_API_KEY`: required for web search evidence.
- `WXT_OPENAI_API_KEY`: optional; when present, the background agent uses OpenAI to compare the claim to Tavily results.
- `WXT_OPENAI_MODEL`: optional; defaults to `gpt-4.1-mini`.

Run `npm run verify:fact-check` to exercise the fact-check contract against a mocked false claim. The script expects a compact `False` JSON response with a corrective source link.
