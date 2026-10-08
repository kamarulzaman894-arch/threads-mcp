-- Staging design only. Not applied to production.
CREATE TABLE IF NOT EXISTS kz_threads_scheduled_posts (
 id uuid PRIMARY KEY,
 account_id text NOT NULL,
 text_content text NOT NULL CHECK (char_length(text_content) BETWEEN 1 AND 500),
 content_hash char(64) NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 status text NOT NULL CHECK (status IN ('DRAFT','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','CANCELLED','FAILED_REVIEW_REQUIRED')),
 approved_by text,
 approved_at timestamptz,
 approved_revision integer,
 scheduled_at timestamptz,
 published_id text UNIQUE,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (status <> 'SCHEDULED' OR
  (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_revision = revision AND scheduled_at IS NOT NULL)),
 CHECK (status <> 'PUBLISHED' OR published_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS kz_threads_due_idx
 ON kz_threads_scheduled_posts(scheduled_at) WHERE status='SCHEDULED';
CREATE TABLE IF NOT EXISTS kz_threads_publish_attempts (
 id uuid PRIMARY KEY,
 post_id uuid NOT NULL REFERENCES kz_threads_scheduled_posts(id),
 post_revision integer NOT NULL,
 attempt_key text NOT NULL UNIQUE,
 started_at timestamptz NOT NULL DEFAULT now(),
 outcome text NOT NULL CHECK(outcome IN ('STARTED','SUCCEEDED','UNKNOWN','FAILED')),
 platform_post_id text,
 response_summary text,
 completed_at timestamptz,
 UNIQUE(post_id,post_revision)
);
CREATE TABLE IF NOT EXISTS kz_threads_approval_audit (
 id uuid PRIMARY KEY,
 post_id uuid NOT NULL REFERENCES kz_threads_scheduled_posts(id),
 revision integer NOT NULL,
 actor_subject text NOT NULL,
 action text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 content_hash char(64) NOT NULL
);
-- Application role must be restricted. Never expose owner approval as a user-supplied string.
-- CAS example: UPDATE ... SET revision = revision + 1, ... WHERE id=$1 AND revision=$2 RETURNING id.
