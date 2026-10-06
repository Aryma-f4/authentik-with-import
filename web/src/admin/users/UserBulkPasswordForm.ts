import "#elements/buttons/SpinnerButton/index";

import { aki } from "#common/api/client";
import {
    parseAPIResponseError,
    pluckErrorDetail,
    pluckFallbackFieldErrors,
} from "#common/errors/network";
import { MessageLevel } from "#common/messages";

import { ModalButton } from "#elements/buttons/ModalButton";
import { showMessage } from "#elements/messages/MessageContainer";

import {
    setTemporaryPasswordForUsers,
    TemporaryPasswordFailure,
    validateTemporaryPassword,
} from "#admin/users/bulkPassword";

import { CoreApi, User } from "@goauthentik/api";

import { msg, str } from "@lit/localize";
import { html, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("ak-user-bulk-password")
export class UserBulkPasswordForm extends ModalButton {
    #api = aki(CoreApi);

    @property({ attribute: false })
    users: User[] = [];

    @state()
    protected password = "";

    @state()
    protected confirmation = "";

    @state()
    protected revealPassword = false;

    @state()
    protected failures: TemporaryPasswordFailure[] = [];

    public override close = () => {
        this.password = "";
        this.confirmation = "";
        this.revealPassword = false;
        this.failures = [];
        this.open = false;
    };

    async #setPasswords(): Promise<void> {
        const validationError = validateTemporaryPassword(this.password, this.confirmation);
        if (validationError) {
            showMessage({ message: validationError, level: MessageLevel.error });
            return;
        }

        const password = this.password;
        const result = await setTemporaryPasswordForUsers(this.users, password, async (user) => {
            try {
                await this.#api.coreUsersSetPasswordCreate({
                    id: user.pk,
                    userPasswordSetRequest: { password },
                });
            } catch (error) {
                const apiError = await parseAPIResponseError(error);
                const fieldError = pluckFallbackFieldErrors(apiError)[0];
                throw new Error(fieldError || pluckErrorDetail(apiError, msg("Unknown error")));
            }
        });

        this.password = "";
        this.confirmation = "";
        this.failures = result.failed;

        showMessage({
            message:
                result.failed.length === 0
                    ? msg(str`Temporary password set for ${result.succeeded.length} user(s).`)
                    : msg(
                          str`Password set for ${result.succeeded.length} user(s); ${result.failed.length} failed.`,
                      ),
            level: result.failed.length === 0 ? MessageLevel.success : MessageLevel.warning,
        });

        if (result.failed.length === 0) {
            this.close();
        }
    }

    public renderModalInner(): TemplateResult {
        return html`<section class="pf-c-modal-box__header pf-c-page__main-section pf-m-light">
                <div class="pf-c-content">
                    <h1 class="pf-c-title pf-m-2xl">${msg("Set temporary password")}</h1>
                </div>
            </section>
            <section class="pf-c-modal-box__body pf-m-light">
                <form
                    class="pf-c-form pf-m-horizontal"
                    @submit=${(event: Event) => event.preventDefault()}
                >
                    <p>
                        ${msg(
                            str`The same temporary password will be set for ${this.users.length} selected user(s).`,
                        )}
                    </p>
                    <div class="pf-c-form__group">
                        <label class="pf-c-form__label" for="bulk-temporary-password">
                            <span class="pf-c-form__label-text">${msg("Temporary password")}</span>
                            <span class="pf-c-form__label-required" aria-hidden="true">&#42;</span>
                        </label>
                        <input
                            id="bulk-temporary-password"
                            class="pf-c-form-control"
                            type=${this.revealPassword ? "text" : "password"}
                            autocomplete="new-password"
                            required
                            .value=${this.password}
                            @input=${(event: Event) => {
                                this.password = (event.target as HTMLInputElement).value;
                            }}
                        />
                    </div>
                    <div class="pf-c-form__group">
                        <label class="pf-c-form__label" for="bulk-temporary-password-confirmation">
                            <span class="pf-c-form__label-text">${msg("Confirm password")}</span>
                            <span class="pf-c-form__label-required" aria-hidden="true">&#42;</span>
                        </label>
                        <input
                            id="bulk-temporary-password-confirmation"
                            class="pf-c-form-control"
                            type=${this.revealPassword ? "text" : "password"}
                            autocomplete="new-password"
                            required
                            .value=${this.confirmation}
                            @input=${(event: Event) => {
                                this.confirmation = (event.target as HTMLInputElement).value;
                            }}
                        />
                    </div>
                    <div class="pf-c-form__group">
                        <label class="pf-c-check">
                            <input
                                class="pf-c-check__input"
                                type="checkbox"
                                .checked=${this.revealPassword}
                                @change=${(event: Event) => {
                                    this.revealPassword = (
                                        event.target as HTMLInputElement
                                    ).checked;
                                }}
                            />
                            <span class="pf-c-check__label">${msg("Show password")}</span>
                        </label>
                    </div>
                    ${this.failures.length > 0
                        ? html`<div class="pf-c-alert pf-m-inline pf-m-danger">
                              <p class="pf-c-alert__title">
                                  ${msg("Some passwords could not be set")}
                              </p>
                              <ul>
                                  ${this.failures.map(
                                      (failure) =>
                                          html`<li>${failure.username}: ${failure.message}</li>`,
                                  )}
                              </ul>
                          </div>`
                        : nothing}
                </form>
            </section>
            <fieldset class="ak-c-fieldset pf-c-modal-box__footer">
                <legend class="sr-only">${msg("Form actions")}</legend>
                <ak-spinner-button .callAction=${async () => this.close()} class="pf-m-plain">
                    ${msg("Cancel")}
                </ak-spinner-button>
                <ak-spinner-button .callAction=${() => this.#setPasswords()} class="pf-m-primary">
                    ${msg("Set password")}
                </ak-spinner-button>
            </fieldset>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-user-bulk-password": UserBulkPasswordForm;
    }
}
