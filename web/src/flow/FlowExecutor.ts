import "#elements/LoadingOverlay";
import "#flow/components/ak-brand-footer";
import "#flow/components/ak-flow-card";
import "#flow/inspector/FlowInspectorButton";
import "#flow/tabs/broadcast";

import { FlowIframeMessageController } from "./controllers/FlowIframeMessageController";
import { FlowMultitabController } from "./controllers/FlowMultitabController";
import { FlowWebsocketClientController } from "./controllers/FlowWebsocketClientController";
import Styles from "./FlowExecutor.css" with { type: "bundled-text" };

import { aki } from "#common/api/client";
import { APIError, parseAPIResponseError, pluckErrorDetail } from "#common/errors/network";
import { globalAK } from "#common/global";
import { configureSentry } from "#common/sentry/index";
import {
    AKBackgroundImageProperty,
    applyBackgroundImageProperty,
    applyThemeChoice,
} from "#common/theme";
import type { TargetLanguageTag } from "#common/ui/locale/definitions";
import { getSessionLocale, setSessionLocale } from "#common/ui/locale/utils";
import { AKSessionAuthenticatedEvent } from "#common/ws/events";

import { listen } from "#elements/decorators/listen";
import { Interface } from "#elements/Interface";
import { showAPIErrorMessage } from "#elements/messages/MessageContainer";
import { WithBrandConfig } from "#elements/mixins/branding";
import { kAKLocale, LocaleContextValue } from "#elements/mixins/locale";
import { LitPropertyRecord, SlottedTemplateResult } from "#elements/types";
import { exportParts } from "#elements/utils/attributes";
import { ThemedImage } from "#elements/utils/images";

import {
    AKFlowAdvanceEvent,
    AKFlowSubmitRequest,
    AKFlowUpdateChallengeRequest,
} from "#flow/events";
import { StageMapping } from "#flow/FlowExecutorStageFactory";
import { BaseStage } from "#flow/stages/base";
import type { FlowChallengeResponseRequestBody, StageHost, SubmitOptions } from "#flow/types";

import { ConsoleLogger } from "#logger/browser";

import {
    ChallengeTypes,
    FlowChallengeResponseRequest,
    FlowErrorChallenge,
    FlowLayoutEnum,
    FlowsApi,
} from "@goauthentik/api";

import { spread } from "@open-wc/lit-helpers";
import { match, P } from "ts-pattern";

import { LOCALE_STATUS_EVENT, LocaleStatusEventDetail, msg } from "@lit/localize";
import { CSSResult, html, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { until } from "lit/directives/until.js";
import { html as staticHTML, unsafeStatic } from "lit/static-html.js";

import PFBackgroundImage from "@patternfly/patternfly/components/BackgroundImage/background-image.css";
import PFButton from "@patternfly/patternfly/components/Button/button.css";
import PFDrawer from "@patternfly/patternfly/components/Drawer/drawer.css";
import PFList from "@patternfly/patternfly/components/List/list.css";
import PFLogin from "@patternfly/patternfly/components/Login/login.css";
import PFTitle from "@patternfly/patternfly/components/Title/title.css";

/// <reference types="../../types/lit.d.ts" />

const POLTEKKES_LOGIN_BACKGROUND = "/static/dist/assets/images/poltekkes-login-bg.png";

/**
 * An executor for authentik flows.
 *
 * @attr {string} slug - The slug of the flow to execute.
 * @prop {ChallengeTypes | null} challenge - The current challenge to render.
 *
 * @part main - The main container for the flow content.
 * @part content - The container for the stage content.
 * @part content-iframe - The iframe element when using a frame background layout.
 * @part footer - The footer container.
 * @part locale-select - The locale select component.
 * @part branding - The branding element, used for the background image in some layouts.
 * @part loading-overlay - The loading overlay element.
 * @part challenge-additional-actions - Container in stages which have additional actions.
 * @part challenge-footer-band - Container for the stage footer, used for additional actions in some stages.
 * @part locale-select-label - The label of the locale select component.
 * @part locale-select-select - The select element of the locale select component.
 */
@customElement("ak-flow-executor")
export class FlowExecutor extends WithBrandConfig(Interface) implements StageHost {
    public static readonly DefaultLayout: FlowLayoutEnum =
        globalAK()?.flow?.layout || FlowLayoutEnum.Stacked;

    //#region Styles

    static styles: CSSResult[] = [
        PFLogin,
        PFDrawer,
        PFButton,
        PFTitle,
        PFList,
        PFBackgroundImage,
        Styles,
    ];

    //#endregion

    //#region Properties

    @property({ type: String, attribute: "slug", useDefault: true })
    public flowSlug: string = window.location.pathname.split("/")[3];

    @property({ attribute: false })
    public challenge: ChallengeTypes | null = null;

    @property({ type: Boolean })
    public loading = false;

    @property({ type: String, attribute: "data-layout", useDefault: true, reflect: true })
    public layout: FlowLayoutEnum = FlowExecutor.DefaultLayout;

    @state()
    public localeDropdownOpen = false;

    @state()
    public selectedLanguageTag: TargetLanguageTag = "en";

    //#endregion

    //#region Internal State

    #logger = ConsoleLogger.prefix("flow-executor");

    #api: FlowsApi;

    /**
     * Desktop breakpoint for the Poltekkes side-by-side login.
     *
     * Must match the media query in `web/src/flow/FlowExecutor.css`.
     */
    #poltekkesDesktopQuery: MediaQueryList;

    #poltekkesBreakpointListener = () => {
        this.#applyPoltekkesBackground();
    };

    // Listen for challenge-forwarding events from iframe-based third-party verifiers (Device Compliance)
    #flowIframeMessageController = new FlowIframeMessageController(this);

    // Listen for authentik state-change events from other tabs
    #flowMultitabController = new FlowMultitabController(this);

    // Listen for server-side events and forward them to the notification handler
    #flowWebsocketClientController = new FlowWebsocketClientController(this);

    //#endregion

    //#region Accessors

    public get flowInfo() {
        return this.challenge?.flowInfo ?? null;
    }

    //region Live event handlers

    handleChallengeRequest = (event: AKFlowUpdateChallengeRequest) => {
        this.challenge = event.challenge;
    };

    handleSubordinateSubmit = (event: AKFlowSubmitRequest) => {
        // prettier-ignore
        const { request: { payload, options } } = event;
        this.submit(payload, options);
    };

    //endregion

    //#region Lifecycle

    constructor() {
        configureSentry();
        super();
        this.#api = aki(FlowsApi);
        this.#poltekkesDesktopQuery = window.matchMedia(
            "(min-width: 70rem) and (min-height: 17.5rem)",
        );
        this.#poltekkesDesktopQuery.addEventListener(
            "change",
            this.#poltekkesBreakpointListener,
        );
        this.addController(this.#flowIframeMessageController);
        this.addController(this.#flowMultitabController);
        this.addController(this.#flowWebsocketClientController);
        this.addEventListener(AKFlowUpdateChallengeRequest.eventName, this.handleChallengeRequest);
        this.addEventListener(AKFlowSubmitRequest.eventName, this.handleSubordinateSubmit);
    }

    /**
     * Synchronize flow info such as background image with the current state.
     */
    get #layoutUsesSidebarFrames() {
        return (
            this.layout === FlowLayoutEnum.SidebarLeftFrameBackground ||
            this.layout === FlowLayoutEnum.SidebarRightFrameBackground
        );
    }

    #synchronizeFlowInfo() {
        if (!this.flowInfo || this.#layoutUsesSidebarFrames) return;

        const background =
            this.flowInfo.backgroundThemedUrls?.[this.activeTheme] || this.flowInfo.background;

        // Storybook has a different document structure, so we need to adjust the target accordingly.
        const target =
            import.meta.env.AK_BUNDLER === "storybook"
                ? this.closest<HTMLDivElement>(".docs-story")
                : this.ownerDocument.body;

        applyBackgroundImageProperty(background, { target });
    }

    #applyPoltekkesBackground() {
        const isIdentification = this.challenge?.component === "ak-stage-identification";
        const isSidebar =
            this.layout === FlowLayoutEnum.SidebarLeft ||
            this.layout === FlowLayoutEnum.SidebarRight;

        const target =
            import.meta.env.AK_BUNDLER === "storybook"
                ? this.closest<HTMLDivElement>(".docs-story")
                : this.ownerDocument.body;

        if (!target) return;

        if (!isIdentification || !isSidebar) {
            // Reset to the default background behavior when not on the custom login.
            if (this.flowInfo && !this.#layoutUsesSidebarFrames) {
                applyBackgroundImageProperty(this.flowInfo.background, { target });
            }
            return;
        }

        const isDesktop = this.#poltekkesDesktopQuery?.matches ?? true;

        if (isDesktop) {
            // Desktop: the sidebar image panel is the only background shown.
            target.style.setProperty(AKBackgroundImageProperty, "none");
            return;
        }

        // Mobile/compact: the sidebar image panel is hidden by CSS, so fall back to
        // the flow's default background (flow_background.jpg) instead of a blank screen.
        if (this.flowInfo) {
            const background =
                this.flowInfo.backgroundThemedUrls?.[this.activeTheme] ||
                this.flowInfo.background;
            applyBackgroundImageProperty(background, { target });
        }
    }

    //#region Listeners

    @listen(AKSessionAuthenticatedEvent, { target: window })
    protected sessionAuthenticatedListener = () => {
        if (!document.hidden) {
            return;
        }

        console.debug("authentik/ws: Reloading after session authenticated event");
        window.location.reload();
    };

    private setFlowErrorChallenge(error: APIError) {
        this.challenge = {
            component: "ak-stage-flow-error",
            error: pluckErrorDetail(error),
            requestId: "",
        } satisfies FlowErrorChallenge as ChallengeTypes;
    }

    protected refresh = async () => {
        if (!this.flowSlug) {
            this.#logger.debug("Skipping refresh, no flow slug provided");
            return Promise.resolve();
        }

        this.loading = true;

        return this.#api
            .flowsExecutorGet({
                flowSlug: this.flowSlug,
                query: window.location.search.substring(1),
            })
            .then((challenge) => {
                this.challenge = challenge;
                return !!this.challenge;
            })
            .catch(async (error) => {
                const parsedError = await parseAPIResponseError(error);
                showAPIErrorMessage(parsedError);
                this.setFlowErrorChallenge(parsedError);
                return false;
            })
            .finally(() => {
                this.loading = false;
            });
    };

    /**
     * Keep the dropdown's active option in sync with the locale that was
     * actually applied, since `setLocale` loads the module asynchronously.
     */
    #localeStatusListener = (event: CustomEvent<LocaleStatusEventDetail>) => {
        if (event.detail.status !== "ready") return;

        this.selectedLanguageTag = event.detail.readyLocale as TargetLanguageTag;
    };

    public override connectedCallback(): void {
        super.connectedCallback();
        this.selectedLanguageTag =
            (getSessionLocale() as TargetLanguageTag) ||
            (document.documentElement.lang as TargetLanguageTag) ||
            "en";

        window.addEventListener(LOCALE_STATUS_EVENT, this.#localeStatusListener);
    }

    public override disconnectedCallback(): void {
        window.removeEventListener(LOCALE_STATUS_EVENT, this.#localeStatusListener);
        this.#poltekkesDesktopQuery.removeEventListener(
            "change",
            this.#poltekkesBreakpointListener,
        );
        super.disconnectedCallback();
    }

    public async firstUpdated(changed: PropertyValues<this>): Promise<void> {
        super.firstUpdated(changed);

        this.refresh().then(() => {
            window.dispatchEvent(new AKFlowAdvanceEvent());
        });
    }

    // DOM post-processing has to happen after the render.
    public updated(changedProperties: PropertyValues<this>) {
        super.updated(changedProperties);

        document.title = match(this.challenge?.flowInfo?.title)
            .with(P.nullish, () => this.brandingTitle)
            .otherwise((title) => `${title} - ${this.brandingTitle}`);

        if (changedProperties.has("challenge") && this.challenge?.flowInfo) {
            const flowLayout = this.challenge.flowInfo.layout || FlowExecutor.DefaultLayout;
            const isIdentification = this.challenge.component === "ak-stage-identification";
            const isSidebar =
                flowLayout === FlowLayoutEnum.SidebarLeft ||
                flowLayout === FlowLayoutEnum.SidebarRight;
            this.layout = isIdentification && !isSidebar ? FlowLayoutEnum.SidebarRight : flowLayout;
        }

        if (changedProperties.has("flowInfo") || changedProperties.has("activeTheme")) {
            this.#synchronizeFlowInfo();
        }

        if (changedProperties.has("challenge") || changedProperties.has("layout")) {
            this.#applyPoltekkesBackground();
        }
    }

    //#endregion

    //#region Public Methods

    public submit = async (
        payload?: FlowChallengeResponseRequestBody,
        options?: SubmitOptions,
    ): Promise<boolean> => {
        if (!payload) throw new Error("No payload provided");
        if (!this.challenge) throw new Error("No challenge provided");

        if (!this.flowSlug) {
            if (import.meta.env.AK_BUNDLER === "storybook") {
                this.#logger.debug("Skipping submit flow slug check in storybook");

                return true;
            }

            throw new Error("No flow slug provided");
        }

        // This order is deliberate; the executor always specifies the component token.
        const flowChallengeResponseRequest = {
            ...payload,
            component: this.challenge.component as FlowChallengeResponseRequest["component"],
        } as FlowChallengeResponseRequest;

        if (!options?.invisible) {
            this.loading = true;
        }

        return this.#api
            .flowsExecutorSolve({
                flowSlug: this.flowSlug,
                query: window.location.search.substring(1),
                flowChallengeResponseRequest,
            })
            .then((challenge) => {
                window.dispatchEvent(new AKFlowAdvanceEvent());
                this.challenge = challenge;
                return !this.challenge.responseErrors;
            })
            .catch((error: APIError) => {
                this.setFlowErrorChallenge(error);
                return false;
            })
            .finally(() => {
                this.loading = false;
            });
    };

    //#region Render Challenge

    protected async renderChallenge(challenge: ChallengeTypes) {
        const stageEntry = StageMapping.registry.get(challenge.component);

        // The special cases!
        if (!stageEntry) {
            if (challenge.component === "xak-flow-shell") {
                return html`${unsafeHTML(challenge.body)}`;
            }

            return this.renderChallengeError(
                `No stage found for component: ${challenge.component}`,
            );
        }

        const challengeProps: LitPropertyRecord<BaseStage<NonNullable<typeof challenge>, object>> =
            {
                ".challenge": challenge,
                ".host": this,
            };

        const litParts = {
            part: "challenge",
            exportparts: exportParts(["additional-actions", "footer-band"], "challenge"),
        };

        let mapping: StageMapping;

        try {
            mapping = await StageMapping.from(stageEntry);
        } catch (error: unknown) {
            return this.renderChallengeError(error);
        }

        const { tag, variant } = mapping;

        const props = spread(
            match(variant)
                .with("challenge", () => challengeProps)
                .with("standard", () => ({ ...challengeProps, ...litParts }))
                .exhaustive(),
        );

        return staticHTML`<${unsafeStatic(tag)} ${props}></${unsafeStatic(tag)}>`;
    }

    protected renderChallengeError(error: unknown): SlottedTemplateResult {
        const detail = pluckErrorDetail(error);

        // eslint-disable-next-line no-console
        console.trace(error);

        const errorChallenge: FlowErrorChallenge = {
            component: "ak-stage-flow-error",
            error: detail,
            requestId: "",
        };

        return html`<ak-stage-flow-error .challenge=${errorChallenge}></ak-stage-flow-error>`;
    }

    //#endregion

    //#region Render

    protected renderLoading(): SlottedTemplateResult {
        return html`<slot name="placeholder"></slot>`;
    }

    protected renderFrameBackground(): SlottedTemplateResult {
        return guard([this.layout, this.challenge], () => {
            if (!this.#layoutUsesSidebarFrames) return;

            const src = this.challenge?.flowInfo?.background;
            if (!src) return nothing;

            return html`
                <div class="ak-c-login__content" part="content">
                    <iframe
                        class="ak-c-login__content-iframe"
                        part="content-iframe"
                        name="flow-content-frame"
                        src=${src}
                    ></iframe>
                </div>
            `;
        });
    }

    protected toggleTheme = () => {
        const nextTheme = this.activeTheme === "dark" ? "light" : "dark";
        applyThemeChoice(nextTheme);
    };

    #availableLocales: { tag: TargetLanguageTag; label: string }[] = [
        { tag: "en", label: "English" },
        { tag: "ar", label: "العربية" },
        { tag: "bg-BG", label: "Български" },
        { tag: "cs-CZ", label: "Čeština" },
        { tag: "de-DE", label: "Deutsch" },
        { tag: "es-ES", label: "Español" },
        { tag: "fi-FI", label: "Suomi" },
        { tag: "fr-FR", label: "Français" },
        { tag: "id", label: "Bahasa Indonesia" },
        { tag: "it-IT", label: "Italiano" },
        { tag: "ja-JP", label: "日本語" },
        { tag: "ko-KR", label: "한국어" },
        { tag: "nb-NO", label: "Norsk bokmål" },
        { tag: "nl-NL", label: "Nederlands" },
        { tag: "pl-PL", label: "Polski" },
        { tag: "pt-BR", label: "Português (Brasil)" },
        { tag: "ru-RU", label: "Русский" },
        { tag: "tr-TR", label: "Türkçe" },
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "zh-Hant", label: "繁體中文" },
    ];

    protected toggleLocaleDropdown = () => {
        this.localeDropdownOpen = !this.localeDropdownOpen;
    };

    protected selectLocale = (tag: TargetLanguageTag) => {
        const context = (this as unknown as { [kAKLocale]: LocaleContextValue })[kAKLocale];
        this.selectedLanguageTag = tag;
        setSessionLocale(tag);
        context?.setLocale(tag);
        this.localeDropdownOpen = false;
    };

    protected renderLocaleDropdown() {
        if (!this.localeDropdownOpen) return nothing;

        return html`<div class="ak-poltekkes-locale-dropdown" role="menu">
            ${this.#availableLocales.map(
                ({ tag, label }) => html`
                    <button
                        type="button"
                        class="ak-poltekkes-locale-option ${this.selectedLanguageTag === tag
                            ? "ak-poltekkes-locale-option-active"
                            : ""}"
                        role="menuitem"
                        @click=${() => this.selectLocale(tag)}
                    >
                        ${label}
                    </button>
                `,
            )}
        </div>`;
    }

    protected renderSidebarImage(): SlottedTemplateResult {
        return guard([this.layout, this.challenge], () => {
            const isIdentification = this.challenge?.component === "ak-stage-identification";
            const isSidebar =
                this.layout === FlowLayoutEnum.SidebarLeft ||
                this.layout === FlowLayoutEnum.SidebarRight;
            if (!isIdentification || !isSidebar) return nothing;

            return html`
                <div
                    class="ak-poltekkes-sidebar-image"
                    part="sidebar-image"
                    role="img"
                    aria-label=${msg("Poltekkes Kemenkes Malang")}
                    style="background-image: url('${POLTEKKES_LOGIN_BACKGROUND}')"
                ></div>
            `;
        });
    }

    protected renderFooter(): SlottedTemplateResult {
        return guard([this.layout], () => {
            return html`<footer
                aria-label=${msg("Site footer")}
                name="site-footer"
                part="footer"
                class="pf-c-login__footer ${this.layout === FlowLayoutEnum.Stacked
                    ? "pf-m-dark"
                    : ""}"
            >
                <slot name="footer"></slot>
            </footer>`;
        });
    }

    protected override render(): SlottedTemplateResult {
        const { challenge, loading } = this;

        return html`<div class="pf-c-login" data-layout=${this.layout} part="login">
            <div class="ak-poltekkes-topbar">
                <div class="ak-poltekkes-locale">
                    <button
                        type="button"
                        class="ak-poltekkes-locale-toggle"
                        @click=${this.toggleLocaleDropdown}
                        aria-label=${msg("Change language", {
                            id: "flow.locale-toggle.aria-label",
                        })}
                        aria-haspopup="true"
                        aria-expanded=${this.localeDropdownOpen}
                    >
                        <svg
                            class="ak-poltekkes-locale-icon"
                            role="img"
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 32 32"
                        >
                            <path
                                d="M27.85 29H30l-6-15h-2.35l-6 15h2.15l1.6-4h6.85Zm-7.65-6 2.62-6.56L25.45 23ZM18 7V5h-7V2H9v3H2v2h10.74a14.7 14.7 0 0 1-3.19 6.18A13.5 13.5 0 0 1 7.26 9h-2.1a16.5 16.5 0 0 0 3 5.58A16.8 16.8 0 0 1 3 18l.75 1.86A18.5 18.5 0 0 0 9.53 16a16.9 16.9 0 0 0 5.76 3.84L16 18a14.5 14.5 0 0 1-5.12-3.37A17.64 17.64 0 0 0 14.8 7Z"
                            />
                        </svg>
                    </button>
                    ${this.renderLocaleDropdown()}
                </div>
                <button
                    type="button"
                    class="ak-poltekkes-theme-toggle"
                    @click=${this.toggleTheme}
                    aria-label=${msg("Toggle theme", { id: "flow.theme-toggle.aria-label" })}
                >
                    <i
                        class="fas ${this.activeTheme === "dark" ? "fa-sun" : "fa-moon"}"
                        aria-hidden="true"
                    ></i>
                </button>
            </div>
            ${this.renderFrameBackground()} ${this.renderSidebarImage()}
            <header class="pf-c-login__header">
                <ak-flow-inspector-button></ak-flow-inspector-button>
            </header>
            <main
                data-layout=${this.layout}
                class="pf-c-login__main"
                aria-label=${msg("Authentication form")}
                part="main"
            >
                <div class="pf-c-login__main-header pf-c-brand" part="branding">
                    ${ThemedImage({
                        src: this.brandingLogo,
                        alt: msg("authentik Logo"),
                        className: "branding-logo",
                        theme: this.activeTheme,
                        themedUrls: this.brandingLogoThemedUrls,
                    })}
                </div>
                ${loading && challenge ? html`<ak-loading-overlay></ak-loading-overlay>` : nothing}
                ${guard([challenge], () => {
                    return challenge?.component
                        ? until(this.renderChallenge(challenge))
                        : this.renderLoading();
                })}
            </main>
            ${this.renderFooter()}
            <div class="ak-poltekkes-copyright">
                ${msg("@ 2026 Poltekkes Kemenkes Malang", { id: "flow.copyright" })}
            </div>
        </div>`;
    }

    //#endregion
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-flow-executor": FlowExecutor;
    }
}
