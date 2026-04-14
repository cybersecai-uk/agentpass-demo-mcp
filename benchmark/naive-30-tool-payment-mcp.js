/**
 * naive-30-tool-payment-mcp.js
 *
 * A realistic "naive" agent-payment MCP server: 30 tools, each modelled
 * 1:1 on a Stripe-like payment API verb. This is what you'd ship if you
 * took a payment REST API and converted every endpoint to its own MCP
 * tool -- the common-and-wrong default.
 *
 * The tool definitions below are written to be representative of real
 * production payment servers (description prose, input schemas with
 * enums, metadata, idempotency keys, currency lists, etc.). They are
 * not artificially padded.
 *
 * Used by ./measure.js to compare token costs against the single-tool
 * AgentPass design.
 *
 * (c) 2026 CyberSecAI Ltd. Apache 2.0.
 */

'use strict';

const ISO_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK'];

const NAIVE_30_TOOLS = [
  // ─── Core payment operations (8) ───────────────────────────────────────
  {
    name: 'create_quote',
    description: 'Create a payment quote to reserve pricing before authorising a charge. Returns a quote_id and expires_at. Use when the merchant must show the customer an itemised price before the agent commits.',
    inputSchema: {
      type: 'object', required: ['line_items', 'currency'],
      properties: {
        line_items: { type: 'array', items: { type: 'object', required: ['description', 'amount_minor'], properties: { description: { type: 'string' }, amount_minor: { type: 'integer' }, quantity: { type: 'integer', default: 1 }, tax_code: { type: 'string' }, sku: { type: 'string' } } } },
        currency: { type: 'string', enum: ISO_CURRENCIES },
        customer_id: { type: 'string', description: 'Existing customer id if known' },
        shipping_address: { type: 'object', properties: { line1: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' }, postal_code: { type: 'string' } } },
        metadata: { type: 'object', additionalProperties: { type: 'string' } },
        idempotency_key: { type: 'string' }
      }
    }
  },
  {
    name: 'create_payment_intent',
    description: 'Create a PaymentIntent to begin authorising funds. Supports card, ACH, bank transfer, and wallet payment methods. Returns client_secret for confirmation.',
    inputSchema: {
      type: 'object', required: ['amount_minor', 'currency'],
      properties: {
        amount_minor: { type: 'integer' },
        currency: { type: 'string', enum: ISO_CURRENCIES },
        payment_method_types: { type: 'array', items: { type: 'string', enum: ['card', 'ach_debit', 'ach_credit', 'sepa_debit', 'bacs_debit', 'wire_transfer', 'wallet'] } },
        customer_id: { type: 'string' },
        description: { type: 'string' },
        statement_descriptor: { type: 'string', maxLength: 22 },
        capture_method: { type: 'string', enum: ['automatic', 'manual'], default: 'automatic' },
        confirmation_method: { type: 'string', enum: ['automatic', 'manual'] },
        setup_future_usage: { type: 'string', enum: ['on_session', 'off_session'] },
        metadata: { type: 'object', additionalProperties: { type: 'string' } },
        idempotency_key: { type: 'string' }
      }
    }
  },
  {
    name: 'confirm_payment_intent',
    description: 'Confirm a PaymentIntent by attaching a payment method and triggering authorisation. Handles 3D Secure challenges when required by the issuer.',
    inputSchema: {
      type: 'object', required: ['payment_intent_id'],
      properties: {
        payment_intent_id: { type: 'string' },
        payment_method_id: { type: 'string' },
        return_url: { type: 'string', format: 'uri', description: '3DS redirect return URL' },
        off_session: { type: 'boolean' },
        mandate_data: { type: 'object', properties: { customer_acceptance: { type: 'object', properties: { type: { type: 'string', enum: ['online', 'offline'] }, accepted_at: { type: 'integer' }, ip_address: { type: 'string' }, user_agent: { type: 'string' } } } } }
      }
    }
  },
  {
    name: 'capture_payment',
    description: 'Capture a previously authorised PaymentIntent. Only valid when capture_method was manual. Cannot capture more than the authorised amount.',
    inputSchema: {
      type: 'object', required: ['payment_intent_id'],
      properties: {
        payment_intent_id: { type: 'string' },
        amount_to_capture_minor: { type: 'integer', description: 'Defaults to full authorised amount' },
        statement_descriptor: { type: 'string', maxLength: 22 },
        application_fee_amount_minor: { type: 'integer' }
      }
    }
  },
  {
    name: 'cancel_payment_intent',
    description: 'Cancel an unconfirmed or manually-captured PaymentIntent. Releases held funds. Cannot cancel once captured or succeeded.',
    inputSchema: {
      type: 'object', required: ['payment_intent_id'],
      properties: {
        payment_intent_id: { type: 'string' },
        cancellation_reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'requested_by_customer', 'abandoned', 'other'] }
      }
    }
  },
  {
    name: 'refund_payment',
    description: 'Refund a captured PaymentIntent fully or partially. Multiple partial refunds allowed up to the captured amount.',
    inputSchema: {
      type: 'object', required: ['payment_intent_id'],
      properties: {
        payment_intent_id: { type: 'string' },
        amount_minor: { type: 'integer' },
        reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'requested_by_customer'] },
        refund_application_fee: { type: 'boolean' },
        reverse_transfer: { type: 'boolean' },
        metadata: { type: 'object', additionalProperties: { type: 'string' } }
      }
    }
  },
  {
    name: 'create_dispute',
    description: 'Record a chargeback or dispute raised by the issuer. Agents should not call this except for testing; disputes normally arrive via webhook.',
    inputSchema: {
      type: 'object', required: ['charge_id', 'reason'],
      properties: {
        charge_id: { type: 'string' },
        reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'subscription_canceled', 'product_not_received', 'product_unacceptable', 'unrecognized', 'credit_not_processed', 'general'] },
        evidence: { type: 'object', properties: { customer_email_address: { type: 'string' }, customer_name: { type: 'string' }, billing_address: { type: 'string' }, shipping_tracking_number: { type: 'string' }, shipping_carrier: { type: 'string' }, receipt: { type: 'string' }, service_documentation: { type: 'string' } } }
      }
    }
  },
  {
    name: 'submit_dispute_evidence',
    description: 'Submit evidence for an active dispute. Evidence must be submitted before the due_by timestamp or the dispute is lost.',
    inputSchema: {
      type: 'object', required: ['dispute_id', 'evidence'],
      properties: {
        dispute_id: { type: 'string' },
        evidence: { type: 'object', properties: { customer_email_address: { type: 'string' }, customer_name: { type: 'string' }, billing_address: { type: 'string' }, shipping_address: { type: 'string' }, shipping_tracking_number: { type: 'string' }, receipt: { type: 'string' }, service_documentation: { type: 'string' }, refund_policy: { type: 'string' }, refund_policy_disclosure: { type: 'string' }, uncategorized_text: { type: 'string' } } },
        submit: { type: 'boolean', default: true }
      }
    }
  },

  // ─── Customer & payment methods (5) ─────────────────────────────────────
  {
    name: 'create_customer',
    description: 'Create a customer record. Customers can have multiple payment methods attached and are used for recurring billing and saved-card flows.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        phone: { type: 'string' },
        description: { type: 'string' },
        address: { type: 'object', properties: { line1: { type: 'string' }, line2: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, postal_code: { type: 'string' }, country: { type: 'string' } } },
        shipping: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'object' } } },
        preferred_locales: { type: 'array', items: { type: 'string' } },
        tax_exempt: { type: 'string', enum: ['none', 'exempt', 'reverse'] },
        metadata: { type: 'object', additionalProperties: { type: 'string' } },
        idempotency_key: { type: 'string' }
      }
    }
  },
  {
    name: 'list_customers',
    description: 'List customers. Supports pagination and filtering by email, created range, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 10, maximum: 100 },
        starting_after: { type: 'string' },
        ending_before: { type: 'string' },
        email: { type: 'string' },
        created: { type: 'object', properties: { gt: { type: 'integer' }, gte: { type: 'integer' }, lt: { type: 'integer' }, lte: { type: 'integer' } } }
      }
    }
  },
  {
    name: 'update_customer',
    description: 'Update a customer record. Only provided fields are changed; omitted fields preserve their existing values.',
    inputSchema: {
      type: 'object', required: ['customer_id'],
      properties: {
        customer_id: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        phone: { type: 'string' },
        description: { type: 'string' },
        address: { type: 'object' },
        invoice_settings: { type: 'object', properties: { default_payment_method: { type: 'string' } } },
        metadata: { type: 'object' }
      }
    }
  },
  {
    name: 'attach_payment_method',
    description: 'Attach a payment method (card, bank account, etc.) to a customer for future use. The payment method must already exist.',
    inputSchema: {
      type: 'object', required: ['payment_method_id', 'customer_id'],
      properties: {
        payment_method_id: { type: 'string' },
        customer_id: { type: 'string' },
        set_as_default: { type: 'boolean' }
      }
    }
  },
  {
    name: 'detach_payment_method',
    description: 'Detach a payment method from its customer. The payment method can no longer be used for off-session charges on that customer.',
    inputSchema: {
      type: 'object', required: ['payment_method_id'],
      properties: {
        payment_method_id: { type: 'string' }
      }
    }
  },

  // ─── Transfers, payouts, balance (4) ────────────────────────────────────
  {
    name: 'create_transfer',
    description: 'Transfer funds from the platform balance to a connected account. Used for marketplace payouts, split payments, and multi-party commerce.',
    inputSchema: {
      type: 'object', required: ['amount_minor', 'currency', 'destination'],
      properties: {
        amount_minor: { type: 'integer' },
        currency: { type: 'string', enum: ISO_CURRENCIES },
        destination: { type: 'string', description: 'Connected account id' },
        source_transaction: { type: 'string', description: 'Charge id this transfer originated from' },
        transfer_group: { type: 'string' },
        description: { type: 'string' },
        metadata: { type: 'object', additionalProperties: { type: 'string' } },
        idempotency_key: { type: 'string' }
      }
    }
  },
  {
    name: 'reverse_transfer',
    description: 'Reverse a transfer partially or fully. Returns funds from the connected account back to the platform balance.',
    inputSchema: {
      type: 'object', required: ['transfer_id'],
      properties: {
        transfer_id: { type: 'string' },
        amount_minor: { type: 'integer' },
        refund_application_fee: { type: 'boolean' },
        description: { type: 'string' }
      }
    }
  },
  {
    name: 'create_payout',
    description: 'Initiate a payout from the account balance to an external bank account. Supports standard and instant payout speeds.',
    inputSchema: {
      type: 'object', required: ['amount_minor', 'currency'],
      properties: {
        amount_minor: { type: 'integer' },
        currency: { type: 'string', enum: ISO_CURRENCIES },
        method: { type: 'string', enum: ['standard', 'instant'] },
        destination: { type: 'string', description: 'External bank account id' },
        statement_descriptor: { type: 'string', maxLength: 22 },
        source_type: { type: 'string', enum: ['card', 'bank_account', 'fpx'] },
        metadata: { type: 'object' }
      }
    }
  },
  {
    name: 'list_balance_transactions',
    description: 'List balance transactions affecting the account. Used for reconciliation and financial reporting.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 10, maximum: 100 },
        starting_after: { type: 'string' },
        type: { type: 'string', enum: ['charge', 'refund', 'adjustment', 'application_fee', 'application_fee_refund', 'transfer', 'payment', 'payout', 'payout_cancel', 'payout_failure', 'validation', 'dispute'] },
        currency: { type: 'string' },
        available_on: { type: 'object', properties: { gte: { type: 'integer' }, lte: { type: 'integer' } } }
      }
    }
  },

  // ─── Subscriptions & invoices (4) ───────────────────────────────────────
  {
    name: 'create_subscription',
    description: 'Create a recurring subscription. Charges the customer on a schedule defined by the price object. Supports trials, coupons, and metered billing.',
    inputSchema: {
      type: 'object', required: ['customer_id', 'items'],
      properties: {
        customer_id: { type: 'string' },
        items: { type: 'array', items: { type: 'object', required: ['price_id'], properties: { price_id: { type: 'string' }, quantity: { type: 'integer' } } } },
        trial_period_days: { type: 'integer' },
        trial_end: { type: 'integer' },
        default_payment_method: { type: 'string' },
        payment_behavior: { type: 'string', enum: ['default_incomplete', 'error_if_incomplete', 'allow_incomplete', 'pending_if_incomplete'] },
        proration_behavior: { type: 'string', enum: ['create_prorations', 'none', 'always_invoice'] },
        billing_cycle_anchor: { type: 'integer' },
        cancel_at: { type: 'integer' },
        collection_method: { type: 'string', enum: ['charge_automatically', 'send_invoice'] },
        metadata: { type: 'object' }
      }
    }
  },
  {
    name: 'cancel_subscription',
    description: 'Cancel a subscription immediately or at period end. Optionally prorates remaining usage and issues a credit to the customer.',
    inputSchema: {
      type: 'object', required: ['subscription_id'],
      properties: {
        subscription_id: { type: 'string' },
        cancel_at_period_end: { type: 'boolean' },
        invoice_now: { type: 'boolean' },
        prorate: { type: 'boolean' },
        cancellation_reason: { type: 'string' }
      }
    }
  },
  {
    name: 'list_invoices',
    description: 'List invoices for a customer or subscription. Supports status filtering and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        subscription_id: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'open', 'paid', 'uncollectible', 'void'] },
        limit: { type: 'integer', default: 10, maximum: 100 },
        starting_after: { type: 'string' }
      }
    }
  },
  {
    name: 'pay_invoice',
    description: 'Pay an open invoice using the default or specified payment method. If payment fails, the invoice moves back to open.',
    inputSchema: {
      type: 'object', required: ['invoice_id'],
      properties: {
        invoice_id: { type: 'string' },
        payment_method_id: { type: 'string' },
        off_session: { type: 'boolean' },
        paid_out_of_band: { type: 'boolean' }
      }
    }
  },

  // ─── Webhooks, charges, reconciliation (4) ──────────────────────────────
  {
    name: 'list_webhook_events',
    description: 'List webhook events that have been sent. Useful for reconciliation, debugging, and backfilling missed events.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Event type filter, e.g. payment_intent.succeeded' },
        types: { type: 'array', items: { type: 'string' } },
        delivery_success: { type: 'boolean' },
        limit: { type: 'integer', default: 10, maximum: 100 },
        starting_after: { type: 'string' }
      }
    }
  },
  {
    name: 'verify_webhook_signature',
    description: 'Verify a webhook payload against the signing secret. Use this before trusting any incoming webhook data.',
    inputSchema: {
      type: 'object', required: ['payload', 'signature', 'secret'],
      properties: {
        payload: { type: 'string', description: 'Raw request body as received' },
        signature: { type: 'string', description: 'Stripe-Signature header' },
        secret: { type: 'string', description: 'Endpoint signing secret' },
        tolerance_seconds: { type: 'integer', default: 300 }
      }
    }
  },
  {
    name: 'list_charges',
    description: 'List charges. Useful for reporting, reconciliation, and customer-facing receipt UIs.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        payment_intent_id: { type: 'string' },
        transfer_group: { type: 'string' },
        limit: { type: 'integer', default: 10, maximum: 100 },
        starting_after: { type: 'string' },
        created: { type: 'object', properties: { gte: { type: 'integer' }, lte: { type: 'integer' } } }
      }
    }
  },
  {
    name: 'reconcile_settlements',
    description: 'Reconcile a date range of settlements against internal ledger. Returns discrepancies and a settlement file reference.',
    inputSchema: {
      type: 'object', required: ['date_from', 'date_to'],
      properties: {
        date_from: { type: 'string', format: 'date' },
        date_to: { type: 'string', format: 'date' },
        currency: { type: 'string', enum: ISO_CURRENCIES },
        merchant_id: { type: 'string' },
        tolerance_minor: { type: 'integer', default: 0, description: 'Allowed discrepancy per transaction' }
      }
    }
  },

  // ─── Compliance, risk, fraud (5) ────────────────────────────────────────
  {
    name: 'run_sanctions_check',
    description: 'Screen a party against OFAC SDN, UK HMT, EU consolidated, and UN sanctions lists. Returns any matches with confidence scores.',
    inputSchema: {
      type: 'object', required: ['name'],
      properties: {
        name: { type: 'string' },
        date_of_birth: { type: 'string', format: 'date' },
        nationality: { type: 'string' },
        country_of_residence: { type: 'string' },
        entity_type: { type: 'string', enum: ['individual', 'entity', 'vessel', 'aircraft'] },
        address: { type: 'object', properties: { line1: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' } } },
        fuzzy_match: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'run_kyc_check',
    description: 'Run a Know-Your-Customer check on an individual or entity. Requires government ID and returns a verification status.',
    inputSchema: {
      type: 'object', required: ['customer_id'],
      properties: {
        customer_id: { type: 'string' },
        document_type: { type: 'string', enum: ['passport', 'driving_licence', 'national_id', 'residence_permit', 'company_registration'] },
        document_country: { type: 'string' },
        document_front_image: { type: 'string', description: 'Base64 encoded image' },
        document_back_image: { type: 'string' },
        selfie_image: { type: 'string' },
        address_proof: { type: 'string' }
      }
    }
  },
  {
    name: 'check_velocity_limits',
    description: 'Check whether a customer or payment method would exceed velocity limits (transactions per hour, daily spend, etc.) if a new payment were added.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        payment_method_id: { type: 'string' },
        proposed_amount_minor: { type: 'integer' },
        proposed_currency: { type: 'string', enum: ISO_CURRENCIES },
        windows: { type: 'array', items: { type: 'string', enum: ['1h', '24h', '7d', '30d'] } }
      }
    }
  },
  {
    name: 'get_risk_score',
    description: 'Return the risk score for a specific payment or payment method, incorporating behavioural signals, device fingerprint, and network reputation.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_intent_id: { type: 'string' },
        payment_method_id: { type: 'string' },
        include_signals: { type: 'boolean', default: false, description: 'Include the underlying features used to compute the score' }
      }
    }
  },
  {
    name: 'flag_transaction_for_review',
    description: 'Flag a transaction for manual review by the risk team. Pauses any pending captures and notifies the configured review queue.',
    inputSchema: {
      type: 'object', required: ['charge_id', 'reason'],
      properties: {
        charge_id: { type: 'string' },
        reason: { type: 'string' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        assigned_to: { type: 'string' },
        notes: { type: 'string' }
      }
    }
  }
];

// Sanity: confirm we have exactly 30 tools.
if (NAIVE_30_TOOLS.length !== 30) {
  throw new Error(`Expected 30 tools, got ${NAIVE_30_TOOLS.length}`);
}

module.exports = { NAIVE_30_TOOLS };
