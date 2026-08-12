"""Tests for the safe Poltekkes legacy-user import helpers and command."""

import csv
import tempfile
from io import StringIO

from django.contrib.auth.hashers import check_password, make_password
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from authentik.core.management.commands.import_poltekkes_users import (
    ImportedRecord,
    encode_legacy_password_hash,
    merge_records,
)
from authentik.core.models import User


class TestMergeRecords(SimpleTestCase):
    """A username has one deterministic import winner."""

    def test_prefers_eakademik_hash_and_fills_missing_email(self):
        winners, conflicts = merge_records(
            [
                ImportedRecord(
                    source="ePortal",
                    username=" P123 ",
                    name="Portal User",
                    email="portal@example.invalid",
                    password_hash="portal-hash",
                ),
                ImportedRecord(
                    source="eAkademik",
                    username="p123",
                    name="Akademik User",
                    email="",
                    password_hash="akademik-hash",
                ),
            ]
        )

        self.assertEqual(winners[0].username, "p123")
        self.assertEqual(winners[0].name, "Akademik User")
        self.assertEqual(winners[0].email, "portal@example.invalid")
        self.assertEqual(winners[0].password_hash, "akademik-hash")
        observed_conflicts = [
            (conflict.kind, conflict.winner_source, conflict.other_source)
            for conflict in conflicts
        ]
        self.assertEqual(
            observed_conflicts,
            [("password_hash_conflict", "eAkademik", "ePortal")],
        )

    def test_rejects_blank_username_without_creating_winner(self):
        winners, conflicts = merge_records(
            [
                ImportedRecord(
                    source="eAkademik",
                    username=" ",
                    name="Ignored User",
                    email="",
                    password_hash="legacy-hash",
                )
            ]
        )

        self.assertEqual(winners, [])
        observed_conflicts = [
            (conflict.kind, conflict.winner_source) for conflict in conflicts
        ]
        self.assertEqual(observed_conflicts, [("blank_username", "eAkademik")])


class TestEncodeLegacyPasswordHash(SimpleTestCase):
    """Legacy hashes are retained only in a Django-verifiable representation."""

    def test_converts_raw_md5_digest(self):
        encoded = encode_legacy_password_hash("5f4dcc3b5aa765d61d8327deb882cf99")

        self.assertEqual(encoded, "poltekkes_md5$5f4dcc3b5aa765d61d8327deb882cf99")
        self.assertTrue(check_password("password", encoded))  # nosec: known test vector

    def test_valid_raw_md5_rejects_wrong_password_and_requests_rehash(self):
        encoded = encode_legacy_password_hash("5f4dcc3b5aa765d61d8327deb882cf99")
        replacement_passwords = []

        self.assertFalse(check_password("not-the-password", encoded))
        self.assertTrue(check_password("password", encoded, replacement_passwords.append))
        self.assertEqual(replacement_passwords, ["password"])
        self.assertTrue(make_password(replacement_passwords[0]).startswith("pbkdf2_sha256$"))

    def test_rejects_unknown_hash_format(self):
        self.assertIsNone(encode_legacy_password_hash("not-a-supported-hash"))


class TestPortalImporter(TestCase):
    """The importer creates only valid new portal users."""

    def _csv_path(self, rows):
        handle = tempfile.NamedTemporaryFile(mode="w", newline="", suffix=".csv", delete=False)
        with handle:
            writer = csv.DictWriter(
                handle, fieldnames=("source", "username", "name", "email", "password_hash")
            )
            writer.writeheader()
            writer.writerows(rows)
        return handle.name

    def test_imports_one_valid_user_and_skips_existing_and_invalid_hash(self):
        csv_path = self._csv_path(
            [
                {
                    "source": "ePortal",
                    "username": " Portal-User ",
                    "name": "Portal User",
                    "email": "portal@example.invalid",
                    "password_hash": "5f4dcc3b5aa765d61d8327deb882cf99",
                },
                {
                    "source": "ePortal",
                    "username": "portal-user",
                    "name": "Duplicate User",
                    "email": "",
                    "password_hash": "5f4dcc3b5aa765d61d8327deb882cf99",
                },
                {
                    "source": "ePortal",
                    "username": "bad-hash-user",
                    "name": "Bad Hash User",
                    "email": "",
                    "password_hash": "not-an-md5-hash",
                },
            ]
        )
        output = StringIO()

        call_command(
            "import_poltekkes_users", "--input", csv_path, "--source", "ePortal", stdout=output
        )

        self.assertTrue(User.objects.filter(username="portal-user").exists())
        self.assertEqual(User.objects.filter(username="portal-user").count(), 1)
        self.assertEqual(
            User.objects.get(username="portal-user").password.split("$", 1)[0], "poltekkes_md5"
        )
        self.assertFalse(User.objects.filter(username="bad-hash-user").exists())
        self.assertIn("created=1", output.getvalue())
        self.assertIn("existing=1", output.getvalue())
        self.assertIn("invalid_hash=1", output.getvalue())
        self.assertNotIn("5f4dcc3b5aa765d61d8327deb882cf99", output.getvalue())
