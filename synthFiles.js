// templateStorage.js
import express from 'express';
import { Pool } from 'pg';

const synthFileRouter = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Save a new synth template
synthFileRouter.post('/', async (req, res) => {
  try {
    const { name, author, description, tags, synth_json } = req.body;

    const result = await pool.query(
      `INSERT INTO synth_templates
      (name, author, description, tags, created_at, synth_json)
      VALUES ($1, $2, $3, $4, now(), $5)
      RETURNING id`,
      [name, author, description, tags, synth_json]
    );

    res.status(201).json({ synthFileId: result.rows[0].id });
  } catch (err) {
    console.error('❌ Error saving synth template:', err);
    res.status(500).send('Error saving synth template');
  }
});

// List all templates
synthFileRouter.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, author, tags, created_at, description FROM synth_templates ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error listing synth templates:', err);
    res.status(500).send('Error listing synth templates');
  }
});

// Load a single template by ID
synthFileRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM synth_templates WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Synth template not found');
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error retrieving synth template:', err);
    res.status(500).send('Error retrieving synth template');
  }
});

export default synthFileRouter;
