// Export Individual Giving to CSV: one row per donor, or one row per gift. The column names are ones the
// donor CSV import recognizes, so an export can be imported back (into this vault or another).
import Papa from "papaparse";
import { summarize, type Donor } from "./donors";

const BOM = "﻿";

export function donorsCsv(donors: Donor[], clientName: (slug: string) => string, year = new Date().getFullYear()): string {
  const fields = [
    "Name", "Email", "Phone", "Address", "Organization", "Gave to", "Stage", "Tags",
    "Lifetime giving", `Given in ${year}`, "Gifts", "Last gift date", "Last gift amount", "Gifts not thanked",
    "Next follow-up", "Next step", "Notes",
  ];
  const data = donors.map((d) => {
    const s = summarize(d, year);
    return [
      d.fm.name, d.fm.email, d.fm.phone, d.fm.address, d.fm.organization, clientName(d.fm.client), d.fm.stage, d.fm.tags.join(", "),
      s.lifetime, s.thisYear, d.fm.gifts.length, s.lastGift?.date ?? "", s.lastGift?.amount ?? "", s.unthanked,
      d.fm.next_followup, d.fm.next_step, d.body.trim(),
    ];
  });
  return BOM + Papa.unparse({ fields, data }) + "\n";
}

export function giftsCsv(donors: Donor[], clientName: (slug: string) => string): string {
  const fields = ["Date", "Name", "Email", "Gave to", "Amount", "Method", "Gift note", "Thanked"];
  const data = donors
    .flatMap((d) => d.fm.gifts.map((g) => ({ d, g })))
    .sort((a, b) => b.g.date.localeCompare(a.g.date) || a.d.fm.name.localeCompare(b.d.fm.name))
    .map(({ d, g }) => [g.date, d.fm.name, d.fm.email, clientName(d.fm.client), g.amount, g.method, g.note, g.acknowledged ? "yes" : "no"]);
  return BOM + Papa.unparse({ fields, data }) + "\n";
}
