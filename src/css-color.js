// SPDX-License-Identifier: GPL-3.0-or-later

// Theme import accepts any colour the engine understands -- isValidColor asks
// CSS.supports -- but the rest of the app could only read hex, so every other
// form was treated as dark. A white `rgb()` theme was handed the dark palette.
//
// Rather than reimplement CSS colour parsing (rgb, hsl, named, and whatever the
// engine adds next), this hands the value back to the engine and reads the
// computed colour, which is serialised as rgb()/rgba() in every engine. The set
// of colours that resolve here is then the same set CSS.supports admits, by
// construction, instead of a second grammar that drifts from it.

// Matches the computed serialisation: "rgb(12, 34, 56)" or "rgba(12, 34, 56,
// 0.5)". Modern engines may emit the space-separated form, so both are read.
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

export function parseComputedColor(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(RGB_PATTERN);
  if (!match) return null;

  const rgb = match.slice(1, 4).map((channel) => {
    const number = Number(channel);
    return Math.max(0, Math.min(255, Math.round(number)));
  });
  if (rgb.some(Number.isNaN)) return null;

  const rawAlpha = match[4];
  const alpha = rawAlpha === undefined
    ? 1
    : (rawAlpha.endsWith("%") ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha));
  if (Number.isNaN(alpha)) return null;

  return { rgb, alpha: Math.max(0, Math.min(1, alpha)) };
}

// Returns { rgb, alpha } for any colour the engine can resolve to sRGB, or null
// for one it cannot -- an unsupported form, or a wide-gamut colour like oklch()
// that engines compute to themselves rather than to rgb(). Callers decide what
// an unresolved colour means; none of them may guess from the syntax.
export function createCssColorResolver(doc) {
  let probe = null;

  return function resolveCssColor(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const view = doc?.defaultView;
    const host = doc?.body || doc?.documentElement;
    if (!view || !host) return null;

    if (!probe) {
      probe = doc.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.display = "none";
    }

    probe.style.color = "";
    probe.style.color = value.trim();
    // A value the engine rejects never lands on the declaration, so this also
    // catches anything CSS.supports would have refused.
    if (!probe.style.color) return null;

    // The probe has to be in the document: getComputedStyle resolves nothing for
    // a detached element. It leaves again immediately -- a permanent hidden node
    // would show up in anything that walks the body.
    host.appendChild(probe);
    let computed = "";
    try {
      computed = view.getComputedStyle(probe).color;
    } finally {
      probe.remove();
    }
    return parseComputedColor(computed);
  };
}

// The historic threshold, kept exactly: changing the formula would reclassify
// built-in themes that have looked the way they look for every release so far.
export function isDarkSurface([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
}

// Light or dark, for picking which built-in palette fills in the tokens a theme
// does not set. Alpha is deliberately ignored rather than composited: what sits
// behind the app background is the window canvas, whose colour follows the
// `color-scheme` this very decision selects, so compositing against it would be
// circular. The theme's own colour is the one backdrop-independent signal there
// is. A colour that does not resolve at all keeps the long-standing default of
// dark, which is also the palette the app ships with.
export function isColorDark(value, resolveCssColor) {
  const resolved = resolveCssColor(value);
  return resolved ? isDarkSurface(resolved.rgb) : true;
}

// theme-colors.js measures contrast, which a translucent colour cannot answer
// without knowing its backdrop, so it keeps taking opaque colours only -- this
// just widens what counts as opaque from hex to every form the engine resolves.
export function createOpaqueColorParser(resolveCssColor) {
  return function parseOpaqueColor(value) {
    const resolved = resolveCssColor(value);
    return resolved && resolved.alpha === 1 ? resolved.rgb : null;
  };
}
