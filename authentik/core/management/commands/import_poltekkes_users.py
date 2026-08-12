"""Safely merge and import legacy Poltekkes account records."""

import csv
from dataclasses import dataclass
from io import TextIOWrapper
from string import hexdigits
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand, CommandError

from authentik.core.models import User

SOURCE_PRIORITY = ("eAkademik", "ePembayaran", "eRegistrasi", "ePortal", "eAdmisi")
_SOURCE_ORDER = {source: index for index, source in enumerate(SOURCE_PRIORITY)}
_MD5_DIGEST_LENGTH = 32


@dataclass(frozen=True)
class ImportedRecord:
    """A single account read from an application database."""

    source: str
    username: str
    name: str
    email: str
    password_hash: str


@dataclass(frozen=True)
class ImportConflict:
    """A merge anomaly without personally sensitive source values."""

    username: str
    kind: str
    winner_source: str
    other_source: str = ""


def _normalise_username(username: str) -> str:
    return username.strip().casefold()


def _valid_email(email: str) -> bool:
    return not email or ("@" in email and " " not in email)


def _record_order(record: ImportedRecord) -> int:
    return _SOURCE_ORDER.get(record.source, len(SOURCE_PRIORITY))


def merge_records(
    records: list[ImportedRecord],
) -> tuple[list[ImportedRecord], list[ImportConflict]]:
    """Deduplicate records by username, selecting the configured source winner."""

    grouped: dict[str, list[ImportedRecord]] = {}
    conflicts: list[ImportConflict] = []
    for record in records:
        username = _normalise_username(record.username)
        if not username:
            conflicts.append(ImportConflict("", "blank_username", record.source))
            continue
        grouped.setdefault(username, []).append(record)

    winners: list[ImportedRecord] = []
    for username, candidates in grouped.items():
        candidates.sort(key=_record_order)
        winner = candidates[0]
        email = winner.email.strip().casefold()
        for candidate in candidates[1:]:
            candidate_email = candidate.email.strip().casefold()
            if candidate.password_hash and candidate.password_hash != winner.password_hash:
                conflicts.append(
                    ImportConflict(
                        username, "password_hash_conflict", winner.source, candidate.source
                    )
                )
            if not email and _valid_email(candidate_email):
                email = candidate_email
        winners.append(
            ImportedRecord(winner.source, username, winner.name, email, winner.password_hash)
        )
    return winners, conflicts


def encode_legacy_password_hash(password_hash: str) -> str | None:
    """Return a Django-compatible encoding for an explicitly supported legacy hash."""

    digest = password_hash.strip().lower()
    if len(digest) == _MD5_DIGEST_LENGTH and all(character in hexdigits for character in digest):
        return f"poltekkes_md5${digest}"
    return None


def open_import_input(
    *, input_path: str | None, input_url: str | None, bearer_token: str | None
) -> TextIOWrapper:
    """Open a local CSV or a short-lived, authenticated HTTPS migration export."""

    if input_path:
        try:
            return open(input_path, encoding="utf-8", newline="")
        except OSError as exc:
            raise CommandError("Could not open import input") from exc

    if not input_url or urlparse(input_url).scheme != "https":
        raise CommandError("Remote import input must use HTTPS")
    if not bearer_token:
        raise CommandError("Remote import input requires an access token")
    try:
        response = urlopen(
            Request(input_url, headers={"Authorization": f"Bearer {bearer_token}"}), timeout=300
        )
    except OSError as exc:
        raise CommandError("Could not fetch remote import input") from exc
    # Legacy MySQL text may contain isolated non-UTF-8 bytes in display-name fields.
    # Usernames and MD5 hashes are ASCII, so replacement keeps identity data intact.
    return TextIOWrapper(response, encoding="utf-8", errors="replace", newline="")


class Command(BaseCommand):
    """Import unique ePortal identities without exposing legacy password hashes."""

    help = "Import legacy Poltekkes users from a CSV export"

    _fieldnames = ("source", "username", "name", "email", "password_hash")

    def add_arguments(self, parser):
        input_source = parser.add_mutually_exclusive_group(required=True)
        input_source.add_argument("--input")
        input_source.add_argument("--input-url")
        parser.add_argument("--bearer-token")
        parser.add_argument("--source", choices=("ePortal",), required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        counters = {
            "created": 0,
            "existing": 0,
            "invalid_hash": 0,
            "blank_username": 0,
            "conflict": 0,
        }
        csv_file = open_import_input(
            input_path=options["input"],
            input_url=options["input_url"],
            bearer_token=options["bearer_token"],
        )

        with csv_file:
            reader = csv.DictReader(csv_file)
            if reader.fieldnames != list(self._fieldnames):
                raise CommandError("Input must use the expected CSV headers")
            for row in reader:
                if row.get("source") != options["source"]:
                    counters["conflict"] += 1
                    continue
                username = _normalise_username(row.get("username", ""))
                if not username:
                    counters["blank_username"] += 1
                    continue
                encoded_password = encode_legacy_password_hash(row.get("password_hash", ""))
                if encoded_password is None:
                    counters["invalid_hash"] += 1
                    continue
                if User.objects.filter(username=username).exists():
                    counters["existing"] += 1
                    continue
                counters["created"] += 1
                if options["dry_run"]:
                    continue
                email = row.get("email", "").strip().casefold()
                if not _valid_email(email):
                    email = ""
                user = User(
                    username=username,
                    name=row.get("name", "").strip() or username,
                    email=email,
                    password=encoded_password,
                )
                user.save()
        self.stdout.write(" ".join(f"{name}={value}" for name, value in counters.items()))
