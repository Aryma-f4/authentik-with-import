# Poltekkes SSO Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a secure, illustrated operational guide to the Poltekkes Malang SSO deployment in Markdown, DOCX, and PDF.

**Architecture:** Maintain Markdown as the canonical content source. Generate the DOCX with deterministic Python document helpers and create the PDF by rendering the verified DOCX, so all distribution formats stay aligned. Use only diagrams and screenshots without credentials.

**Tech Stack:** Markdown, Python with python-docx and Pillow, LibreOffice renderer, Poppler.

## Global Constraints

- Do not include secrets, passwords, tokens, or database credentials.
- Do not modify Authentik production configuration, application source, or any application database.
- Use the `compact_reference_guide` document preset with Letter pages, 1-inch margins, and fixed-width tables.
- Include only SIA, eAkademik, e-Billing, and e-Registrasi; eAdmisi is excluded.
- Render and visually inspect every DOCX and PDF page before delivery.

---

### Task 1: Draft the canonical Markdown guide

**Files:**
- Create: `output/markdown/Panduan-SSO-Poltekkes-Malang.md`

**Produces:** Secure, complete source text covering architecture, role policy, user OIDC, M2M JWT, operations, and troubleshooting.

- [ ] **Step 1: Draft the guide with explicit sections for administrators and developers.**
- [ ] **Step 2: Check the source for sensitive-value patterns and replace any accidental value with a placeholder.**
- [ ] **Step 3: Verify required headings and application scope are present.**

### Task 2: Create diagrams and safe supporting figures

**Files:**
- Create: `output/assets/poltekkes-sso-login-flow.png`
- Create: `output/assets/poltekkes-sso-m2m-flow.png`
- Create: `output/assets/poltekkes-sso-group-setup.png`
- Create: `output/assets/poltekkes-sso-service-account.png`

**Produces:** Four figures that explain browser login, M2M JWT, group policy, and service-account purpose without exposing confidential fields.

- [ ] **Step 1: Build two labelled flow diagrams with an accessible color palette.**
- [ ] **Step 2: Copy only safe supplied screenshots and label them as configuration examples.**
- [ ] **Step 3: Inspect each figure for readable labels and sensitive content.**

### Task 3: Generate the DOCX operator/developer guide

**Files:**
- Create: `scripts/create_poltekkes_sso_guide.py`
- Create: `output/docx/Panduan-SSO-Poltekkes-Malang.docx`

**Consumes:** The Markdown structure and safe figures from Tasks 1-2.

**Produces:** A print-ready DOCX with controlled heading styles, diagrams, screenshots, procedure steps, checklists, and page footer.

- [ ] **Step 1: Encode the `compact_reference_guide` geometry, typography, table, header, and footer tokens in the builder.**
- [ ] **Step 2: Generate DOCX sections and figures using only placeholders for client credentials and tokens.**
- [ ] **Step 3: Run a structural check for required headings, figures, and secret-like values.**

### Task 4: Render, inspect, and publish all formats

**Files:**
- Create: `output/pdf/Panduan-SSO-Poltekkes-Malang.pdf`

**Consumes:** Verified DOCX from Task 3.

**Produces:** Visually checked DOCX and PDF distribution files.

- [ ] **Step 1: Render DOCX into page PNGs and inspect every page for layout defects.**
- [ ] **Step 2: Iterate on the DOCX builder if a page has clipped text, broken tables, overlap, or an unbalanced break.**
- [ ] **Step 3: Create the PDF from the final DOCX, render the PDF into page PNGs, and inspect every page.**
- [ ] **Step 4: Confirm final file paths and source/document content alignment.**
