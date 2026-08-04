# Poltekkes authentik OIDC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users sign into authentik once and launch five Poltekkes PHP applications from its dashboard, while preserving every existing local-login path and application database.

**Architecture:** authentik supplies a distinct confidential OIDC client per application. A small PHP adapter in each application implements an SSO-only launch/callback pair using Authorization Code Flow with PKCE, `state`, and `nonce`; the callback reuses the application's existing local-session registration code. A custom authentik import command reads source accounts, deduplicates by username using the agreed precedence, and writes only to the `sso` schema.

**Tech Stack:** authentik/Django 5.2, PostgreSQL schema `sso`, OAuth 2.0/OIDC, PHP legacy/GTFW, Nginx, shell, Docker Compose.

## Global Constraints

- The legacy `*.polkesmalang.id` domains are out of scope.
- OIDC is additive only: do not replace, disable, redirect, or edit existing local-login logic or URLs.
- Never change application user, role, session, or business tables; source databases are read-only.
- Never log, print, export, or persist plaintext passwords, client secrets, API tokens, or database credentials.
- User merge key is normalized username; precedence is eAkademik, ePembayaran, eRegistrasi, ePortal, then eAdmisi.
- Exact HTTPS redirect URIs, PKCE, `state`, and `nonce` are mandatory; no wildcard callback URLs.
- A release is accepted only after both dashboard SSO and the pre-existing direct login work with the same test account.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `authentik/core/management/commands/import_poltekkes_users.py` | Read-only source import, precedence merge, encoded-hash conversion, conflict CSV. |
| `authentik/core/tests/test_import_poltekkes_users.py` | Merge, conflict, and password-hash tests. |
| `blueprints/custom/poltekkes-oidc.yaml` | Managed OIDC providers, applications, scopes, and launch URLs. |
| `scripts/poltekkes/import-users.sh` | Container entrypoint that mounts a root-only source configuration and runs dry-run/import. |
| `/home/polkesma/webserv/<app>/sso/oidc.php` | Shared per-application OIDC primitives: session transaction, authorize URL, token exchange, ID-token validation. |
| `/home/polkesma/webserv/<app>/sso/login.php` | Dashboard launch URL; creates PKCE transaction then redirects to authentik. |
| `/home/polkesma/webserv/<app>/sso/callback.php` | Validates OIDC response and invokes the application's established session-registration path. |
| `/etc/nginx/conf.d/*.poltekkes-malang.ac.id.conf` | Explicitly permit only each `/sso/` PHP adapter path if the current PHP location block does not already cover it. |

`<app>` is one of `eAkademik`, `ePembayaran`, `eRegistrasi`, `ePortal`, or `eAdmisi`. Do not create a shared writable directory inside the web roots; secrets belong in root-owned configuration outside each document root.

### Task 1: Capture a safe, read-only source inventory and rollback baseline

**Files:**
- Create: `/home/sani/poltekkes-oidc/audit/README.md`
- Create: `/home/sani/poltekkes-oidc/audit/schema-summary.json`
- Create: `/home/sani/poltekkes-oidc/backups/<timestamp>/`
- Modify: none
- Test: no code; read-only SQL metadata and syntax checks

**Consumes:** The five application roots and the existing authentik Compose deployment.

**Produces:** A source-to-table mapping, hash-format evidence, row counts, a collision count, and restorable copies of only files that will be edited.

- [ ] **Step 1: Record file and service baseline without reading secrets**

  Run:

  ```sh
  ssh -p 5617 sani@125.213.128.249 \
    'nginx -t && for d in /home/polkesma/webserv/eAkademik /home/polkesma/webserv/ePembayaran /home/polkesma/webserv/eRegistrasi /home/polkesma/webserv/ePortal /home/polkesma/webserv/eAdmisi; do git -C "$d" status --short; done'
  ```

  Expected: Nginx reports successful syntax; record existing application changes without modifying them.

- [ ] **Step 2: Identify actual authentication tables and hash representations**

  Use each application's existing root-owned database configuration locally on the VM, but query only metadata and aggregate values. For ePortal, start from `module/login/business/gatekeeper.sql.php`, which selects `t_user.tusrNama` and `t_user.tusrPassword`. Produce output shaped like:

  ```json
  {
    "ePortal": {"table": "t_user", "username_column": "tusrNama", "hash_lengths": {"32": 0}, "rows": 0},
    "eAkademik": {"table": "...", "username_column": "...", "hash_lengths": {}, "rows": 0}
  }
  ```

  Do not include usernames, hashes, connection strings, passwords, or email addresses in the report.

- [ ] **Step 3: Verify the import preconditions fail closed**

  Run a metadata query that counts (without selecting) blank usernames, duplicate normalized usernames, unsupported hash lengths/prefixes, and same-username/different-hash conflicts. Expected: every unresolved result has a count and source label; no rows are imported.

- [ ] **Step 4: Back up only planned integration targets**

  Copy the selected login/session source files and each active `*.poltekkes-malang.ac.id.conf` into `/home/sani/poltekkes-oidc/backups/<UTC timestamp>/`, preserve modes/ownership metadata, and write SHA-256 checksums. Expected: no application or database content changes.

- [ ] **Step 5: Commit the audit tooling only**

  ```sh
  git add scripts/poltekkes
  git commit -m "chore: add Poltekkes SSO audit tooling"
  ```

### Task 2: Implement the authentik user importer with tests

**Files:**
- Create: `authentik/core/management/commands/import_poltekkes_users.py`
- Create: `authentik/core/tests/test_import_poltekkes_users.py`
- Create: `scripts/poltekkes/import-users.sh`
- Modify: `docker-compose.yml`
- Test: `authentik/core/tests/test_import_poltekkes_users.py`

**Consumes:** Source descriptors from Task 1, with each query executed by a database role granted `SELECT` only.

**Produces:** `ak import_poltekkes_users --dry-run` and `--apply`, with deterministic winner selection and a conflict report containing no password hashes.

- [ ] **Step 1: Write failing merge tests**

  Add tests that exercise a pure function:

  ```python
  def merge_records(records: list[ImportedRecord]) -> tuple[list[ImportedRecord], list[ImportConflict]]: ...

  def test_merge_records_prefers_eakademik_password_and_fills_missing_email():
      winners, conflicts = merge_records([
          ImportedRecord("ePortal", "P123", "portal@example.invalid", "hash-portal"),
          ImportedRecord("eAkademik", "P123", "", "hash-akademik"),
      ])
      assert winners[0].password_hash == "hash-akademik"
      assert winners[0].email == "portal@example.invalid"
      assert conflicts[0].kind == "password_hash_conflict"
  ```

- [ ] **Step 2: Run the focused test and confirm it fails**

  Run: `make test authentik/core/tests/test_import_poltekkes_users.py`

  Expected: FAIL because `ImportedRecord` and `merge_records` do not exist.

- [ ] **Step 3: Implement pure precedence and validation code**

  Define `SOURCE_PRIORITY = ("eAkademik", "ePembayaran", "eRegistrasi", "ePortal", "eAdmisi")`. Normalize usernames with `strip().casefold()`. Reject empty usernames and invalid email values; preserve only the winning hash; append a conflict record for differing non-empty values. Conflict output contains source names and a reason, never the original value or hash.

- [ ] **Step 4: Add encoded-hash conversion tests before conversion code**

  Add parameterized tests for the exact hash representation found in Task 1. For a raw MD5 digest the required result is `md5$$<digest>` and `check_password(plain, encoded)` must be true. For a bcrypt or Django-encoded value, assert it is retained only if `identify_hasher(encoded)` succeeds. Unsupported values must return an import error, not an unusable account.

- [ ] **Step 5: Run converter tests and confirm they fail**

  Run: `make test authentik/core/tests/test_import_poltekkes_users.py`

  Expected: FAIL because `encode_legacy_password_hash` does not exist.

- [ ] **Step 6: Implement importer command and safe execution wrapper**

  `Command.handle()` must require exactly one of `--dry-run` or `--apply`, load descriptors from a root-owned JSON file mounted read-only as `/run/secrets/poltekkes-import-sources.json`, and use a `transaction.atomic()` block only around writes to authentik users. It writes `<timestamp>-conflicts.csv` with columns `username,kind,winner_source,other_source` and mode `0600`.

  `scripts/poltekkes/import-users.sh` must invoke:

  ```sh
  docker compose exec -T server ak import_poltekkes_users --dry-run --report /var/lib/authentik/import-report
  ```

  and require an explicit `--apply` argument to perform writes.

- [ ] **Step 7: Run importer tests and static checks**

  Run:

  ```sh
  make test authentik/core/tests/test_import_poltekkes_users.py
  make lint
  ```

  Expected: PASS. No source database modification occurs during tests.

- [ ] **Step 8: Commit the importer**

  ```sh
  git add authentik/core/management/commands/import_poltekkes_users.py authentik/core/tests/test_import_poltekkes_users.py scripts/poltekkes/import-users.sh docker-compose.yml
  git commit -m "feat: import Poltekkes SSO users safely"
  ```

### Task 3: Declare managed authentik applications and OIDC providers

**Files:**
- Create: `blueprints/custom/poltekkes-oidc.yaml`
- Test: blueprint validation and provider tests

**Consumes:** The five public hosts and each `/sso/callback.php` endpoint.

**Produces:** Five dashboard cards and five independent confidential OIDC clients.

- [ ] **Step 1: Write a failing blueprint/provider test**

  Create a test that loads the blueprint and asserts five providers, each with exactly one `RedirectURIMatchingMode.STRICT` URI and no `implicit` grant type:

  ```python
  assert provider.redirect_uris[0].url == "https://sia.poltekkes-malang.ac.id/sso/callback.php"
  assert provider.client_type == ClientType.CONFIDENTIAL
  assert "implicit" not in provider.grant_types
  ```

- [ ] **Step 2: Run the test and confirm it fails**

  Run: `make test authentik/providers/oauth2/tests/test_provider.py`

  Expected: FAIL because the Poltekkes blueprint is absent.

- [ ] **Step 3: Add the blueprint**

  Define providers for Admin SIA, e-Billing, e-Registrasi, SIA, and SPMB. Use `authorization_code`, confidential client type, strict callback URI, `openid email profile` scopes, and a launch URL ending in `/sso/login.php`. Assign each authentik application only to its intended access group; do not use an all-users binding.

- [ ] **Step 4: Apply only in preview, then test**

  Run:

  ```sh
  docker compose exec -T server ak apply_blueprint /blueprints/custom/poltekkes-oidc.yaml --dry-run
  make test authentik/providers/oauth2/tests
  ```

  Expected: preview creates/updates only the five managed OIDC objects and tests pass.

- [ ] **Step 5: Commit blueprint and tests**

  ```sh
  git add blueprints/custom/poltekkes-oidc.yaml authentik/providers/oauth2/tests
  git commit -m "feat: add Poltekkes OIDC applications"
  ```

### Task 4: Implement and prove the SIA/ePortal OIDC adapter first

**Files:**
- Create: `/home/polkesma/webserv/ePortal/sso/oidc.php`
- Create: `/home/polkesma/webserv/ePortal/sso/login.php`
- Create: `/home/polkesma/webserv/ePortal/sso/callback.php`
- Modify: `/home/polkesma/webserv/ePortal/module/login/display/proses_login.class.php`
- Modify: `/etc/nginx/conf.d/sia.poltekkes-malang.ac.id.conf` only if `nginx -t` shows `/sso/*.php` is not handled by the existing PHP location.
- Test: `/home/polkesma/webserv/ePortal/tests/sso/oidc_test.php`

**Consumes:** OIDC client ID and root-owned client secret, available only to the PHP-FPM user through `/etc/poltekkes-oidc/sia.conf` mode `0640` with a dedicated group.

**Produces:** A dashboard-only SSO entry point that calls the existing `GateKeeper` session registration without running `Authenticate()` again.

- [ ] **Step 1: Write adapter tests first**

  Test `build_authorize_url()` for required query fields and `validate_callback()` for rejection of invalid state, absent code, invalid nonce, issuer mismatch, audience mismatch, and expired token. Test that `complete_local_session($username)` calls a new `ProsesLogin::LoginFromSso($username)` path that registers the existing session ID but never calls `GateKeeper::Authenticate`.

- [ ] **Step 2: Run the adapter test and confirm it fails**

  Run: `php /home/polkesma/webserv/ePortal/tests/sso/oidc_test.php`

  Expected: FAIL because adapter functions and `LoginFromSso` are absent.

- [ ] **Step 3: Add the minimal SSO session bridge**

  Add only this behavior to `ProsesLogin`:

  ```php
  function LoginFromSso($user) {
      $this->mGateKeeper = new GateKeeper($this->mrConfig);
      $current = $this->mGateKeeper->IsUserSessionRegistered(session_id());
      if ($current !== false) $this->DoLogout($current);
      return $this->mGateKeeper->DoRegisterUserSessionId(session_id(), $user);
  }
  ```

  Do not alter `LoginCheck`, the local login form, or `GateKeeper::Authenticate`.

- [ ] **Step 4: Implement `/sso/login.php` and `/sso/callback.php`**

  `login.php` stores 32-byte random `state`, 32-byte random `nonce`, PKCE verifier, and the validated same-origin return path in PHP session, then redirects to authentik. `callback.php` consumes those values once, exchanges the code over TLS using the confidential secret, verifies discovery/JWKS issuer/audience/nonce/expiry, uses `preferred_username` as the only local lookup key, confirms that it exists in `t_user`, and calls `LoginFromSso`. On any error, clear the transaction and return HTTP 400/403 without creating a session.

- [ ] **Step 5: Run tests and syntax checks**

  Run:

  ```sh
  php /home/polkesma/webserv/ePortal/tests/sso/oidc_test.php
  php -l /home/polkesma/webserv/ePortal/sso/oidc.php
  php -l /home/polkesma/webserv/ePortal/sso/login.php
  php -l /home/polkesma/webserv/ePortal/sso/callback.php
  nginx -t
  ```

  Expected: PASS; the direct `module/login/view_login.php` flow remains unchanged.

- [ ] **Step 6: Manually verify both paths before rollout**

  With the designated test user: open `https://sso-polkesma.dploy.id`, select SIA, and verify the local SIA session. Then use a private browser window to open `https://sia.poltekkes-malang.ac.id` and log in using the existing page. Expected: both succeed; no application DB writes beyond the application's normal pre-existing login session updates.

- [ ] **Step 7: Commit the ePortal adapter in its own repository**

  ```sh
  git -C /home/polkesma/webserv/ePortal add sso module/login/display/proses_login.class.php
  git -C /home/polkesma/webserv/ePortal commit -m "feat: add dashboard OIDC login"
  ```

### Task 5: Roll out the proven adapter to the other four applications

**Files:**
- Create: `/home/polkesma/webserv/eAkademik/sso/{oidc.php,login.php,callback.php}`
- Create: `/home/polkesma/webserv/ePembayaran/sso/{oidc.php,login.php,callback.php}`
- Create: `/home/polkesma/webserv/eRegistrasi/sso/{oidc.php,login.php,callback.php}`
- Create: `/home/polkesma/webserv/eAdmisi/sso/{oidc.php,login.php,callback.php}`
- Modify: each application's existing session-registration class only
- Test: one `tests/sso/oidc_test.php` per application

**Consumes:** Task 4's proven flow and each application's existing successful-login method.

**Produces:** Four more independently launchable authentik dashboard applications.

- [ ] **Step 1: For one application at a time, write a failing bridge test**

  The test must assert: valid signed claim with existing username produces the existing local session; invalid state/nonce/token/unknown username produces no session; direct legacy login source is byte-for-byte unchanged.

- [ ] **Step 2: Run the focused test and confirm it fails**

  Run: `php /home/polkesma/webserv/<app>/tests/sso/oidc_test.php`

  Expected: FAIL because its SSO bridge does not exist.

- [ ] **Step 3: Implement the minimum adapter and local-session hook**

  Reuse only the protocol primitives from Task 4. Adapt the last step to each application's native session code: eAkademik begins at `login.php`/`sql/sql_login.php`; ePembayaran, eRegistrasi, and eAdmisi begin at `module/login_default/business/login.service.class.php` and `module/login_default/response/DoLogin.html.class.php`. Do not call, edit, or bypass their password-verification methods for direct login.

- [ ] **Step 4: Verify tests, PHP syntax, Nginx syntax, dashboard launch, and direct login**

  Run the Task 4 validation sequence for the individual application before continuing to the next. Expected: both flows pass before another application is touched.

- [ ] **Step 5: Commit each application separately**

  Use one commit per application: `feat: add dashboard OIDC login`. Never bundle unrelated application changes.

### Task 6: Apply managed configuration, import accounts, and close out safely

**Files:**
- Create: `/home/sani/poltekkes-oidc/audit/<timestamp>-final-report.md`
- Create: `/home/sani/poltekkes-oidc/runbooks/rollback.md`
- Modify: none outside the approved SSO schema and adapters
- Test: end-to-end smoke test for every dashboard card and both login paths

**Consumes:** Passing tasks 1–5, reviewed dry-run report, and an approved maintenance window.

**Produces:** Active SSO dashboard, idempotently imported users, a conflict report, and tested rollback instructions.

- [ ] **Step 1: Execute and review the dry run**

  Run `scripts/poltekkes/import-users.sh` without `--apply`. Record only source totals, winners, conflict counts, and invalid-hash counts. Obtain explicit approval if invalid hashes or conflicts need user intervention.

- [ ] **Step 2: Apply the blueprint and import exactly once**

  Run:

  ```sh
  docker compose exec -T server ak apply_blueprint /blueprints/custom/poltekkes-oidc.yaml
  scripts/poltekkes/import-users.sh --apply
  ```

  Expected: writes occur only in authentik schema `sso`; each imported username is unique.

- [ ] **Step 3: End-to-end acceptance**

  For Admin SIA, e-Billing, e-Registrasi, SIA, and SPMB: authenticate at authentik, click the dashboard card, verify correct host and local session; separately verify direct local login in a private window. Record pass/fail only—no passwords or tokens.

- [ ] **Step 4: Test rollback**

  In a maintenance-safe test, restore one application's backup files, run `nginx -t`, reload Nginx, and verify its local login. Remove only its managed authentik provider/application; do not delete imported SSO users or touch source databases.

- [ ] **Step 5: Commit runbooks and final report templates**

  ```sh
  git add docs/superpowers scripts/poltekkes
  git commit -m "docs: add Poltekkes SSO rollout runbook"
  ```
