"""Tests for the safe Poltekkes legacy-user import helpers and command."""

import csv
import tempfile
from io import BytesIO, StringIO
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.core.management import CommandError, call_command
from django.db import DataError
from django.test import SimpleTestCase, TestCase

from authentik.core.management.commands.import_poltekkes_users import (
    ImportedRecord,
    encode_legacy_password_hash,
    merge_records,
    open_import_input,
    save_legacy_user,
)
from authentik.core.management.commands.sync_poltekkes_roles import (
    add_user_to_group,
    missing_group_memberships,
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


class TestRemoteImportInput(SimpleTestCase):
    """A remote migration source is fetched only over authenticated HTTPS."""

    @patch("authentik.core.management.commands.import_poltekkes_users.urlopen")
    def test_fetches_https_input_with_bearer_token(self, mock_urlopen):
        response = BytesIO(b"source,username,name,email,password_hash\\n")
        mock_urlopen.return_value = response

        with open_import_input(
            input_path=None,
            input_url="https://sia.poltekkes-malang.ac.id/sso/export.csv",
            bearer_token="test-token",
        ) as csv_file:
            self.assertEqual(csv_file.read(), "source,username,name,email,password_hash\\n")

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://sia.poltekkes-malang.ac.id/sso/export.csv")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")

    def test_rejects_non_https_remote_input(self):
        with self.assertRaisesMessage(CommandError, "HTTPS"):
            open_import_input(
                input_path=None,
                input_url="http://sia.poltekkes-malang.ac.id/sso/export.csv",
                bearer_token="test-token",
            )

    @patch("authentik.core.management.commands.import_poltekkes_users.urlopen")
    def test_replaces_invalid_source_text_bytes(self, mock_urlopen):
        mock_urlopen.return_value = BytesIO(
            b"source,username,name,email,password_hash" + bytes([10, 255])
        )

        with open_import_input(
            input_path=None,
            input_url="https://sia.poltekkes-malang.ac.id/sso/export.csv",
            bearer_token="test-token",
        ) as csv_file:
            self.assertIn("\ufffd", csv_file.read())


class TestLegacyUserSave(SimpleTestCase):
    """One malformed legacy row must not stop later account imports."""

    def test_database_error_is_reported_without_raising(self):
        user = type("User", (), {"save": lambda self: (_ for _ in ()).throw(DataError())})()

        self.assertFalse(save_legacy_user(user))


class TestRoleGroupMembership(SimpleTestCase):
    """Role synchronization only adds a user when membership is absent."""

    def test_adds_missing_membership(self):
        class Groups:
            def __init__(self):
                self.added = []

            def filter(self, **kwargs):
                return self

            def exists(self):
                return False

            def add(self, group):
                self.added.append(group)

        user = type("User", (), {"groups": Groups()})()
        group = type("Group", (), {"pk": "student"})()

        self.assertTrue(add_user_to_group(user, group))
        self.assertEqual(user.groups.added, [group])

    def test_keeps_existing_membership(self):
        class Groups:
            def filter(self, **kwargs):
                return self

            def exists(self):
                return True

            def add(self, group):
                raise AssertionError("existing membership must not be re-added")

        user = type("User", (), {"groups": Groups()})()
        group = type("Group", (), {"pk": "student"})()

        self.assertFalse(add_user_to_group(user, group))

    def test_builds_only_missing_membership_rows(self):
        group = type("Group", (), {"pk": "student"})()
        first = type("User", (), {"pk": "first"})()
        second = type("User", (), {"pk": "second"})()

        rows = missing_group_memberships(
            group,
            [first, second],
            {"first"},
            lambda **kwargs: (kwargs["user"].pk, kwargs["group"].pk),
        )

        self.assertEqual(rows, [("second", "student")])

    def test_unexpected_legacy_value_is_reported_without_raising(self):
        user = type("User", (), {"save": lambda self: (_ for _ in ()).throw(ValueError())})()

        self.assertFalse(save_legacy_user(user))

    def test_legacy_signal_error_is_reported_without_raising(self):
        user = type("User", (), {"save": lambda self: (_ for _ in ()).throw(RuntimeError())})()

        self.assertFalse(save_legacy_user(user))


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
