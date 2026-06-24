import "#elements/buttons/SpinnerButton/index";

import { aki } from "#common/api/client";
import { EVENT_REFRESH } from "#common/constants";
import { downloadFile } from "#common/download";
import { parseAPIResponseError, pluckErrorDetail } from "#common/errors/network";
import { MessageLevel } from "#common/messages";

import { ModalButton } from "#elements/buttons/ModalButton";
import { showMessage } from "#elements/messages/MessageContainer";
import { SlottedTemplateResult } from "#elements/types";

import {
    EXAMPLE_USER_CSV,
    parseUserCSV,
    UserCSVParseResult,
    UserCSVRowError,
} from "#admin/users/csv";

import { CoreApi } from "@goauthentik/api";

import { msg, str } from "@lit/localize";
import { css, CSSResult, html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

interface ImportSummary {
    created: number;
    failed: UserCSVRowError[];
}

@customElement("ak-user-csv-import")
export class UserCSVImportForm extends ModalButton {
    #coreAPI = aki(CoreApi);

    @state()
    protected csvText = "";

    @state()
    protected parseResult: UserCSVParseResult | null = null;

    @state()
    protected importing = false;

    @state()
    protected summary: ImportSummary | null = null;

    static styles: CSSResult[] = [
        ...ModalButton.styles,
        css`
            .pf-c-form__group textarea {
                min-height: 12rem;
                font-family: var(--pf-global--FontFamily--monospace);
            }
            .ak-csv-feedback {
                margin-top: 1rem;
            }
            .ak-csv-feedback ul {
                margin: 0.5rem 0 0 1rem;
                list-style: disc;
            }
        `,
    ];

    public override close = () => {
        this.csvText = "";
        this.parseResult = null;
        this.summary = null;
        this.importing = false;
        this.open = false;
    };

    #parse(text: string): void {
        this.csvText = text;
        this.summary = null;
        this.parseResult = text.trim() ? parseUserCSV(text) : null;
    }

    #onTextInput(event: Event): void {
        const target = event.target as HTMLTextAreaElement;
        this.#parse(target.value);
    }

    async #onFileInput(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
            return;
        }

        const text = await file.text();
        this.#parse(text);
    }

    #downloadExample(): void {
        downloadFile({
            content: EXAMPLE_USER_CSV,
            filename: "authentik-users-example.csv",
            type: "text/csv",
        });
    }

    async #import(): Promise<void> {
        const result = this.parseResult;

        if (!result || result.users.length === 0) {
            showMessage({
                message: msg("There are no valid users to import."),
                level: MessageLevel.error,
            });
            return;
        }

        this.importing = true;

        const summary: ImportSummary = { created: 0, failed: [...result.errors] };

        for (const { line, user } of result.users) {
            try {
                await this.#coreAPI.coreUsersCreate({
                    userRequest: {
                        ...user,
                        groups: [],
                        roles: [],
                    },
                });
                summary.created += 1;
            } catch (error) {
                const apiError = await parseAPIResponseError(error);
                summary.failed.push({
                    line,
                    message: msg(
                        str`${user.username}: ${pluckErrorDetail(apiError, msg("Unknown error"))}`,
                    ),
                });
            }
        }

        this.importing = false;
        this.summary = summary;

        if (summary.created > 0) {
            this.dispatchEvent(
                new CustomEvent(EVENT_REFRESH, {
                    bubbles: true,
                    composed: true,
                }),
            );
        }

        showMessage({
            message:
                summary.failed.length === 0
                    ? msg(str`Successfully imported ${summary.created} user(s).`)
                    : msg(
                          str`Imported ${summary.created} user(s), ${summary.failed.length} row(s) failed.`,
                      ),
            level: summary.failed.length === 0 ? MessageLevel.success : MessageLevel.warning,
        });
    }

    protected renderErrorList(title: string, errors: UserCSVRowError[]): TemplateResult {
        return html`<div class="pf-c-alert pf-m-inline pf-m-danger ak-csv-feedback">
            <div class="pf-c-alert__icon">
                <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
            </div>
            <p class="pf-c-alert__title">${title}</p>
            <div class="pf-c-alert__description">
                <ul>
                    ${errors.map(
                        (error) => html`<li>${msg(str`Line ${error.line}: ${error.message}`)}</li>`,
                    )}
                </ul>
            </div>
        </div>`;
    }

    protected renderFeedback(): SlottedTemplateResult {
        if (this.summary) {
            return html`<div class="pf-c-alert pf-m-inline pf-m-success ak-csv-feedback">
                    <div class="pf-c-alert__icon">
                        <i class="fas fa-check-circle" aria-hidden="true"></i>
                    </div>
                    <p class="pf-c-alert__title">
                        ${msg(str`Created ${this.summary.created} user(s).`)}
                    </p>
                </div>
                ${this.summary.failed.length > 0
                    ? this.renderErrorList(
                          msg(str`${this.summary.failed.length} row(s) could not be imported:`),
                          this.summary.failed,
                      )
                    : nothing}`;
        }

        if (!this.parseResult) {
            return nothing;
        }

        const { users, errors } = this.parseResult;

        return html`<div class="pf-c-alert pf-m-inline pf-m-info ak-csv-feedback">
                <div class="pf-c-alert__icon">
                    <i class="fas fa-info-circle" aria-hidden="true"></i>
                </div>
                <p class="pf-c-alert__title">
                    ${msg(str`${users.length} valid user(s) ready to import.`)}
                </p>
            </div>
            ${errors.length > 0
                ? this.renderErrorList(msg(str`${errors.length} row(s) will be skipped:`), errors)
                : nothing}`;
    }

    public renderModalInner(): TemplateResult {
        const validCount = this.parseResult?.users.length ?? 0;

        return html`<section class="pf-c-modal-box__header pf-c-page__main-section pf-m-light">
                <div class="pf-c-content">
                    <h1 class="pf-c-title pf-m-2xl">${msg("Import users from CSV")}</h1>
                </div>
            </section>
            <section class="pf-c-modal-box__body pf-m-light">
                <form class="pf-c-form pf-m-horizontal">
                    <p>
                        ${msg(
                            "Upload or paste a CSV file to create multiple users at once. The first row must be a header. The only required column is 'username'; supported columns are username, name, email, type, is_active and path.",
                        )}
                    </p>
                    <div class="pf-c-form__group">
                        <label class="pf-c-form__label" for="csv-file">
                            <span class="pf-c-form__label-text">${msg("CSV file")}</span>
                        </label>
                        <input
                            id="csv-file"
                            type="file"
                            accept=".csv,text/csv"
                            class="pf-c-form-control"
                            @change=${(ev: Event) => this.#onFileInput(ev)}
                        />
                    </div>
                    <div class="pf-c-form__group">
                        <label class="pf-c-form__label" for="csv-text">
                            <span class="pf-c-form__label-text"
                                >${msg("Or paste CSV content")}</span
                            >
                        </label>
                        <textarea
                            id="csv-text"
                            class="pf-c-form-control"
                            .value=${this.csvText}
                            @input=${(ev: Event) => this.#onTextInput(ev)}
                            placeholder=${EXAMPLE_USER_CSV}
                        ></textarea>
                    </div>
                    <div class="pf-c-form__group">
                        <button
                            type="button"
                            class="pf-c-button pf-m-link pf-m-inline"
                            @click=${() => this.#downloadExample()}
                        >
                            <i class="fas fa-download" aria-hidden="true"></i>&nbsp;${msg(
                                "Download example CSV",
                            )}
                        </button>
                    </div>
                    ${this.renderFeedback()}
                </form>
            </section>
            <fieldset class="ak-c-fieldset pf-c-modal-box__footer">
                <legend class="sr-only">${msg("Form actions")}</legend>
                <ak-spinner-button
                    .callAction=${async () => {
                        this.close();
                    }}
                    class="pf-m-plain"
                    >${msg("Cancel")}</ak-spinner-button
                >
                <ak-spinner-button
                    .callAction=${() => this.#import()}
                    ?disabled=${validCount === 0 || this.importing}
                    class="pf-m-primary"
                    >${msg("Import")}</ak-spinner-button
                >
            </fieldset>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-user-csv-import": UserCSVImportForm;
    }
}
