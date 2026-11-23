// Export Individual Giving to CSV: one row per donor, or one row per gift. The column names are ones the
// donor CSV import recognizes, so an export can be imported back (into this vault or another).
import Papa from "papaparse";
import { giftTo, giftsFor, summarize, type Donor } from "./donors";
import { csvSafe } from "./csvImport";

const BOM = "﻿";

/** One row per donor. With `client`, giving totals count only gifts to that client. */
export function donorsCsv(donors: Donor[], clientName: (slug: string) => string, year = new Date().getFullYear(), client = ""): string {
  const fields = [
    "Name", "Email", "Phone", "Address", "Organization", "Gave to", "Stage", "Tags",
    "Lifetime giving", `Given in ${year}`, "Gifts", "Last gift date", "Last gift amount", "Gifts not thanked",
    "Next follow-up", "Next step", "Notes",
  ];
  const data = donors.map((d) => {
    const s = summarize(d, year, client);
    return [
      d.fm.name, d.fm.email, d.fm.phone, d.fm.address, d.fm.organization, d.fm.gave_to.map(clientName).join("; "), d.fm.stage, d.fm.tags.join(", "),
      s.lifetime, s.thisYear, d.fm.gifts.length, s.lastGift?.date ?? "", s.lastGift?.amount ?? "", s.unthanked,
      d.fm.next_followup, d.fm.next_step, d.body.trim(),
    ].map(csvSafe);
  });
  return BOM + Papa.unparse({ fields, data }) + "\n";
}

/** One row per gift, with who it went to. With `client`, only gifts to that client. */
export function giftsCsv(donors: Donor[], clientName: (slug: string) => string, client = ""): string {
  const fields = ["Date", "Name", "Email", "Gave to", "Amount", "Method", "Gift note", "Thanked"];
  const data = donors
    .flatMap((d) => giftsFor(d, client).map((g) => ({ d, g })))
    .sort((a, b) => b.g.date.localeCompare(a.g.date) || a.d.fm.name.localeCompare(b.d.fm.name))
    .map(({ d, g }) => [g.date, d.fm.name, d.fm.email, clientName(giftTo(d, g)), g.amount, g.method, g.note, g.acknowledged ? "yes" : "no"].map(csvSafe));
  return BOM + Papa.unparse({ fields, data }) + "\n";
}
