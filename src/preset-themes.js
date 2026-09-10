// SPDX-License-Identifier: GPL-3.0-or-later

// The built-in developer palette presets. Each one declares only the colours a
// user picks; the secondary/muted text tones and the active-note surface are
// derived from these at apply time -- see theme-colors.js.

export const PRESET_THEMES = [
  {
    id: "default-dark",
    name: "Default Dark",
    background: "#090d16",
    foreground: "#f3f4f6",
    sidebar: "#111625",
    accent: "#a855f7",
    border: "#1e2640",
    selection: "#2d1f46"
  },
  {
    id: "default-light",
    name: "Default Light",
    background: "#f8fafc",
    foreground: "#0f172a",
    sidebar: "#ffffff",
    accent: "#a855f7",
    border: "#e2e8f0",
    selection: "#f3e8ff"
  },
  {
    id: "dracula",
    name: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    sidebar: "#21222c",
    accent: "#bd93f9",
    border: "#44475a",
    selection: "#44475a"
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    sidebar: "#181825",
    accent: "#89b4fa",
    border: "#313244",
    selection: "#45475a"
  },
  {
    id: "nord",
    name: "Nord",
    background: "#2e3440",
    foreground: "#eceff4",
    sidebar: "#242933",
    accent: "#88c0d0",
    border: "#3b4252",
    selection: "#434c5e"
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#a9b1d6",
    sidebar: "#16161e",
    accent: "#7aa2f7",
    border: "#292e42",
    selection: "#283457"
  },
  {
    id: "monokai-pro",
    name: "Monokai Pro",
    background: "#2d2a2e",
    foreground: "#fcfcfa",
    sidebar: "#221f22",
    accent: "#ffd866",
    border: "#403e41",
    selection: "#49464e"
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    background: "#282c34",
    foreground: "#abb2bf",
    sidebar: "#21252b",
    accent: "#61afef",
    border: "#3e4451",
    selection: "#3e4451"
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    sidebar: "#073642",
    accent: "#268bd2",
    border: "#073642",
    selection: "#073642"
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    background: "#fdf6e3",
    foreground: "#657b83",
    sidebar: "#eee8d5",
    accent: "#268bd2",
    border: "#d33682",
    selection: "#eee8d5"
  },
  {
    id: "amber-crt",
    name: "Amber CRT",
    background: "#120f08",
    foreground: "#f6c453",
    sidebar: "#1b160b",
    accent: "#ffb000",
    border: "#4a3814",
    selection: "#5c4315"
  },
  {
    id: "green-crt",
    name: "Green CRT",
    background: "#07110a",
    foreground: "#7cff8a",
    sidebar: "#0a180d",
    accent: "#39ff65",
    border: "#1d5c2b",
    selection: "#154d24"
  },
  {
    id: "pastel-daydream",
    name: "Pastel Daydream",
    background: "#fff7fb",
    foreground: "#574f64",
    sidebar: "#f5ecfa",
    accent: "#a56cc1",
    border: "#ddcfe8",
    selection: "#eadcf3"
  },
  {
    id: "macintosh-system-6",
    name: "Macintosh System 6",
    background: "#f4f4f4",
    foreground: "#111111",
    sidebar: "#d9d9d9",
    accent: "#000000",
    border: "#777777",
    selection: "#b8b8b8"
  },
  {
    id: "mac-os-9-platinum",
    name: "Mac OS 9 Platinum",
    background: "#ffffff",
    foreground: "#171717",
    sidebar: "#d6d6d6",
    accent: "#315da8",
    border: "#707070",
    selection: "#bed0ec",
    uiStyle: "mac-os-9"
  },
  {
    id: "windows-classic",
    name: "Windows Classic",
    background: "#ffffff",
    foreground: "#000000",
    sidebar: "#c0c0c0",
    accent: "#000080",
    border: "#808080",
    selection: "#a6caf0",
    uiStyle: "windows-classic"
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    background: "#0d1117",
    foreground: "#c9d1d9",
    sidebar: "#010409",
    accent: "#58a6ff",
    border: "#30363d",
    selection: "#1f6feb"
  }
];
