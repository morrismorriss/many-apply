// Core types and constants for the Many Apply vault format.

export const STATUSES = [
  "researching",
  "planning",
  "drafting",
  "submitted",
  "awarded",
  "declined",
  "withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  researching: "Researching",
  planning: "Planning",
  drafting: "Drafting",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/** Statuses that count as an "active application". */
export const ACTIVE_STATUSES: Status[] = ["planning", "drafting", "submitted"];
/** Statuses where the deadline no longer needs chasing. */
export const DONE_STATUSES: Status[] = ["submitted", "awarded", "declined", "withdrawn"];

export const GRANT_TYPES = ["grant", "residency", "fellowship", "award", "commission"] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

export const DEADLINE_TYPES = ["fixed", "rolling", "loi"] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const FUNDER_TYPES = [
  "foundation",
  "government",
  "arts council",
  "corporate",
  "residency program",
] as const;

export const CLIENT_TYPES = [
  "individual artist",
  "nonprofit",
  "fiscally sponsored project",
  "company",
] as const;

export interface ReportDate {
  title: string;
  due: string;
  submitted_on?: string | null;
  todoist_task_id?: string | null;
  notes?: string | null;
}

/** Time spent working on an application, logged by the built-in timer or by hand. */
export interface TimeEntry {
  date: string;
  minutes: number;
  note: string;
}

export interface StatusEvent {
  status: Status;
  date: string;
}

export interface GrantFM {
  title: string;
  client: string;
  funder: string;
  url: string;
  type: GrantType;
  status: Status;
  starred: boolean;
  amount_requested: number | null;
  amount_awarded: number | null;
  max_award: number | null;
  currency: string;
  deadline: string;
  deadline_type: DeadlineType;
  project: string;
  location: string;
  tags: string[];
  submitted_on: string;
  decision_expected: string;
  decision_on: string;
  todoist_task_ids: string[];
  reports: ReportDate[];
  created: string;
  updated: string;
  status_history: StatusEvent[];
  time_log: TimeEntry[];
  /** Any extra frontmatter keys (kept round-trip, e.g. from imports). */
  [extra: string]: unknown;
}

export interface Question {
  number: string;
  title: string;
  limit: number | null;
  limitUnit: "words" | "characters";
  draft: string | null; // relative path inside the grant folder
}

export interface Grant {
  folder: string; // folder name inside grants/
  fm: GrantFM;
  body: string;
  /** mtime of the newest draft or grant.md, ms since epoch (for "no edits in 7 days"). */
  lastEdited: number;
}

export interface Funder {
  slug: string;
  fm: {
    name: string;
    website: string;
    funder_type: string;
    contacts: string;
    notes: string;
    [extra: string]: unknown;
  };
  body: string;
}

export interface Client {
  slug: string;
  fm: {
    name: string;
    type: string;
    contact_person: string;
    contact_email: string;
    website: string;
    mission: string;
    fiscal_year_start: string;
    annual_budget: number | null;
    fiscal_sponsor: string;
    color: string;
    todoist_project_id: string;
    budget_template: string;
    [extra: string]: unknown;
  };
  body: string;
}

export interface LibraryItem {
  /** Path relative to library/, e.g. "me/bio-short.md" */
  path: string;
  fm: {
    title: string;
    tags: string[];
    word_count: number;
    used_in: string[];
    [extra: string]: unknown;
  };
  body: string;
}

export interface BudgetLine {
  id: string;
  category: string;
  type: "Expense" | "Income" | "In-kind";
  line_item: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  notes: string;
}

export const DEFAULT_CATEGORIES = [
  "Artist fees",
  "Personnel",
  "Space",
  "Materials",
  "Marketing",
  "Documentation",
  "Travel",
  "Other",
];

export interface PrepTask {
  title: string;
  days_before: number;
}

export interface ImportPreset {
  name: string;
  columns: Record<string, string>; // csv header -> field ("" = skip, "__extra" / "__notes")
  statuses: Record<string, Status>;
  dateOrder: "us" | "dayfirst";
}

export interface Settings {
  theme: "light" | "dark" | "pink" | "custom";
  customTheme: { bg: string; text: string; accent: string; sidebar: string };
  currency: string;
  categories: string[];
  todoist: {
    enabled: boolean;
    prepTasks: PrepTask[];
    reportReminderDays: number | null;
    projectPerClient: boolean;
    defaultProjectId: string;
  };
  importPresets: ImportPreset[];
  keepIcsUpdated: boolean;
  pairingCode: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  customTheme: { bg: "#fcfcfc", text: "#2f2b28", accent: "#8a1c2b", sidebar: "#f5f3f1" },
  currency: "USD",
  categories: [...DEFAULT_CATEGORIES],
  todoist: {
    enabled: true,
    prepTasks: [
      { title: "Gather work samples", days_before: 14 },
      { title: "Final draft", days_before: 3 },
    ],
    reportReminderDays: 14,
    projectPerClient: true,
    defaultProjectId: "",
  },
  importPresets: [],
  keepIcsUpdated: true,
  pairingCode: "",
};

export const ME = "me";
