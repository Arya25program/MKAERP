// ─────────────────────────────────────────────────────────────
//  MKA ERP — Express Backend (Railway / Node)
//  Run:  node server.js
//  Env:  DATABASE_URL  (PostgreSQL connection string)
// ─────────────────────────────────────────────────────────────

const express  = require('express');
const cors     = require('cors');
const { Pool } = require('pg');

const app  = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors());
app.use(express.json());

function ok(res, data)    { res.json(data); }
function fail(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: String(err) });
}


// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );
    if (!rows.length) return res.status(401).send('Invalid credentials');
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════

app.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role, active, new_user)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [name, email, password, role, active ?? true]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/users/:id', async (req, res) => {
  try {
    const { name, email, password, role, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET name=$1, email=$2, password=$3, role=$4, active=$5
       WHERE id=$6 RETURNING *`,
      [name, email, password, role, active, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.delete('/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});

app.post('/users/:id/complete-onboarding', async (req, res) => {
  try {
    await pool.query('UPDATE users SET new_user = false WHERE id = $1', [req.params.id]);
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════════════════════

app.get('/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/products', async (req, res) => {
  try {
    const { name, price, stock, category, added_date } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO products (name, price, stock, category, added_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, price, stock ?? 0, category ?? '', added_date ?? null]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/products/:id', async (req, res) => {
  try {
    const { name, price, stock, category } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, price=$2, stock=$3, category=$4
       WHERE id=$5 RETURNING *`,
      [name, price, stock, category, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/products/:id/threshold', async (req, res) => {
  try {
    const { reorder_threshold } = req.body;
    if (reorder_threshold === undefined || reorder_threshold === null || isNaN(Number(reorder_threshold))) {
      return res.status(400).json({ error: 'reorder_threshold must be a number' });
    }
    const { rows } = await pool.query(
      `UPDATE products SET reorder_threshold = $1 WHERE id = $2
       RETURNING id, name, reorder_threshold`,
      [Number(reorder_threshold), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.delete('/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  DOCUMENTS  (invoices + quotations)
// ═══════════════════════════════════════════════════════════════

app.get('/documents', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents ORDER BY created DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/documents', async (req, res) => {
  try {
    const {
      id, type, employee_id,
      customer_name, customer_phone, customer_address,
      customer_ref, mka_ref, company_name, promo_code,
      lpo_no, lpo_date,
      status, total, created, terms, items,
      discount_pct, discount_title
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO documents (
         id, type, employee_id,
         customer_name, customer_phone, customer_address,
         customer_ref, mka_ref, company_name, promo_code,
         lpo_no, lpo_date,
         status, total, created, terms, items,
         discount_pct, discount_title,
         accountant_sent
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,
         $18,$19, false
       ) RETURNING *`,
      [
        id, type, employee_id,
        customer_name, customer_phone, customer_address,
        customer_ref ?? '', mka_ref ?? '', company_name ?? '', promo_code ?? '',
        lpo_no ?? '', lpo_date ?? null,
        status, total, created,
        JSON.stringify(terms ?? {}), JSON.stringify(items ?? []),
        discount_pct ?? 0, discount_title ?? ''
      ]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/documents/:id/lpo', async (req, res) => {
  try {
    const { lpo_no, lpo_date, accountant_sent } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents
       SET lpo_no=$1, lpo_date=$2, accountant_sent=$3
       WHERE id=$4
       RETURNING id, lpo_no, lpo_date, accountant_sent`,
      [lpo_no ?? '', lpo_date || null, accountant_sent ?? true, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/documents/:id/approve', async (req, res) => {
  try {
    const { approved_by, approved_at } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents SET status='approved', approved_by=$1, approved_at=$2
       WHERE id=$3 RETURNING *`,
      [approved_by, approved_at ?? new Date().toISOString(), req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/documents/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents SET status='rejected', reject_reason=$1 WHERE id=$2 RETURNING *`,
      [reason, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/documents/:id/delivery-date', async (req, res) => {
  try {
    const { delivery_date } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents SET delivery_date=$1 WHERE id=$2 RETURNING *`,
      [delivery_date, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/documents/:id/delivery-done', async (req, res) => {
  try {
    const { delivery_done_date } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents SET delivery_done=true, delivery_done_date=$1 WHERE id=$2 RETURNING *`,
      [delivery_done_date, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.delete('/documents/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  LEADS  (powers the "Customers" page)
//
//  ⚠️  REQUIRED one-time DB migration (run once in Supabase SQL editor):
//
//    ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_product_id_fkey;
//    ALTER TABLE leads DROP COLUMN IF EXISTS product_id;
//    ALTER TABLE leads ADD COLUMN IF NOT EXISTS product TEXT DEFAULT '';
//
// ═══════════════════════════════════════════════════════════════

app.get('/leads', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/leads', async (req, res) => {
  try {
    const { name, phone, source, product, status, notes, address, employee_id, created } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO leads (name, phone, source, product, status, notes, address, employee_id, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        name, phone ?? '', source ?? 'Instagram',
        product ?? '',          // product name as text
        status ?? 'new',
        notes ?? '', address ?? '',
        employee_id,
        created ?? new Date().toISOString().split('T')[0]
      ]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/leads/:id', async (req, res) => {
  try {
    const { name, phone, source, product, status, notes, address } = req.body;
    const { rows } = await pool.query(
      `UPDATE leads SET name=$1, phone=$2, source=$3, product=$4,
       status=$5, notes=$6, address=$7 WHERE id=$8 RETURNING *`,
      [name, phone ?? '', source ?? '', product ?? '', status ?? 'new', notes ?? '', address ?? '', req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.delete('/leads/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  EXPENDITURE
// ═══════════════════════════════════════════════════════════════

app.get('/expenditure', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenditure ORDER BY created_at DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/expenditure', async (req, res) => {
  try {
    const { user_id, amount, expense_type, description, used_for, car_plate, proof_url, is_petty_cash } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO expenditure (user_id, amount, expense_type, description, used_for, car_plate, proof_url, is_petty_cash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
      [user_id, amount, expense_type, description, used_for, car_plate, proof_url, is_petty_cash ?? false]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/expenditure/:id', async (req, res) => {
  try {
    const { user_id, amount, expense_type, description, used_for, car_plate, proof_url, is_petty_cash } = req.body;
    const { rows } = await pool.query(
      `UPDATE expenditure SET user_id=$1,amount=$2,expense_type=$3,description=$4,
       used_for=$5,car_plate=$6,proof_url=$7,is_petty_cash=$8 WHERE id=$9 RETURNING *`,
      [user_id, amount, expense_type, description, used_for, car_plate, proof_url, is_petty_cash, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/expenditure/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    const { rows } = await pool.query(
      `UPDATE expenditure SET status='approved', approved_by=$1 WHERE id=$2 RETURNING *`,
      [approved_by, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.patch('/expenditure/:id/reject', async (req, res) => {
  try {
    const { reason, approved_by } = req.body;
    const { rows } = await pool.query(
      `UPDATE expenditure SET status='rejected', reject_reason=$1, approved_by=$2 WHERE id=$3 RETURNING *`,
      [reason, approved_by, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

app.delete('/expenditure/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenditure WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════

app.get('/audit-log', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

app.post('/audit-log', async (req, res) => {
  try {
    const { user_id, user_name, category, action, meta, time_label, date_label, ts } = req.body;
    await pool.query(
      `INSERT INTO audit_log (user_id, user_name, category, action, meta, time_label, date_label, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user_id, user_name, category, action, meta ? JSON.stringify(meta) : null, time_label, date_label, ts]
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
});

// ═══════════════════════════════════════════════════════════════
//  DEMAND TRACKER
// ═══════════════════════════════════════════════════════════════
 
app.get('/demand-tracker', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM demand_tracker WHERE converted = false ORDER BY created_at DESC'
    );
    ok(res, rows);
  } catch (e) { fail(res, e); }
});
 
app.post('/demand-tracker', async (req, res) => {
  try {
    const { customer_name, phone, product_id, product_name } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO demand_tracker (customer_name, phone, product_id, product_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [customer_name, phone ?? '', product_id, product_name]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});
 
app.delete('/demand-tracker/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM demand_tracker WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MKA ERP server running on port ${PORT}`));
