require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

console.log("Server file loaded");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true
  }
});


// ✅ TEST ROUTE
app.get('/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── 2. GET /audit-log  (admin only — frontend enforces role) ───
app.get('/audit-log', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, user_name, category, action, meta,
              time_label, date_label, ts
         FROM audit_log
        ORDER BY ts DESC
        LIMIT 2000`           // cap at 2000 most recent events
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Audit log GET error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});
 
 
// ── 3. POST /audit-log  (called silently by frontend) ──────────
app.post('/audit-log', async (req, res) => {
  const { user_id, user_name, category, action, meta, time_label, date_label, ts } = req.body;
 
  if (!user_name || !action) {
    return res.status(400).json({ error: 'user_name and action are required' });
  }
 
  const validCategories = ['login','logout','invoice','approval','rejection','customer','product','expense','quotation','delivery','user','system'];
  const safeCat = validCategories.includes(category) ? category : 'system';
 
  try {
    const result = await pool.query(
      `INSERT INTO audit_log (user_id, user_name, category, action, meta, time_label, date_label, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        user_id   || null,
        user_name,
        safeCat,
        action,
        meta ? JSON.stringify(meta) : null,
        time_label || null,
        date_label || null,
        ts || new Date().toISOString()
      ]
    );
    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Audit log POST error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});
 
 
// ── 4. OPTIONAL: DELETE old logs (housekeeping endpoint) ───────
// Call this manually or via a cron job to keep the table lean.
// Only allow this for admin users — protect it server-side too.
app.delete('/audit-log/purge', async (req, res) => {
  // Optional: require a secret header for safety
  // if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(403).end();
  try {
    const result = await pool.query(
      `DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '90 days'`
    );
    return res.json({ deleted: result.rowCount });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

//Onboarding
app.post('/users/:id/complete-onboarding', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
 
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  } 
  try {
    const result = await pool.query(
      `UPDATE users
         SET new_user = false
       WHERE id = $1
       RETURNING id, name, email, role, active, new_user`,
      [userId]
    );
 
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
 
    return res.json({ success: true, user: result.rows[0] });
 
  } catch (err) {
    console.error('Onboarding complete error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


// 🔥 PRODUCTS
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post('/products', async (req, res) => {
  const { name, price, stock, category } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO products (name, price, stock, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, price, stock, category]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Insert failed' });
  }
});


// 📄 DOCUMENTS
app.post("/documents", async (req, res) => {
  try {
    const {
      id, type, status, employee_id,
      customer_name, customer_phone, customer_address,
      customer_ref, mka_ref, company_name, promo_code,
      lpo_no, lpo_date,
      total, created,
      terms, items
    } = req.body;

    if (!id || !type || !status || !customer_name) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Items required" });
    }

    const result = await pool.query(
      `INSERT INTO documents (
        id, type, status, employee_id,
        customer_name, customer_phone, customer_address,
        customer_ref, mka_ref, company_name, promo_code,
        lpo_no, lpo_date,
        total, created,
        terms, items
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,
        $14,$15,
        $16,$17
      ) RETURNING *`,
      [
        id, type, status, employee_id,
        customer_name, customer_phone, customer_address,
        customer_ref, mka_ref, company_name, promo_code,
        lpo_no || null, lpo_date || null,
        total, created,
        JSON.stringify(terms || {}),
        JSON.stringify(items || [])
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("DOCUMENT INSERT ERROR:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

app.get("/documents", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents ORDER BY created DESC");
    const data = result.rows.map(r => ({
      ...r,
      items: r.items || [],
      terms: r.terms || {}
    }));
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Fetch error");
  }
});

app.get('/approvals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM documents
      WHERE status = 'pending' AND type = 'invoice'
      ORDER BY created DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching approvals");
  }
});

app.post("/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { approver } = req.body;
    await pool.query(
      `UPDATE documents
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2`,
      [approver, id]
    );
    res.send("Approved");
  } catch (err) {
    console.error(err);
    res.status(500).send("Approval failed");
  }
});

app.post("/reject/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { approver, note } = req.body;
    await pool.query(
      `UPDATE documents
       SET status = 'rejected', approved_by = $1, rejection_note = $2
       WHERE id = $3`,
      [approver, note, id]
    );
    res.send("Rejected");
  } catch (err) {
    console.error(err);
    res.status(500).send("Reject failed");
  }
});


// 👥 USERS
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Users fetch failed" });
  }
});

// ── ADD USER ──
app.post('/users', async (req, res) => {
  const { name, email, password, role, active } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, email, password, role, active !== false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'User insert failed' });
  }
});

// ── UPDATE USER ──
app.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET name=$1, email=$2, password=$3, role=$4, active=$5
       WHERE id=$6 RETURNING *`,
      [name, email, password, role, active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'User update failed' });
  }
});


// 📋 LEADS
app.get('/leads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        l.id, l.name, l.phone, l.source,
        p.name AS product,
        l.status, l.employee_id, l.notes, l.created, l.address
      FROM leads l
      LEFT JOIN products p ON l.product_id = p.id
      ORDER BY l.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching leads");
  }
});


// 🔐 LOGIN
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email=$1 AND password=$2',
      [email, password]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});


// ══════════════════════════════════════════════
// 💸 EXPENDITURE ROUTES
// ══════════════════════════════════════════════

// GET all expenditures
app.get('/expenditure', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM expenditure ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Expenditure fetch error:", err);
    res.status(500).json({ error: "Failed to fetch expenditures" });
  }
});

// GET single expenditure
app.get('/expenditure/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM expenditure WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// POST — create new expenditure
app.post('/expenditure', async (req, res) => {
  try {
    const {
      user_id,
      amount,
      expense_type,
      description,
      used_for,
      proof_url,
      car_plate,
      is_petty_cash
    } = req.body;

    if (!user_id || !amount || !expense_type) {
      return res.status(400).json({ error: "user_id, amount, and expense_type are required" });
    }

    const result = await pool.query(
      `INSERT INTO expenditure
         (user_id, amount, expense_type, description, used_for, proof_url, car_plate, is_petty_cash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        user_id,
        amount,
        expense_type,
        description || null,
        used_for   || null,
        proof_url  || null,
        car_plate  || null,
        is_petty_cash || false
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Expenditure insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// PUT — edit an expenditure (accountant / Arya only enforced on frontend)
app.put('/expenditure/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      user_id,
      amount,
      expense_type,
      description,
      used_for,
      proof_url,
      car_plate,
      is_petty_cash
    } = req.body;

    const result = await pool.query(
      `UPDATE expenditure
       SET user_id=$1, amount=$2, expense_type=$3, description=$4,
           used_for=$5, proof_url=$6, car_plate=$7, is_petty_cash=$8,
           updated_at=NOW()
       WHERE id=$9
       RETURNING *`,
      [
        user_id,
        amount,
        expense_type,
        description || null,
        used_for   || null,
        proof_url  || null,
        car_plate  || null,
        is_petty_cash || false,
        id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Expenditure update error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE — remove an expenditure
app.delete('/expenditure/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM expenditure WHERE id=$1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error("Expenditure delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// PATCH — approve an expenditure (Ramachandran / Arya)
app.patch('/expenditure/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;

    const result = await pool.query(
      `UPDATE expenditure
       SET status='approved', approved_by=$1, approved_at=NOW(), updated_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [approved_by || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Expenditure approve error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

// PATCH — reject an expenditure (Ramachandran / Arya)
app.patch('/expenditure/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, approved_by } = req.body;

    const result = await pool.query(
      `UPDATE expenditure
       SET status='rejected', approved_by=$1, approved_at=NOW(), updated_at=NOW(),
           description = CASE WHEN $2::text IS NOT NULL
                              THEN COALESCE(description || ' | Rejection: ', 'Rejection: ') || $2
                              ELSE description END
       WHERE id=$3
       RETURNING *`,
      [approved_by || null, reason || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Expenditure reject error:", err);
    res.status(500).json({ error: "Rejection failed" });
  }
});

// GET — expenditures filtered by employee
app.get('/expenditure/by-user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM expenditure WHERE user_id=$1 ORDER BY created_at DESC',
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// GET — expenditures filtered by car plate
app.get('/expenditure/by-plate/:plate', async (req, res) => {
  try {
    const { plate } = req.params;
    const result = await pool.query(
      'SELECT * FROM expenditure WHERE LOWER(car_plate)=LOWER($1) ORDER BY created_at DESC',
      [plate]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// GET — petty cash only
app.get('/expenditure/petty-cash', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM expenditure
       WHERE is_petty_cash=true OR expense_type='Petty Cash'
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
