from unittest import TestCase
from unittest.mock import MagicMock

from app.jobs.database import Database


class JobDatabaseTests(TestCase):
    def test_transaction_rolls_back_failed_replacement(self):
        connection = MagicMock()
        database = Database(connection)
        with self.assertRaisesRegex(RuntimeError, "insert failed"):
            with database.transaction():
                self.assertFalse(connection.autocommit)
                raise RuntimeError("insert failed")
        connection.rollback.assert_called_once()
        connection.commit.assert_not_called()
        self.assertTrue(connection.autocommit)
        self.assertFalse(database.in_transaction)

    def test_success_commits_and_nested_transactions_are_rejected(self):
        connection = MagicMock()
        database = Database(connection)
        with database.transaction():
            with self.assertRaisesRegex(RuntimeError, "Nested"):
                with database.transaction():
                    pass
        connection.commit.assert_called_once()
        connection.rollback.assert_not_called()

    def test_derived_replacement_requires_transaction(self):
        connection = MagicMock()
        database = Database(connection)
        with self.assertRaisesRegex(RuntimeError, "requires a transaction"):
            database.replace_computed("risks", [], scope_column="scope", scope_value="org")
        connection.cursor.assert_not_called()

    def test_mismatched_bulk_columns_fail_before_writing(self):
        connection = MagicMock()
        database = Database(connection)
        with self.assertRaisesRegex(ValueError, "same columns"):
            database.insert_many("people", [{"id": 1}, {"id": 2, "name": "Alex"}])
        connection.cursor.assert_not_called()
