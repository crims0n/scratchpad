// SPDX-License-Identifier: GPL-3.0-or-later

// Theme import accepts any colour the engine understands -- isValidColor asks
// CSS.supports -- but the rest of the app could only read hex, so every other
// form was treated as dark. A white `rgb()` theme was handed the dark palette.
//
// Rather than reimplement CSS colour parsing (rgb, hsl, named, and whatever the
// engine adds next), this hands the value back to the engine and reads the
// computed colour, which engines serialise as rgb()/rgba() -- or, for a colour
// written in CSS Color 4 notation, as that same notation. Both sRGB
// serialisations are read here, so the set of colours that resolve is the set
// CSS.supports admits minus the spaces sRGB cannot express, rather than a
// second grammar that drifts from it.

// Matches the computed serialisation: "rgb(12, 34, 56)" or "rgba(12, 34, 56,
// 0.5)". Modern engines may emit the space-separated form, so both are read.
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/i;
// A CSS Color 4 colour keeps its own notation when computed, so an sRGB one
// arrives as "color(srgb 1 1 1)" -- same colours as rgb(), 0-1 components.
// Other spaces in that notation (display-p3, srgb-linear, xyz) name colours
// outside sRGB or on a different transfer curve; converting them takes real
// colour-space maths, and a wrong conversion is worse than the stated
// fallback, so they stay unresolved alongside oklch().
const COLOR_SRGB_PATTERN = /^color\(\s*srgb\s+([^)]*)\)$/i;

// One component of a computed colour. `none` is a missing component, which
// renders as zero; a percentage is relative to `full`, the unit's own maximum.
function componentValue(token, full) {
  if (typeof token !== "string" || !token) return NaN;
  if (token.toLowerCase() === "none") return 0;
  if (token.endsWith("%")) return (Number(token.slice(0, -1)) / 100) * full;
  return Number(token);
}

// Splits "12 34 56 / 0.5", "12, 34, 56, 0.5" and "1 1 1" alike.
function splitComponents(body) {
  const [channels, ...rest] = body.split("/");
  const tokens = channels.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 4 && rest.length === 0) return { tokens: tokens.slice(0, 3), alpha: tokens[3] };
  if (tokens.length !== 3 || rest.length > 1) return null;
  return { tokens, alpha: rest.length ? rest[0].trim() : undefined };
}

export function parseComputedColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  const srgbMatch = trimmed.match(COLOR_SRGB_PATTERN);
  const rgbMatch = srgbMatch ? null : trimmed.match(RGB_PATTERN);
  if (!srgbMatch && !rgbMatch) return null;

  // color(srgb ...) states its channels as 0-1, rgb() as 0-255.
  const scale = srgbMatch ? 255 : 1;
  const parts = splitComponents((srgbMatch || rgbMatch)[1]);
  if (!parts) return null;

  const channels = parts.tokens.map(token => componentValue(token, srgbMatch ? 1 : 255) * scale);
  if (channels.some(Number.isNaN)) return null;
  // Components may fall outside the range -- an out-of-gamut colour, or a
  // percentage over 100 -- and are clipped the way the engine clips them.
  const rgb = channels.map(channel => Math.max(0, Math.min(255, Math.round(channel))));

  const alpha = parts.alpha === undefined ? 1 : componentValue(parts.alpha, 1);
  if (Number.isNaN(alpha)) return null;

  return { rgb, alpha: Math.max(0, Math.min(1, alpha)) };
}

// Returns { rgb, alpha } for any colour the engine can resolve to sRGB, or null
// for one it cannot -- an unsupported form, or a colour in a space sRGB cannot
// express, like oklch() or display-p3. Callers decide what an unresolved colour
// means; none of them may guess from the syntax.
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
