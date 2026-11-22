// Demo vault used in the browser preview and offered as "Try with sample data" on first run.
import { stringifyFrontmatter } from "./frontmatter";
import { GRANT_ORDER, grantFolderName } from "./vault";
import { addDays, toISO } from "./util";

type G = Record<string, unknown> & { title: string; funder: string; status: string };

export function sampleVault(today = new Date()): { files: Record<string, string>; staleDrafts: string[] } {
  const d = (n: number) => toISO(addDays(today, n));
  const files: Record<string, string> = {};
  const grants: [G, string][] = [];

  const add = (fm: G, body = "") => grants.push([fm, body]);
  const hist = (...pairs: [string, number][]) => pairs.map(([status, n]) => ({ status, date: d(n) }));

  add(
    {
      title: "Project Grant 2027", client: "me", funder: "pittsburgh-foundation", url: "https://example.org/pittsburgh-foundation/project-grant",
      type: "grant", status: "drafting", starred: true, amount_requested: 5000, max_award: 5000, deadline: d(9), deadline_type: "fixed",
      project: "Prodigy", location: "Pittsburgh, PA", tags: ["theater", "individual-artist"], created: d(-40),
      status_history: hist(["researching", -40], ["planning", -30], ["drafting", -21]),
    },
    `## Eligibility\nIndividual artists living in Allegheny County for at least two years. No students.\n\n## Questions\n### 1. Project description (500 words)\nDraft: drafts/01-project-description.md\n\n### 2. Artist bio (150 words)\nDraft: drafts/02-artist-bio.md\n\n### 3. Community impact (300 words)\nDraft: drafts/03-community-impact.md\n\n## Notes\nProgram officer said work samples matter more than the narrative.\n`,
  );
  add({
    title: "Creative Development Fellowship", client: "me", funder: "heinz-endowments", url: "https://example.org/heinz/fellowship", type: "fellowship",
    status: "planning", amount_requested: 15000, max_award: 15000, deadline: d(24), project: "Made Men", location: "Pittsburgh, PA",
    tags: ["writing", "individual-artist"], created: d(-12), status_history: hist(["researching", -12], ["planning", -6]),
  });
  add({
    title: "Spring Writers Residency", client: "me", funder: "ucross-foundation", url: "https://example.org/ucross", type: "residency",
    status: "researching", starred: true, deadline: d(52), deadline_type: "fixed", location: "Clearmont, WY", tags: ["residency", "writing"], created: d(-3),
  });
  add({
    title: "Rolling Artist Opportunity Grant", client: "me", funder: "pennsylvania-council-on-the-arts", url: "https://example.org/pca/aog", type: "grant",
    status: "researching", max_award: 2500, deadline_type: "rolling", tags: ["individual-artist"], created: d(-8),
  });
  add({
    title: "New Play Commission", client: "me", funder: "city-theatre", type: "commission", status: "submitted", amount_requested: 8000,
    deadline: d(-35), submitted_on: d(-37), decision_expected: d(-4), project: "Prodigy", tags: ["theater"], created: d(-80),
    status_history: hist(["researching", -80], ["drafting", -60], ["submitted", -37]),
  });
  add(
    {
      title: "Individual Artist Award", client: "me", funder: "pittsburgh-foundation", type: "award", status: "awarded", amount_requested: 3000,
      amount_awarded: 3000, deadline: d(-150), submitted_on: d(-152), decision_on: d(-90), project: "Made Men", tags: ["individual-artist"], created: d(-190),
      reports: [{ title: "Final report", due: d(21), submitted_on: "", todoist_task_id: "", notes: "From the award email: 2-page narrative + receipts" }],
      status_history: hist(["researching", -190], ["drafting", -170], ["submitted", -152], ["awarded", -90]),
    },
    "## Notes\nAward letter in attachments.\n",
  );
  add({
    title: "Travel & Study Grant", client: "me", funder: "heinz-endowments", type: "grant", status: "awarded", amount_requested: 2000, amount_awarded: 1500,
    deadline: d(-300), submitted_on: d(-305), decision_on: d(-250), tags: ["travel"], created: d(-330),
    status_history: hist(["submitted", -305], ["awarded", -250]),
  });
  add({
    title: "Emerging Playwrights Prize", client: "me", funder: "city-theatre", type: "award", status: "declined", amount_requested: 1000,
    deadline: d(-200), submitted_on: d(-201), decision_on: d(-140), tags: ["theater"], created: d(-220),
    status_history: hist(["submitted", -201], ["declined", -140]),
  });
  add({
    title: "Summer Residency 2026", client: "me", funder: "ucross-foundation", type: "residency", status: "declined", deadline: d(-260),
    submitted_on: d(-262), decision_on: d(-200), tags: ["residency"], created: d(-280),
    status_history: hist(["submitted", -262], ["declined", -200]),
  });
  // Client work
  add(
    {
      title: "Arts Education Grant", client: "lakeside-youth-theater", funder: "pennsylvania-council-on-the-arts", url: "https://example.org/pca/aie",
      type: "grant", status: "drafting", amount_requested: 12000, max_award: 10000, deadline: d(13), project: "Summer Intensive",
      location: "Erie, PA", tags: ["education", "youth"], created: d(-30), status_history: hist(["planning", -30], ["drafting", -20]),
    },
    `## Eligibility\n501(c)(3) organizations with at least two years of programming.\n\n## Questions\n### 1. Mission and history (250 words)\nDraft: drafts/01-mission-and-history.md\n\n### 2. Program description (750 words)\nDraft: drafts/02-program-description.md\n\n### 3. Diversity, equity and inclusion (300 words)\nDraft: drafts/03-dei.md\n\n## Notes\n`,
  );
  add({
    title: "Community Foundation General Operating", client: "lakeside-youth-theater", funder: "erie-community-foundation", type: "grant",
    status: "awarded", amount_requested: 20000, amount_awarded: 18000, deadline: d(-120), submitted_on: d(-122), decision_on: d(-60),
    tags: ["operating"], created: d(-150), reports: [], status_history: hist(["submitted", -122], ["awarded", -60]),
  });
  add({
    title: "Youth Theater Capacity Building", client: "lakeside-youth-theater", funder: "erie-community-foundation", type: "grant",
    status: "planning", amount_requested: 7500, deadline: d(40), tags: ["capacity", "youth"], created: d(-5), status_history: hist(["planning", -5]),
  });
  add({
    title: "Corporate Giving Program", client: "lakeside-youth-theater", funder: "erie-insurance", type: "grant", status: "withdrawn",
    deadline: d(-20), tags: ["corporate"], created: d(-60), status_history: hist(["researching", -60], ["withdrawn", -25]),
  });

  const stale: string[] = [];
  for (const [fm, body] of grants) {
    const folder = grantFolderName(fm as never);
    const full = {
      currency: "USD", deadline_type: "fixed", starred: false, url: "", project: "", location: "", tags: [], amount_requested: null,
      amount_awarded: null, max_award: null, submitted_on: "", decision_expected: "", decision_on: "", todoist_task_ids: [], reports: [],
      updated: toISO(today), status_history: [{ status: fm.status, date: fm.created }], ...fm,
    };
    files[`grants/${folder}/grant.md`] = stringifyFrontmatter(full, body || "## Eligibility\n\n## Questions\n\n## Notes\n", GRANT_ORDER);
    if (fm.title === "Arts Education Grant") stale.push(`grants/${folder}/grant.md`, `grants/${folder}/drafts/01-mission-and-history.md`);
    if (fm.title === "Project Grant 2027") {
      files[`grants/${folder}/drafts/01-project-description.md`] =
        "# Project description\n\nProdigy is a new play about a child chess champion and the adults who build their lives around her. With this grant I will hold three rehearsals and a public staged reading at the Carnegie Library in Lawrenceville, followed by a talkback with local chess clubs.\n";
      files[`grants/${folder}/drafts/02-artist-bio.md`] = "";
      files[`grants/${folder}/budget.csv`] =
        "category,type,line_item,quantity,rate,amount,notes\n" +
        "Artist fees,Expense,Playwright fee,,,1500,\n" +
        "Artist fees,Expense,Actor stipends,4,300,,4 actors × 3 rehearsals + reading\n" +
        "Personnel,Expense,Lighting designer fee,,,600,\"Quote from vendor, Nov 2026\"\n" +
        "Space,Expense,Rehearsal space,3,150,,3 rehearsals × $150\n" +
        "Marketing,Expense,Posters and printing,,,250,\n" +
        "Documentation,Expense,Video of reading,,,500,\n" +
        "Space,In-kind,Library reading room,,,800,Donated by Carnegie Library\n" +
        "Other,Income,Ticket donations,,,350,Estimated\n";
    }
    if (fm.title === "Arts Education Grant") {
      files[`grants/${folder}/drafts/01-mission-and-history.md`] =
        "Lakeside Youth Theater gives every young person in Erie a stage. Founded in 2014 in a church basement, we now serve 300 students a year.\n";
    }
  }

  const funders: [string, string, string, string][] = [
    ["pittsburgh-foundation", "The Pittsburgh Foundation", "foundation", "https://example.org/pittsburgh-foundation"],
    ["heinz-endowments", "The Heinz Endowments", "foundation", "https://example.org/heinz"],
    ["ucross-foundation", "Ucross Foundation", "residency program", "https://example.org/ucross"],
    ["pennsylvania-council-on-the-arts", "Pennsylvania Council on the Arts", "arts council", "https://example.org/pca"],
    ["city-theatre", "City Theatre", "corporate", "https://example.org/city-theatre"],
    ["erie-community-foundation", "Erie Community Foundation", "foundation", "https://example.org/erie-cf"],
    ["erie-insurance", "Erie Insurance", "corporate", "https://example.org/erie-insurance"],
  ];
  for (const [slug, name, type, web] of funders) {
    files[`funders/${slug}.md`] = stringifyFrontmatter({ name, website: web, funder_type: type, contacts: "", notes: "" }, "");
  }

  files["clients/me.md"] = stringifyFrontmatter(
    { name: "Me", type: "individual artist", contact_person: "", contact_email: "", website: "", mission: "", fiscal_year_start: "", annual_budget: null, fiscal_sponsor: "", color: "#8a817c" },
    "",
  );
  files["clients/lakeside-youth-theater.md"] = stringifyFrontmatter(
    {
      name: "Lakeside Youth Theater", type: "nonprofit", contact_person: "Dana Ruiz", contact_email: "dana@example.org", website: "https://example.org/lyt",
      mission: "Lakeside Youth Theater gives every young person in Erie a stage, a voice and a team.", fiscal_year_start: "07-01",
      annual_budget: 420000, fiscal_sponsor: "", color: "#4f7cac",
    },
    "Contract runs through June. Board chair prefers drafts as Google Docs.\n",
  );

  const donor = (slug: string, fm: Record<string, unknown>, body = "") => {
    files[`donors/${slug}.md`] = stringifyFrontmatter({ tags: [], gifts: [], touches: [], created: d(-400), ...fm }, body);
  };
  donor("ruth-okafor", {
    name: "Ruth Okafor", email: "ruth@example.org", stage: "major", tags: ["board", "made-men"],
    next_followup: d(-2), next_step: "Invite to the Made Men reading",
    gifts: [
      { date: d(-40), amount: 2500, method: "Check", note: "Made Men development", acknowledged: false },
      { date: d(-380), amount: 1500, method: "Check", note: "", acknowledged: true },
    ],
    touches: [{ date: d(-38), kind: "call", note: "Thanked by phone; letter still to send" }],
  }, "Retired steelworker's daughter. Loves new plays about the Mon Valley.\n");
  donor("sam-whitfield", {
    name: "Sam Whitfield", email: "sam@example.org", stage: "active", tags: ["newsletter"],
    next_followup: d(21), next_step: "Year-end appeal",
    gifts: [
      { date: d(-120), amount: 100, method: "Venmo", note: "", acknowledged: true },
      { date: d(-300), amount: 75, method: "Card", note: "", acknowledged: true },
    ],
  });
  donor("priya-raman", {
    name: "Priya Raman", organization: "Raman Family Fund", stage: "prospect", tags: ["family-foundation"],
    next_followup: d(7), next_step: "Coffee to talk about the summer workshop",
    touches: [{ date: d(-10), kind: "event", note: "Met at the City Theatre opening" }],
  });
  donor("tom-becker", {
    name: "Tom Becker", email: "tom@example.org", stage: "active",
    gifts: [{ date: d(-650), amount: 250, method: "Check", note: "", acknowledged: true }],
  });

  const lib = (path: string, title: string, tags: string[], body: string, used: string[] = []) => {
    files[`library/${path}`] = stringifyFrontmatter({ title, tags, word_count: 0, used_in: used }, body);
  };
  lib("shared/budget-narrative-basics.md", "Budget narrative basics", ["budget", "narrative"], "Explain every line over 10% of the total. Tie each cost to an activity in the project description.\n");
  lib("me/bio-short.md", "Artist bio (short)", ["bio", "artist"], "I'm a Pittsburgh playwright whose plays look at ambition, family and the games we play to win approval. My work has been developed at City Theatre and read at the Carnegie Library.\n");
  lib("me/bio-long.md", "Artist bio (long)", ["bio", "artist"], "I'm a Pittsburgh playwright and teaching artist. Over the last ten years my plays have been developed at City Theatre, read at the Carnegie Library and staged by community companies across western Pennsylvania. I teach playwriting to teenagers and adults, and my work looks at ambition, family and the games we play to win approval.\n");
  lib("me/project-description-made-men.md", "Project description: Made Men", ["project", "description", "made-men"], "Made Men is a play cycle about three generations of men in a Monongahela Valley steel town.\n");
  lib("lakeside-youth-theater/mission-statement.md", "Mission statement", ["mission"], "Lakeside Youth Theater gives every young person in Erie a stage, a voice and a team.\n");
  lib("lakeside-youth-theater/org-history.md", "Organization history", ["history", "mission"], "Founded in 2014 in a church basement, Lakeside Youth Theater now serves 300 students a year through classes, a summer intensive and two mainstage productions.\n");
  lib("lakeside-youth-theater/dei-statement.md", "DEI statement", ["dei", "diversity", "equity", "inclusion"], "Half of our students receive full scholarships. We cast without regard to race, gender or ability, and our teaching artists reflect the city we serve.\n");
  files["library/budgets/staged-reading.csv"] =
    "category,type,line_item,quantity,rate,amount,notes\nArtist fees,Expense,Playwright fee,,,,\nArtist fees,Expense,Actor stipends,4,,,\nSpace,Expense,Rehearsal space,3,,,\nDocumentation,Expense,Video of reading,,,,\n";

  files[".manyapply/settings.json"] = JSON.stringify(
    {
      theme: "light",
      categories: ["Artist fees", "Personnel", "Space", "Materials", "Marketing", "Documentation", "Travel", "Other"],
    },
    null,
    2,
  );
  return { files, staleDrafts: stale };
}
