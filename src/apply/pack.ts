import { Packer } from "docx";
import type { Profile } from "../lib/config.js";
import type { OppRow } from "../db/store.js";
import { politeFetch } from "../lib/http.js";
import { htmlToText } from "../pipeline/resolve.js";
import { isClosed } from "../pipeline/extract-rules.js";
import { buildCv } from "../cv/build-cv.js";
import { tailorProfile } from "./tailor.js";
import { buildChecklist, type ChecklistItem } from "./requirements.js";
import { letterOutlineBuffer, refereeRequests } from "./letter.js";

/** Platforms whose terms forbid bots: never automate, only prepare text + a link. */
export const NO_BOTS = /(^|\.)(linkedin\.com|upwork\.com|fiverr\.com|indeed\.com|glassdoor\.com|wellfound\.com|angel\.co|freelancer\.com)$/i;

export interface Pack {
  checklist: ChecklistItem[];
  files: { name: string; data: Buffer }[];
  referees: { name: string; href: string }[];
  closed: string | null;
  noBots: boolean;
  pageFetched: boolean;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 40);

/** Everything needed to apply to one opportunity. Nothing is submitted or sent anywhere. */
export async function preparePack(
  row: OppRow,
  prof: Profile,
  // One retry only: this runs inside the Telegram webhook, which has a 30-second limit.
  fetchPage: (url: string) => Promise<{ status: number; text: string }> = (u) => politeFetch(u, { retries: 1 }),
): Promise<Pack> {
  let pageText = "";
  let pageFetched = false;
  try {
    const r = await fetchPage(row.official_url);
    if (r.status < 400) {
      pageText = htmlToText(r.text);
      pageFetched = true;
    }
  } catch {
    // Fall back to the facts stored when the item was found.
  }
  if (!pageText) {
    const x = row.extracted;
    pageText = [x.howToApply.quote, x.fundingDetails.quote, x.eligibleNationalities.quote, x.gradeRequirement.quote].filter(Boolean).join(" ");
  }

  const tailored = tailorProfile(prof, pageText);
  const cv = await Packer.toBuffer(buildCv(tailored));
  const letter = await letterOutlineBuffer(tailored, row);
  const name = slug(prof.name);
  const what = slug(row.title);

  return {
    checklist: buildChecklist(pageText, prof, { gpaMandatory: row.extracted.gpaMandatory.value }),
    files: [
      { name: `${name}_CV_${what}.docx`, data: cv },
      { name: `Letter_outline_${what}.docx`, data: letter },
    ],
    referees: refereeRequests(prof, row),
    closed: pageFetched ? isClosed(pageText.slice(0, 3000)) : null,
    noBots: NO_BOTS.test(new URL(row.official_url).hostname),
    pageFetched,
  };
}
