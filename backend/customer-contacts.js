function normalizeCustomerPhone(value) {
  const digits = String(value || '').replace(/[^0-9+]/g, '');
  if (!/^\+?[0-9]{9,13}$/.test(digits)) return null;
  if (digits.startsWith('+254')) return `254${digits.slice(4)}`;
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
}

async function findOrCreateCustomer(db, { phone, name = null, client = db } = {}) {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) throw new Error('A valid customer phone number is required.');
  const normalizedName = name == null || String(name).trim() === '' ? null : String(name).trim().slice(0, 160);
  const result = await client.query(`
    INSERT INTO customers (phone, name)
    VALUES ($1, $2)
    ON CONFLICT (phone) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name), updated_at = now()
    RETURNING id, phone, name, created_at, updated_at`, [normalizedPhone, normalizedName]);
  return result.rows[0];
}

async function associateOrderCustomer(db, order) {
  const customer = await findOrCreateCustomer(db, { phone: order.phone, name: order.customer_name });
  await db.query('UPDATE orders SET customer_id = $1, updated_at = now() WHERE id = $2 AND customer_id IS NULL', [customer.id, order.id]);
  return customer;
}

module.exports = { normalizeCustomerPhone, findOrCreateCustomer, associateOrderCustomer };
