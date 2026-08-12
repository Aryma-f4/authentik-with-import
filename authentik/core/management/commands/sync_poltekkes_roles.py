"""Synchronise read-only legacy role exports into Authentik groups."""

import csv

from django.core.management.base import BaseCommand, CommandError

from authentik.core.management.commands.import_poltekkes_users import (
    _normalise_username,
    open_import_input,
)
from authentik.core.models import Group, User, UserGroup

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


def missing_group_memberships(group, users, member_ids, membership_factory=UserGroup):
    """Build only the through-model rows not already present in a role group."""

    return [
        membership_factory(user=user, group=group) for user in users if user.pk not in member_ids
    ]


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
        usernames_by_role = {role: set() for role in ROLE_GROUPS}
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
                usernames_by_role[role].add(username)

        for role, usernames in usernames_by_role.items():
            if not usernames:
                continue
            group = groups[role]
            users = list(User.objects.filter(username__in=usernames).only("id", "username"))
            counters["missing"] += len(usernames) - len(users)
            existing_ids = set(
                UserGroup.objects.filter(group=group, user__in=users).values_list(
                    "user_id", flat=True
                )
            )
            memberships = missing_group_memberships(group, users, existing_ids)
            counters["existing"] += len(users) - len(memberships)
            counters["added"] += len(memberships)
            if not options["dry_run"] and memberships:
                UserGroup.objects.bulk_create(memberships, batch_size=1000, ignore_conflicts=True)
        self.stdout.write(" ".join(f"{name}={value}" for name, value in counters.items()))
