// patchStorage.js
import express from 'express';
import { Pool } from 'pg';

const patchHistoryRouter = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Save a new patch history
patchHistoryRouter.post('/', async (req, res) => {
  try {
    const {
      title,
      description,
      authors,
      parent_patch_id,
      tags,
      visibility,
      patchHistoryBase64,
      synth_template_id
    } = req.body;

    const buffer = Buffer.from(patchHistoryBase64, 'base64');

    const result = await pool.query(
      `INSERT INTO patch_histories
      (title, description, created_at, updated_at, authors, parent_patch_id, tags, visibility, patchHistory_doc, synth_template_id)
      VALUES ($1, $2, now(), now(), $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [title, description, authors, parent_patch_id, tags, visibility, buffer, synth_template_id]
    );

    res.status(201).json({ patchHistoryId: result.rows[0].id });
  } catch (err) {
    console.error('❌ Error saving patch history:', err);
    res.status(500).send('Error saving patch history');
  }
});

// List all patch histories
patchHistoryRouter.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, authors, tags, visibility, created_at, description
       FROM patch_histories
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error listing patch histories:', err);
    res.status(500).send('Error listing patch histories');
  }
});

// Get one patch history by ID
patchHistoryRouter.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM patch_histories WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Patch history not found');
    }

    const row = result.rows[0];
    res.json({
      ...row,
      patchHistoryBase64: row.patchhistory_doc.toString('base64'),
    });
  } catch (err) {
    console.error('❌ Error retrieving patch history:', err);
    res.status(500).send('Error retrieving patch history');
  }
});

export default patchHistoryRouter;
