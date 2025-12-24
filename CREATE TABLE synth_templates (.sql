CREATE TABLE synth_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT,
  description TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  synth_json JSONB NOT NULL
);

CREATE TABLE patch_histories (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  authors TEXT[] NOT NULL,
  parent_patch_id INTEGER REFERENCES patch_histories(id) ON DELETE SET NULL,
  tags TEXT[],
  visibility TEXT CHECK (visibility IN ('public', 'private', 'modifiable')) DEFAULT 'public',
  patchHistory_doc BYTEA NOT NULL,
  synth_template_id INTEGER REFERENCES synth_templates(id) ON DELETE SET NULL
);
