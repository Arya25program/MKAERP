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

// ─── DB migrations (run once on deploy) ───────────────────────
// ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_threshold INTEGER DEFAULT 10;
// ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── Helper ───────────────────────────────────────────────────
function ok(res, data)    { res.json(data); }
function fail(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: String(err) });
}


// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════

// POST /login
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

// GET /users
app.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /users
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

// PATCH /users/:id
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

// DELETE /users/:id
app.delete('/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});

// POST /users/:id/complete-onboarding
app.post('/users/:id/complete-onboarding', async (req, res) => {
  try {
    await pool.query('UPDATE users SET new_user = false WHERE id = $1', [req.params.id]);
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════════════════════

// GET /products
app.get('/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /products
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

// PATCH /products/:id  — full edit (admin/owner)
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

// PATCH /products/:id/threshold  — set reorder threshold only (owner & admin)
// The frontend enforces role-based access; the backend persists it.
// SQL: ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_threshold INTEGER DEFAULT 10;
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

// DELETE /products/:id
app.delete('/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  DOCUMENTS  (invoices + quotations)
// ═══════════════════════════════════════════════════════════════

// GET /documents
app.get('/documents', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents ORDER BY created DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /documents  — create invoice or quotation
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
        customer_ref, mka_ref, company_name, promo_code,
        lpo_no ?? '', lpo_date ?? null,
        status, total, created,
        JSON.stringify(terms), JSON.stringify(items),
        discount_pct ?? 0, discount_title ?? ''
      ]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /documents/:id/lpo
//  Called by the accountant when they click "Generate & Print".
//  Saves LPO No, LPO Date, and marks accountant_sent = true.
// ─────────────────────────────────────────────────────────────
app.patch('/documents/:id/lpo', async (req, res) => {
  try {
    const { lpo_no, lpo_date, accountant_sent } = req.body;

    const { rows } = await pool.query(
      `UPDATE documents
       SET lpo_no          = $1,
           lpo_date        = $2,
           accountant_sent = $3
       WHERE id = $4
       RETURNING id, lpo_no, lpo_date, accountant_sent`,
      [
        lpo_no  ?? '',
        lpo_date || null,   // store NULL if empty string
        accountant_sent ?? true,
        req.params.id
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Document not found' });
    }

    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// PATCH /documents/:id/approve
app.patch('/documents/:id/approve', async (req, res) => {
  try {
    const { approved_by, approved_at } = req.body;
    const { rows } = await pool.query(
      `UPDATE documents
       SET status='approved', approved_by=$1, approved_at=$2
       WHERE id=$3 RETURNING *`,
      [approved_by, approved_at ?? new Date().toISOString(), req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// PATCH /documents/:id/reject
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

// PATCH /documents/:id/delivery-date
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

// PATCH /documents/:id/delivery-done
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

// DELETE /documents/:id
app.delete('/documents/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  LEADS
// ═══════════════════════════════════════════════════════════════

// GET /leads
app.get('/leads', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /leads
app.post('/leads', async (req, res) => {
  try {
    const { name, phone, source, product, status, notes, address, employee_id, created } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO leads (name, phone, source, product, status, notes, address, employee_id, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, phone, source, product, status, notes, address, employee_id, created]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// PATCH /leads/:id
app.patch('/leads/:id', async (req, res) => {
  try {
    const { name, phone, source, product, status, notes, address } = req.body;
    const { rows } = await pool.query(
      `UPDATE leads SET name=$1,phone=$2,source=$3,product=$4,status=$5,notes=$6,address=$7
       WHERE id=$8 RETURNING *`,
      [name, phone, source, product, status, notes, address, req.params.id]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// DELETE /leads/:id
app.delete('/leads/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  EXPENDITURE
// ═══════════════════════════════════════════════════════════════

// GET /expenditure
app.get('/expenditure', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenditure ORDER BY created_at DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /expenditure
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

// PATCH /expenditure/:id
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

// PATCH /expenditure/:id/approve
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

// PATCH /expenditure/:id/reject
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

// DELETE /expenditure/:id
app.delete('/expenditure/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenditure WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════

// GET /audit-log
app.get('/audit-log', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// POST /audit-log
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
//  MAIL ALERTS
// ═══════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');
 
// ─── In-memory spam guard: track last send time per sender ───
const lastDigestSent = {}; // { adminEmail: timestamp }
const DIGEST_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between sends
 
// POST /send-approval-digest
// Body: { html, invoiceCount, critCount, highCount, sentBy, sentAt }
// Access: admin only (enforced in frontend; double-checked here by audit log)
app.post('/send-approval-digest', async (req, res) => {
  try {
    const { html, invoiceCount, critCount, highCount, sentBy, sentAt } = req.body;
 
    if (!html || !invoiceCount) {
      return res.status(400).json({ error: 'html and invoiceCount are required' });
    }
 
    // ── Spam guard ──────────────────────────────────────────
    const senderKey = sentBy || 'unknown';
    const now = Date.now();
    const last = lastDigestSent[senderKey] || 0;
    if (now - last < DIGEST_COOLDOWN_MS) {
      const waitMin = Math.ceil((DIGEST_COOLDOWN_MS - (now - last)) / 60000);
      return res.status(429).json({ error: `Digest already sent recently. Try again in ${waitMin} minute(s).` });
    }
 
    // ── Send via Nodemailer ──────────────────────────────────
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
 
    const ownerEmail = process.env.OWNER_EMAIL;
    if (!ownerEmail) {
      return res.status(500).json({ error: 'OWNER_EMAIL environment variable not set on server' });
    }
 
    const subject = `[MKA ERP] ${invoiceCount} Invoice${invoiceCount !== 1 ? 's' : ''} Awaiting Approval`
      + (critCount > 0 ? ` — ${critCount} Critical` : '');
 
    await transporter.sendMail({
      from: `"MKA ERP System" <${process.env.SMTP_USER}>`,
      to:   ownerEmail,
      subject,
      html,
    });
 
    // ── Update spam guard & log ──────────────────────────────
    lastDigestSent[senderKey] = now;
 
    // Persist to audit log
    await pool.query(
      `INSERT INTO audit_log (user_name, category, action, meta, time_label, date_label, ts)
       VALUES ($1, 'approval', $2, $3, $4, $5, $6)`,
      [
        sentBy || 'admin',
        `Approval digest emailed to owner — ${invoiceCount} pending (${critCount} critical, ${highCount} high)`,
        JSON.stringify({ invoiceCount, critCount, highCount, to: ownerEmail }),
        new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        new Date().toLocaleDateString('en-GB'),
        new Date().toISOString(),
      ]
    );
 
    ok(res, { sent: true, to: ownerEmail, invoiceCount });
  } catch (e) {
    fail(res, e);
  }
});


// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MKA ERP server running on port ${PORT}`));
