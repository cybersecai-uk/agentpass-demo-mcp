# The agent-payment MCP without the 55,000-token tax

A minimal MCP server that exposes **one tool** — `agentpass_pay` — so any MCP host (Claude Desktop, Cursor, Cline, Zed, etc.) can have its agent make a paid x402 / Stripe / AP2 / Mastercard / Visa TAP call with **~180 tokens of schema floor instead of 55,000**.

Clone it. Run it. See it work.

## The token-tax problem in one picture

```
┌──────────────────────────────────────────────────────────────────┐
│ Naive 30-tool MCP payment server                                 │
│   tools: quote, authorize, capture, refund, dispute, webhook,    │
│          reconcile, payout, subscribe, ...  (×30)                │
│   schema floor per request: ~55,000 tokens                       │
│   cost at 1,000 payments/day, Claude Sonnet ~$3/MTok: ~$4,950/mo │
└──────────────────────────────────────────────────────────────────┘
                               ⬇
┌──────────────────────────────────────────────────────────────────┐
│ agentpass-demo-mcp (this repo)                                   │
│   tools: agentpass_pay(rail, to, amount, currency)               │
│   schema floor per request: ~180 tokens                          │
│   cost at the same volume: ~$32/mo                               │
│                                                                  │
│   Every call is:                                                 │
│     ✓ signed locally with x-agent-trust (ECDSA P-256)            │
│     ✓ screened against OFAC + UK HMT (75,000+ entries)           │
│     ✓ trust-gated (L0–L4 spend limits)                           │
│     ✓ rail-shaped for x402/Stripe/AP2/MPP/MC/Visa TAP/L402       │
└──────────────────────────────────────────────────────────────────┘
```

**~150× token reduction. One install. No protocol change.**

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

Every MCP tool the model can see eats tokens on every single request (schemas are re-injected). The more tools, the higher the floor. Naive payment MCPs expose 30+ tools (one per REST verb); that's the 55,000-token problem.

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
