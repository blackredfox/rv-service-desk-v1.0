import { describe, expect, it } from "vitest";

import { classifyStepGuidanceIntent } from "@/lib/chat/step-guidance-intent";

const ACTIVE_STEP_QUESTION = "Is 12V present at the water heater control board input?";
const ACTIVE_STEP_GUIDANCE = "Measure at the board B+ input, compare the reading to battery voltage, and verify the correct wire or fuse path before moving on.";

function classify(message: string, hasPhotoAttachment = false) {
  return classifyStepGuidanceIntent({
    message,
    activeStepQuestion: ACTIVE_STEP_QUESTION,
    activeStepHowToCheck: ACTIVE_STEP_GUIDANCE,
    hasPhotoAttachment,
  });
}

describe("classifyStepGuidanceIntent — sticky active-step support", () => {
  it("keeps broad active-step follow-ups on the same step while findings are missing", () => {
    [
      "Where is it?",
      "What does it look like?",
      "Is this the right one?",
      "left side?",
      "near the board harness?",
      "рядом с платой?",
      "junto a la placa?",
    ].forEach((message) => {
      expect(classify(message)).not.toBeNull();
    });
  });

  it("still tags obvious same-step clarification subtypes when they are clear", () => {
    expect(classify("Where is it?")).toEqual({ category: "LOCATE_COMPONENT" });
    expect(classify("What does it look like?")).toEqual({ category: "APPEARANCE_RECOGNITION" });
    expect(classify("Is this the right one?")).toEqual({ category: "CONFIRM_STEP_TARGET" });
  });

  it("defaults unknown but related follow-ups to generic same-step support instead of null", () => {
    expect(classify("near the board harness?")).toEqual({ category: "GENERIC_STEP_SUPPORT" });
    expect(classify("рядом с платой?")).toEqual({ category: "GENERIC_STEP_SUPPORT" });
    expect(classify("junto a la placa?")).toEqual({ category: "GENERIC_STEP_SUPPORT" });
  });

  it("treats photo-related clarification as same-step support, not automatic evidence", () => {
    expect(classify("photo attached", true)).toEqual({ category: "PHOTO_CONFIRMATION" });
  });

  it.each([
    ["EN", "that one?"],
    ["RU", "это он?"],
    ["ES", "¿es este?"],
  ])("supports %s fragment-style same-step follow-ups", (_language, message) => {
    expect(classify(message)).not.toBeNull();
  });

  it("supports same-step RU clarification with a leading filler word", () => {
    expect(classify("А как проверить 12V?")) .not.toBeNull();
  });

  it.each([
    ["EN", "So how do I measure 12V there?"],
    ["RU", "А как измерить 12В там?"],
    ["ES", "Bueno, cómo mido 12V ahí?"],
  ])("keeps %s filler-led measurement follow-ups on the same step", (_language, message) => {
    expect(classify(message)).toEqual({ category: "HOW_TO_CHECK" });
  });

  it("returns null when actual findings are reported so normal progression can resume", () => {
    expect(classify("I measured 12.6V at the board input.")).toBeNull();
    expect(classify("12.6V present")).toBeNull();
  });

  it("returns bounded classification data only and does not emit flow authority decisions", () => {
    const result = classify("Is this the right one?");

    expect(result).toEqual({ category: "CONFIRM_STEP_TARGET" });
    expect(result).not.toHaveProperty("nextStepId");
    expect(result).not.toHaveProperty("mode");
    expect(result).not.toHaveProperty("advance");
    expect(result).not.toHaveProperty("completeStep");
  });
});