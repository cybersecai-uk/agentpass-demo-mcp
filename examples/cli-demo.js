#!/usr/bin/env node
/**
 * CLI demo -- runs the MCP handler directly without stdio.
 *
 *   node examples/cli-demo.js
 *   node examples/cli-demo.js --to "Viktor Bout" --amount 5000  # blocked by sanctions
 */

'use strict';

const { handle } = require('../src/server');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

(async () => {
  const rail    = arg('rail', 'x402');
  const to      = arg('to', 'acme-cloud-services');
  const amount  = parseInt(arg('amount', '2500'), 10);
  const currency = arg('currency', 'USD');

  console.log('='.repeat(66));
  console.log('agentpass-demo-mcp  (hosted backend)');
  console.log('='.repeat(66));

  // Step 1: what the MCP host sees
  const list = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  console.log('\nTools exposed to the agent:');
  console.log('  Count:', list.result.tools.length);
  console.log('  Name :', list.result.tools[0].name);
  const schemaBytes = JSON.stringify(list.result.tools[0]).length;
  console.log('  Schema bytes:', schemaBytes, `(≈${Math.round(schemaBytes/4)} tokens)`);

  // Step 2: what the agent would do -- one tool call
  console.log('\nAgent calls agentpass_pay({ rail, to, amount, currency })...');
  const res = await handle({
    jsonrpc: '2.0', id: 2,
    method: 'tools/call',
    params: {
      name: 'agentpass_pay',
      arguments: { rail, to, amount, currency }
    }
  });

  // Step 3: show result
  if (res.error) {
    console.log('\nError:', res.error.message);
    process.exit(1);
  }
  const payload = JSON.parse(res.result.content[0].text);
  const verdict = payload.gatePassed ? 'PAID' : `BLOCKED (${payload.blocked})`;
  console.log('\nVerdict:', verdict);
  console.log('  Rail         :', payload.rail?.name);
  console.log('  Trust level  :', payload.gates?.trust?.level, 'score', payload.gates?.trust?.score);
  console.log('  Sanctions    :', payload.gates?.sanctions?.status, 'matches:', payload.gates?.sanctions?.matches);
  console.log('  Mastercard   :', payload.gates?.mastercardRisk?.riskLevel);
  console.log('  Signed by    :', payload.xat?.signedBy, '(' + payload.xat?.alg + ')');
  if (payload.settlement) console.log('  Settlement tx:', payload.settlement.transactionId);

  console.log('\nToken-floor comparison (see ./benchmark for measurement):');
  console.log('  Naive 30-tool payment MCP   : 3,705 tokens schema floor');
  console.log(`  agentpass-demo-mcp          :   230 tokens schema floor`);
  console.log('  Ratio                       :  16.1x smaller');
  console.log('');
})();
