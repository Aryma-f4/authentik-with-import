import { TargetLanguageTag } from "#common/ui/locale/definitions";
import { formatLocaleDisplayNames } from "#common/ui/locale/format";
import { setSessionLocale } from "#common/ui/locale/utils";

import { AKElement } from "#elements/Base";
import { listen } from "#elements/decorators/listen";
import Styles from "#elements/locale/ak-locale-select.css";
import { LocaleOptions } from "#elements/locale/utils";
import { WithCapabilitiesConfig } from "#elements/mixins/capabilities";
import { WithLocale } from "#elements/mixins/locale";

import { CapabilitiesEnum } from "@goauthentik/api";

import { LOCALE_STATUS_EVENT, LocaleStatusEventDetail, msg } from "@lit/localize";
import { html, PropertyValues } from "lit";
import { guard } from "lit-html/directives/guard.js";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";

@customElement("ak-locale-select")
export class AKLocaleSelect extends WithLocale(WithCapabilitiesConfig(AKElement)) {
    public static shadowRootOptions = {
        ...AKElement.shadowRootOptions,
        delegatesFocus: true,
    };

    public static readonly styles = [Styles];

    #previousActiveLanguageTag: TargetLanguageTag | null = null;

    //#region Listeners

    /**
     * An event listener for when the user selects a different locale from the dropdown.
     *
     * Note that their choice may not be immediately reflected in the UI.
     */
    protected localeChangeListener = (event: Event) => {
        const select = event.target as HTMLSelectElement;
        const nextActiveLanguageTag = select.value as TargetLanguageTag;

        this.blur();

        requestAnimationFrame(() => {
            this.#previousActiveLanguageTag = this.activeLanguageTag;
            this.activeLanguageTag = nextActiveLanguageTag;

            setSessionLocale(nextActiveLanguageTag);
        });
    };

    @listen(LOCALE_STATUS_EVENT, { target: window })
    protected localeStatusListener = (event: CustomEvent<LocaleStatusEventDetail>) => {
        if (!this.ready || event.detail.status !== "ready") {
            return;
        }

        const { readyLocale } = event.detail;

        this.requestUpdate(
            "activeLanguageTag",
            this.#previousActiveLanguageTag,
            undefined,
            true,
            readyLocale,
        );
    };

    /**
     * An event listener which only reacts to the locale being ready.
     * This is used to delay showing the select until the locale is loaded,
     * preventing a flash of unlocalized content and avoiding expensive localization operations during initial render.
     */
    protected localeReadyStatusListener = (event: CustomEvent<LocaleStatusEventDetail>) => {
        if (event.detail.status !== "ready") {
            return;
        }

        if (!this.ready) {
            this.ready = true;
            window.clearTimeout(this.#readyTimeout);
        }
    };

    /**
     * Show the locale select dropdown.
     */
    public show = () => {
        const selectElement = this.#selectRef.value;

        if (!selectElement) {
            return;
        }

        // Gracefully degrade if not supported.
        try {
            selectElement.showPicker();
        } catch (_error) {
            selectElement.focus();
        }
    };

    //#endregion

    //#region Lifecycle

    /**
     * Indicates whether the locale select is ready to be displayed.
     *
     * @remarks
     *
     * This avoids showing the select before the locale is initialized,
     * preventing a flash of unlocalized content and avoiding expensive localization
     * operations during initial render.
     */
    @state()
    protected ready = false;

    #readyTimeout = -1;
    #selectRef = createRef<HTMLSelectElement>();

    public override connectedCallback(): void {
        super.connectedCallback();

        window.addEventListener(LOCALE_STATUS_EVENT, this.localeReadyStatusListener, {
            once: true,
            passive: true,
        });
    }

    public override disconnectedCallback(): void {
        super.disconnectedCallback();
        window.clearTimeout(this.#readyTimeout);
        window.removeEventListener(LOCALE_STATUS_EVENT, this.localeReadyStatusListener);
    }

    public override firstUpdated(changed: PropertyValues<this>): void {
        super.firstUpdated(changed);

        // Fallback to ready if the network is taking too long.
        this.#readyTimeout = window.setTimeout(() => {
            this.ready = true;
            window.removeEventListener(LOCALE_STATUS_EVENT, this.localeReadyStatusListener);
        }, 250);
    }

    //#endregion

    //#region Render

    protected override render() {
        if (!this.ready) {
            return null;
        }

        const activeLocaleTag = this.activeLanguageTag;
        const debug = this.can(CapabilitiesEnum.CanDebug);

        return guard([activeLocaleTag, debug], () => {
            const entries = formatLocaleDisplayNames(activeLocaleTag, {
                debug,
            });

            return html`<label
                    part="label"
                    for="locale-selector"
                    @click=${this.show}
                    aria-label=${msg("Select language", {
                        id: "language-selector-label",
                        desc: "Label for the language selection dropdown",
                    })}
                >
                    <!-- Globe icon removed; the language dropdown select is kept. -->
                </label>
                <select
                    ${ref(this.#selectRef)}
                    part="select"
                    id="locale-selector"
                    @change=${this.localeChangeListener}
                    class="ak-m-capitalize"
                    name="locale"
                >
                    ${LocaleOptions({ entries, activeLocaleTag })}
                </select>`;
        });
    }

    //#endregion
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-locale-select": AKLocaleSelect;
    }
}
