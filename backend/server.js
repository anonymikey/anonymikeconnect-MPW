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
        p.id,
        p.name,
        p.price,
        p.duration,
        p.bandwidth,
        p.data,
        p.label,
        count(v.id) filter (where v.status = 'AVAILABLE')::int as available_vouchers,
        (count(v.id) filter (where v.status = 'AVAILABLE') > 0) as available
      from packages p
      left join vouchers v on v.package_id = p.id
      group by p.id, p.name, p.price, p.duration, p.bandwidth, p.data, p.label
      order by p.id asc
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

function getDefaultCallbackUrl() {
  if (process.env.CALLBACK_URL) {
    return process.env.CALLBACK_URL;
  }

  if (process.env.PALPLUSS_CALLBACK_URL) {
    return process.env.PALPLUSS_CALLBACK_URL;
  }

  return 'https://supalan.anonymiketech.space/api/webhooks/palpluss';
}

async function sendPalPlussStk(payload) {
  const provider = (process.env.PAYMENT_PROVIDER || 'TEST').toUpperCase();

  if (provider === 'TEST' || testMode) {
    const transactionId = crypto.randomUUID();
    const providerRequestId = `TEST-${crypto.randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

    return {
      statusCode: 200,
      success: true,
      provider: 'TEST',
      testMode: true,
      data: {
        transactionId,
        tenantId: null,
        channelId: payload.channelId || null,
        type: 'STK',
        status: 'PENDING',
        amount: payload.amount,
        currency: 'KES',
        phone: payload.phone,
        providerRequestId,
        providerCheckoutId: providerRequestId,
        accountReference: payload.accountReference,
        transactionDesc: payload.transactionDesc,
        callbackUrl: payload.callbackUrl
      },
      message: 'TEST MODE: PalPluss STK simulation accepted. No real provider request was executed.'
    };
  }

  if (!process.env.PALPLUSS_BASE_URL || !process.env.PALPLUSS_API_KEY) {
    return {
      statusCode: 503,
      success: false,
      error: 'PAYMENT_API_NOT_READY',
      message: 'PalPluss base URL and API key are not configured.'
    };
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
        amount: payload.amount,
        phone: payload.phone,
        accountReference: payload.accountReference,
        transactionDesc: payload.transactionDesc,
        callbackUrl: payload.callbackUrl,
        channelId: payload.channelId || null
      })
    });

    const raw = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        success: false,
        error: raw.error || raw,
        requestId: raw.requestId || null
      };
    }

    const transactionId = raw.data?.transactionId || raw.transactionId || null;
    const providerRequestId = raw.data?.providerRequestId || raw.providerRequestId || null;

    return {
      statusCode: 200,
      success: true,
      provider: 'PALPLUSS',
      data: raw.data || raw,
      transactionId,
      providerRequestId,
      callbackUrl: payload.callbackUrl,
      status: 'PENDING'
    };
  } catch (err) {
    console.error('PalPluss STK helper error:', err.message);
    return {
      statusCode: 500,
      success: false,
      error: 'PALPLUSS_STK_INIT_FAILED',
      message: 'Unable to reach the PalPluss STK endpoint.'
    };
  }
}

app.post('/api/payments/stk', async (req, res) => {
  const body = req.body || {};
  const amount = Number(body.amount || 0);
  const phone = normalizePhone(body.phone || body.phonenumber || body.phone_number);
  const accountReference = String(body.accountReference || body.reference || body.account_reference || '').trim();
  const transactionDesc = String(body.transactionDesc || body.transaction_desc || 'Payment').trim();
  const callbackUrl = String(body.callbackUrl || body.callback_url || getDefaultCallbackUrl()).trim();
  const channelId = body.channelId || body.channel_id || null;

  if (!amount || amount < 1 || !phone || !accountReference || !transactionDesc || !callbackUrl) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'amount, phone, accountReference, transactionDesc, and callbackUrl are required'
    });
  }

  const result = await sendPalPlussStk({
    amount,
    phone,
    accountReference,
    transactionDesc,
    callbackUrl,
    channelId
  });

  if (!result.success) {
    return res.status(result.statusCode || 500).json({
      success: false,
      error: result.error || 'PAYMENT_FAILED',
      message: result.message || 'Unable to initiate STK request.'
    });
  }

  return res.status(result.statusCode || 200).json(result);
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
    const inventoryResult = await db.query(
      `select count(*)::int as available
       from vouchers
       where package_id = $1 and status = 'AVAILABLE'`,
      [pkg.id]
    );

    if (inventoryResult.rows[0].available < 1) {
      return res.status(409).json({
        error: 'PACKAGE_UNAVAILABLE',
        message: 'This package is currently unavailable. Please choose another package.'
      });
    }

    const reference = `SUPA-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const provider = (process.env.PAYMENT_PROVIDER || 'PALPLUSS').toUpperCase();

    const orderInsert = await db.query(
      `insert into orders
        (reference, package_id, amount, phone, status, payment_provider, provider_transaction_id, voucher_id, created_at, paid_at, updated_at)
       values
        ($1, $2, $3, $4, 'PENDING', $5, null, null, now(), null, now())
       returning
        id, reference, package_id, amount, phone, status, payment_provider, provider_transaction_id, voucher_id, created_at, paid_at, updated_at`,
      [reference, pkg.id, pkg.price, phone, provider]
    );

    const order = orderInsert.rows[0];

    const callbackUrl = getDefaultCallbackUrl();
    const transactionDesc = `Payment for ${pkg.name}`;

    const stkResult = await sendPalPlussStk({
      amount: pkg.price,
      phone,
      accountReference: order.reference,
      transactionDesc,
      callbackUrl,
      channelId: req.body.channelId || req.body.channel_id || null
    });

    if (!stkResult.success) {
      await db.query(
        `update orders
         set status = 'FAILED',
             payment_provider = $1,
             updated_at = now()
         where id = $2`,
        [provider, order.id]
      );

      return res.status(stkResult.statusCode || 500).json({
        success: false,
        error: stkResult.error || 'PAYMENT_INIT_FAILED',
        message: stkResult.message || 'Unable to initialize PalPluss STK push.'
      });
    }

    const providerRequestId = stkResult.providerRequestId || stkResult.transactionId || null;

    await db.query(
      `update orders
       set payment_provider = $1,
           provider_transaction_id = $2,
           updated_at = now()
       where id = $3`,
      [provider, providerRequestId, order.id]
    );

    let responseStatus = order.status;
    let assignedVoucher = null;

    if (testMode) {
      const fulfillmentResult = await db.query(
        `with next_voucher as (
           select id, code
           from vouchers
           where package_id = $1 and status = 'AVAILABLE'
           order by created_at asc
           limit 1
           for update skip locked
         ), claimed as (
           update vouchers v
           set status = 'ASSIGNED', order_id = $2, assigned_at = now()
           from next_voucher n
           where v.id = n.id and v.status = 'AVAILABLE'
           returning v.id, v.code
         )
         update orders o
         set status = 'VOUCHER_ASSIGNED', voucher_id = claimed.id, paid_at = now(), updated_at = now()
         from claimed
         where o.id = $2 and o.voucher_id is null
         returning claimed.code`,
        [pkg.id, order.id]
      );
      if (fulfillmentResult.rowCount > 0) {
        responseStatus = 'VOUCHER_ASSIGNED';
        assignedVoucher = fulfillmentResult.rows[0].code;
      }
    }

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        reference: order.reference,
        package_id: order.package_id,
        package_name: pkg.name,
        amount: order.amount,
        status: responseStatus,
        created_at: order.created_at,
        message: assignedVoucher
          ? 'TEST MODE: payment verified and voucher assigned.'
          : 'STK Push accepted. Complete the M-PESA prompt on your phone.'
      },
      provider: stkResult.provider || 'PALPLUSS',
      providerRequestId,
      transactionId: stkResult.transactionId || null,
      voucher: assignedVoucher ? { code: assignedVoucher } : null
    });
  } catch (err) {
    console.error('POST /api/orders error:', err.message);
    return res.status(500).json({
      error: 'ORDER_CREATE_FAILED',
      message: 'Unable to create order.'
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
         o.voucher_id,
         v.code as voucher_code,
         o.created_at,
         o.paid_at,
         o.updated_at
       from orders o
       join packages p on p.id = o.package_id
       left join vouchers v on v.id::text = o.voucher_id
       where o.id::text = $1 or o.reference = $1
       limit 1`,
      [idParam]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order was not found.' });
    }

    const order = result.rows[0];

    // Only expose the voucher code once the payment is verified and a voucher assigned.
    const voucherCode = order.status === 'VOUCHER_ASSIGNED' ? order.voucher_code : null;

    return res.json({
      id: order.id,
      reference: order.reference,
      package_id: order.package_id,
      package_name: order.package_name,
      amount: order.amount,
      status: order.status,
      payment_provider: order.payment_provider,
      voucher_code: voucherCode,
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

  if (!transactionId || !externalReference) {
    return res.status(400).json({
      error: 'WEBHOOK_VALIDATION_ERROR',
      message: 'transaction.id and transaction.external_reference are required.'
    });
  }

  try {
    // Do not use provider_transaction_id as the duplicate guard here. The initial
    // order stores PalPluss provider_request_id, while callbacks identify the
    // transaction with a different UUID. The locked order lookup below is the
    // authoritative idempotency check and also handles callback races safely.
    const status = normalizePalPlussState(
      transaction.status || (eventType === 'transaction.success' ? 'SUCCESS' : 'PENDING')
    );
    const amount = Number(transaction.amount || 0);
    const paymentProvider = process.env.PAYMENT_PROVIDER || 'PALPLUSS';
    const providerTransactionId = transaction.id;

    // All state changes run inside one transaction with the order row locked,
    // so concurrent or replayed callbacks can never assign more than one voucher.
    const client = await db.connect();
    let assignedVoucherCode = null;
    let finalStatus = status;

    try {
      await client.query('begin');

      const orderResult = await client.query(
        `select id, reference, package_id, voucher_id, status
         from orders
         where reference = $1
         limit 1
         for update`,
        [externalReference]
      );

      if (orderResult.rowCount === 0) {
        await client.query('rollback');
        return res.status(404).json({
          error: 'ORDER_NOT_FOUND',
          message: 'Order reference from PalPluss callback was not found locally.'
        });
      }

      const order = orderResult.rows[0];

      // Idempotency: once a voucher has been assigned the order is terminal.
      // Re-delivered success callbacks are acknowledged without side effects.
      if (order.voucher_id || order.status === 'VOUCHER_ASSIGNED') {
        await client.query('rollback');
        return res.status(200).json({
          success: true,
          message: 'Order already fulfilled. Duplicate callback ignored.',
          idempotent: true,
          status: 'VOUCHER_ASSIGNED'
        });
      }

      await client.query(
        `update orders
         set status = $1,
             payment_provider = $2,
             provider_transaction_id = $3,
             amount = coalesce($4, amount),
             updated_at = now(),
             paid_at = case when $1 = 'PAID' then now() else paid_at end
         where id = $5`,
        [status, paymentProvider, providerTransactionId, amount || null, order.id]
      );

      // Only a verified successful payment ever leads to voucher assignment.
      if (status === 'PAID') {
        const availableVoucher = await client.query(
          `select id, code
           from vouchers
           where package_id = $1 and status = 'AVAILABLE'
           order by created_at asc
           limit 1
           for update skip locked`,
          [order.package_id]
        );

        if (availableVoucher.rowCount > 0) {
          const voucher = availableVoucher.rows[0];

          await client.query(
            `update vouchers
             set status = 'ASSIGNED',
                 order_id = $1,
                 assigned_at = now(),
                 used_at = null
             where id = $2 and status = 'AVAILABLE'`,
            [order.id, voucher.id]
          );

          await client.query(
            `update orders
             set voucher_id = $2,
                 status = 'VOUCHER_ASSIGNED',
                 updated_at = now()
             where id = $1 and voucher_id is null`,
            [order.id, voucher.id]
          );

          assignedVoucherCode = voucher.code;
          finalStatus = 'VOUCHER_ASSIGNED';
        } else {
          console.warn(`No AVAILABLE voucher in inventory for package ${order.package_id} (order ${order.reference}).`);
        }
      }

      await client.query('commit');
    } catch (txErr) {
      await client.query('rollback').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    return res.status(200).json({
      success: true,
      message: 'PalPluss webhook accepted and processed.',
      eventType,
      transactionId,
      status: finalStatus,
      voucherAssigned: Boolean(assignedVoucherCode)
    });
  } catch (err) {
    console.error('POST /api/webhooks/palpluss error:', err.message);
    return res.status(500).json({
      error: 'WEBHOOK_PROCESSING_FAILED',
      message: 'Unable to process PalPluss callback.'
    });
  }
});

// ---------------------------------------------------------------------------
// Admin: voucher inventory management
// ---------------------------------------------------------------------------

// Constant-time comparison so the admin token cannot be guessed via timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    return res.status(503).json({
      error: 'ADMIN_NOT_CONFIGURED',
      message: 'ADMIN_TOKEN is not set on the server. Add it in Render environment settings.'
    });
  }

  const provided = req.get('x-admin-token') || '';
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing admin token.' });
  }

  return next();
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(rootDir, 'admin.html'));
});

// Lightweight probe the admin page uses to validate the token before loading.
app.get('/api/admin/session', requireAdmin, (req, res) => {
  return res.json({ ok: true });
});

// Inventory summary grouped by package, plus the package list for the form.
app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      select
        p.id,
        p.name,
        p.price,
        count(v.id) filter (where v.status = 'AVAILABLE')       as available,
        count(v.id) filter (where v.status = 'ASSIGNED')        as assigned,
        count(v.id) filter (where v.status = 'USED')            as used,
        count(v.id) filter (where v.status = 'BLOCKED')         as blocked,
        count(v.id)                                             as total
      from packages p
      left join vouchers v on v.package_id = p.id
      group by p.id, p.name, p.price
      order by p.price desc
    `);

    return res.json({
      packages: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        price: Number(row.price),
        available: Number(row.available),
        assigned: Number(row.assigned),
        used: Number(row.used),
        blocked: Number(row.blocked),
        total: Number(row.total)
      })),
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('GET /api/admin/summary error:', err.message);
    return res.status(500).json({ error: 'SUMMARY_FAILED', message: 'Unable to load voucher inventory.' });
  }
});

// Recent vouchers, optionally filtered by package and/or status.
app.get('/api/admin/vouchers', requireAdmin, async (req, res) => {
  const packageId = (req.query.packageId || '').toString().trim();
  const status = (req.query.status || '').toString().trim().toUpperCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const conditions = [];
  const params = [];
  let i = 1;

  if (packageId) {
    conditions.push(`v.package_id = $${i++}`);
    params.push(packageId);
  }
  if (status) {
    conditions.push(`v.status = $${i++}`);
    params.push(status);
  }

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  params.push(limit);

  try {
    const result = await db.query(
      `select
         v.id,
         v.code,
         v.package_id,
         p.name as package_name,
         v.status,
         v.order_id,
         o.reference as order_reference,
         v.created_at,
         v.assigned_at,
         v.used_at
       from vouchers v
       join packages p on p.id = v.package_id
       left join orders o on o.id = v.order_id
       ${where}
       order by v.created_at desc
       limit $${i}`,
      params
    );

    return res.json({ vouchers: result.rows });
  } catch (err) {
    console.error('GET /api/admin/vouchers error:', err.message);
    return res.status(500).json({ error: 'VOUCHER_LIST_FAILED', message: 'Unable to load vouchers.' });
  }
});

// Bulk import voucher codes for a specific package.
// Codes exported from MyPublicWiFi are pasted or uploaded, deduped, and inserted.
app.post('/api/admin/vouchers', requireAdmin, async (req, res) => {
  const packageId = (req.body.packageId || req.body.package_id || '').toString().trim();
  const rawCodes = Array.isArray(req.body.codes) ? req.body.codes : [];

  if (!packageId) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'packageId is required.' });
  }

  // Normalize: trim, drop empties, uppercase, and dedupe within the request.
  const seen = new Set();
  const codes = [];
  for (const entry of rawCodes) {
    const code = String(entry || '').trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }

  if (codes.length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one voucher code is required.' });
  }

  if (codes.length > 5000) {
    return res.status(400).json({ error: 'TOO_MANY_CODES', message: 'Import at most 5000 codes per request.' });
  }

  try {
    const pkg = await db.query('select id, name from packages where id = $1', [packageId]);
    if (pkg.rowCount === 0) {
      return res.status(404).json({ error: 'PACKAGE_NOT_FOUND', message: 'Unknown package selected.' });
    }

    const valuePlaceholders = [];
    const values = [];
    let i = 1;
    for (const code of codes) {
      valuePlaceholders.push(`($${i++}, $${i++}, $${i++}, 'AVAILABLE', now())`);
      values.push(crypto.randomUUID(), code, packageId);
    }

    // Codes already present (any package) are skipped via the unique(code) constraint.
    const insertResult = await db.query(
      `insert into vouchers (id, code, package_id, status, created_at)
       values ${valuePlaceholders.join(', ')}
       on conflict (code) do nothing
       returning code`,
      values
    );

    const inserted = insertResult.rowCount;
    const skipped = codes.length - inserted;

    return res.status(201).json({
      success: true,
      packageId,
      packageName: pkg.rows[0].name,
      received: codes.length,
      inserted,
      skipped,
      message: `${inserted} voucher(s) added to ${pkg.rows[0].name}. ${skipped} duplicate(s) skipped.`
    });
  } catch (err) {
    console.error('POST /api/admin/vouchers error:', err.message);
    return res.status(500).json({ error: 'VOUCHER_IMPORT_FAILED', message: 'Unable to import vouchers.' });
  }
});

// Remove a voucher that has not yet been assigned (for correcting bad imports).
app.delete('/api/admin/vouchers/:id', requireAdmin, async (req, res) => {
  const id = req.params.id.trim();

  try {
    const result = await db.query(
      `delete from vouchers
       where id::text = $1 and status = 'AVAILABLE'
       returning id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: 'DELETE_BLOCKED',
        message: 'Only AVAILABLE (unassigned) vouchers can be deleted.'
      });
    }

    return res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('DELETE /api/admin/vouchers/:id error:', err.message);
    return res.status(500).json({ error: 'VOUCHER_DELETE_FAILED', message: 'Unable to delete voucher.' });
  }
});

app.listen(PORT, () => {
  console.log(`ANONYMIKECONNECT Phase 1 test backend running on http://localhost:${PORT}`);
  console.log(`TEST_MODE=${testMode}`);
});
