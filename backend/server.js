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

app.get('/approvals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.*,
        u.name AS employee_name
      FROM invoices i
      LEFT JOIN users u ON u.id = i.employee_id
      WHERE i.status = 'pending'
      ORDER BY i.created DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching approvals");
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

app.get('/invoices', async (req, res) => {
  try {
    // 🔹 1. Get invoices + employee name
    const invoices = await pool.query(`
      SELECT 
        i.*,
        u.name AS employee_name
      FROM invoices i
      LEFT JOIN users u ON u.id = i.employee_id
      ORDER BY i.created DESC
    `);

    // 🔹 2. Get invoice items
    const items = await pool.query(`
      SELECT * FROM invoice_items
    `);

    // 🔹 3. Group items by invoice_id
    const map = {};

    items.rows.forEach(item => {
      if (!map[item.invoice_id]) {
        map[item.invoice_id] = [];
      }

      map[item.invoice_id].push({
        productId: item.product_id,
        name: item.name,
        qty: item.qty,
        price: Number(item.price)
      });
    });

    // 🔹 4. Attach items to invoices
    const final = invoices.rows.map(inv => ({
      ...inv,
      total: Number(inv.total || 0),
      items: map[inv.id] || []
    }));

    res.json(final);

  } catch (err) {
    console.error("INVOICE ERROR:", err);
    res.status(500).send("Error fetching invoices");
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

app.get('/quotations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        q.id,
        q.customer_name,
        q.product_id,
        p.name AS product_name,
        q.date,
        q.phone,
        q.address,
        q.converted
      FROM quotations q
      LEFT JOIN products p ON q.product_id = p.id
      ORDER BY q.id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching quotations");
  }
});

app.get('/invoices', async (req, res) => {
  try {
    const invoices = await pool.query(`SELECT * FROM invoices ORDER BY created DESC`);

    const items = await pool.query(`SELECT * FROM invoice_items`);

    const itemsMap = {};

    items.rows.forEach(item => {
      if (!itemsMap[item.invoice_id]) {
        itemsMap[item.invoice_id] = [];
      }
      itemsMap[item.invoice_id].push(item);
    });

    const final = invoices.rows.map(inv => ({
      ...inv,
      items: itemsMap[inv.id] || []
    }));

    res.json(final);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching invoices");
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
