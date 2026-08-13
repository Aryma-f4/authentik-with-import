# Poltekkes Malang SSO Documentation Design

## Purpose

Produce one operator-and-developer guide for the Poltekkes Malang Authentik SSO deployment, delivered in Markdown, DOCX, and PDF. It must help administrators operate the identity platform and help developers integrate or diagnose OAuth2/OIDC flows without exposing credentials.

## Audience

- IT administrators: providers, applications, groups, policies, service accounts, monitoring, rotation, and recovery.
- Application developers: browser login, callback handling, PKCE, JWT validation, API machine-to-machine authentication, and error diagnosis.

## Deliverables

- Markdown: canonical, versionable source document.
- DOCX: polished field guide using the `compact_reference_guide` visual preset and an editorial-cover opening.
- PDF: distribution copy rendered from the verified DOCX.

## Content Boundary

The guide covers Authentik as the central identity provider; SIA, eAkademik, e-Billing, and e-Registrasi; legacy login preservation; student/staff access policy; user OIDC; API M2M JWT; security; and troubleshooting. eAdmisi is explicitly excluded from the documented rollout.

The guide must not contain passwords, client secrets, PATs, database credentials, raw JWTs, or unredacted screenshots containing them. It should describe sensitive values with placeholders and redact or omit sensitive portions of screenshots.

## Reader Experience

The guide begins with a one-page overview, then provides a shared architecture and two clearly-labelled perspectives: **Administrator** and **Developer**. Procedures use numbered steps; repeated facts use concise tables. Each OAuth flow has a diagram and a minimum working request shape using placeholders.

Two safe UI screenshots illustrate the API service-account group setup. Diagrams cover the browser login flow and M2M service-token flow. A troubleshooting matrix maps common OAuth error messages to checks and safe remediations.

## Acceptance Criteria

- All three files communicate the same substantive guidance.
- Markdown has no secrets and uses only safe placeholders.
- DOCX includes title, document-control information, contents, headings, diagrams, safe screenshots, tables, footer page numbers, and a revision notice.
- DOCX is rendered to PNGs and inspected page by page.
- PDF is produced from the verified DOCX, rendered to PNGs, and inspected.
- Final output paths are stable under the workspace `output/` directory.
