const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const rootDir = path.join(__dirname, '..');
const testMode = (process.env.TEST_MODE || 'true').toLowerCase() === 'true' || process.env.TEST_MODE === '1';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

app.use(express.static(rootDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'login.html'));
});

app.get('/api/health', async (req, res) => {
  let dbStatus = 'unknown';

  try {
    await db.query('select 1 as ok');
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'disconnected';
  }

  return res.json({
    status: 'ok',
    service: 'ANONYMIKECONNECT SUPA LAN',
    provider: process.env.PAYMENT_PROVIDER || 'TEST',
    testMode,
    database: dbStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/packages', async (req, res) => {
  try {
    const result = await db.query(`
      select
        id,
        name,
        price,
        duration,
        bandwidth,
        data,
        label
      from packages
      order by id asc
    `);

    return res.json({
      packages: result.rows,
      testMode,
      source: 'supabase/postgres packages table',
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('GET /api/packages error:', err.message);
    return res.status(500).json({ error: 'PACKAGE_LIST_FAILED', message: 'Unable to read package list from Supabase.' });
  }
});

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  let cleaned = phone.replace(/\s|\-/g, '').trim();
  if (!/^\+?[0-9]{9,13}$/.test(cleaned)) {
    return null;
  }

  if (cleaned.startsWith('+254')) {
    return '254' + cleaned.slice(4);
  }

  if (cleaned.startsWith('254')) {
    return cleaned;
  }

  if (cleaned.startsWith('0')) {
    return '254' + cleaned.slice(1);
  }

  return cleaned;
}

function normalizePalPlussState(status) {
  const map = {
    SUCCESS: 'PAID',
    FAILED: 'FAILED',
    CANCELLED: 'FAILED',
    EXPIRED: 'EXPIRED'
  };

  return map[status] || 'PENDING';
}

app.post('/api/payments/stk', async (req, res) => {
  const provider = (process.env.PAYMENT_PROVIDER || 'TEST').toUpperCase();

  const body = req.body || {};
  const amount = Number(body.amount || 0);
  const phone = normalizePhone(body.phone || body.phonenumber || body.phone_number);
  const accountReference = String(body.accountReference || body.reference || body.account_reference || '').trim();
  const transactionDesc = String(body.transactionDesc || body.transaction_desc || 'Payment').trim();
  const callbackUrl = String(body.callbackUrl || body.callback_url || '').trim();
  const channelId = body.channelId || body.channel_id || null;
  const credentialId = body.credential_id || null;

  if (provider === 'TEST' || testMode) {
    if (!amount || amount < 1 || !phone || !accountReference || !transactionDesc || !callbackUrl) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'amount, phone, accountReference, transactionDesc, and callbackUrl are required'
      });
    }

    const transactionId = crypto.randomUUID();
    const providerRequestId = `TEST-${crypto.randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

    return res.status(200).json({
      success: true,
      provider: 'TEST',
      testMode: true,
      data: {
        transactionId,
        tenantId: null,
        channelId: channelId || null,
        type: 'STK',
        status: 'PENDING',
        amount,
        currency: 'KES',
        phone,
        providerRequestId,
        providerCheckoutId: providerRequestId,
        accountReference,
        transactionDesc,
        callbackUrl
      },
      message: 'TEST MODE: PalPluss STK simulation accepted. No real provider request was executed.'
    });
  }

  if (!amount || amount < 1 || !phone || !accountReference || !transactionDesc || !callbackUrl) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'amount, phone, accountReference, transactionDesc, and callbackUrl are required'
    });
  }

  if (!process.env.PALPLUSS_BASE_URL || !process.env.PALPLUSS_API_KEY) {
    return res.status(503).json({
      error: 'PAYMENT_API_NOT_READY',
      message: 'PalPluss base URL and API key are not configured.'
    });
  }

  try {
    const base = process.env.PALPLUSS_BASE_URL.replace(/\/$/, '');
    const response = await fetch(`${base}/payments/stk`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + process.env.PALPLUSS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        phone,
        accountReference,
        transactionDesc,
        callbackUrl,
        channelId,
        credential_id: credentialId
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: payload.error || payload,
        requestId: payload.requestId || null
      });
    }

    const transactionId = payload.data?.transactionId || payload.transactionId || null;
    const providerRequestId = payload.data?.providerRequestId || payload.providerRequestId || null;

    return res.status(200).json({
      success: true,
      provider: 'PALPLUSS',
      data: payload.data || payload,
      transactionId,
      providerRequestId,
      callbackUrl,
      status: 'PENDING'
    });
  } catch (err) {
    console.error('POST /api/payments/stk error:', err.message);
    return res.status(500).json({
      error: 'PALPLUSS_STK_INIT_FAILED',
      message: 'Unable to reach the PalPluss STK endpoint.'
    });
  }
});

app.post('/api/orders', async (req, res) => {
  const packageId = req.body.packageId || req.body.package_id || req.body.package;
  const phone = normalizePhone(req.body.phone);

  if (!packageId || !phone) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'packageId and phone are required'
    });
  }

  if (!testMode) {
    return res.status(503).json({
      error: 'PAYMENT_API_NOT_READY',
      message: 'Real payment provider is not enabled in this build'
    });
  }

  try {
    const packageResult = await db.query(
      `select id, name, price, duration, bandwidth, data, label
       from packages
       where id = $1`,
      [packageId]
    );

    if (packageResult.rowCount === 0) {
      return res.status(404).json({
        error: 'PACKAGE_NOT_FOUND',
        message: 'Unknown package selected'
      });
    }

    const pkg = packageResult.rows[0];
    const reference = `SUPA-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const orderInsert = await db.query(
      `insert into orders
        (reference, package_id, amount, phone, status, payment_provider, provider_transaction_id, voucher_id, created_at, paid_at, updated_at)
       values
        ($1, $2, $3, $4, 'PENDING', 'TEST', $5, null, now(), null, now())
       returning
        id, reference, package_id, amount, phone, status, payment_provider, provider_transaction_id, voucher_id, created_at, paid_at, updated_at`,
      [reference, pkg.id, pkg.price, phone, `TEST-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`]
    );

    const order = orderInsert.rows[0];

    const voucherId = crypto.randomUUID();
    const voucherCode = `SUPA-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    await db.query(
      `insert into vouchers
        (id, code, package_id, status, order_id, created_at, assigned_at, used_at)
       values
        ($1, $2, $3, 'AVAILABLE', $4, now(), now(), null)
       on conflict (code) do nothing`,
      [voucherId, voucherCode, pkg.id, order.id]
    );

    await db.query(
      `update orders
       set voucher_id = $1,
           updated_at = now()
       where id = $2`,
      [voucherId, order.id]
    );

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        reference: order.reference,
        package_id: order.package_id,
        package_name: pkg.name,
        amount: order.amount,
        status: order.status,
        created_at: order.created_at,
        message: 'TEST MODE: STK Push accepted. No real PalPluss payment executed.'
      },
      voucher: {
        id: voucherId,
        code: voucherCode,
        package_id: pkg.id,
        status: 'AVAILABLE',
        assigned_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('POST /api/orders error:', err.message);
    return res.status(500).json({
      error: 'ORDER_CREATE_FAILED',
      message: 'Unable to create test order.'
    });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const idParam = req.params.id.trim();

  try {
    const result = await db.query(
      `select
         o.id,
         o.reference,
         o.package_id,
         p.name as package_name,
         o.amount,
         o.status,
         o.payment_provider,
         o.created_at,
         o.paid_at,
         o.updated_at
       from orders o
       join packages p on p.id = o.package_id
       where o.id::text = $1 or o.reference = $1
       limit 1`,
      [idParam]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order was not found.' });
    }

    const order = result.rows[0];

    return res.json({
      id: order.id,
      reference: order.reference,
      package_id: order.package_id,
      package_name: order.package_name,
      amount: order.amount,
      status: order.status,
      payment_provider: order.payment_provider,
      created_at: order.created_at,
      paid_at: order.paid_at,
      updated_at: order.updated_at
    });
  } catch (err) {
    console.error('GET /api/orders/:id error:', err.message);
    return res.status(500).json({ error: 'ORDER_LOOKUP_FAILED', message: 'Unable to retrieve order status.' });
  }
});

app.post('/api/webhooks/palpluss', async (req, res) => {
  const body = req.body || {};
  const eventType = body.event_type || body.event || 'transaction.updated';
  const transaction = body.transaction || {};
  const transactionId = transaction.id || null;
  const externalReference = transaction.external_reference || transaction.accountReference || transaction.reference || null;

  if (!transactionId) {
    return res.status(400).json({
      error: 'WEBHOOK_VALIDATION_ERROR',
      message: 'transaction.id is required for idempotent processing.'
    });
  }

  try {
    const existing = await db.query(
      `select id from orders where provider_transaction_id = $1 limit 1`,
      [transactionId]
    );

    if (existing.rowCount > 0) {
      return res.status(200).json({
        success: true,
        message: 'Duplicate PalPluss callback received and ignored.',
        idempotent: true
      });
    }

    const status = normalizePalPlussState(transaction.status || 'SUCCESS');
    const amount = Number(transaction.amount || 0);
    const paymentProvider = process.env.PAYMENT_PROVIDER || 'PALPLUSS';
    const providerTransactionId = transaction.provider_request_id || transaction.providerRequestId || transaction.id;

    await db.query(
      `update orders
       set status = $1,
           payment_provider = $2,
           provider_transaction_id = $3,
           amount = coalesce($4, amount),
           updated_at = now(),
           paid_at = case when $1 = 'PAID' then now() else paid_at end
       where reference = $5
       or reference = $6`,
      [status, paymentProvider, providerTransactionId, amount || null, externalReference, transaction.external_reference]
    );

    return res.status(200).json({
      success: true,
      message: 'PalPluss webhook accepted and processed.',
      eventType,
      transactionId,
      status
    });
  } catch (err) {
    console.error('POST /api/webhooks/palpluss error:', err.message);
    return res.status(500).json({
      error: 'WEBHOOK_PROCESSING_FAILED',
      message: 'Unable to process PalPluss callback.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`ANONYMIKECONNECT Phase 1 test backend running on http://localhost:${PORT}`);
  console.log(`TEST_MODE=${testMode}`);
});
