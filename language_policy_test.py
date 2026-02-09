#!/usr/bin/env python3

"""
Language Policy Backend Test for RV Service Desk

Tests the core language policy functionality to ensure:
1. EN mode never outputs translation blocks
2. RU/ES/AUTO modes output translation blocks when appropriate
3. Language policy is enforced declaratively, not through prompt hacks
4. All language policy functions work as expected
"""

import sys
import json
import subprocess
import os
from pathlib import Path

def run_node_test(test_code):
    """Run Node.js test code and return result"""
    # Write test code to temp file
    test_file = Path("/tmp/lang_test.mjs")
    test_file.write_text(test_code)
    
    # Run with Node.js
    result = subprocess.run(
        ["node", str(test_file)], 
        capture_output=True, 
        text=True, 
        cwd="/app"
    )
    
    # Clean up
    test_file.unlink(missing_ok=True)
    
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "returncode": result.returncode
    }

class LanguagePolicyTester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.failures = []

    def test(self, name, test_func):
        """Run a single test"""
        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            result = test_func()
            if result:
                self.tests_passed += 1
                print(f"✅ Passed")
                return True
            else:
                print(f"❌ Failed")
                self.failures.append(name)
                return False
        except Exception as e:
            print(f"❌ Failed with error: {str(e)}")
            self.failures.append(f"{name}: {str(e)}")
            return False

    def test_resolve_language_policy_en_mode(self):
        """Test: EN mode returns includeTranslation=false"""
        test_code = '''
        import { resolveLanguagePolicy } from "./src/lib/lang.js";
        
        const policy = resolveLanguagePolicy("EN", "EN");
        
        if (policy.mode !== "EN") {
            console.error("Expected mode EN, got:", policy.mode);
            process.exit(1);
        }
        
        if (policy.includeTranslation !== false) {
            console.error("Expected includeTranslation false, got:", policy.includeTranslation);
            process.exit(1);
        }
        
        if (policy.translationLanguage !== undefined) {
            console.error("Expected translationLanguage undefined, got:", policy.translationLanguage);
            process.exit(1);
        }
        
        console.log("EN mode correctly returns includeTranslation=false");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_resolve_language_policy_ru_mode(self):
        """Test: RU mode returns includeTranslation=true"""
        test_code = '''
        import { resolveLanguagePolicy } from "./src/lib/lang.js";
        
        const policy = resolveLanguagePolicy("RU", "RU");
        
        if (policy.mode !== "RU") {
            console.error("Expected mode RU, got:", policy.mode);
            process.exit(1);
        }
        
        if (policy.includeTranslation !== true) {
            console.error("Expected includeTranslation true, got:", policy.includeTranslation);
            process.exit(1);
        }
        
        if (policy.translationLanguage !== "RU") {
            console.error("Expected translationLanguage RU, got:", policy.translationLanguage);
            process.exit(1);
        }
        
        console.log("RU mode correctly returns includeTranslation=true with translationLanguage=RU");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_resolve_language_policy_auto_en(self):
        """Test: AUTO+EN returns includeTranslation=false"""
        test_code = '''
        import { resolveLanguagePolicy } from "./src/lib/lang.js";
        
        const policy = resolveLanguagePolicy("AUTO", "EN");
        
        if (policy.mode !== "AUTO") {
            console.error("Expected mode AUTO, got:", policy.mode);
            process.exit(1);
        }
        
        if (policy.includeTranslation !== false) {
            console.error("Expected includeTranslation false, got:", policy.includeTranslation);
            process.exit(1);
        }
        
        console.log("AUTO+EN correctly returns includeTranslation=false");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_resolve_language_policy_auto_ru(self):
        """Test: AUTO+RU returns includeTranslation=true"""
        test_code = '''
        import { resolveLanguagePolicy } from "./src/lib/lang.js";
        
        const policy = resolveLanguagePolicy("AUTO", "RU");
        
        if (policy.mode !== "AUTO") {
            console.error("Expected mode AUTO, got:", policy.mode);
            process.exit(1);
        }
        
        if (policy.includeTranslation !== true) {
            console.error("Expected includeTranslation true, got:", policy.includeTranslation);
            process.exit(1);
        }
        
        if (policy.translationLanguage !== "RU") {
            console.error("Expected translationLanguage RU, got:", policy.translationLanguage);
            process.exit(1);
        }
        
        console.log("AUTO+RU correctly returns includeTranslation=true with translationLanguage=RU");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_validate_final_report_en_mode_english_only(self):
        """Test: EN mode (includeTranslation=false) passes for English-only report"""
        test_code = '''
        import { validateFinalReportOutput } from "./src/lib/mode-validators.js";
        
        const englishOnlyReport = "Water pump not operating per spec. Labor: 1.0 hr. Total labor: 1.0 hr.";
        const result = validateFinalReportOutput(englishOnlyReport, false);
        
        if (!result.valid) {
            console.error("Expected valid=true, got:", result.valid);
            console.error("Violations:", result.violations);
            process.exit(1);
        }
        
        console.log("EN mode correctly validates English-only report");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_validate_final_report_en_mode_with_translation(self):
        """Test: EN mode rejects bilingual report with translation"""
        test_code = '''
        import { validateFinalReportOutput } from "./src/lib/mode-validators.js";
        
        const bilingualReport = "Water pump not operating per spec. Labor: 1.0 hr.\\n\\n--- TRANSLATION ---\\n\\nНасос не работает. Работа: 1.0 час.";
        const result = validateFinalReportOutput(bilingualReport, false);
        
        if (result.valid) {
            console.error("Expected valid=false for bilingual report in EN mode, got:", result.valid);
            process.exit(1);
        }
        
        const hasLanguagePolicyViolation = result.violations.some(v => v.includes("EN mode must not include"));
        if (!hasLanguagePolicyViolation) {
            console.error("Expected language policy violation, got violations:", result.violations);
            process.exit(1);
        }
        
        console.log("EN mode correctly rejects bilingual report");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_build_language_directive_v2_en_mode(self):
        """Test: buildLanguageDirectiveV2 with includeTranslation=false produces English-only directive"""
        test_code = '''
        import { buildLanguageDirectiveV2 } from "./src/lib/prompt-composer.js";
        
        const directive = buildLanguageDirectiveV2({
            inputDetected: "EN",
            outputEffective: "EN",
            mode: "final_report",
            includeTranslation: false
        });
        
        if (!directive.includes("English only")) {
            console.error("Expected 'English only' in directive, got:", directive);
            process.exit(1);
        }
        
        if (directive.includes("--- TRANSLATION ---")) {
            console.error("EN mode should not mention translation separator");
            process.exit(1);
        }
        
        console.log("buildLanguageDirectiveV2 correctly produces English-only directive");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_build_language_directive_v2_ru_mode(self):
        """Test: buildLanguageDirectiveV2 with includeTranslation=true produces translation directive"""
        test_code = '''
        import { buildLanguageDirectiveV2 } from "./src/lib/prompt-composer.js";
        
        const directive = buildLanguageDirectiveV2({
            inputDetected: "RU",
            outputEffective: "EN",
            mode: "final_report",
            includeTranslation: true,
            translationLanguage: "RU"
        });
        
        if (!directive.includes("--- TRANSLATION ---")) {
            console.error("Expected translation separator mention in directive, got:", directive);
            process.exit(1);
        }
        
        if (!directive.includes("translate the full output into Russian")) {
            console.error("Expected Russian translation instruction, got:", directive);
            process.exit(1);
        }
        
        console.log("buildLanguageDirectiveV2 correctly produces translation directive");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_prompt_files_no_hardcoded_translation(self):
        """Test: SYSTEM_PROMPT_BASE.txt does not contain hardcoded translation rules"""
        test_code = '''
        import { readFileSync } from "fs";
        import { join } from "path";
        
        const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");
        
        if (content.includes("provide a full literal translation into the dialogue language")) {
            console.error("SYSTEM_PROMPT_BASE.txt should NOT contain hardcoded translation instruction");
            process.exit(1);
        }
        
        if (!content.includes("LANGUAGE DIRECTIVE")) {
            console.error("SYSTEM_PROMPT_BASE.txt should reference LANGUAGE DIRECTIVE");
            process.exit(1);
        }
        
        console.log("SYSTEM_PROMPT_BASE.txt correctly delegates to LANGUAGE DIRECTIVE");
        '''
        
        result = run_node_test(test_code)
        if not result["success"]:
            print(f"   Error: {result['stderr']}")
        return result["success"]

    def test_vitest_tests_pass(self):
        """Test: All existing vitest tests still pass"""
        print("Running complete vitest test suite...")
        result = subprocess.run(
            ["npx", "vitest", "run"], 
            cwd="/app",
            capture_output=True, 
            text=True,
            timeout=180
        )
        
        if result.returncode == 0:
            # Extract test count from output
            lines = result.stdout.split('\n')
            for line in lines:
                if "Tests" in line and "passed" in line:
                    print(f"   {line.strip()}")
            print("All vitest tests pass")
            return True
        else:
            print(f"   Error: {result.stderr[:300]}")
            return False

    def run_all_tests(self):
        """Run all language policy tests"""
        print("🚀 Starting RV Service Desk Language Policy Backend Tests")
        print("=" * 60)
        
        # Test language policy resolution
        self.test("resolveLanguagePolicy: EN mode → includeTranslation=false", 
                 self.test_resolve_language_policy_en_mode)
        
        self.test("resolveLanguagePolicy: RU mode → includeTranslation=true", 
                 self.test_resolve_language_policy_ru_mode)
        
        self.test("resolveLanguagePolicy: AUTO+EN → includeTranslation=false", 
                 self.test_resolve_language_policy_auto_en)
        
        self.test("resolveLanguagePolicy: AUTO+RU → includeTranslation=true", 
                 self.test_resolve_language_policy_auto_ru)
        
        # Test final report validation
        self.test("validateFinalReportOutput: EN mode passes English-only", 
                 self.test_validate_final_report_en_mode_english_only)
        
        self.test("validateFinalReportOutput: EN mode rejects bilingual", 
                 self.test_validate_final_report_en_mode_with_translation)
        
        # Test prompt composition
        self.test("buildLanguageDirectiveV2: EN mode → English-only directive", 
                 self.test_build_language_directive_v2_en_mode)
        
        self.test("buildLanguageDirectiveV2: RU mode → translation directive", 
                 self.test_build_language_directive_v2_ru_mode)
        
        # Test prompt files
        self.test("SYSTEM_PROMPT_BASE.txt: no hardcoded translation rules", 
                 self.test_prompt_files_no_hardcoded_translation)
        
        # Test complete vitest suite
        self.test("All 353 existing vitest tests still pass", 
                 self.test_vitest_tests_pass)
        
        # Print results
        print("\n" + "=" * 60)
        print(f"📊 Backend Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failures:
            print(f"❌ Failed tests:")
            for failure in self.failures:
                print(f"  - {failure}")
            return 1
        else:
            print("✅ All backend tests passed!")
            return 0

def main():
    # Change to app directory
    os.chdir("/app")
    
    tester = LanguagePolicyTester()
    exit_code = tester.run_all_tests()
    
    return exit_code

if __name__ == "__main__":
    sys.exit(main())