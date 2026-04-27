// ─── i18n Runtime ───
// Lightweight runtime translator scoped to geon. Reads from a flat-key
// dictionary in i18n/strings.js. Walks the DOM for data-i18n attributes,
// swaps text/title/aria-label in place, and notifies subscribers so JS-driven
// content (info popovers, presets dropdown, reference overlay, about panel)
// can re-render with the new language.
//
// Boot precedence: ?lang= URL param > localStorage > navigator.language ('ja*' → ja) > 'en'.
//
// HTML decoration:
//   <button data-i18n="ui.play">Play</button>            // textContent
//   <button data-i18n-title="ui.playTitle"></button>     // title attribute
//   <button data-i18n-aria="ui.playAria"></button>       // aria-label
//   <meta name="description" data-i18n-content="meta.desc">  // meta content attribute
//
// HTML-bearing strings (info popovers, reference, edu blurbs) are rendered by
// their owning subsystems (shared-info.js, initReferenceOverlay, etc.). i18n
// just supplies the string via t(); insertion stays inside those subsystems.

import { STRINGS } from '../i18n/strings.js';

const SUPPORTED = ['en', 'ja'];
const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'geon-lang';

let _lang = DEFAULT_LANG;
const _listeners = [];

function _detect() {
    // URL ?lang=ja takes priority — supports shareable language-specific links
    try {
        const q = new URL(window.location.href).searchParams.get('lang');
        if (q && SUPPORTED.includes(q)) return q;
    } catch (e) { /* ignore */ }
    try {
        const s = localStorage.getItem(STORAGE_KEY);
        if (s && SUPPORTED.includes(s)) return s;
    } catch (e) { /* ignore */ }
    try {
        const nl = (navigator.language || 'en').toLowerCase();
        if (nl.startsWith('ja')) return 'ja';
    } catch (e) { /* ignore */ }
    return DEFAULT_LANG;
}

export function getLang() { return _lang; }

export function t(key, fallback) {
    const dict = STRINGS[_lang];
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    const en = STRINGS.en;
    if (en && Object.prototype.hasOwnProperty.call(en, key)) return en[key];
    return fallback != null ? fallback : key;
}

export function applyDOM(root) {
    root = root || document;
    // textContent swap
    const text = root.querySelectorAll('[data-i18n]');
    for (let i = 0; i < text.length; i++) {
        const el = text[i];
        const v = t(el.dataset.i18n);
        if (el.textContent !== v) el.textContent = v;
    }
    // title attribute
    const titles = root.querySelectorAll('[data-i18n-title]');
    for (let i = 0; i < titles.length; i++) {
        titles[i].title = t(titles[i].dataset.i18nTitle);
    }
    // aria-label attribute
    const arias = root.querySelectorAll('[data-i18n-aria]');
    for (let i = 0; i < arias.length; i++) {
        arias[i].setAttribute('aria-label', t(arias[i].dataset.i18nAria));
    }
    // meta tag content attribute (description, og:title, og:description, etc.)
    const metas = root.querySelectorAll('[data-i18n-content]');
    for (let i = 0; i < metas.length; i++) {
        metas[i].setAttribute('content', t(metas[i].dataset.i18nContent));
    }
    // <optgroup label="..."> attribute
    const labels = root.querySelectorAll('[data-i18n-label]');
    for (let i = 0; i < labels.length; i++) {
        labels[i].setAttribute('label', t(labels[i].dataset.i18nLabel));
    }
}

export function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === _lang) return;
    _lang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang === 'ja' ? 'ja' : 'en';
    applyDOM();
    for (let i = 0; i < _listeners.length; i++) {
        try { _listeners[i](lang); } catch (e) { console.warn('i18n listener error', e); }
    }
}

export function onChange(cb) {
    _listeners.push(cb);
    return () => {
        const i = _listeners.indexOf(cb);
        if (i >= 0) _listeners.splice(i, 1);
    };
}

export function listSupported() { return SUPPORTED.slice(); }

export function init() {
    _lang = _detect();
    document.documentElement.lang = _lang === 'ja' ? 'ja' : 'en';
    applyDOM();
}

// Expose globally for use by shared modules / inline wiring.
window._i18n = { t, setLang, getLang, onChange, applyDOM, listSupported, init };
