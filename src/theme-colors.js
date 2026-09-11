// SPDX-License-Identifier: GPL-3.0-or-later

// Themes only declare the handful of colours a user cares about picking
// (background, foreground, sidebar, accent, border, selection). The secondary
// and muted text tones used all over the sidebar were left at the built-in
// dark/light values, so a theme whose surfaces sit far from the defaults ended
// up with unreadable preview text -- most visibly GitHub Dark, whose selection
// blue left the snippet on the active note at 1.04:1.
//
// Everything here derives those tones from the theme's own colours instead,
// with a WCAG AA floor so no theme can fall below readable contrast.

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

// Minimum contrast for text against every sidebar surface it can land on.
const MIN_TEXT_CONTRAST = 4.5;
const MIN_SECONDARY_CONTRAST = 5;
// The active-note background is a theme's `selection` colour, which some themes
// set to a saturated accent. Nudge it toward the sidebar until even pure black
// or white would clear this, so the row can carry a title *and* a dimmer
// snippet rather than forcing both to the same near-white.
const MIN_ACTIVE_SURFACE_HEADROOM = 8;

// Opaque hex only. A translucent colour has no contrast until it is composited
// over whatever sits behind it, and for a theme's background or foreground that
// backdrop isn't ours to assume -- so #RGBA and #RRGGBBAA are reported as
// unmeasurable, exactly like the rgba()/hsl() forms an imported theme may use.
// Callers leave such colours alone rather than guessing at an opaque stand-in.
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) return null;

  let digits = trimmed.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
  if (digits.length === 3) {
    digits = digits.split("").map(d => d + d).join("");
  }
  if (digits.length !== 6) return null;

  const rgb = parseInt(digits, 16);
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

// Snap to the 8-bit channels a colour will actually be rendered at, so a ratio
// measured here is the ratio the emitted hex delivers.
export function quantize(color) {
  return color.map(channel => Math.max(0, Math.min(255, Math.round(channel))));
}

export function toHex(color) {
  return "#" + quantize(color).map(channel => channel.toString(16).padStart(2, "0")).join("");
}

function relativeLuminance(color) {
  const [r, g, b] = color.map(channel => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function mix(from, to, amount) {
  return from.map((channel, index) => channel + (to[index] - channel) * amount);
}

// Best contrast any text could reach on this surface.
function surfaceHeadroom(surface) {
  return Math.max(contrastRatio(WHITE, surface), contrastRatio(BLACK, surface));
}

function worstContrast(color, surfaces) {
  return Math.min(...surfaces.map(surface => contrastRatio(color, surface)));
}

// Walk `color` toward white or black -- whichever the surfaces have room for --
// until it clears `target` everywhere, keeping as much of the theme's hue as
// the floor allows. Returns the closest it got when the target is unreachable.
export function ensureContrast(color, surfaces, target) {
  const start = quantize(color);
  if (worstContrast(start, surfaces) >= target) return start;

  const towardWhite = surfaces.every(s => contrastRatio(WHITE, s) >= contrastRatio(BLACK, s));
  const direction = towardWhite ? WHITE : BLACK;

  let candidate = start;
  for (let step = 1; step <= 255; step += 1) {
    candidate = quantize(mix(color, direction, step / 255));
    if (worstContrast(candidate, surfaces) >= target) return candidate;
  }
  return candidate;
}

// The tones the active note row rebinds its text to. That rebinding is
// unconditional in the stylesheet, so a caller that cannot derive these must
// still supply them from the theme itself -- left unset they resolve from the
// built-in palette, which a theme we could not measure may look nothing like.
export const ACTIVE_TEXT_PROPERTIES = [
  "--text-on-active",
  "--text-secondary-on-active",
  "--text-muted-on-active"
];

// Every property deriveThemeSurfaceColors can set. A theme it can only partly
// derive -- or not at all -- returns a subset, so callers must clear the whole
// list before applying, or the previous theme's tones stay on the element.
export const DERIVED_THEME_PROPERTIES = [
  "--bg-note-hover",
  "--bg-note-active",
  "--text-secondary",
  "--text-muted",
  ...ACTIVE_TEXT_PROPERTIES
];

// Returns the CSS custom properties a theme should set beyond its own colours,
// or null when the theme's colours aren't parseable (a custom theme may use any
// CSS colour string) -- callers should leave the built-in values in place then.
export function deriveThemeSurfaceColors(theme) {
  if (!theme) return null;
  const background = parseColor(theme.background);
  const foreground = parseColor(theme.foreground);
  if (!background || !foreground) return null;

  const sidebar = parseColor(theme.sidebar) || background;
  const hover = quantize(mix(sidebar, foreground, 0.09));
  const surfaces = [background, sidebar, hover];

  const derived = {
    "--bg-note-hover": toHex(hover),
    "--text-secondary": toHex(ensureContrast(mix(foreground, sidebar, 0.3), surfaces, MIN_SECONDARY_CONTRAST)),
    "--text-muted": toHex(ensureContrast(mix(foreground, sidebar, 0.48), surfaces, MIN_TEXT_CONTRAST))
  };

  const selection = parseColor(theme.selection);
  // An imported theme may name its selection in a form we can't measure. Leave
  // the row alone rather than replacing a colour the author deliberately chose.
  if (!selection && theme.selection) return derived;

  let active = selection || quantize(mix(sidebar, foreground, 0.16));
  for (let step = 0; step < 20 && surfaceHeadroom(active) < MIN_ACTIVE_SURFACE_HEADROOM; step += 1) {
    active = quantize(mix(active, sidebar, 0.1));
  }

  return {
    ...derived,
    "--bg-note-active": toHex(active),
    "--text-on-active": toHex(ensureContrast(foreground, [active], MIN_TEXT_CONTRAST)),
    "--text-secondary-on-active": toHex(ensureContrast(mix(foreground, active, 0.25), [active], MIN_SECONDARY_CONTRAST)),
    "--text-muted-on-active": toHex(ensureContrast(mix(foreground, active, 0.4), [active], MIN_TEXT_CONTRAST))
  };
}
