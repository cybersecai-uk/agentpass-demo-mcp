# 30 tools vs 1: the agent-payment MCP token-floor benchmark

A minimal MCP server that exposes **one tool** — `agentpass_pay` — so any MCP host (Claude Desktop, Cursor, Cline, Zed, etc.) can have its agent make a paid x402 / Stripe / AP2 / Mastercard / Visa TAP call with **230 tokens of schema floor instead of 3,705**.

Clone it. Run it. See it work. Reproduce the measurement in [`benchmark/`](./benchmark).

## Measured numbers (tiktoken cl100k_base, 14 Apr 2026)

```
┌──────────────────────────────────────────────────────────────────┐
│ Naive 30-tool payment MCP (realistic Stripe-shaped surface)      │
│   tools: create_quote, confirm_payment_intent, capture,          │
│          refund, dispute, customer CRUD, transfer, payout,       │
│          subscription, webhook_verify, sanctions, KYC,           │
│          velocity, risk, flag review ... (30 total)              │
│                                                                  │
│   Schema floor per request : 3,705 tokens                        │
│   Cost (1,000 req/day, Sonnet)  : $333 / month                   │
│   Cost (1,000 req/day, Opus)    : $1,667 / month                 │
└──────────────────────────────────────────────────────────────────┘
                               ⬇
┌──────────────────────────────────────────────────────────────────┐
│ agentpass-demo-mcp (this repo)                                   │
│   tools: agentpass_pay(rail, to, amount, currency)               │
│                                                                  │
│   Schema floor per request : 230 tokens                          │
│   Cost (1,000 req/day, Sonnet)  : $21 / month                    │
│   Cost (1,000 req/day, Opus)    : $104 / month                   │
│                                                                  │
│   Every call is:                                                 │
│     ✓ signed locally with x-agent-trust (ECDSA P-256)            │
│     ✓ screened against OFAC + UK HMT (75,000+ entries)           │
│     ✓ trust-gated (L0–L4 spend limits)                           │
│     ✓ rail-shaped for x402/Stripe/AP2/MPP/MC/Visa TAP/L402       │
└──────────────────────────────────────────────────────────────────┘
```

**Schema floor: 16.1× smaller.**
**Effective advantage at payment-flow level: ~48×** (multi-hop flows like quote → confirm → capture re-inject the schema three times on the 30-tool server — 11,115 tokens — but settle in one call here).

All figures reproducible — see [`benchmark/`](./benchmark).

## What you'll see

An agent running in Claude Desktop (or any MCP host) that:

1. Lists exactly **one** tool: `agentpass_pay`
2. Can pay `acme-cloud-services` → returns `PAID` with a signed settlement
3. Can try to pay `Viktor Bout` → returns `BLOCKED` by sanctions gate
4. Can try to pay from a low-trust persona → returns `BLOCKED` by trust gate

All the heavy lifting (signing, sanctions, trust, rail shaping) is deterministic code — the LLM never re-enters the loop after the decision.

## Prerequisites

- Node.js 18+
- Claude Desktop (or any MCP host — Cursor, Cline, Zed, Continue.dev also work)

## Quickstart

```bash
# 1. Clone
git clone https://github.com/cybersecai-uk/agentpass-demo-mcp.git
cd agentpass-demo-mcp

# 2. Run the CLI demo to prove end-to-end works
node examples/cli-demo.js
node examples/cli-demo.js --to "Viktor Bout" --amount 5000   # blocked
node examples/cli-demo.js --rail ap2 --to acme-cloud-services --amount 2500

# 3. Run the tests
node test/handler.test.js
LIVE=1 node test/handler.test.js    # hits the hosted AgentPass API
```

## Wire it into Claude Desktop

Edit Claude Desktop's config at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS, and add:

```json
{
  "mcpServers": {
    "agentpass-demo": {
      "command": "node",
      "args": ["/absolute/path/to/agentpass-demo-mcp/src/server.js"],
      "env": {
        "AGENTPASS_AGENT_ID": "trusted"
      }
    }
  }
}
```

Restart Claude Desktop. Your agent now sees one tool: `agentpass_pay`.

Try it:

> *"Pay acme-cloud-services $25.00 on x402 for a hosting invoice."*

Then:

> *"Pay Viktor Bout $50.00."*

The second one will be blocked with a detailed sanctions match.

## How the token floor stays tiny

Every MCP tool the model can see eats tokens on every single request (schemas are re-injected). The more tools, the higher the floor. Naive payment MCPs expose 25–35 tools (one per REST verb). We measured a realistic 30-tool payment surface at **3,705 tokens**. The 55,000-token figure you may have seen in Valley discourse is from Anthropic's 93-tool GitHub MCP, not a payment MCP — see [`benchmark/`](./benchmark) for the honest numbers.

We collapse every payment branch (quote, authorize, capture, refund, dispute, etc.) into **one** high-intent tool:

```
agentpass_pay({ rail, to, amount, currency })
```

The model makes a single decision: *"should I call this, and with what?"* Everything downstream — signing, trust, sanctions, rail payload — is deterministic code, **zero tokens**.

This is Armin Ronacher's *"[code is the tool](https://lucumr.pocoo.org/2025/8/18/code-mcps/)"* principle, applied to money.

## How this demo differs from the production library

| | **This demo** | **[AgentPass SDK](https://agentpass.co.uk/rails)** (production) |
|---|---|---|
| Licence | Apache 2.0 | BSL 1.1 |
| Where gates run | Hosted API at agentpass.co.uk | In-process, inside your infra |
| Sanctions screening | Server-side at agentpass.co.uk | Bundled locally (OFAC + HMT, 75k entries) |
| Transactions visible to CyberSecAI | Yes (hosted mode) | No — payments never leave your process |
| Deployment | Copy `server.js` | `npm install @cybersecai-uk/agentpass-sdk` |
| Rate limit | Yes (free tier) | None |

For indie agent devs, hackathons, and proof-of-concepts the demo is fine. For production payment flows, use the SDK.

## Standards this builds on

- **[`x-agent-trust`](https://spec.openapis.org/registry/extension/x-agent-trust.html)** — OpenAPI Extensions Registry entry for agent-signature declaration.
- **[IETF draft-sharif-agent-payment-trust](https://datatracker.ietf.org/doc/draft-sharif-agent-payment-trust/)** — Payment-specific signing primitives.
- **[IETF draft-sharif-mcps-secure-mcp](https://datatracker.ietf.org/doc/draft-sharif-mcps-secure-mcp/)** — MCP transport-boundary security.
- **[OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)** — Recommended controls for MCP deployments.
- **[OWASP MCP Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html)** — Section 7 covers message integrity and replay protection.

## Related repos

- **[x-agent-trust-reference](https://github.com/cybersecai-uk/x-agent-trust-reference)** — Apache 2.0 reference implementation of the signing primitive only.
- **[AgentPass SDK](https://agentpass.co.uk/rails)** — BSL 1.1 production library (npm: `@cybersecai-uk/agentpass-sdk`, private).
- **[MCPS](https://mcpsaas.co.uk)** — MCP transport boundary security.

## Licence

Apache License, Version 2.0. See [`LICENSE`](LICENSE).

## Maintainer

Raza Sharif, FBCS, CISSP, CSSLP. Published author, *Breach 20/20*.
CyberSecAI Ltd — contact@agentsign.dev
