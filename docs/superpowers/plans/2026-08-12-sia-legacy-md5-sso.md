# SIA Legacy MD5 SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate existing SIA portal identities with legacy MD5 password hashes into Authentik and allow a successful OIDC login to create the existing SIA portal session.

**Architecture:** Build the existing Authentik source into one versioned image containing a narrowly scoped `poltekkes_md5` Django hasher and a one-shot importer. Both Coolify `server` and `worker` use that image. A portal export is read-only; the importer uses Authentik's ORM, deduplicates usernames, and causes each verified MD5 password to be rehashed with PBKDF2 after first login.

**Tech Stack:** Authentik/Django, Python, Django password hashers, PHP 5.4 portal callback, OAuth2/OIDC Authorization Code + PKCE, Coolify, GHCR.

## Global Constraints

- Do not write to ePortal or eAkademik databases.
- Do not commit deployment secrets, Coolify settings, Docker Compose files, or credentials.
- Do not write directly to Authentik PostgreSQL tables; use the Authentik ORM/API only.
- Preserve the existing portal login flow unchanged.
- Accept only a 32-character hexadecimal raw MD5 digest from the portal.
- Deployed `server` and `worker` use the same immutable GHCR image tag.
- Do not publish the SIA dashboard application until a pilot login succeeds.

---

### Task 1: Complete and prove legacy MD5 verification

**Files:**
- Modify: `authentik/core/password_hashers.py`
- Modify: `authentik/core/tests/test_import_poltekkes_users.py`
- Modify: `authentik/root/settings.py`

**Interfaces:**
- Produces: `LegacyPoltekkesMD5PasswordHasher` with algorithm `poltekkes_md5`.
- Produces: `check_password(plain, "poltekkes_md5$<digest>") == True` and `verify_password(...)[1] == True`.

- [ ] **Step 1: Add a failing verification and rehash test**

```python
from authentik.lib.utils.reflection import verify_password

def test_valid_raw_md5_verifies_and_requires_rehash(self):
    encoded = "poltekkes_md5$5f4dcc3b5aa765d61d8327deb882cf99"
    self.assertTrue(check_password("password", encoded))
    self.assertEqual(verify_password("password", encoded), (True, True))
```

- [ ] **Step 2: Run the focused test and confirm it fails before the hasher is registered**

Run: `uv run pytest authentik/core/tests/test_import_poltekkes_users.py -k rehash -v`

Expected: FAIL because the legacy hasher is not available to the test settings.

- [ ] **Step 3: Register the legacy hasher after modern preferred hashers**

```python
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "authentik.core.password_hashers.LegacyPoltekkesMD5PasswordHasher",
]
```

Keep `verify()` constant-time and `must_update()` returning `True`; do not add a general MD5 hasher.

- [ ] **Step 4: Run the focused test and all importer-helper tests**

Run: `uv run pytest authentik/core/tests/test_import_poltekkes_users.py -v`

Expected: PASS with valid MD5 verification, invalid-password rejection, malformed-hash rejection, and rehash requirement.

- [ ] **Step 5: Commit the focused change**

```bash
git add authentik/core/password_hashers.py authentik/core/tests/test_import_poltekkes_users.py authentik/root/settings.py
git commit -m "feat: verify legacy SIA MD5 passwords"
```

### Task 2: Implement the one-shot ORM importer

**Files:**
- Modify: `authentik/core/management/commands/import_poltekkes_users.py`
- Modify: `authentik/core/tests/test_import_poltekkes_users.py`

**Interfaces:**
- Consumes: UTF-8 CSV with headers `source,username,name,email,password_hash`.
- Produces: `manage.py import_poltekkes_users --input /data/sia-users.csv --source ePortal --dry-run`.
- Produces: no duplicate `authentik_core_user.username`; no password value or digest in stdout/stderr.

- [ ] **Step 1: Add failing command tests for create, duplicate skip, and invalid hash skip**

```python
call_command("import_poltekkes_users", "--input", csv_path, "--source", "ePortal")
self.assertTrue(User.objects.filter(username="portal-user").exists())
self.assertEqual(User.objects.filter(username="portal-user").count(), 1)
self.assertIn("invalid_hash=1", output.getvalue())
```

Use temporary CSV rows with a known test digest only. Assert the output reports counters, never `password_hash` values.

- [ ] **Step 2: Run command tests and confirm they fail because no `Command` exists**

Run: `uv run pytest authentik/core/tests/test_import_poltekkes_users.py -k importer -v`

Expected: FAIL with an unknown command or missing created user.

- [ ] **Step 3: Implement `Command(BaseCommand)` in the existing module**

```python
parser.add_argument("--input", required=True)
parser.add_argument("--source", choices=("ePortal",), required=True)
parser.add_argument("--dry-run", action="store_true")
```

Read with `csv.DictReader`, normalize via `_normalise_username`, validate via `encode_legacy_password_hash`, and call `User.objects.get_or_create(username=username, defaults={...})`. On create, set `user.password` to the encoded legacy value and save only that Authentik user. On existing username, skip without overwriting password, profile, groups, or attributes. Print only `created`, `existing`, `invalid_hash`, `blank_username`, and `conflict` counters.

- [ ] **Step 4: Run the command tests and full focused test module**

Run: `uv run pytest authentik/core/tests/test_import_poltekkes_users.py -v`

Expected: PASS and output contains no fixture MD5 digest.

- [ ] **Step 5: Commit the importer**

```bash
git add authentik/core/management/commands/import_poltekkes_users.py authentik/core/tests/test_import_poltekkes_users.py
git commit -m "feat: import legacy SIA portal users"
```

### Task 3: Add a read-only SIA export utility

**Files:**
- Create: `scripts/poltekkes/eportal/export_legacy_users.php`
- Create: `scripts/poltekkes/eportal/test_export_legacy_users.php`

**Interfaces:**
- Produces: CSV on stdout with `source,username,name,email,password_hash`.
- Consumes: the portal's existing configuration and read-only `t_user` data.
- Produces: exit code `0` only when all emitted rows have a nonblank username and a 32-character hexadecimal password digest.

- [ ] **Step 1: Write a failing fixture test for CSV redaction-safe serialization**

```php
$row = array('tusrNama' => 'portal-user', 'tusrPassword' => '5f4dcc3b5aa765d61d8327deb882cf99');
assert(export_legacy_user_row($row)['username'] === 'portal-user');
assert(export_legacy_user_row($row)['source'] === 'ePortal');
```

- [ ] **Step 2: Run the PHP 5.4 fixture test and confirm it fails before the function exists**

Run: `/opt/remi/php54/root/usr/bin/php scripts/poltekkes/eportal/test_export_legacy_users.php`

Expected: FAIL with an undefined `export_legacy_user_row` function.

- [ ] **Step 3: Implement a CLI-only export utility**

```php
if (php_sapi_name() !== 'cli') { fwrite(STDERR, "CLI only\n"); exit(2); }
fputcsv(STDOUT, array('source', 'username', 'name', 'email', 'password_hash'));
```

Load the portal configuration, query only `tusrNama`, `tusrEmail`, and `tusrPassword`, validate the hash with `preg_match('/^[a-f0-9]{32}$/i', ...)`, and write CSV to stdout. Do not log records, connection settings, or hashes. Run it remotely with the ePortal PHP 5.4 executable and redirect stdout to a protected temporary file outside the web root.

- [ ] **Step 4: Run fixture test, PHP lint, and export metadata check**

Run:

```bash
/opt/remi/php54/root/usr/bin/php scripts/poltekkes/eportal/test_export_legacy_users.php
/opt/remi/php54/root/usr/bin/php -l scripts/poltekkes/eportal/export_legacy_users.php
```

Expected: both commands exit `0`; the production export count is recorded without printing users or hashes.

- [ ] **Step 5: Commit export utility and test**

```bash
git add scripts/poltekkes/eportal
git commit -m "feat: export SIA legacy users safely"
```

### Task 4: Build and deploy the immutable Authentik image

**Files:**
- Modify: none in the repository beyond Tasks 1–3.
- Modify in Coolify only: service `f2v3c9zow71nfnyp8h8r0ejw` image references for `server` and `worker`.

**Interfaces:**
- Consumes: current repository commit and `lifecycle/container/Dockerfile`.
- Produces: `ghcr.io/aryma-f4/server:poltekkes-md5-v1`.
- Produces: both service containers on the same image digest.

- [ ] **Step 1: Verify source tree and tag the release candidate locally**

Run:

```bash
git status --short
git rev-parse --verify HEAD
```

Expected: no uncommitted source changes and a recorded commit SHA.

- [ ] **Step 2: Build the existing Dockerfile without adding deployment files**

Run:

```bash
DOCKER_IMAGE=ghcr.io/aryma-f4/server:poltekkes-md5-v1 make docker
```

Expected: build exits `0` and image label revision matches the recorded commit.

- [ ] **Step 3: Push the immutable image tag to the existing GHCR namespace**

Run:

```bash
docker push ghcr.io/aryma-f4/server:poltekkes-md5-v1
```

Expected: push exits `0`; record the resulting image digest from `docker inspect`.

- [ ] **Step 4: Change exactly two Coolify image references and deploy**

In service `authentik-sso-polkesma`, change `server.image` and `worker.image` from `ghcr.io/aryma-f4/server:latest` to `ghcr.io/aryma-f4/server:poltekkes-md5-v1`. Leave Redis, database environment variables, volumes, commands, domains, and all other service settings unchanged. Deploy the service once.

- [ ] **Step 5: Verify both runtime roles and retain rollback value**

Check the Coolify deployment status and call `GET /api/v3/core/users/32/` using the Authentik API token.

Expected: `server` and `worker` healthy; API returns HTTP `200`. Rollback value is the prior `ghcr.io/aryma-f4/server:latest` reference.

### Task 5: Pilot import and first-login password upgrade

**Files:**
- Modify: none.
- Temporary artifact outside repositories and web roots: `/data/sia-users.csv` in the Authentik service runtime.

**Interfaces:**
- Consumes: protected pilot CSV from Task 3.
- Produces: one Authentik user with `password` beginning `poltekkes_md5$`, then a PBKDF2 prefix after real login.

- [ ] **Step 1: Export exactly one authorized pilot account read-only**

Run the Task 3 utility on the VM, piping its output through a username filter before transfer. Confirm only a header and one data row are present using `wc -l`; do not print the row.

- [ ] **Step 2: Run the importer in dry-run mode inside the deployed Authentik image**

Run:

```bash
ak manage import_poltekkes_users --input /data/sia-users.csv --source ePortal --dry-run
```

Expected: `created=1` in the summary; no user data or hash appears in output.

- [ ] **Step 3: Run the importer once without `--dry-run`**

Run:

```bash
ak manage import_poltekkes_users --input /data/sia-users.csv --source ePortal
```

Expected: `created=1`; repeating the command reports `existing=1`.

- [ ] **Step 4: Verify the stored hash type through the Authentik ORM**

Run a management shell query that prints only `user.password.split('$', 1)[0]` for the authorized pilot.

Expected: `poltekkes_md5` before first Authentik password login.

- [ ] **Step 5: Authenticate once at Authentik and verify upgrade**

Use the pilot's existing portal username/password only at the Authentik login page. Repeat the Task 5 Step 4 prefix check.

Expected: the prefix changes from `poltekkes_md5` to `pbkdf2_sha256` (or the configured preferred modern hasher).

### Task 6: Add the SIA OIDC adapter and publish it after pilot success

**Files:**
- Create: `scripts/poltekkes/eportal/oauth2_login.php`
- Create: `scripts/poltekkes/eportal/oauth2_callback.php`
- Create: `scripts/poltekkes/eportal/oauth.config.php`
- Modify in Authentik API: OAuth2 provider and application only after Task 5 succeeds.

**Interfaces:**
- `oauth2_login.php`: starts native portal session, generates state and S256 PKCE, redirects to Authentik.
- `oauth2_callback.php`: validates state, exchanges code, reads `preferred_username`, verifies the portal user exists, and establishes the native portal session.
- Provider redirect URI: `https://sia.poltekkes-malang.ac.id/sso/callback.php`.

- [ ] **Step 1: Write failing PHP 5.4 tests for state validation and portal-user mapping**

```php
assert(oauth_state_matches('expected', 'expected') === true);
assert(oauth_state_matches('expected', 'other') === false);
assert(oauth_portal_username(array('preferred_username' => 'portal-user')) === 'portal-user');
```

- [ ] **Step 2: Run PHP 5.4 tests and confirm they fail before helper functions exist**

Run: `/opt/remi/php54/root/usr/bin/php scripts/poltekkes/eportal/test_oauth2_callback.php`

Expected: FAIL with undefined helper functions.

- [ ] **Step 3: Implement callback using only OIDC state, PKCE, token, userinfo, and native session APIs**

```php
if (!oauth_state_matches($_SESSION['oauth_state'], $_GET['state'])) {
    oauth_fail('state_mismatch');
}
```

Reuse the portal's own session startup and user lookup code. Never call password verification, password update, or a portal write query from the callback. Log only bounded error codes such as `state_mismatch`, `token_error`, `userinfo_missing_username`, and `unknown_portal_user`.

- [ ] **Step 4: Run PHP 5.4 lint and test suite, then deploy adapter files**

Run:

```bash
/opt/remi/php54/root/usr/bin/php -l scripts/poltekkes/eportal/oauth2_login.php
/opt/remi/php54/root/usr/bin/php -l scripts/poltekkes/eportal/oauth2_callback.php
/opt/remi/php54/root/usr/bin/php scripts/poltekkes/eportal/test_oauth2_callback.php
```

Expected: all commands exit `0`. Deploy only the two endpoints and a PHP configuration file containing the provider-specific client secret; do not modify native login source or Nginx.

- [ ] **Step 5: Create the Authentik provider/application and test all boundaries**

Create a confidential authorization-code provider with strict callback URL, scopes `openid profile email`, and PKCE S256. Create the dashboard application with launch URL `https://sia.poltekkes-malang.ac.id/sso/login.php` only after the provider and callback tests pass.

Verify: existing portal password login works; SSO card redirects to Authentik; pilot returns to SIA with native session; direct callback without state is rejected; rollback hides the card and restores the prior image reference if needed.

- [ ] **Step 6: Commit the adapter and tests**

```bash
git add scripts/poltekkes/eportal
git commit -m "feat: add SIA OIDC adapter"
```

## Plan self-review

- Spec coverage: MD5 verification (Task 1), deduplicated Authentik ORM migration (Task 2), read-only portal export (Task 3), image deployment without repository deployment configuration (Task 4), pilot/rehash verification (Task 5), and SIA native-session OIDC integration (Task 6).
- Placeholder scan: no deferred implementation labels or undefined interfaces remain.
- Type consistency: CSV headers, `poltekkes_md5` algorithm name, `ePortal` source name, and SIA callback URLs are used consistently throughout.
