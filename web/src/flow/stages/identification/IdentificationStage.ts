import "#elements/Divider";
import "#elements/EmptyState";
import "#flow/components/ak-flow-card";
import "#flow/components/ak-flow-password-input";
import "#flow/stages/captcha/CaptchaStage";

import { renderSourceIcon } from "#elements/sources/utils";

import { AKFormErrors } from "#components/ak-field-errors";
import { AKLabel } from "#components/ak-label";

import { BaseStage } from "#flow/stages/base";
import AutoRedirect from "#flow/stages/identification/controllers/AutoRedirectController";
import CaptchaDisplayController from "#flow/stages/identification/controllers/CaptchaDisplayController";
import RememberMeController from "#flow/stages/identification/controllers/RememberMeController";
import WebauthnController from "#flow/stages/identification/controllers/WebauthnController";
import PoltekkesStyles from "#flow/stages/identification/poltekkes-login.css";
import Styles from "#flow/stages/identification/styles.css";
import { compareLoginSource } from "#flow/stages/identification/utils";

import {
    FlowDesignationEnum,
    IdentificationChallenge,
    IdentificationChallengeResponseRequest,
    LoginChallengeTypes,
    LoginSource,
} from "@goauthentik/api";

import { kebabCase } from "change-case";

import { msg, str } from "@lit/localize";
import { html, nothing, PropertyValues, ReactiveControllerHost } from "lit";
import { createRef, ref } from "lit-html/directives/ref.js";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";

import PFAlert from "@patternfly/patternfly/components/Alert/alert.css";
import PFButton from "@patternfly/patternfly/components/Button/button.css";
import PFForm from "@patternfly/patternfly/components/Form/form.css";
import PFFormControl from "@patternfly/patternfly/components/FormControl/form-control.css";
import PFInputGroup from "@patternfly/patternfly/components/InputGroup/input-group.css";
import PFLogin from "@patternfly/patternfly/components/Login/login.css";
import PFTitle from "@patternfly/patternfly/components/Title/title.css";

type IdentificationFooter = Partial<Pick<IdentificationChallenge, "enrollUrl" | "recoveryUrl">>;

const POLTEKKES_LOGO_URL = "/static/dist/assets/images/poltekkes-logo.png";

export type IdentificationHost = IdentificationStage & ReactiveControllerHost;

export const PasswordManagerPrefill: {
    password?: string;
    totp?: string;
} = {};

@customElement("ak-stage-identification")
export class IdentificationStage extends BaseStage<
    IdentificationChallenge,
    IdentificationChallengeResponseRequest
> {
    static styles = [
        PFAlert,
        PFInputGroup,
        PFLogin,
        PFForm,
        PFFormControl,
        PFTitle,
        PFButton,
        ...RememberMeController.styles,
        Styles,
        PoltekkesStyles,
    ];

    /**
     * The ID of the identifier input field, used for accessibility and focus management.
     *
     * @attr
     */
    @property({ type: String, attribute: "input-id" })
    public inputID = "ak-identifier-input";

    protected passwordFieldRef = createRef<HTMLInputElement>();

    #form?: HTMLFormElement;

    public defaultUserIdentification: string | null = null;

    protected rememberMeController: RememberMeController | null = null;

    #autoRedirect = new AutoRedirect(this);
    #captcha = new CaptchaDisplayController(this);
    #webauthn = new WebauthnController(this);

    //#endregion

    //#region Lifecycle

    constructor() {
        super();
        // We _define and instantiate_ these fields above, then _read_ them here, and that satisfies
        // the lint pass that there are no unused private fields.
        this.addController(this.#autoRedirect);
        this.addController(this.#captcha);
        this.addController(this.#webauthn);
    }

    #prepareRememberMeFrame = -1;

    public override updated(changedProperties: PropertyValues<this>) {
        super.updated(changedProperties);

        if (changedProperties.has("challenge") && this.challenge) {
            cancelAnimationFrame(this.#prepareRememberMeFrame);

            this.#prepareRememberMeFrame = requestAnimationFrame(() => {
                this.prepareRememberMeController();
            });

            this.#createHelperForm();
        }
    }

    public override connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("focus", this.autofocusTarget.toEventListener());
    }

    public override disconnectedCallback(): void {
        super.disconnectedCallback();

        cancelAnimationFrame(this.#prepareRememberMeFrame);
    }

    public override firstUpdated(): void {
        this.focus();
    }

    protected prepareRememberMeController(): void {
        if (!this.challenge) return;

        const { enableRememberMe, pendingUserIdentifier = null } = this.challenge;

        if (!enableRememberMe) {
            this.defaultUserIdentification = pendingUserIdentifier;

            if (this.rememberMeController) {
                this.removeController(this.rememberMeController);
                this.rememberMeController = null;
            }

            return;
        }

        if (!this.rememberMeController) {
            this.rememberMeController = new RememberMeController(this, {
                identificationFieldID: this.inputID,
                identificationFieldRef: this.autofocusTarget.reference,
                passwordFieldRef: this.passwordFieldRef,
                pendingUserIdentifier,
            });

            this.addController(this.rememberMeController);
        }

        this.defaultUserIdentification = this.rememberMeController.defaultUserIdentification;
    }

    //#endregion

    //#region Helper Form

    #createHelperForm(): void {
        const compatMode = "ShadyDOM" in window;
        this.#form = document.createElement("form");
        document.documentElement.appendChild(this.#form);
        // Only add the additional username input if we're in a shadow dom
        // otherwise it just confuses browsers
        if (!compatMode) {
            // This is a workaround for the fact that we're in a shadow dom
            // adapted from https://github.com/home-assistant/frontend/issues/3133
            const username = document.createElement("input");
            username.setAttribute("type", "text");
            username.setAttribute("name", "username"); // username as name for high compatibility
            username.setAttribute("autocomplete", "username");
            username.onkeyup = (ev: Event) => {
                const el = ev.target as HTMLInputElement;
                (this.shadowRoot || this)
                    .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                    .forEach((input) => {
                        input.value = el.value;
                        // Because we assume only one input field exists that matches this
                        // call focus so the user can press enter
                        input.focus();
                    });
            };
            this.#form.appendChild(username);
        }
        // Only add the password field when we don't already show a password field
        if (!compatMode && !this.challenge?.passwordFields) {
            const password = document.createElement("input");
            password.setAttribute("type", "password");
            password.setAttribute("name", "password");
            password.setAttribute("autocomplete", "current-password");
            password.onkeyup = (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.submitForm();
                }

                const el = event.target as HTMLInputElement;
                // Because the password field is not actually on this page,
                // and we want to 'prefill' the password for the user,
                // save it globally
                PasswordManagerPrefill.password = el.value;
                // Because password managers fill username, then password,
                // we need to re-focus the uid_field here too
                (this.shadowRoot || this)
                    .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                    .forEach((input) => {
                        // Because we assume only one input field exists that matches this
                        // call focus so the user can press enter
                        input.focus();
                    });
            };

            this.#form.appendChild(password);
        }

        const totp = document.createElement("input");

        totp.setAttribute("type", "text");
        totp.setAttribute("name", "code");
        totp.setAttribute("autocomplete", "one-time-code");
        totp.onkeyup = (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.submitForm();
            }

            const el = event.target as HTMLInputElement;
            // Because the totp field is not actually on this page,
            // and we want to 'prefill' the totp for the user,
            // save it globally
            PasswordManagerPrefill.totp = el.value;
            // Because totp managers fill username, then password, then optionally,
            // we need to re-focus the uid_field here too
            (this.shadowRoot || this)
                .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                .forEach((input) => {
                    // Because we assume only one input field exists that matches this
                    // call focus so the user can press enter
                    input.focus();
                });
        };

        this.#form.appendChild(totp);
    }

    //#endregion

    protected override onSubmitSuccess(): void {
        this.#form?.remove();
    }

    protected override onSubmitFailure(): void {
        this.#captcha.onFailure();
    }

    #dispatchChallengeToHost = (challenge: LoginChallengeTypes) => {
        if (!this.host) return;
        this.host.challenge = challenge;
    };

    protected renderRecoveryMessage() {
        return html`
            <p>${msg("Enter the email address or username associated with your account.")}</p>
        `;
    }

    protected renderUidField(
        id: string,
        type: "email" | "text",
        label: string,
        initialUserIdentification: string | null,
        passwordFields?: boolean,
    ) {
        // When webauthn is enabled, add "webauthn" to autocomplete to enable passkey autofill
        let autocomplete: AutoFill = type === "email" ? "email" : "username";

        if (this.#webauthn.live) {
            autocomplete = `${autocomplete} webauthn`;
        }

        const iconClass = type === "email" ? "fa-envelope" : "fa-user";

        return html`<div class="ak-poltekkes-input-wrap">
            <i class="fas ${iconClass} ak-poltekkes-input-icon" aria-hidden="true"></i>
            <input
                ${ref(this.autofocusTarget.reference)}
                id=${id}
                type=${type}
                name="uidField"
                placeholder=${label}
                autofocus
                autocomplete=${autocomplete}
                spellcheck="false"
                inputmode=${type === "email" ? "email" : "text"}
                autocapitalize="none"
                enterkeyhint=${passwordFields ? "next" : "go"}
                class="pf-c-form-control"
                value=${initialUserIdentification ?? ""}
                required
            />
        </div>`;
    }

    protected renderPasswordFields(challenge: IdentificationChallenge) {
        const { allowShowPassword } = challenge;
        return html`<ak-flow-input-password
            .inputRef=${this.passwordFieldRef}
            label=${msg("Password")}
            placeholder=${msg("Please enter your password", {
                id: "identification.password.placeholder",
            })}
            input-id="ak-stage-identification-password"
            class="pf-c-form__group ak-poltekkes-password-input"
            .errors=${challenge.responseErrors?.password}
            ?allow-show-password=${allowShowPassword}
            prefill=${PasswordManagerPrefill.password ?? ""}
        ></ak-flow-input-password> `;
    }

    protected renderRememberMe() {
        return (
            this.rememberMeController?.renderToggleInput() ??
            html`<label class="remember-me-switch">
                <input class="pf-c-check__input" type="checkbox" name="remember-me" />
                <span class="pf-c-check__label"
                    >${msg("Remember me", { id: "identification.remember-me.label" })}</span
                >
            </label>`
        );
    }

    protected renderInput(challenge: IdentificationChallenge) {
        const { flowDesignation, passwordFields, passwordlessUrl, recoveryUrl } = challenge;

        const { inputID, defaultUserIdentification: initialUserIdentification } = this;

        const offerRecovery = flowDesignation === FlowDesignationEnum.Recovery;

        const label = msg("Username or Email", { id: "identification.email.label" });
        const placeholder = msg("username or email", {
            id: "identification.email.placeholder",
        });

        // prettier-ignore
        return html`${offerRecovery ? this.renderRecoveryMessage() : nothing}
            <div class="pf-c-form__group">
                ${AKLabel({ required: true, htmlFor: inputID }, label)}
                ${this.renderUidField(inputID, "text", placeholder, initialUserIdentification, true)}
                ${AKFormErrors({ errors: challenge.responseErrors?.uid_field })}
            </div>
            ${this.renderPasswordFields(challenge)}
            <div class="ak-poltekkes-form-options">
                ${this.renderRememberMe()}
                ${recoveryUrl
                    ? html`<a class="ak-poltekkes-link" href=${recoveryUrl}
                           data-ouia-component-id="recovery">${msg("Forgot password?", { id: "identification.forgot-password.label" })}</a>`
                    : nothing}
            </div>
            ${this.renderNonFieldErrors()}
            ${this.#captcha.render()}
            <div class="pf-c-form__group ${this.#captcha.live ? "" : "pf-m-action"}">
                <button
                    ?disabled=${this.#captcha.pending}
                    type="submit"
                    class="ak-poltekkes-submit"
                >
                    ${msg("Sign in", { id: "identification.submit.label" })}
                </button>
            </div>
            ${passwordlessUrl ? html`<ak-divider>${msg("Or")}</ak-divider>` : nothing}`;
    }

    protected renderPrelude(prelude: string) {
        return html`<p>${msg(str`Log in to continue to ${prelude}.`)}</p>`;
    }

    protected renderPasswordlessUrl(url: string) {
        return html`<a
            href=${url}
            class="pf-c-button pf-m-secondary pf-m-block"
            data-ouia-component-id="passwordless"
        >
            ${msg("Use a security key")}
        </a> `;
    }

    //#region Render
    protected renderDefaultSource(source: LoginSource, showLabels: boolean) {
        const { name, iconUrl, challenge } = source;

        const icon = renderSourceIcon(name, iconUrl);
        return html`<button
            type="button"
            @click=${() => this.#dispatchChallengeToHost(challenge)}
            part="source-item"
            name=${`source-${kebabCase(name)}`}
            class="pf-c-button source-button"
            aria-label=${msg(str`Continue with ${name}`)}
        >
            <span class="pf-c-button__icon pf-m-start">${icon}</span>
            ${showLabels ? name : ""}
        </button>`;
    }

    protected renderPromotedSource(source: LoginSource) {
        const { name, challenge } = source;

        return html`<button
            type="button"
            @click=${() => this.#dispatchChallengeToHost(challenge)}
            part="source-item source-item-promoted"
            name=${`source-${kebabCase(name)}`}
            class="pf-c-button pf-m-primary pf-m-block source-button source-button-promoted"
            aria-label=${msg(str`Continue with ${name}`)}
        >
            ${msg(str`Continue with ${name}`)}
        </button>`;
    }

    protected renderLoginSource(source: LoginSource, showLabels: boolean) {
        return source.promoted
            ? this.renderPromotedSource(source)
            : this.renderDefaultSource(source, showLabels);
    }

    protected renderLoginSources(sources: LoginSource[], showLabels: boolean) {
        return html`<fieldset
            slot="footer"
            part="source-list"
            name="login-sources"
            class="ak-c-fieldset pf-c-form__group"
        >
            <legend class="sr-only">${msg("Login sources")}</legend>
            ${repeat(
                [...sources].sort(compareLoginSource),
                (source, idx) => source.name + idx,
                (source) => this.renderLoginSource(source, showLabels),
            )}
        </fieldset> `;
    }

    protected renderIdentificationStage(challenge: IdentificationChallenge) {
        const { applicationPre, passwordlessUrl, showSourceLabels, sources = [] } = challenge;

        return html`
            <form class="pf-c-form ak-poltekkes-form" @submit=${this.submitForm}>
                ${applicationPre ? this.renderPrelude(applicationPre) : nothing}
                ${this.renderInput(challenge)}
                ${passwordlessUrl ? this.renderPasswordlessUrl(passwordlessUrl) : nothing}
            </form>
            ${sources.length ? this.renderLoginSources(sources, showSourceLabels) : nothing}
        `;
    }

    protected renderFooter({ enrollUrl, recoveryUrl }: IdentificationFooter) {
        if (!(enrollUrl || recoveryUrl)) {
            return nothing;
        }

        return html`<fieldset
            slot="footer-band"
            part="additional-actions"
            name="additional-actions"
            class="ak-c-fieldset pf-c-login__main-footer-band"
        >
            <legend class="sr-only">${msg("Additional actions")}</legend>
            ${enrollUrl
                ? html`<div class="pf-c-login__main-footer-band-item">
                      ${msg("Need an account?")}
                      <a href="${enrollUrl}" data-ouia-component-id="enroll">${msg("Sign up.")}</a>
                  </div>`
                : nothing}
            ${recoveryUrl
                ? html`<div class="pf-c-login__main-footer-band-item">
                      <a href="${recoveryUrl}" data-ouia-component-id="recovery"
                          >${msg("Forgot username or password?")}</a
                      >
                  </div>`
                : nothing}
        </fieldset>`;
    }

    public override render() {
        const { challenge } = this;
        const { enrollUrl } = challenge ?? {};

        if (!challenge) {
            return html`<ak-flow-card .challenge=${challenge} part="flow-card"></ak-flow-card>`;
        }

        return html`<div
            class="ak-poltekkes-wrapper ${classMap({
                "ak-poltekkes-theme-dark": this.activeTheme === "dark",
            })}"
        >
            <div class="ak-poltekkes-card">
                <div class="ak-poltekkes-card-header">
                    <img
                        src=${POLTEKKES_LOGO_URL}
                        alt="${msg("Poltekkes Kemenkes Malang", {
                            id: "identification.logo.alt-text",
                        })}"
                    />
                </div>
                ${this.renderIdentificationStage(challenge)}
            </div>
            <div class="ak-poltekkes-help">
                ${msg("Need help?", { id: "identification.help.prefix" })}
                <a href="mailto:admin@poltekkes-malang.ac.id"
                    >${msg("Contact an Administrator", { id: "identification.help.link" })}</a
                >
            </div>
            ${enrollUrl
                ? html`<div class="ak-poltekkes-help">
                      ${msg("Need an account?", { id: "identification.enroll.prefix" })}
                      <a href="${enrollUrl}" data-ouia-component-id="enroll"
                          >${msg("Sign up.", { id: "identification.enroll.link" })}</a
                      >
                  </div>`
                : nothing}
        </div>`;
    }

    //#endregion

    public override async submitForm(
        event?: SubmitEvent,
        defaults?: IdentificationChallengeResponseRequest,
    ): Promise<boolean> {
        const password = this.passwordFieldRef.value?.value;
        if (password) {
            PasswordManagerPrefill.password = password;
        }
        return super.submitForm(event, defaults);
    }
}

export default IdentificationStage;

declare global {
    interface HTMLElementTagNameMap {
        "ak-stage-identification": IdentificationStage;
    }
}
