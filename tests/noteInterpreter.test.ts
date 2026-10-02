import { describe, it, expect } from "vitest";
import { interpretNote } from "../src/services/noteInterpreter";
import { d } from "./helpers";

// Note dated Friday Oct 2 2026
const ND = d(2026, 10, 2, 11);

describe("NoteInterpreter", () => {
  it.each([
    ["Spoke with pt, he asked me to call tomorrow.", "2026-10-03"],
    ["Daughter said to call Monday.", "2026-10-05"],
    ["Will follow up in 3 days.", "2026-10-05"],
    ["follow up in two weeks", "2026-10-16"],
    ["Call next week to confirm.", "2026-10-05"],
    ["FOLLOW-UP SET FOR 10/5/2026, MONDAY AFTER 2:30 PM", "2026-10-05"],
    ["NYIA scheduled for 10/14.", "2026-10-14"],
    ["Discharge scheduled on 10/09/2026.", "2026-10-09"],
    ["Appointment scheduled Oct 20th", "2026-10-20"],
  ])("%s -> %s", (note, expected) => {
    expect(interpretNote(note, ND).explicitFollowUpDate).toBe(expected);
  });

  it("extracts a time when stated", () => {
    const r = interpretNote("FOLLOW-UP SET FOR 10/5/2026, MONDAY AFTER 2:30 PM", ND);
    expect(r.explicitFollowUpTime).toBe("14:30");
  });

  it.each([
    ["Called twice, no answer, no VM.", "NO_ANSWER"],
    ["Called, didn't pick up. left VM and texted as well.", "LEFT_VOICEMAIL"],
    ["Spoke with the patient, she is interested.", "SPOKE_WITH_PATIENT"],
    ["Spoke with the daughter about the case.", "SPOKE_WITH_FAMILY"],
    ["Spoke with family, explained process.", "SPOKE_WITH_FAMILY"],
    ["Authorization pending with Fidelis.", "AUTHORIZATION_PENDING"],
    ["Bank statements requested from the member.", "DOCUMENTS_REQUESTED"],
    ["RN assessment scheduled 10/28. Call after assessment.", "ASSESSMENT_SCHEDULED"],
  ])("%s -> outcome %s", (note, outcome) => {
    expect(interpretNote(note, ND).detectedOutcome).toBe(outcome);
  });

  it("detects Medicaid waiting / application submitted", () => {
    const a = interpretNote("Medicaid application submitted to HRA.", ND);
    expect(a.suggestedDepartment).toBe("Medicaid");
    expect(a.suggestedStage).toBe("Application Submitted");
    expect(a.waitingOn).toBe("Medicaid decision");
    const b = interpretNote("Waiting for Medicaid to approve.", ND);
    expect(b.suggestedStage).toBe("Waiting for Medicaid");
  });

  it("RN assessment note suggests MLTC with high confidence", () => {
    const r = interpretNote("RN assessment scheduled 10/28. Call after assessment.", ND);
    expect(r.suggestedDepartment).toBe("MLTC");
    expect(r.confidence).toBe("HIGH");
    expect(r.requiresConfirmation).toBe(false);
    expect(r.action).toContain("10/28/2026");
  });

  it("never invents dates", () => {
    for (const note of ["Called twice, no answer, left VM", "Agency switched", "Pt is interested in services", ""]) {
      expect(interpretNote(note, ND).explicitFollowUpDate).toBeNull();
    }
  });

  it("ignores system signature timestamps and past dates", () => {
    const r = interpretNote("STATUS CHANGED TO HOLDIslam Faria (Faria)6/19/2026 2:53:37 PM", d(2026, 7, 13));
    expect(r.explicitFollowUpDate).toBeNull();
    const past = interpretNote("RN assessment was done on 9/15.", ND);
    expect(past.explicitFollowUpDate).toBeNull();
  });

  it("does not treat phone numbers as dates", () => {
    expect(interpretNote("Called @646-547-7891, no response", ND).explicitFollowUpDate).toBeNull();
  });

  it("flags multiple future dates as low confidence requiring confirmation", () => {
    const r = interpretNote("NYIA scheduled 10/10, RN assessment scheduled 10/20.", ND);
    expect(r.confidence).toBe("LOW");
    expect(r.requiresConfirmation).toBe(true);
    expect(r.explicitFollowUpDate).toBe("2026-10-10");
  });

  it("flags a bare future date without action words for confirmation and does not use it", () => {
    const r = interpretNote("Pt number changed 10/20", ND);
    expect(r.explicitFollowUpDate).toBeNull();
    expect(r.requiresConfirmation).toBe(true);
  });

  it("detects Code 54 and H-78 mentions", () => {
    expect(interpretNote("Member has code 54", ND).codes).toContain("Code 54");
    expect(interpretNote("H-78 on the case", ND).codes).toContain("H-78");
  });

  it("year rolls over only for near-future dates", () => {
    expect(interpretNote("Call on 1/5", d(2026, 12, 20)).explicitFollowUpDate).toBe("2027-01-05");
  });
});
