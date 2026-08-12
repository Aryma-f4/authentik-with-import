# SIA legacy MD5 SSO design

## Purpose

Enable SIA portal users to authenticate through Authentik while retaining their
existing portal passwords during migration. The ePortal database remains
read-only throughout the rollout.

## Scope

- Source identities from the portal `t_user` table, using the existing
  username and raw legacy MD5 password hash.
- Import each unique username once into Authentik.
- Keep local SIA login working unchanged.
- Add an OAuth2/OIDC provider and launch application for
  `sia.poltekkes-malang.ac.id` only after a pilot account succeeds.
- Support a post-login upgrade from the legacy MD5 hash to Authentik's normal
  PBKDF2 hash.

## Out of scope

- No writes to ePortal or eAkademik databases.
- No password reset or password change in the portal.
- No deployment secrets, Coolify configuration, Docker Compose files, or
  credentials committed to this repository.
- No use of direct PostgreSQL writes to Authentik internal tables.

## Architecture

The existing Authentik source is built into a versioned derived image. The only
runtime change is that Coolify deploys this image for both the `server` and
`worker` services.

The image includes a `poltekkes_md5` Django password hasher. It compares a
candidate password with the imported raw MD5 digest. It returns `must_update`,
so a successful login immediately rehashes the password with Authentik's
standard PBKDF2 hasher.

A one-shot management command imports a read-only export of portal account
records. It normalizes usernames, skips duplicate usernames, validates the MD5
format, and reports conflicts without printing a password hash. The importer is
executed inside the deployed Authentik image rather than updating PostgreSQL
tables directly.

After a pilot import and login are verified, a SIA OAuth2 provider will issue
tokens whose `preferred_username` is the portal username. A portal-only
callback validates OIDC state and PKCE, looks up the existing local portal user,
then creates the same native portal session as the current login flow. It does
not validate or write the portal password.

## Data flow

1. Read portal username and MD5 hash through the existing VM access.
2. Transfer only the temporary import data to the Authentik management command.
3. Import unique identities into Authentik using `poltekkes_md5` hashes.
4. User authenticates at Authentik with the existing password.
5. Authentik verifies MD5, immediately upgrades the stored password hash, and
   issues an OIDC authorization code.
6. SIA exchanges the code with PKCE and establishes its native login session
   for the matching local user.

## Verification

- Unit tests prove valid raw MD5 credentials verify and require rehashing;
  invalid credentials do not verify.
- Importer tests cover normalization, deduplication, malformed-hash skipping,
  and no sensitive values in report output.
- A pilot user is imported without changes to source databases.
- A real login proves Authentik password verification, hash upgrade, OIDC token
  exchange, and the SIA native session.
- Existing portal password login is tested before and after the rollout.

## Rollback

Rolling back the Coolify image reference restores the previous Authentik image.
Imported Authentik users remain but do not affect ePortal. The SIA launch card
is not published until the pilot succeeds; if needed, its provider/application
can be disabled through the Authentik API.
