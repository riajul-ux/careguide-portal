/**
 * NoteInterpreter
 * ----------------
 * Turns a free-text referral note into structured follow-up signals.
 *
 * This MVP implementation is deterministic (regex / keyword based) and never
 * calls an external API. The `NoteInterpreter` interface is the seam where an
 * LLM-backed implementation can later replace or supplement it: anything that
 * returns a `NoteInterpretation` can be plugged into `setNoteInterpreter()`.
 *
 * Hard rule: never invent dates. A follow-up date is only returned when it is
 * written in the note (absolute date) or derivable from an explicit relative
 * phrase ("call tomorrow", "follow up in 3 days") anchored to the note date.
 */
import {
  addDays,
  addBusinessDays,
  addWeeks,
  format,
  isValid,
  startOfDay,
  differenceInCalendarDays,
  nextMonday,
  nextTuesday,
  nextWednesday,
  nextThursday,
  nextFriday,
  nextSaturday,
  nextSunday,
} from "date-fns";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface NoteInterpretation {
  suggestedDepartment: string | null;
  suggestedStage: string | null;
  /** Recommended next action, in plain language. */
  action: string | null;
  /** yyyy-MM-dd (local) or null. Never invented. */
  explicitFollowUpDate: string | null;
  /** HH:mm (24h) when the note states a time, else null. */
  explicitFollowUpTime: string | null;
  /** Why the system reached this interpretation. */
  reason: string;
  /** Outcome code (see OUTCOMES in constants) if the note describes one. */
  detectedOutcome: string | null;
  confidence: Confidence;
  /** True when a coordinator should confirm before relying on this. */
  requiresConfirmation: boolean;
  /** "What happened" - short human summary. */
  summary: string;
  /** Matched phrases, for transparency in the UI. */
  signals: string[];
  /** e.g. "Waiting on Medicaid" - present when the case is waiting on an outside party */
  waitingOn: string | null;
  /** Restriction codes mentioned in the note (Code 54, H-78) */
  codes: string[];
}

export interface NoteInterpreter {
  readonly name: string;
  interpret(note: string | null | undefined, noteDate: Date | null, referenceDate?: Date): NoteInterpretation;
}

// ---------------------------------------------------------------------------

const ACTION_VERB = String.raw`(?:call(?:\s*back)?|follow[\s-]*up|f\/u|fu|reach\s*out|check(?:\s*back)?|contact|touch\s*base|try\s*again)`;

const WEEKDAYS: Record<string, (d: Date) => Date> = {
  monday: nextMonday,
  mon: nextMonday,
  tuesday: nextTuesday,
  tues: nextTuesday,
  tue: nextTuesday,
  wednesday: nextWednesday,
  wed: nextWednesday,
  thursday: nextThursday,
  thurs: nextThursday,
  thu: nextThursday,
  friday: nextFriday,
  fri: nextFriday,
  saturday: nextSaturday,
  sunday: nextSunday,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  couple: 2, few: 3,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/** Words near a date that make it a follow-up / event date (vs. an incidental date). */
const DATE_CONTEXT = /(schedul|set\b|set for|follow|f\/u|\bfu\b|call|appointment|appt|assessment|visit|\brn\b|nyia|maximus|cfeec|discharg|\bsoc\b|start|\bon\b|\bfor\b|after|until|by\b|interview|eval|meeting|due|effective|eff\b)/i;

interface DateCandidate {
  date: Date;
  time: string | null;
  context: string;
  hasContext: boolean;
  event: string | null;
  raw: string;
}

interface PatternHit {
  outcome?: string;
  stage?: string;
  department?: string;
  waitingOn?: string;
  label: string;
}

const PATTERNS: { re: RegExp; hit: PatternHit }[] = [
  // --- contact outcomes --------------------------------------------------
  { re: /\bleft\s+(?:a\s+)?(?:vm|v\/m|voice\s*-?mail|voicemail|msg|message)\b|\bsent\s+vm\b|\bwent\s+to\s+(?:vm|voicemail|voice\s*mail)\b/i, hit: { outcome: "LEFT_VOICEMAIL", label: "left voicemail" } },
  { re: /\bno\s+(?:answer|ans|response|pick\s*up)\b|\bdid(?:n'?t| not)\s+(?:pick\s*up|answer)\b|\bnot\s+answer(?:ing|ed)?\b|\bphone\s+not\s+answered\b|\bunreachable\b|\bunable\s+to\s+reach\b/i, hit: { outcome: "NO_ANSWER", label: "no answer" } },
  { re: /\bspoke\s+(?:with|to)\s+(?:the\s+)?(?:pt|patient|member|client|mbr)\b|\bspoke\s+(?:with|to)\s+(?:mr|mrs|ms)\.?\s/i, hit: { outcome: "SPOKE_WITH_PATIENT", label: "spoke with patient" } },
  { re: /\bspoke\s+(?:with|to)\s+(?:the\s+|pt'?s\s+|patient'?s\s+|his\s+|her\s+)?(?:daughter|son|family|wife|husband|mother|mom|father|dad|niece|nephew|sister|brother|caregiver|cg|grand\w*|spouse|relative|hcp|poa)\b/i, hit: { outcome: "SPOKE_WITH_FAMILY", label: "spoke with family" } },
  { re: /\b(?:auth(?:orization)?|pa)\s+(?:is\s+|still\s+)?pending\b|\bpending\s+(?:the\s+)?auth(?:orization)?\b|\bwaiting\s+(?:for|on)\s+(?:the\s+)?auth(?:orization)?\b/i, hit: { outcome: "AUTHORIZATION_PENDING", stage: "Authorization Pending", department: "Authorization / Start of Care", waitingOn: "Authorization", label: "authorization pending" } },
  { re: /\b(?:documents?|docs|paperwork|bank\s+statements?|award\s+letter)\s+(?:were\s+|was\s+|have\s+been\s+)?requested\b|\brequested\s+(?:the\s+)?(?:documents?|docs|paperwork|bank\s+statements?)\b|\bwaiting\s+(?:for|on)\s+(?:the\s+)?(?:documents?|docs|paperwork|bank\s+statements?)\b/i, hit: { outcome: "DOCUMENTS_REQUESTED", waitingOn: "Documents", label: "documents requested" } },
  { re: /\b(?:documents?|docs|paperwork)\s+(?:were\s+|was\s+|have\s+been\s+)?received\b|\breceived\s+(?:the\s+|all\s+)?(?:documents?|docs|paperwork)\b/i, hit: { outcome: "DOCUMENTS_RECEIVED", label: "documents received" } },

  // --- process stages ----------------------------------------------------
  { re: /\b(?:mltc\s+)?rn\s+(?:assessment|visit|eval\w*)\s+(?:is\s+|was\s+|has\s+been\s+)?(?:scheduled|set|booked)\b|\bscheduled\s+(?:the\s+)?(?:mltc\s+)?rn\s+(?:assessment|visit)\b|\brn\s+(?:assessment|visit)\s+(?:on|for)\b/i, hit: { outcome: "ASSESSMENT_SCHEDULED", stage: "MLTC RN Assessment Scheduled", department: "MLTC", label: "RN assessment scheduled" } },
  { re: /\b(?:nyia|maximus|cfeec)\b[^.]{0,25}?\b(?:scheduled|set|booked|rescheduled)\b|\b(?:scheduled|booked)\s+(?:the\s+)?(?:nyia|maximus|cfeec)\b|\b(?:nyia|maximus)\s+(?:on|for)\s+\d/i, hit: { outcome: "ASSESSMENT_SCHEDULED", stage: "NYIA Scheduled", department: "MLTC", label: "NYIA scheduled" } },
  { re: /\bdischarg\w*\s+(?:is\s+|was\s+|has\s+been\s+)?(?:scheduled|planned|set|date)\b|\bdischarg\w*\s+on\b|\bwill\s+be\s+discharged\b/i, hit: { stage: "Discharge Scheduled", label: "discharge scheduled" } },
  { re: /\b(?:appointment|appt)\s+(?:is\s+|was\s+|has\s+been\s+)?(?:scheduled|set|booked|on|for)\b|\bscheduled\s+(?:an?\s+)?(?:appointment|appt)\b/i, hit: { outcome: "APPOINTMENT_SCHEDULED", stage: "Appointment Scheduled", label: "appointment scheduled" } },
  { re: /\bwaiting\s+(?:for|on)\s+(?:the\s+)?(?:medicaid|hra|dss)\b|\bmedicaid\s+(?:is\s+)?(?:still\s+)?pending\b|\bpending\s+medicaid\b/i, hit: { stage: "Waiting for Medicaid", department: "Medicaid", waitingOn: "Medicaid decision", label: "waiting for Medicaid" } },
  { re: /\b(?:medicaid\s+)?(?:application|app)\s+(?:was\s+|has\s+been\s+)?(?:submitted|sent|faxed|filed)\b|\bsubmitted\s+(?:the\s+)?(?:medicaid\s+)?(?:application|app)\b/i, hit: { stage: "Application Submitted", department: "Medicaid", waitingOn: "Medicaid decision", label: "application submitted" } },
  { re: /\bwaiting\s+(?:for|on)\s+(?:the\s+)?(?:insurance|plan|mltc)\b/i, hit: { outcome: "WAITING_FOR_INSURANCE", waitingOn: "Insurance", label: "waiting for insurance" } },
];

const DEPARTMENT_KEYWORDS: { department: string; re: RegExp }[] = [
  { department: "Medicaid", re: /\bmedicaid\s+(?:application|app|recert\w*|renewal)|\bhra\b|\bdss\b|spend\s*-?down|surplus|pooled\s+(?:income\s+)?trust|\bmap[-\s]?751/i },
  { department: "MLTC", re: /\bmltc\b|\brn\s+assessment|\bnyia\b|\bmaximus\b|\bcfeec\b|plan\s+of\s+care|\bpoc\b/i },
  { department: "Authorization / Start of Care", re: /\bauth(?:orization)?\b|\bsoc\b|start\s+of\s+care|start\s+date/i },
  { department: "Agency / Plan Transfer", re: /\btransfer\b|\bp2p\b|plan\s+to\s+plan/i },
  { department: "CHHA", re: /\bchha\b/i },
  { department: "OPWDD", re: /\bopwdd\b|code\s*95/i },
  { department: "NHTD", re: /\bnhtd\b|\brrdc\b/i },
  { department: "Private Pay", re: /private\s+pay/i },
];

// ---------------------------------------------------------------------------

function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function parseTimeNear(text: string): string | null {
  const m = text.match(/(?:\bat\b|@|\bafter\b|\bby\b|\baround\b|,)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 1 || h > 12 || min > 59) return null;
  const pm = m[3].toLowerCase().startsWith("p");
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function eventForContext(ctx: string): string | null {
  const c = ctx.toLowerCase();
  if (/\brn\b/.test(c)) return "RN assessment";
  if (/nyia|maximus|cfeec/.test(c)) return "NYIA assessment";
  if (/discharg/.test(c)) return "discharge";
  if (/\bsoc\b|start/.test(c)) return "start of care";
  if (/appointment|appt/.test(c)) return "appointment";
  if (/interview/.test(c)) return "interview";
  if (/follow|f\/u|\bfu\b|call/.test(c)) return "follow-up";
  return null;
}

/**
 * Resolve a month/day (optional year) into a date on/after the note date.
 * Returns null when the date is in the past relative to the note (historic
 * reference) - we never roll a past date forward arbitrarily.
 */
function resolveMonthDay(month: number, day: number, year: number | null, anchor: Date): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const anchorDay = startOfDay(anchor);
  if (year !== null) {
    const y = year < 100 ? 2000 + year : year;
    const d = new Date(y, month - 1, day);
    if (!isValid(d) || d.getMonth() !== month - 1) return null;
    return d;
  }
  const sameYear = new Date(anchorDay.getFullYear(), month - 1, day);
  if (!isValid(sameYear) || sameYear.getMonth() !== month - 1) return null;
  if (sameYear >= anchorDay) return sameYear;
  // e.g. note on 12/20 mentioning "1/5": next year, only when close (<= 120 days)
  const nextYear = new Date(anchorDay.getFullYear() + 1, month - 1, day);
  if (differenceInCalendarDays(nextYear, anchorDay) <= 120) return nextYear;
  return null;
}

function findDateCandidates(note: string, anchor: Date): DateCandidate[] {
  const out: DateCandidate[] = [];
  // numeric dates: 10/28, 10/28/2026, 10-28-26
  const numeric = /(?<![\d/-])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d/-])/g;
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(note))) {
    const after = note.slice(m.index + m[0].length, m.index + m[0].length + 14);
    // Skip system signature timestamps like "6/19/2026 2:53:37 PM"
    if (/^\s*\d{1,2}:\d{2}:\d{2}/.test(after)) continue;
    // Skip "x/y" that are clearly ratios / scores (e.g. "1/2 hour", "24/7")
    if (/^\s*(?:hrs?|hours?|days?|weeks?)\b/i.test(after) || m[0] === "24/7") continue;
    if (m[0].includes("-") && !m[3]) continue; // "10-28" without year is too ambiguous (phone fragments, ranges)
    const date = resolveMonthDay(parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null, anchor);
    if (!date) continue;
    const before = note.slice(Math.max(0, m.index - 45), m.index);
    const ctx = before + m[0] + note.slice(m.index + m[0].length, m.index + m[0].length + 25);
    out.push({
      date,
      time: parseTimeNear(note.slice(m.index + m[0].length, m.index + m[0].length + 30)),
      context: ctx,
      hasContext: DATE_CONTEXT.test(before) || DATE_CONTEXT.test(note.slice(m.index + m[0].length, m.index + m[0].length + 20)),
      event: eventForContext(before),
      raw: m[0],
    });
  }
  // month-name dates: "Oct 28", "October 28th, 2026"
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  while ((m = named.exec(note))) {
    const month = MONTHS[m[1].toLowerCase().replace(/\.$/, "")] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (!month) continue;
    const date = resolveMonthDay(month, parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null, anchor);
    if (!date) continue;
    const before = note.slice(Math.max(0, m.index - 45), m.index);
    out.push({
      date,
      time: parseTimeNear(note.slice(m.index + m[0].length, m.index + m[0].length + 30)),
      context: before + m[0],
      hasContext: DATE_CONTEXT.test(before) || true,
      event: eventForContext(before),
      raw: m[0],
    });
  }
  return out;
}

interface RelativeHit {
  date: Date;
  label: string;
  precise: boolean;
}

function findRelative(note: string, anchor: Date): RelativeHit | null {
  const n = note.toLowerCase();
  const base = startOfDay(anchor);

  // follow up in X days / weeks / business days
  const inX = new RegExp(String.raw`${ACTION_VERB}[^.]{0,30}?\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple(?:\s+of)?|few)\s+(business\s+|working\s+)?(day|days|week|weeks)\b`, "i");
  let m = n.match(inX);
  if (m) {
    const qtyRaw = m[1].replace(/\s+of$/, "");
    const qty = /^\d+$/.test(qtyRaw) ? parseInt(qtyRaw, 10) : NUMBER_WORDS[qtyRaw] ?? NaN;
    if (Number.isFinite(qty) && qty > 0 && qty < 120) {
      const unit = m[3];
      const date = unit.startsWith("week") ? addWeeks(base, qty) : m[2] ? addBusinessDays(base, qty) : addDays(base, qty);
      return { date, label: `"${m[0].trim()}"`, precise: !/couple|few/.test(qtyRaw) };
    }
  }
  // call tomorrow
  m = n.match(new RegExp(String.raw`${ACTION_VERB}[^.]{0,35}?\btomorrow\b|\btomorrow\b[^.]{0,20}?${ACTION_VERB}`, "i"));
  if (m) return { date: addDays(base, 1), label: `"${m[0].trim()}"`, precise: true };
  // call next week (interpreted as Monday of next week)
  m = n.match(new RegExp(String.raw`${ACTION_VERB}[^.]{0,35}?\bnext\s+week\b`, "i"));
  if (m) return { date: nextMonday(base), label: `"${m[0].trim()}" (Monday of next week)`, precise: false };
  // call Monday / next Tuesday
  m = n.match(new RegExp(String.raw`${ACTION_VERB}[^.]{0,35}?\b(?:on\s+|next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri)\b`, "i"));
  if (m) {
    const fn = WEEKDAYS[m[1]];
    if (fn) return { date: fn(base), label: `"${m[0].trim()}"`, precise: true };
  }
  return null;
}

// ---------------------------------------------------------------------------

export class RuleBasedNoteInterpreter implements NoteInterpreter {
  readonly name = "rule-based-v1";

  interpret(rawNote: string | null | undefined, noteDate: Date | null, referenceDate?: Date): NoteInterpretation {
    const note = (rawNote ?? "").replace(/\s+/g, " ").trim();
    const anchor = noteDate ?? referenceDate ?? null;
    const signals: string[] = [];

    if (!note) {
      return {
        suggestedDepartment: null,
        suggestedStage: null,
        action: null,
        explicitFollowUpDate: null,
        explicitFollowUpTime: null,
        reason: "No note text to interpret.",
        detectedOutcome: null,
        confidence: "LOW",
        requiresConfirmation: false,
        summary: "No note recorded.",
        signals,
        waitingOn: null,
        codes: [],
      };
    }

    // --- outcomes, stages, waiting ---
    const hits: PatternHit[] = [];
    for (const p of PATTERNS) if (p.re.test(note)) hits.push(p.hit);
    for (const h of hits) signals.push(h.label);

    const outcomes = Array.from(new Set(hits.map((h) => h.outcome).filter(Boolean))) as string[];
    let detectedOutcome: string | null = null;
    let outcomeConflict = false;
    const spoke = outcomes.find((o) => o === "SPOKE_WITH_PATIENT" || o === "SPOKE_WITH_FAMILY");
    const unsuccessful = outcomes.find((o) => o === "LEFT_VOICEMAIL") ?? outcomes.find((o) => o === "NO_ANSWER");
    const process = outcomes.find((o) => !["SPOKE_WITH_PATIENT", "SPOKE_WITH_FAMILY", "LEFT_VOICEMAIL", "NO_ANSWER"].includes(o));
    if (process) detectedOutcome = process;
    else if (spoke) detectedOutcome = spoke;
    else if (unsuccessful) detectedOutcome = unsuccessful;
    // "no answer ... then spoke with daughter" is fine (contact was eventually made);
    // two different spoke-with targets are fine too. Flag only "spoke" + "no answer" with no ordering cue.
    if (spoke && unsuccessful && !/\b(then|later|eventually|finally|after)\b/i.test(note)) outcomeConflict = true;

    const stage = hits.find((h) => h.stage)?.stage ?? null;
    const waitingOn = hits.find((h) => h.waitingOn)?.waitingOn ?? null;

    // restriction codes
    const codes: string[] = [];
    if (/\bcode\s*-?\s*54\b|\b54\s*code\b/i.test(note)) codes.push("Code 54");
    if (/\bh\s*-?\s*78\b|\b78\s*code\b|\bcode\s*78\b/i.test(note)) codes.push("H-78");
    for (const c of codes) signals.push(c);

    const statusChange = note.match(/status\s+(?:was\s+)?changed\s+to\s+([a-z0-9 _/-]{2,40}?)(?=[A-Z][a-z]|[.,;]|$)/i);
    if (statusChange) signals.push(`status changed to ${statusChange[1].trim()}`);

    // --- department suggestion ---
    let suggestedDepartment: string | null = hits.find((h) => h.department)?.department ?? null;
    if (!suggestedDepartment) {
      const matches = DEPARTMENT_KEYWORDS.filter((k) => k.re.test(note)).map((k) => k.department);
      if (matches.length === 1) suggestedDepartment = matches[0];
    }

    // --- dates ---
    let explicitFollowUpDate: string | null = null;
    let explicitFollowUpTime: string | null = null;
    let dateReason = "";
    let dateConfidence: Confidence | null = null;
    let dateAmbiguous = false;
    let event: string | null = null;

    if (anchor) {
      const candidates = findDateCandidates(note, anchor).filter((c) => c.date >= startOfDay(anchor));
      const contextual = candidates.filter((c) => c.hasContext);
      const distinct = Array.from(new Set(contextual.map((c) => toYmd(c.date))));
      const relative = findRelative(note, anchor);

      if (contextual.length > 0) {
        contextual.sort((a, b) => a.date.getTime() - b.date.getTime());
        const chosen = contextual[0];
        explicitFollowUpDate = toYmd(chosen.date);
        explicitFollowUpTime = chosen.time;
        event = chosen.event;
        signals.push(`date ${chosen.raw}`);
        if (distinct.length > 1) {
          dateAmbiguous = true;
          dateConfidence = "LOW";
          dateReason = `Note mentions several future dates (${distinct.join(", ")}); using the earliest. Please confirm.`;
        } else {
          dateConfidence = "HIGH";
          dateReason = `Note states ${event ? `${event} ` : ""}date ${chosen.raw}${chosen.time ? ` at ${chosen.time}` : ""}.`;
        }
      } else if (relative) {
        explicitFollowUpDate = toYmd(relative.date);
        signals.push(relative.label);
        dateConfidence = relative.precise ? "HIGH" : "MEDIUM";
        dateReason = `Note says ${relative.label}, relative to note date ${format(anchor, "MM/dd/yyyy")}.`;
        event = "follow-up";
        const t = parseTimeNear(note);
        if (t && /\b(at|after|around|by)\b/i.test(note)) explicitFollowUpTime = t;
      } else if (candidates.length > 0) {
        // A future date with no surrounding action words - do not rely on it silently.
        dateAmbiguous = true;
        dateConfidence = "LOW";
        dateReason = `Note contains date ${candidates[0].raw} without a clear action; not used automatically. Please confirm.`;
      }
    }

    // --- action ---
    const after = /\bafter\s+(?:the\s+)?(?:rn\s+)?(?:assessment|visit|appointment|appt|discharge|interview)\b/i.test(note);
    if (after) signals.push("call after event");
    let action: string | null = null;
    if (explicitFollowUpDate) {
      action = `Follow up on ${format(new Date(explicitFollowUpDate + "T00:00:00"), "MM/dd/yyyy")}${event && event !== "follow-up" ? ` (${after ? "after " : ""}${event})` : ""}`;
    } else if (detectedOutcome === "NO_ANSWER" || detectedOutcome === "LEFT_VOICEMAIL") {
      action = "Retry phone contact";
    } else if (waitingOn === "Medicaid decision") {
      action = "Check Medicaid application status";
    } else if (detectedOutcome === "AUTHORIZATION_PENDING") {
      action = "Follow up with insurance on authorization";
    } else if (detectedOutcome === "DOCUMENTS_REQUESTED") {
      action = "Follow up on requested documents";
    } else if (codes.length) {
      action = `Review ${codes.join(" / ")} restriction - rule may not be configured`;
    } else if (hits.length) {
      action = "Follow up per department rule";
    }

    // --- confidence ---
    let confidence: Confidence;
    const reasons: string[] = [];
    if (dateReason) reasons.push(dateReason);
    if (dateConfidence) {
      confidence = dateConfidence;
    } else if (detectedOutcome || stage) {
      confidence = "MEDIUM";
      reasons.push(`Detected: ${signals.filter((s) => !s.startsWith("date")).join(", ")}. No explicit follow-up date in note; department rule applies.`);
    } else {
      confidence = "LOW";
      reasons.push("No recognizable action or date in note; department rule applies.");
    }
    if (outcomeConflict) {
      confidence = "LOW";
      reasons.push("Note mentions both a successful contact and an unanswered call.");
    }
    const requiresConfirmation = dateAmbiguous || outcomeConflict;

    const summaryParts: string[] = [];
    if (detectedOutcome) summaryParts.push(OUTCOME_SUMMARY[detectedOutcome] ?? detectedOutcome);
    if (stage && !summaryParts.some((s) => s.toLowerCase().includes(stage.toLowerCase()))) summaryParts.push(stage);
    if (codes.length) summaryParts.push(`${codes.join(", ")} mentioned`);
    if (statusChange) summaryParts.push(`Status changed to ${statusChange[1].trim()}`);

    return {
      suggestedDepartment,
      suggestedStage: stage,
      action,
      explicitFollowUpDate,
      explicitFollowUpTime,
      reason: reasons.join(" "),
      detectedOutcome,
      confidence,
      requiresConfirmation,
      summary: summaryParts.length ? summaryParts.join("; ") : "Note does not describe a recognizable action.",
      signals,
      waitingOn,
      codes,
    };
  }
}

const OUTCOME_SUMMARY: Record<string, string> = {
  NO_ANSWER: "Phone not answered",
  LEFT_VOICEMAIL: "No answer - voicemail left",
  SPOKE_WITH_PATIENT: "Spoke with patient",
  SPOKE_WITH_FAMILY: "Spoke with family member",
  AUTHORIZATION_PENDING: "Authorization pending",
  DOCUMENTS_REQUESTED: "Documents requested",
  DOCUMENTS_RECEIVED: "Documents received",
  ASSESSMENT_SCHEDULED: "Assessment scheduled",
  APPOINTMENT_SCHEDULED: "Appointment scheduled",
  WAITING_FOR_INSURANCE: "Waiting for insurance",
};

let active: NoteInterpreter = new RuleBasedNoteInterpreter();

/** The interpreter used by the app. Swap via setNoteInterpreter (e.g. an LLM-backed one). */
export function getNoteInterpreter(): NoteInterpreter {
  return active;
}

export function setNoteInterpreter(impl: NoteInterpreter): void {
  active = impl;
}

export function interpretNote(note: string | null | undefined, noteDate: Date | null, referenceDate?: Date): NoteInterpretation {
  return active.interpret(note, noteDate, referenceDate);
}
