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


// 🔥 PRODUCTS (READ ONLY FOR NOW)
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});


// (OPTIONAL) KEEP — NOT USED BY FRONTEND
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

//Documents (Merging Invoice and Quotations)
app.post("/documents", async (req, res) => {
  try {
    const {
      id,
      type,
      status,
      employee_id,

      customer_name,
      customer_phone,
      customer_address,

      customer_ref,
      mka_ref,
      company_name,
      promo_code,
      lpo_no,
      lpo_date,

      total,
      created,

      terms,
      items
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
        id,
        type,
        status,
        employee_id,

        customer_name,
        customer_phone,
        customer_address,

        customer_ref,
        mka_ref,
        company_name,
        promo_code,

        lpo_no || null,
        lpo_date || null,

        total,
        created,

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
    const result = await pool.query(
      "SELECT * FROM documents ORDER BY created DESC"
    );

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

//Get pending APPROVALS
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
       SET status = 'approved',
           approved_by = $1,
           approved_at = NOW()
       WHERE id = $2`,
      [approver, id]
    );

    res.send("Approved");
  } catch (err) {
    console.error(err);
    res.status(500).send("Approval failed");
  }
});

//reject invoices
app.post("/reject/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { approver, note } = req.body;

    await pool.query(
      `UPDATE documents
       SET status = 'rejected',
           approved_by = $1,
           rejection_note = $2
       WHERE id = $3`,
      [approver, note, id]
    );

    res.send("Rejected");
  } catch (err) {
    console.error(err);
    res.status(500).send("Reject failed");
  }
});

// 🔹 OTHER READ ROUTES
app.get('/leads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.id,
        l.name,
        l.phone,
        l.source,
        p.name AS product,   -- 🔥 THIS FIX
        l.status,
        l.employee_id,
        l.notes,
        l.created,
        l.address
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


app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Users fetch failed" });
  }
});

// 🔐 LOGIN (SAFE)
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


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
