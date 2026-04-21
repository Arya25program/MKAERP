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

app.get('/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/add-test-user', async (req, res) => {
  await pool.query(
    'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
    ["Arya", "arya@test.com", "1234"]
  );

  res.send("Test user added");
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    'SELECT * FROM users WHERE email=$1 AND password=$2',
    [email, password]
  );

  if (result.rows.length > 0) {
    res.json(result.rows[0]);
  } else {
    res.status(401).send("Invalid credentials");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
