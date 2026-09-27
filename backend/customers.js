const { normalizeKenyanPhone } = require('./textsms');

function normalizeCustomerPhone(value) {
  return normalizeKenyanPhone(value);
}

async function upsertCustomer(db, { phone, name = null }) {
  const normalizedPhone = normalizeCustomerPhone(phone);
  const result = await db.query(
    `insert into customers (phone, name)
     values ($1, nullif($2, ''))
     on conflict (phone) do update set name = coalesce(nullif(excluded.name, ''), customers.name), updated_at = now()
     returning id, phone, name, created_at, updated_at`,
    [normalizedPhone, String(name || '').trim()]
  );
  return result.rows[0];
}

async function associateOrderCustomer(db, { orderId, phone, name = null }) {
  const customer = await upsertCustomer(db, { phone, name });
  await db.query('update orders set customer_id = $1, updated_at = now() where id = $2', [customer.id, orderId]);
  return customer;
}

module.exports = { normalizeCustomerPhone, upsertCustomer, associateOrderCustomer };
