from __future__ import annotations

import unittest

from scripts.check_citation_draft import rollback_sql, tap_passed


class CitationDraftRunnerTests(unittest.TestCase):
    def test_rehearsal_is_wrapped_with_timeouts_and_rollback(self) -> None:
        sql = rollback_sql(("select 1;", "select 2;"))
        self.assertTrue(sql.startswith("begin;\n"))
        self.assertTrue(sql.endswith("\nrollback;\n"))
        self.assertIn("set local lock_timeout='3s';", sql)
        self.assertIn("set local statement_timeout='20s';", sql)

    def test_transaction_controls_and_psql_commands_are_refused(self) -> None:
        for value in ("commit;", " COMMIT;", "end;", "rollback;",
                      "prepare transaction 'x';", "select 1; commit;",
                      "COMMIT /* hidden terminator */;", "\\include arbitrary.sql"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                rollback_sql((value,))

    def test_function_block_and_comment_do_not_open_a_transaction(self) -> None:
        sql = rollback_sql(("-- commit;\ncreate function f() returns void as $$\nbegin\nreturn;\nend;\n$$ language plpgsql;",))
        self.assertTrue(sql.endswith("rollback;\n"))

    def test_tap_failure_or_incomplete_plan_cannot_pass(self) -> None:
        self.assertTrue(tap_passed("1..2\nok 1 - a\nok 2 - b\n", 2))
        for value in ("1..2\nok 1 - a\n", "1..2\nok 1 - a\nnot ok 2 - b\n",
                      "1..1\nok 1 - a\nok 2 - b\n"):
            with self.subTest(value=value):
                self.assertFalse(tap_passed(value, 2))


if __name__ == "__main__":
    unittest.main()
