#!/usr/bin/env node
/**
 * agentpass-demo-mcp
 *
 * A minimal MCP server that exposes ONE tool -- agentpass_pay -- so any
 * MCP host (Claude Desktop, Cursor, Cline, Zed, ...) can make a paid
 * x402 call with 230 tokens of schema floor instead of 3,705 (a realistic
 * 30-tool payment MCP). Measured with tiktoken cl100k_base. See
 * ./benchmark for the reproducible comparison.
 *
 * This demo talks to the hosted AgentPass API at https://agentpass.co.uk
 * so you can clone-and-run it with zero licence keys. For production
 * deployment you'd swap the fetch call for the commercial SDK running
 * in-process.
 *
 * Licensed under Apache License, Version 2.0.
 * (c) 2026 CyberSecAI Ltd.
 */

'use strict';

const https = require('https');
const readline = require('readline');

const AGENTPASS_BASE = process.env.AGENTPASS_BASE || 'https://agentpass.co.uk';
// Demo persona. Valid values match the hosted demo endpoint:
//   'trusted' -- L3, score 88, clean history
//   'new'     -- L1, score 32, no history
//   'suspect' -- L0, score 12, velocity spikes, anomalies
const AGENT_ID = process.env.AGENTPASS_AGENT_ID || 'trusted';
const SERVER_NAME = 'agentpass-demo-mcp';
const SERVER_VERSION = '1.0.0';

// The ONE tool. 230 tokens on the wire. Replaces a realistic 30-tool
// MCP payment surface that burns 3,705 tokens of schema floor on every
// request -- 16x more -- and roughly 48x more across a real multi-hop
// flow (quote -> confirm -> capture).
const AGENTPASS_TOOL = {
  name: 'agentpass_pay',
  description:
    'Make an agent-authorised payment through AgentPass. Signs the request with x-agent-trust (ECDSA P-256), screens the recipient against OFAC + UK HMT sanctions, applies trust-level spend limits, and settles on the chosen rail (x402, Stripe, ACP, AP2, MPP, Mastercard Agent Pay, Visa TAP, L402). Returns a settlement receipt with a tamper-evident hash.',
  inputSchema: {
    type: 'object',
    required: ['to', 'amount', 'currency'],
    properties: {
      rail: {
        type: 'string',
        enum: ['x402', 'stripe', 'acp', 'ap2', 'mpp', 'mastercard', 'visa-tap', 'l402'],
        description: 'Payment rail (default: x402)'
      },
      to: { type: 'string', description: 'Recipient name or identifier' },
      amount: { type: 'integer', minimum: 1, description: 'Minor units (cents)' },
      currency: { type: 'string', description: 'ISO currency or asset code (USD, USDC, GBP, EUR, BTC)' },
      description: { type: 'string', description: 'Optional payment memo' }
    }
  }
};

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(AGENTPASS_BASE + path);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function callAgentPass(args) {
  const { rail = 'x402', to, amount, currency = 'USD', description } = args;
  const res = await postJSON('/api/rails/demo/click-to-pay', {
    rail,
    persona: AGENT_ID,
    to,
    amount,
    currency,
    description
  });
  return res.body;
}

// ----- MCP JSON-RPC dispatch -----

async function handle(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [AGENTPASS_TOOL] } };
  }

  if (method === 'tools/call') {
    if (!params || params.name !== AGENTPASS_TOOL.name) {
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool' } };
    }
    try {
      const result = await callAgentPass(params.arguments || {});
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: e.message } };
    }
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ----- stdio transport -----

async function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); }
    catch (e) { return; }
    const res = await handle(req);
    process.stdout.write(JSON.stringify(res) + '\n');
  });

  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} listening on stdio (backend: ${AGENTPASS_BASE})\n`);
}

if (require.main === module) main();

module.exports = { handle, AGENTPASS_TOOL };
