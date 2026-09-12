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

  const cleaned = phone.replace(/\s|\-/g, '').trim();
  if (!/^\+?[0-9]{9,13}$/.test(cleaned)) {
    return null;
  }

  return cleaned.startsWith('+') ? cleaned : cleaned;
}

app.post('/api/orders', async (req, res) => {
  const packageId = req.body.packageId || req.body.package_id;
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

app.post('/api/webhooks/palpluss', (req, res) => {
  return res.status(202).json({
    success: true,
    message: 'PalPluss webhook endpoint is ready for Phase 2 integration.',
    received: req.body || {}
  });
});

app.listen(PORT, () => {
  console.log(`ANONYMIKECONNECT Phase 1 test backend running on http://localhost:${PORT}`);
  console.log(`TEST_MODE=${testMode}`);
});
