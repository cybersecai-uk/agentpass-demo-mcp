/**
 * agentpass-demo-mcp tests
 * Run: node test/handler.test.js
 */

'use strict';

const { handle, AGENTPASS_TOOL } = require('../src/server');

let PASSED = 0, FAILED = 0, TOTAL = 0;
function assert(cond, msg) {
  TOTAL++;
  if (cond) { PASSED++; console.log('  PASS:', msg); }
  else { FAILED++; console.log('  FAIL:', msg); }
}

(async () => {
  console.log('='.repeat(60));
  console.log('agentpass-demo-mcp handler tests');
  console.log('='.repeat(60));

  console.log('\n[1] initialize');
  const initRes = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert(initRes.result?.serverInfo?.name === 'agentpass-demo-mcp', 'serverInfo.name');
  assert(initRes.result?.protocolVersion === '2024-11-05', 'protocolVersion');
  assert(initRes.result?.capabilities?.tools, 'declares tools capability');

  console.log('\n[2] tools/list -- EXACTLY ONE tool');
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert(Array.isArray(list.result?.tools), 'tools is array');
  assert(list.result.tools.length === 1, `exactly 1 tool (got ${list.result.tools.length})`);
  assert(list.result.tools[0].name === 'agentpass_pay', 'tool name = agentpass_pay');

  console.log('\n[3] schema token floor -- <300 tokens');
  const schemaBytes = JSON.stringify(AGENTPASS_TOOL).length;
  const approxTokens = Math.round(schemaBytes / 4);
  console.log(`   schema JSON: ${schemaBytes} bytes (≈${approxTokens} tokens)`);
  assert(approxTokens < 300, `schema fits under 300 tokens (got ~${approxTokens})`);

  console.log('\n[4] unknown tool rejected');
  const bad = await handle({
    jsonrpc: '2.0', id: 3,
    method: 'tools/call',
    params: { name: 'not_a_real_tool', arguments: {} }
  });
  assert(bad.error?.code === -32601, 'unknown tool returns -32601');

  console.log('\n[5] ping');
  const pingRes = await handle({ jsonrpc: '2.0', id: 4, method: 'ping' });
  assert(pingRes.result !== undefined, 'ping returns result');

  console.log('\n[6] unknown method');
  const um = await handle({ jsonrpc: '2.0', id: 5, method: 'not/a/method' });
  assert(um.error?.code === -32601, 'unknown method returns -32601');

  // Live call is skipped by default to keep tests hermetic.
  // To run against production AgentPass, set LIVE=1.
  if (process.env.LIVE === '1') {
    console.log('\n[7] LIVE: tools/call agentpass_pay against production');
    const live = await handle({
      jsonrpc: '2.0', id: 6,
      method: 'tools/call',
      params: { name: 'agentpass_pay', arguments: { rail: 'x402', to: 'acme-cloud-services', amount: 1000, currency: 'USD' } }
    });
    assert(live.result?.content?.[0]?.type === 'text', 'live call returned text content');
    const parsed = JSON.parse(live.result.content[0].text);
    assert(parsed.rail?.id === 'x402', 'live call settled on x402 rail');
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${PASSED}/${TOTAL} passed, ${FAILED} failed`);
  console.log('='.repeat(60));
  process.exit(FAILED > 0 ? 1 : 0);
})();
