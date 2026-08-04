# Poltekkes authentik OIDC hub

## Goal

Make `sso-polkesma.dploy.id` the central OpenID Connect identity provider for
the Poltekkes applications while keeping their existing local login paths and
application databases intact.

The SSO user journey is:

1. A user signs in to authentik.
2. The authentik user dashboard shows only applications the user may access.
3. Selecting an application starts that application's OIDC launch endpoint.
4. authentik reuses its active session, returns an authorization-code response,
   and the application establishes its normal local PHP session.

No SSO button is added to the existing application login pages. A direct visit
to an existing application login page continues to use its unchanged local
authentication mechanism.

## Applications

The integration covers these production hosts:

| authentik application | Application root | Public host |
| --- | --- | --- |
| Admin SIA | `/home/polkesma/webserv/eAkademik` | `adminsia.poltekkes-malang.ac.id` |
| e-Billing | `/home/polkesma/webserv/ePembayaran` | `e-billing.poltekkes-malang.ac.id` |
| e-Registrasi | `/home/polkesma/webserv/eRegistrasi` | `e-registrasi.poltekkes-malang.ac.id` |
| SIA | `/home/polkesma/webserv/ePortal` | `sia.poltekkes-malang.ac.id` |
| SPMB | `/home/polkesma/webserv/eAdmisi` | `spmb.poltekkes-malang.ac.id` |

The legacy `*.polkesmalang.id` hosts are out of scope.

## Architecture

Each application receives its own confidential OIDC provider and authentik
application. Providers use Authorization Code Flow with PKCE, exact HTTPS
redirect URIs, `state`, and `nonce`. Each application gets a small, dedicated
SSO launch and callback pair. The launch endpoint generates and stores the
transaction state, redirects to authentik, and the callback verifies the code
exchange and claims before creating the application's ordinary local session.

The authentik dashboard card points to the launch endpoint. It is not an OIDC
redirect URI and does not expose a client secret. A user without an authentik
session is shown the authentik login flow; a user with a valid session is
redirected back to the selected application without another password prompt.

OIDC claims are mapped as follows:

- `preferred_username`: canonical NIM/NIP and local-account lookup key.
- `email`: secondary lookup and profile attribute, never a replacement for a
  conflicting username.
- `sub`: immutable authentik subject stored in the application session only.
- group/role claims: reserved for later authorization mapping; this rollout
  does not change existing application authorization.

## User import and password preservation

The importer reads existing application databases only. It writes only to
authentik's PostgreSQL schema `sso`; it does not create, alter, update, or
delete any application table.

Accounts are merged by normalized username. Source precedence is:

1. eAkademik
2. ePembayaran
3. eRegistrasi
4. ePortal
5. eAdmisi

The first source supplies the canonical display data and password hash.
Lower-priority sources may fill missing email, NIM, or NIP data, but cannot
overwrite a populated eAkademik value. A duplicate username with conflicting
email, NIM/NIP, or password hash is written to an import conflict report and
uses the higher-priority source's password hash.

No plaintext password is read, logged, exported, or stored. Before the import,
the implementation identifies the actual legacy password-hash representation
from code and schema metadata. The importer converts it to a Django-compatible
encoded hash or uses a narrowly scoped compatibility verifier. On successful
authentik login, compatible legacy hashes are replaced with authentik's current
strong password hash. Accounts with an unsupported or malformed hash are not
silently accepted; they are reported for an administrator-managed reset.

## Safety, rollout, and rollback

Implementation begins with non-mutating audits of the PHP login/session code
and database metadata, followed by a dry-run import report. The production
import is idempotent and runs only after the report is reviewed.

Each PHP application is changed independently. Its prior application files and
Nginx vhost configuration are backed up, syntax-checked, and deployed
atomically. The verification path uses a designated test account: authenticate
to authentik, open the dashboard card, confirm callback validation and local
session creation, confirm local login remains available, and check logout.

Rollback restores the saved application integration files and removes the
corresponding authentik dashboard application/provider. Imported authentik
users are retained unless an explicit cleanup is approved, so rollback never
alters the source application databases.

## Non-goals

- Replacing or removing existing application login pages.
- Changing application user, role, or business tables.
- Integrating the excluded legacy `*.polkesmalang.id` domains.
- Granting every imported user access to every application by default.
