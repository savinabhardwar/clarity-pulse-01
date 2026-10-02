"""Job database access with bound parameters and explicit transactions."""

from contextlib import contextmanager

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, RealDictCursor, execute_values

from app.jobs.config import JobSettings


class Database:
    def __init__(self, connection, schema="public"):
        self.connection = connection
        self.schema = schema
        self.connection.autocommit = True
        self.in_transaction = False

    @classmethod
    def connect(cls, settings: JobSettings):
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required for jobs")
        connection = psycopg2.connect(
            settings.database_url.get_secret_value(), connect_timeout=15,
        )
        return cls(connection, settings.database_schema)

    def close(self):
        self.connection.close()

    def rows(self, statement, parameters=None):
        with self.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(statement, parameters)
            return [dict(row) for row in cursor.fetchall()]

    def execute(self, statement, parameters=None):
        with self.cursor() as cursor:
            cursor.execute(statement, parameters)
            return cursor.rowcount

    @contextmanager
    def cursor(self, **options):
        # Transaction poolers can discard session settings after every commit.
        # Bind search_path within the same transaction as every operation.
        if not self.in_transaction:
            with self.transaction():
                with self.connection.cursor(**options) as cursor:
                    yield cursor
        else:
            with self.connection.cursor(**options) as cursor:
                yield cursor

    @contextmanager
    def transaction(self):
        if self.in_transaction:
            raise RuntimeError("Nested job transactions are not supported")
        self.connection.autocommit = False
        self.in_transaction = True
        try:
            with self.connection.cursor() as cursor:
                cursor.execute("SELECT set_config('search_path', %s, true)", [self.schema])
            yield self
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise
        finally:
            self.in_transaction = False
            self.connection.autocommit = True

    def insert_many(self, table, rows, *, conflict_columns=None, update_columns=None):
        if not rows:
            return
        columns = list(rows[0])
        if any(set(row) != set(columns) for row in rows):
            raise ValueError("Bulk rows must have the same columns")
        statement = sql.SQL("INSERT INTO {} ({}) VALUES %s").format(
            sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns)),
        )
        if conflict_columns:
            updates = update_columns if update_columns is not None else [column for column in columns if column not in conflict_columns]
            statement += sql.SQL(" ON CONFLICT ({}) ").format(sql.SQL(", ").join(map(sql.Identifier, conflict_columns)))
            statement += sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(
                sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(column), sql.Identifier(column)) for column in updates
            ) if updates else sql.SQL("DO NOTHING")
        values = [tuple(Json(row[column]) if isinstance(row[column], dict) else row[column] for column in columns) for row in rows]
        with self.cursor() as cursor:
            execute_values(cursor, statement, values, page_size=500)

    def upsert(self, table, rows, *, conflict_columns, update_columns=None):
        self.insert_many(table, rows, conflict_columns=conflict_columns, update_columns=update_columns)

    def replace_computed(self, table, rows, *, scope_column, scope_value):
        # The caller controls a transaction spanning this delete and insert.
        if not self.in_transaction:
            raise RuntimeError("Replacing derived rows requires a transaction")
        self.execute(sql.SQL("DELETE FROM {} WHERE {} = %s").format(sql.Identifier(table), sql.Identifier(scope_column)), [scope_value])
        self.insert_many(table, rows)
