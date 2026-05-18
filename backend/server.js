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
//  Login route
// ═══════════════════════════════════════════════════════════════
 
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
 
    const lowerEmail = email.toLowerCase().trim();
    const now        = Date.now();
    const tracker    = failedAttempts[lowerEmail] || { count: 0, firstFail: null, lockedUntil: null, postLockFails: 0, postLockFirst: null };
 
    // ── Check if account is permanently blocked ──────────────
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [lowerEmail]);
    const user = userRows[0];
 
    if (user && user.active === false) {
      return res.status(403).json({ error: 'Account locked. Please contact your administrator.' });
    }
 
    // ── Check if currently in lockout window ─────────────────
    if (tracker.lockedUntil && now < tracker.lockedUntil) {
      const remaining = Math.ceil((tracker.lockedUntil - now) / 60000);
      return res.status(429).json({
        error: `Account temporarily locked due to too many failed attempts. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`
      });
    }
 
    // ── If lockout just expired, reset first-phase counter ───
    if (tracker.lockedUntil && now >= tracker.lockedUntil) {
      tracker.count = 0;
      tracker.firstFail = null;
      // Keep postLockFails tracking active
    }
 
    // ── Verify credentials ───────────────────────────────────
    if (!user || user.password !== password) {
      // Increment failure counter
      tracker.firstFail = tracker.firstFail || now;
      tracker.count = (tracker.count || 0) + 1;
 
      if (tracker.lockedUntil && now >= tracker.lockedUntil) {
        // We're in the post-lockout window — track secondary failures
        tracker.postLockFirst = tracker.postLockFirst || now;
        tracker.postLockFails = (tracker.postLockFails || 0) + 1;
 
        if (tracker.postLockFails >= SECOND_FAIL) {
          // ── PERMANENT BLOCK — set active=false ────────────
          if (user) {
            await pool.query('UPDATE users SET active = false WHERE id = $1', [user.id]);
 
            // Log security event for admin notification
            const ts  = new Date().toISOString();
            const now2 = new Date();
            const hh   = now2.getHours();
            const mm   = String(now2.getMinutes()).padStart(2,'0');
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const time = `${hh % 12 || 12}:${mm}${ampm}`;
            const date = `${String(now2.getDate()).padStart(2,'0')}/${String(now2.getMonth()+1).padStart(2,'0')}/${now2.getFullYear()}`;
 
            await pool.query(
              `INSERT INTO audit_log (user_id, user_name, category, action, meta, time_label, date_label, ts)
               VALUES ($1, $2, 'security', $3, $4::jsonb, $5, $6, $7)`,
              [
                user.id,
                user.name,
                `ACCOUNT LOCKED: ${user.name} (${user.email}) — account disabled after repeated failed login attempts`,
                JSON.stringify({ email: user.email, locked: true, attempts: tracker.count + tracker.postLockFails }),
                time,
                date,
                ts
              ]
            );
          }
 
          failedAttempts[lowerEmail] = tracker;
          return res.status(403).json({ error: 'Account permanently locked due to repeated failed attempts. Contact your administrator.' });
        }
      } else if (tracker.count >= FAIL_LIMIT) {
        // ── TEMPORARY LOCKOUT ─────────────────────────────────
        tracker.lockedUntil = now + LOCKOUT_MINUTES * 60 * 1000;
        tracker.postLockFails = 0;
        tracker.postLockFirst = null;
 
        if (user) {
          const ts  = new Date().toISOString();
          const now2 = new Date();
          const hh   = now2.getHours();
          const mm   = String(now2.getMinutes()).padStart(2,'0');
          const ampm = hh >= 12 ? 'PM' : 'AM';
          const time = `${hh % 12 || 12}:${mm}${ampm}`;
          const date = `${String(now2.getDate()).padStart(2,'0')}/${String(now2.getMonth()+1).padStart(2,'0')}/${now2.getFullYear()}`;
 
          await pool.query(
            `INSERT INTO audit_log (user_id, user_name, category, action, meta, time_label, date_label, ts)
             VALUES ($1, $2, 'security', $3, $4::jsonb, $5, $6, $7)`,
            [
              user.id,
              user.name,
              `Failed login attempt: ${user.name} (${user.email}) — locked for 15 minutes after ${FAIL_LIMIT} failed attempts`,
              JSON.stringify({ email: user.email, locked: false, attempts: tracker.count, lockout_until: new Date(tracker.lockedUntil).toISOString() }),
              time,
              date,
              ts
            ]
          );
        }
 
        failedAttempts[lowerEmail] = tracker;
        return res.status(429).json({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`
        });
      }
 
      failedAttempts[lowerEmail] = tracker;
      const remaining = FAIL_LIMIT - tracker.count;
      return res.status(401).json({
        error: `Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before temporary lockout.`
      });
    }
 
    // ── SUCCESS — clear tracker, return user (without password) ──
    delete failedAttempts[lowerEmail];
    const { password: _pw, ...safeUser } = user;
    return res.json(safeUser);
 
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
    const { user_id, user_name, category, action, meta, time_label, date_label, ts, target_user_id } = req.body;
    await pool.query(
      `INSERT INTO audit_log (user_id, user_name, category, action, meta, time_label, date_label, ts, target_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user_id, user_name, category, action, meta ? JSON.stringify(meta) : null, time_label, date_label, ts, target_user_id || null]
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
});

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

app.get('/notifications', async (req, res) => {
  try {
    const { user_id, role } = req.query;
    const uid = parseInt(user_id);
 
    let query, params;
 
    if (role === 'owner' || role === 'admin') {
      // Owner/admin: see approvals, rejections, all invoices, expense events
      query = `
        SELECT * FROM audit_log
        WHERE category IN ('approval','rejection','invoice','quotation','expense','product')
        ORDER BY ts DESC LIMIT 100
      `;
      params = [];
    } else {
      // Employee/accountant: see approvals/rejections targeting them + product changes
      query = `
        SELECT * FROM audit_log
        WHERE (
          category IN ('approval','rejection') AND (target_user_id = $1 OR user_id = $1)
          OR category = 'product'
        )
        ORDER BY ts DESC LIMIT 100
      `;
      params = [uid];
    }
 
    const { rows } = await pool.query(query, params);
    ok(res, rows);
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

// ═══════════════════════════════════════════════════════
//  SALES TARGETS
// ═══════════════════════════════════════════════════════

app.get('/sales-targets', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sales_targets ORDER BY year DESC, month DESC');
    ok(res, rows);
  } catch (e) { fail(res, e); }
});

// Upsert: POST with employee_id+year+month inserts or updates
app.post('/sales-targets', async (req, res) => {
  try {
    const { employee_id, year, month, target } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO sales_targets (employee_id, year, month, target)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, year, month)
       DO UPDATE SET target = EXCLUDED.target
       RETURNING *`,
      [employee_id, year, month, target]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});

// ═══════════════════════════════════════════════════════════════
//  HELP REQUESTS  (feature requests, change requests, bugs, help)
// ═══════════════════════════════════════════════════════════════
 
// GET all (admin sees all; pass ?user_id=X for filtered employee view)
app.get('/help-requests', async (req, res) => {
  try {
    const { user_id } = req.query;
    let query, params;
    if (user_id) {
      query = 'SELECT * FROM help_requests WHERE user_id = $1 ORDER BY created_at DESC';
      params = [user_id];
    } else {
      query = 'SELECT * FROM help_requests ORDER BY created_at DESC';
      params = [];
    }
    const { rows } = await pool.query(query, params);
    ok(res, rows);
  } catch (e) { fail(res, e); }
});
 
// POST — create new request
app.post('/help-requests', async (req, res) => {
  try {
    const { user_id, user_name, user_role, type, title, description } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO help_requests (user_id, user_name, user_role, type, title, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING *`,
      [user_id, user_name, user_role, type, title, description]
    );
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});
 
// PATCH status — admin updates status + optional note
app.patch('/help-requests/:id/status', async (req, res) => {
  try {
    const { status, admin_note, reviewed_by } = req.body;
    const { rows } = await pool.query(
      `UPDATE help_requests
       SET status=$1, admin_note=$2, reviewed_by=$3, reviewed_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, admin_note || null, reviewed_by || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
});
 
// DELETE
app.delete('/help-requests/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM help_requests WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});


// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MKA ERP server running on port ${PORT}`));
