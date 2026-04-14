# Token-floor benchmark

> **Reproducible proof** that collapsing a 30-tool payment MCP into a single high-intent tool cuts the schema floor by 16×, or ~48× once you account for multi-hop tool dances.

## Run it

```bash
git clone https://github.com/cybersecai-uk/agentpass-demo-mcp.git
cd agentpass-demo-mcp
npm i --no-save tiktoken
node benchmark/measure.js
```

## What's measured

The benchmark compares **two payment MCP servers** by JSON-serialising each server's `tools/list` response (which is what the agent receives verbatim on every conversation turn) and tokenising the result with **`tiktoken` `cl100k_base`** (the GPT-4 tokeniser, within ~5–10 % of Claude's tokeniser for English + JSON content).

| Configuration | Source |
|---|---|
| **Naive 30-tool payment MCP** | `benchmark/naive-30-tool-payment-mcp.js` |
| **Collapsed 1-tool `agentpass_pay`** | `src/server.js` |

## Results

Measured on 14 April 2026 with tiktoken `cl100k_base`:

| Server | Tools | Bytes | **Tokens** | Tokens / tool |
|---|---:|---:|---:|---:|
| Naive 30-tool payment MCP | 30 | 17,596 | **3,705** | 123 |
| agentpass-demo-mcp (1 tool) | 1 | 944 | **230** | 230 |

**Schema-floor saving: 3,475 tokens / request. Ratio: 16.1× smaller.**

Projected monthly input-token cost at **1,000 payments/day**, **Claude Sonnet** pricing ($3 / M tokens):

| | Monthly cost |
|---|---:|
| Naive 30-tool | **$333.45** |
| agentpass-demo-mcp (1 tool) | **$20.70** |
| **Saving** | **$312.75 / month** |

On **Claude Opus** ($15 / M tokens) multiply all three lines by 5: **$1,667 → $104, saving ~$1,563 / month.**

## Why the naïve MCP isn't 55,000 tokens

The popular "55,000 tokens" figure in Valley discourse refers to Anthropic's **GitHub MCP server**, which exposes **93 tools**. A realistic **payment** MCP surface is 25–35 tools (the [Stripe-like verb set](./naive-30-tool-payment-mcp.js) — create_quote, confirm_payment_intent, capture, refund, dispute, customer CRUD, transfer, payout, subscription, webhook verify, reconcile, sanctions, KYC, velocity, risk scoring, flag review).

Our 30-tool payment MCP is written realistically — well-described tools, proper JSON schemas with enums and metadata — and it costs **3,705 tokens of schema floor**. That's the honest number to anchor against.

## Why the *effective* advantage is closer to 48×, not 16×

The 16.1× figure is the **per-request schema floor**. Real payment flows are multi-hop:

```
agent
 ├── create_quote(line_items, currency)            ← 3,705 tokens of schema
 ├── confirm_payment_intent(intent_id, method)      ← 3,705 tokens again
 └── capture_payment(intent_id)                     ← 3,705 tokens again
                                                     = ~11,115 tokens
```

vs.

```
agent
 └── agentpass_pay(rail, to, amount, currency)      ← 230 tokens, one call
```

**Effective advantage at the payment flow level: ~48×.**

Additionally, tool-selection accuracy degrades as the tool menu grows (43% → 14% at 100-tool scale, per published benchmarks). Wrong-tool retries burn further tokens that don't appear in the schema floor at all. Collapsing to one high-intent tool removes the selection problem entirely.

## Methodology notes & caveats

- **Tokeniser choice.** `cl100k_base` is GPT-4's tokeniser. Claude uses a different vocabulary, but for English-plus-JSON content token counts differ by only a few percent. Anthropic does not publish an official public tokeniser; `cl100k_base` is the industry-standard proxy.
- **Schema content.** The naive 30-tool server is intentionally realistic, not padded. Descriptions are 15–30 words each, input schemas cover the fields a real engineer would include. If anything it undercounts what a production server ships with (we excluded extensive `metadata` blobs, oneOf branches, and example bodies).
- **Assumption of 1,000 payments/day.** Chosen to match the volume figure in common token-cost commentary. Scale linearly for your own traffic.
- **Pricing.** Claude Sonnet input $3 / M tokens, Opus input $15 / M tokens (as of April 2026).

## Licence

Apache 2.0, same as the rest of this repo.
