// ─── Reference Pages ───
// Extended content for each physics concept, shown via Shift+click on info buttons.
//
// The actual prose lives in i18n/strings-reference.js so it can be translated.
// This module is now a thin Proxy that resolves title/body via _i18n.t(), so
// switching language is just a matter of clearing the reference overlay's
// rendered cache (handled by main.js's i18n change handler).

const REF_KEYS = [
    'gravity', 'coulomb', 'magnetic', 'gravitomag', 'relativity', 'radiation',
    'onepn', 'blackhole', 'kugelblitz', 'spinorbit', 'yukawa', 'axion', 'higgs',
    'expansion', 'disintegration', 'barneshut', 'collision', 'boundary',
    'topology', 'external', 'spin', 'charge', 'energy', 'pion',
    'fieldExcitation', 'conserved',
];

function _t(key) {
    return (typeof window !== 'undefined' && window._i18n) ? window._i18n.t(key) : key;
}

// Build a fresh getter object for each concept. Each access returns the
// currently-translated title and body — stale captures are impossible because
// the lookup happens at property-read time.
function _entry(key) {
    return {
        get title() { return _t('ref.' + key + '.title'); },
        get body()  { return _t('ref.' + key + '.body');  },
    };
}

const _registry = {};
for (let i = 0; i < REF_KEYS.length; i++) _registry[REF_KEYS[i]] = _entry(REF_KEYS[i]);

export const REFERENCE = _registry;
