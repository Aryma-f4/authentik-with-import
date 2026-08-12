"""Synchronise read-only legacy role exports into Authentik groups."""

import csv

from django.core.management.base import BaseCommand, CommandError

from authentik.core.management.commands.import_poltekkes_users import (
    _normalise_username,
    open_import_input,
)
from authentik.core.models import Group, User

ROLE_GROUPS = {
    "1": "Poltekkes Mahasiswa",
    "2": "Poltekkes SIA Staff",
    "3": "Poltekkes SIA Staff",
}
_FIELDNAMES = ("source", "username", "role")


def add_user_to_group(user: User, group: Group) -> bool:
    """Add one membership only when absent, returning whether it changed."""

    if user.groups.filter(group_uuid=group.pk).exists():
        return False
    user.groups.add(group)
    return True


class Command(BaseCommand):
    """Add SIA users to their role group without changing the SIA database."""

    help = "Synchronise legacy SIA roles into Authentik groups"

    def add_arguments(self, parser):
        input_source = parser.add_mutually_exclusive_group(required=True)
        input_source.add_argument("--input")
        input_source.add_argument("--input-url")
        parser.add_argument("--bearer-token")
        parser.add_argument("--source", choices=("ePortal",), required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        counters = {"added": 0, "existing": 0, "missing": 0, "invalid": 0}
        groups = {
            role: Group.objects.get_or_create(name=name)[0] for role, name in ROLE_GROUPS.items()
        }
        csv_file = open_import_input(
            input_path=options["input"],
            input_url=options["input_url"],
            bearer_token=options["bearer_token"],
        )
        with csv_file:
            reader = csv.DictReader(csv_file)
            if reader.fieldnames != list(_FIELDNAMES):
                raise CommandError("Input must use the expected CSV headers")
            for row in reader:
                username = _normalise_username(row.get("username", ""))
                role = row.get("role", "")
                if row.get("source") != options["source"] or not username or role not in groups:
                    counters["invalid"] += 1
                    continue
                user = User.objects.filter(username=username).first()
                if user is None:
                    counters["missing"] += 1
                    continue
                if options["dry_run"]:
                    counters["added"] += 1
                    continue
                if add_user_to_group(user, groups[role]):
                    counters["added"] += 1
                else:
                    counters["existing"] += 1
        self.stdout.write(" ".join(f"{name}={value}" for name, value in counters.items()))
