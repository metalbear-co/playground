CREATE TABLE account (
    username text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    last_fetched_at timestamptz,
    fetched_by text
);

INSERT INTO account (username, name, email, password)
VALUES ('demo', 'Demo User', 'demo@example.com', 'demo-pass');
