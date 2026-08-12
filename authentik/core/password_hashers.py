"""Temporary password hashers for securely migrating legacy accounts."""

from hashlib import md5

from django.contrib.auth.hashers import BasePasswordHasher, mask_hash
from django.utils.crypto import constant_time_compare
from django.utils.translation import gettext_noop as _


class LegacyPoltekkesMD5PasswordHasher(BasePasswordHasher):
    """Verify an unsalted legacy MD5 digest and force an upgrade after login."""

    algorithm = "poltekkes_md5"

    def encode(self, password, salt=""):
        digest = md5(password.encode()).hexdigest()  # nosec: legacy migration verifier
        return f"{self.algorithm}${digest}"

    def decode(self, encoded):
        algorithm, digest = encoded.split("$", 1)
        assert algorithm == self.algorithm
        return {"algorithm": algorithm, "hash": digest}

    def verify(self, password, encoded):
        return constant_time_compare(encoded, self.encode(password))

    def safe_summary(self, encoded):
        decoded = self.decode(encoded)
        return {_("algorithm"): decoded["algorithm"], _("hash"): mask_hash(decoded["hash"])}

    def must_update(self, encoded):
        return True
