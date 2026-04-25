/**
 * Pushback detection — verify the extended `detectAlreadyAnswered`
 * patterns recognize technician frustration / "you're not listening" /
 * "irrelevant question" so the existing already-answered handling path
 * runs for these cases (Cases-78/79/81).
 *
 * Authority contract:
 *   - These patterns inform the SERVER's already-answered branch in
 *     `processUserMessage`. Detection is server-owned. The LLM never
 *     selects step transitions.
 */

import { describe, it, expect } from "vitest";
import { detectAlreadyAnswered } from "@/lib/diagnostic-registry";

describe("detectAlreadyAnswered — pushback recognition", () => {
  it("recognises Russian 'ты меня не слышишь' / 'не слышите меня'", () => {
    expect(detectAlreadyAnswered("ты меня не слышиш что я говорю")).toBe(true);
    expect(detectAlreadyAnswered("вы меня не слышите")).toBe(true);
    expect(detectAlreadyAnswered("не слышишь что я говорю?")).toBe(true);
  });

  it("recognises Russian 'вопрос не по существу' / 'не по существу'", () => {
    expect(detectAlreadyAnswered("вопрос не по существу")).toBe(true);
    expect(detectAlreadyAnswered("это не по существу")).toBe(true);
  });

  it("recognises Russian 'не понял вопроса'", () => {
    expect(detectAlreadyAnswered("не понял вопроса")).toBe(true);
    expect(detectAlreadyAnswered("я не поняла вопроса")).toBe(true);
  });

  it("recognises Russian 'я уже ответил'", () => {
    expect(detectAlreadyAnswered("я уже ответил")).toBe(true);
    expect(detectAlreadyAnswered("уже ответил, 0 ампер")).toBe(true);
  });

  it("recognises English 'you're not listening' / 'not relevant'", () => {
    expect(detectAlreadyAnswered("you're not listening to me")).toBe(true);
    expect(detectAlreadyAnswered("you are not listening")).toBe(true);
    expect(detectAlreadyAnswered("that's not relevant")).toBe(true);
    expect(detectAlreadyAnswered("not the point")).toBe(true);
    expect(detectAlreadyAnswered("irrelevant question")).toBe(true);
  });

  it("does NOT trigger on neutral diagnostic prose", () => {
    expect(detectAlreadyAnswered("the gas valve is open")).toBe(false);
    expect(detectAlreadyAnswered("12V present at the pump")).toBe(false);
    expect(detectAlreadyAnswered("я измерил напряжение и оно 12 вольт")).toBe(false);
    expect(detectAlreadyAnswered("работает")).toBe(false);
  });

  it("preserves prior coverage for classic phrases", () => {
    expect(detectAlreadyAnswered("already checked the fuse")).toBe(true);
    expect(detectAlreadyAnswered("I already told you")).toBe(true);
    expect(detectAlreadyAnswered("уже проверил, всё хорошо")).toBe(true);
    expect(detectAlreadyAnswered("ya lo revisé")).toBe(true);
  });
});
