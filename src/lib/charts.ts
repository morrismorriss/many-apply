import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";

Chart.register(BarElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);
Chart.defaults.font.family = '"Hauora Sans", -apple-system, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.maintainAspectRatio = false;

/** Read a CSS variable so charts follow the current theme. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function themeChartOptions() {
  const grid = cssVar("--border");
  const text = cssVar("--muted");
  return {
    scales: {
      x: { grid: { display: false }, ticks: { color: text }, border: { color: grid } },
      y: { grid: { color: grid }, ticks: { color: text }, border: { display: false }, beginAtZero: true },
    },
    plugins: { legend: { labels: { color: cssVar("--text-soft") } } },
  };
}

// ---- Data colours: one per status, plus report and decision dates. Each theme has its own greys;
// settings.dataColors overrides any of them, on top of whichever theme is chosen.

export const DATA_COLOR_KEYS = [
  "st-researching", "st-planning", "st-drafting", "st-submitted", "st-awarded", "st-declined", "st-withdrawn", "ev-report", "ev-decision",
] as const;
export type DataColorKey = (typeof DATA_COLOR_KEYS)[number];

export const DATA_COLOR_LABEL: Record<DataColorKey, string> = {
  "st-researching": "Researching",
  "st-planning": "Planning",
  "st-drafting": "Drafting",
  "st-submitted": "Submitted",
  "st-awarded": "Awarded",
  "st-declined": "Declined",
  "st-withdrawn": "Withdrawn",
  "ev-report": "Report due",
  "ev-decision": "Decision expected",
};

/** One-click palettes. "Theme" means no overrides: the chosen theme's own colours. */
export const DATA_PALETTES: { id: string; name: string; colors: Partial<Record<DataColorKey, string>> }[] = [
  { id: "theme", name: "Theme", colors: {} },
  {
    id: "colorful", name: "Colorful",
    colors: { "st-researching": "#b8c4d6", "st-planning": "#7fa7d9", "st-drafting": "#e0a458", "st-submitted": "#8a6fc2", "st-awarded": "#4f9d69", "st-declined": "#d0675f", "st-withdrawn": "#c9c4bf", "ev-report": "#3e9aa6", "ev-decision": "#c2577a" },
  },
  {
    id: "warm", name: "Warm",
    colors: { "st-researching": "#e8d3b9", "st-planning": "#e0b07a", "st-drafting": "#d48a4a", "st-submitted": "#b8613a", "st-awarded": "#7a3b2e", "st-declined": "#c98f86", "st-withdrawn": "#e5ddd5", "ev-report": "#a5653a", "ev-decision": "#8a1c2b" },
  },
  {
    id: "cool", name: "Cool",
    colors: { "st-researching": "#c7d7e4", "st-planning": "#9bb8d3", "st-drafting": "#6f97c0", "st-submitted": "#4a74a8", "st-awarded": "#264e86", "st-declined": "#9aa5b1", "st-withdrawn": "#dde3e8", "ev-report": "#3e9aa6", "ev-decision": "#5a4fa0" },
  },
  {
    id: "pink", name: "Pink",
    colors: { "st-researching": "#f6d3df", "st-planning": "#eeadc4", "st-drafting": "#e283a7", "st-submitted": "#d6427a", "st-awarded": "#9e2457", "st-declined": "#c9a3b2", "st-withdrawn": "#f3e3e9", "ev-report": "#b5557f", "ev-decision": "#7a2d4f" },
  },
];

/** Put the overrides on the page (or take them off), so every var(--st-…) follows them. */
export function applyDataColors(colors: Partial<Record<DataColorKey, string>> | undefined) {
  const root = document.documentElement;
  for (const k of DATA_COLOR_KEYS) {
    const v = colors?.[k];
    if (v && /^#[0-9a-f]{3,8}$/i.test(v)) root.style.setProperty(`--${k}`, v);
    else root.style.removeProperty(`--${k}`);
  }
}

/**
 * A data colour for a chart. Charts draw on a canvas, so they need the value itself, not var(--…).
 * The override is read from settings directly, so a chart is right on the same render the setting changes.
 */
export function dataColor(key: DataColorKey, colors?: Partial<Record<DataColorKey, string>>): string {
  return colors?.[key] || cssVar(`--${key}`);
}
