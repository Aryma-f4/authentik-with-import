import "#flow/FormStatic";
import "#flow/components/ak-flow-card";
import "#flow/components/ak-flow-password-input";

import { ErrorProp } from "#components/ak-field-errors";

import { FlowUserDetails } from "#flow/FormStatic";
import { BaseStage } from "#flow/stages/base";
import { PasswordManagerPrefill } from "#flow/stages/identification/IdentificationStage";

import { PasswordChallenge, PasswordChallengeResponseRequest } from "@goauthentik/api";

import { msg } from "@lit/localize";
import { CSSResult, html, PropertyValues, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";

import PFButton from "@patternfly/patternfly/components/Button/button.css";
import PFForm from "@patternfly/patternfly/components/Form/form.css";
import PFFormControl from "@patternfly/patternfly/components/FormControl/form-control.css";
import PFInputGroup from "@patternfly/patternfly/components/InputGroup/input-group.css";
import PFLogin from "@patternfly/patternfly/components/Login/login.css";
import PFTitle from "@patternfly/patternfly/components/Title/title.css";

@customElement("ak-stage-password")
export class PasswordStage extends BaseStage<PasswordChallenge, PasswordChallengeResponseRequest> {
    static styles: CSSResult[] = [PFLogin, PFInputGroup, PFForm, PFFormControl, PFButton, PFTitle];

    #autoSubmitted = false;

    get #willAutoSubmit(): boolean {
        if (this.#autoSubmitted) return false;

        const hasErrors =
            this.challenge?.responseErrors?.password ||
            this.challenge?.responseErrors?.non_field_errors;

        return !!PasswordManagerPrefill.password && !hasErrors;
    }

    #errors(field: string): ErrorProp[] | undefined {
        const errors = this.challenge?.responseErrors?.[field];

        return errors;
    }

    public override firstUpdated(changedProperties: PropertyValues): void {
        super.firstUpdated(changedProperties);

        if (this.#willAutoSubmit) {
            this.#autoSubmitted = true;

            // The password was captured on the identification stage. Auto-submit it
            // directly instead of reading the (unrendered) form's FormData, which would
            // be empty and fail validation with "This field is required".
            const password = PasswordManagerPrefill.password;

            this.updateComplete.then(() => this.submitForm(undefined, { password }));
        }
    }

    render(): TemplateResult {
        // The password was already captured on the identification stage and will be
        // auto-submitted immediately. Render a loading card instead of the form so the
        // user never sees a flash of a password field between stages.
        if (this.#willAutoSubmit) {
            return html`<ak-flow-card .challenge=${this.challenge} loading></ak-flow-card>`;
        }

        return html`<ak-flow-card .challenge=${this.challenge}>
            <form class="pf-c-form" @submit=${this.submitForm}>
                ${FlowUserDetails({ challenge: this.challenge })}

                <input
                    name="username"
                    type="text"
                    autocomplete="username"
                    hidden
                    readonly
                    value="${this.challenge?.pendingUser ?? ""}"
                />
                <ak-flow-input-password
                    label=${msg("Password")}
                    grab-focus
                    class="pf-c-form__group"
                    .errors=${this.#errors("password")}
                    ?allow-show-password=${!!this.challenge?.allowShowPassword}
                    prefill=${PasswordManagerPrefill.password ?? ""}
                ></ak-flow-input-password>
                <fieldset class="ak-c-fieldset pf-c-form__group pf-m-action">
                    <legend class="sr-only">${msg("Form actions")}</legend>
                    <button
                        name="continue"
                        type="submit"
                        class="pf-c-button pf-m-primary pf-m-block"
                    >
                        ${msg("Continue")}
                    </button>
                </fieldset>
            </form>
            ${this.challenge?.recoveryUrl
                ? html`<fieldset
                      slot="footer-band"
                      part="additional-actions"
                      name="additional-actions"
                      class="ak-c-fieldset pf-c-login__main-footer-band"
                  >
                      <legend class="sr-only">${msg("Additional actions")}</legend>
                      <div class="pf-c-login__main-footer-band-item">
                          <a href="${this.challenge.recoveryUrl}">${msg("Forgot password?")}</a>
                      </div>
                  </fieldset>`
                : null}
        </ak-flow-card>`;
    }
}

export default PasswordStage;

declare global {
    interface HTMLElementTagNameMap {
        "ak-stage-password": PasswordStage;
    }
}
