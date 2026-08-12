"""Tests for the safe Poltekkes legacy-user import helpers."""

from django.contrib.auth.hashers import check_password, make_password
from django.test import SimpleTestCase

from authentik.core.management.commands.import_poltekkes_users import (
    ImportedRecord,
    encode_legacy_password_hash,
    merge_records,
)


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
