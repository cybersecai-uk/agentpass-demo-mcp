/**
 * measure.js -- honest token-count comparison
 *
 * Compares the schema floor of:
 *   (A) A realistic 30-tool payment MCP server (./naive-30-tool-payment-mcp.js)
 *   (B) Our single-tool AgentPass wrapper       (../src/server.js)
 *
 * Uses the `tiktoken` tokeniser (`cl100k_base`) for precise counts. This
 * is the GPT-4 tokeniser; Claude uses a different vocab but for typical
 * English-plus-JSON content the token counts are within ~5-10% of each
 * other. For executive-level "how many tokens does my MCP burn" answers
 * this is the right instrument.
 *
 * Run:
 *   npm i --no-save tiktoken
 *   node benchmark/measure.js
 *
 * (c) 2026 CyberSecAI Ltd. Apache 2.0.
 */

'use strict';

const { NAIVE_30_TOOLS } = require('./naive-30-tool-payment-mcp');
const { AGENTPASS_TOOL } = require('../src/server');

function tryRequireTiktoken() {
  try {
    const { encoding_for_model } = require('tiktoken');
    return encoding_for_model('gpt-4');  // uses cl100k_base
  } catch (e) {
    return null;
  }
}

function approximateTokens(s) {
  // Lightweight fallback when tiktoken isn't installed.
  // Empirically ~4 chars/token for JSON-heavy English content.
  return Math.round(Buffer.byteLength(s, 'utf8') / 4);
}

function measure(label, tools, encoder) {
  const payload = { tools };   // what the MCP host actually receives from tools/list
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json, 'utf8');
  const tokens = encoder ? encoder.encode(json).length : approximateTokens(json);
  const perTool = tokens / tools.length;
  return { label, count: tools.length, bytes, tokens, perTool };
}

function fmt(n) { return n.toLocaleString(); }

(function main() {
  const encoder = tryRequireTiktoken();
  const mode = encoder ? 'tiktoken cl100k_base (GPT-4)' : 'approximate (bytes/4)';

  console.log('='.repeat(74));
  console.log('  Agent-payment MCP token-floor benchmark');
  console.log('  Tokeniser:', mode);
  console.log('='.repeat(74));

  const naive = measure('naive 30-tool payment MCP', NAIVE_30_TOOLS, encoder);
  const squashed = measure('agentpass-demo-mcp (1 tool)', [AGENTPASS_TOOL], encoder);

  function report(r) {
    console.log(`\n  ${r.label}`);
    console.log(`    tools        : ${fmt(r.count)}`);
    console.log(`    bytes        : ${fmt(r.bytes)}`);
    console.log(`    tokens       : ${fmt(r.tokens)}`);
    console.log(`    tokens/tool  : ${Math.round(r.perTool)}`);
  }
  report(naive);
  report(squashed);

  const ratio = naive.tokens / squashed.tokens;
  const tokenSavings = naive.tokens - squashed.tokens;

  console.log('\n' + '-'.repeat(74));
  console.log(`  Schema floor saving    : ${fmt(tokenSavings)} tokens per request`);
  console.log(`  Ratio                  : ${ratio.toFixed(1)}× smaller`);

  // Cost projection at 1,000 requests/day, Claude Sonnet input $3/MTok.
  const DAILY_REQUESTS = 1000;
  const PRICE_PER_MTOK_USD = 3;
  const DAYS = 30;
  function monthlyCostUsd(tokensPerCall) {
    const tokensPerMonth = tokensPerCall * DAILY_REQUESTS * DAYS;
    return (tokensPerMonth / 1_000_000) * PRICE_PER_MTOK_USD;
  }
  console.log(`  Monthly input-token cost @ ${fmt(DAILY_REQUESTS)} req/day, $${PRICE_PER_MTOK_USD}/MTok:`);
  console.log(`    naive 30-tool       : $${monthlyCostUsd(naive.tokens).toFixed(2)}`);
  console.log(`    agentpass-demo-mcp  : $${monthlyCostUsd(squashed.tokens).toFixed(2)}`);
  console.log(`    saving              : $${(monthlyCostUsd(naive.tokens) - monthlyCostUsd(squashed.tokens)).toFixed(2)} / month`);

  console.log('\n  Notes:');
  console.log('    - Tokens above are the SCHEMA FLOOR -- what the agent pays');
  console.log('      on every single request, regardless of which tool is called.');
  console.log('    - Multi-hop tool dances (quote -> authorize -> capture) multiply');
  console.log('      this cost further because schema re-injects at each hop.');
  console.log('    - Claude Opus input price is ~$15/MTok -- 5× these figures.');

  if (!encoder) {
    console.log('\n  WARNING: tiktoken not installed. Numbers above are approximate.');
    console.log('  Install for precise measurement:');
    console.log('    npm i --no-save tiktoken');
  }

  // Also emit a JSON summary for programmatic use
  const summary = {
    tokeniser: mode,
    naive: naive,
    squashed: squashed,
    ratio: Number(ratio.toFixed(2)),
    tokenSavings,
    monthlyCostUsd: {
      naive: Number(monthlyCostUsd(naive.tokens).toFixed(2)),
      squashed: Number(monthlyCostUsd(squashed.tokens).toFixed(2)),
      saving: Number((monthlyCostUsd(naive.tokens) - monthlyCostUsd(squashed.tokens)).toFixed(2)),
      assumptions: { dailyRequests: DAILY_REQUESTS, pricePerMtokUsd: PRICE_PER_MTOK_USD, days: DAYS }
    }
  };

  console.log('\n  JSON:');
  console.log(JSON.stringify(summary, null, 2));
})();
