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
