"""Forward-only automation migrations and synthetic development seed."""

import argparse
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env.local", extra="ignore")
    database_url: SecretStr


def migrate(connection, directory=ROOT / "db/migrations"):
    applied = []
    # Transaction-scoped locks also work with transaction-pooling databases.
    for path in sorted(Path(directory).glob("*.sql")):
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(81820394)")
                cursor.execute("CREATE TABLE IF NOT EXISTS _migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
                cursor.execute("SELECT filename FROM _migrations WHERE filename = %s", [path.name])
                if cursor.fetchone() is not None:
                    continue
                cursor.execute(path.read_text(encoding="utf-8"))
                cursor.execute("INSERT INTO _migrations (filename) VALUES (%s)", [path.name])
        applied.append(path.name)
    return applied


def seed(connection):
    users = [("Demo Admin", "demo.admin@example.com", "admin", "admin"),
             ("Demo PM", "demo.pm@example.com", "pm", "lead"),
             ("Demo Developer", "demo.dev@example.com", "member", "developer"),
             ("Demo QA", "demo.qa@example.com", "member", "qa")]
    with connection:
        with connection.cursor() as cursor:
            cursor.execute("""INSERT INTO projects (name, code, description, status, jira_project_key, dev_branch)
                VALUES ('Demo Project', 'DEMO', 'Synthetic project for local development and testing -- not a real Jira project.', 'active', null, 'development')
                ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id""")
            project_id = cursor.fetchone()[0]
            for name, email, role, member_role in users:
                cursor.execute("""INSERT INTO users (name, email, role) VALUES (%s, %s, %s)
                    ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role RETURNING id""", [name, email, role])
                user_id = cursor.fetchone()[0]
                cursor.execute("""INSERT INTO project_members (project_id, user_id, role) VALUES (%s, %s, %s)
                    ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role""", [project_id, user_id, member_role])
                if member_role == "lead":
                    cursor.execute("""INSERT INTO project_configurations (project_id, project_lead_id) VALUES (%s, %s)
                        ON CONFLICT (project_id) DO UPDATE SET project_lead_id = excluded.project_lead_id""", [project_id, user_id])
    return {"project": "DEMO", "members": len(users)}


def main():
    import psycopg2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["migrate", "seed", "setup"])
    args = parser.parse_args()
    settings = DatabaseSettings()
    connection = psycopg2.connect(settings.database_url.get_secret_value())
    try:
        if args.command in {"migrate", "setup"}:
            print({"migrationsApplied": migrate(connection)})
        if args.command in {"seed", "setup"}:
            print(seed(connection))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
