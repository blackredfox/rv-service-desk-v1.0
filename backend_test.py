#!/usr/bin/env python3
"""
RV Service Desk Backend Testing - Prompt Orchestration Stabilization
Testing alias detection, final report validation, RV terminology enforcement
"""

import subprocess
import sys
import os
import re
from datetime import datetime

class PromptOrchestrationTester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.base_dir = "/app"

    def run_test(self, name, test_func, *args, **kwargs):
        """Run a single test"""
        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            success = test_func(*args, **kwargs)
            if success:
                self.tests_passed += 1
                print(f"✅ {name} - PASSED")
            else:
                print(f"❌ {name} - FAILED")
            return success
        except Exception as e:
            print(f"❌ {name} - ERROR: {str(e)}")
            return False

    def test_alias_detection_unit_tests(self):
        """Test alias detection via unit tests"""
        try:
            result = subprocess.run([
                "yarn", "test", "tests/prompt-composer.test.ts", 
                "--reporter=verbose"
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            # Check if alias detection tests pass
            output = result.stdout + result.stderr
            
            # Look for specific test results
            alias_tests_passed = all([
                "should detect final report aliases (exact match)" in output,
                "should detect authorization aliases (exact match)" in output,
                "should return null for non-exact matches" in output
            ])
            
            if alias_tests_passed and result.returncode == 0:
                print("  ✓ All alias detection tests passed")
                return True
            else:
                print(f"  ❌ Unit tests failed or missing. Return code: {result.returncode}")
                return False
                
        except Exception as e:
            print(f"Alias detection test error: {e}")
            return False

    def test_mode_validators_unit_tests(self):
        """Test mode validators via unit tests"""
        try:
            result = subprocess.run([
                "yarn", "test", "tests/mode-validators.test.ts",
                "--reporter=verbose"
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            output = result.stdout + result.stderr
            
            # Check for final report validation tests
            validation_tests_passed = all([
                "should detect missing translation separator" in output,
                "should detect missing section header" in output,
                "should detect prohibited words" in output
            ])
            
            if validation_tests_passed and result.returncode == 0:
                print("  ✓ All mode validator tests passed")
                return True
            else:
                print(f"  ❌ Mode validator tests failed. Return code: {result.returncode}")
                return False
                
        except Exception as e:
            print(f"Mode validators test error: {e}")
            return False

    def test_prompt_enforcement_unit_tests(self):
        """Test prompt enforcement via unit tests"""
        try:
            result = subprocess.run([
                "yarn", "test", "tests/prompt-enforcement.test.ts",
                "--reporter=verbose"
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            output = result.stdout + result.stderr
            
            # Check for RV terminology enforcement tests
            enforcement_tests_passed = all([
                "should enforce RV terminology and battery-type question" in output,
                "should limit non-complex unit teardown" in output,
                "should list all complex equipment types" in output
            ])
            
            if enforcement_tests_passed and result.returncode == 0:
                print("  ✓ All prompt enforcement tests passed")
                return True
            else:
                print(f"  ❌ Prompt enforcement tests failed. Return code: {result.returncode}")
                return False
                
        except Exception as e:
            print(f"Prompt enforcement test error: {e}")
            return False

    def test_language_policy_unit_tests(self):
        """Test language policy via unit tests"""
        try:
            result = subprocess.run([
                "yarn", "test", "tests/language-policy.test.ts",
                "--reporter=verbose" 
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            output = result.stdout + result.stderr
            
            # Check for language policy tests
            policy_tests_passed = all([
                "EN mode → no translation" in output,
                "RU mode → translation into Russian" in output,
                "ES mode → translation into Spanish" in output
            ])
            
            if policy_tests_passed and result.returncode == 0:
                print("  ✓ All language policy tests passed")
                return True
            else:
                print(f"  ❌ Language policy tests failed. Return code: {result.returncode}")
                return False
                
        except Exception as e:
            print(f"Language policy test error: {e}")
            return False

    def test_overall_unit_test_suite(self):
        """Test overall unit test suite"""
        try:
            result = subprocess.run([
                "yarn", "test", "--run"
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            output = result.stdout + result.stderr
            
            # Check pass rate
            if "passed" in output and result.returncode == 0:
                print(f"  ✓ Overall test suite passed")
                return True
            else:
                print(f"  ❌ Overall test suite failed. Return code: {result.returncode}")
                print(f"  Output snippet: {output[-500:]}")  # Last 500 chars for debugging
                return False
                
        except Exception as e:
            print(f"Overall test suite error: {e}")
            return False

    def test_prompt_file_integrity(self):
        """Test that prompt files exist and contain required content"""
        try:
            # Test diagnostic prompt contains RV terminology
            diagnostic_path = os.path.join(self.base_dir, "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt")
            if not os.path.exists(diagnostic_path):
                print("  ❌ Diagnostic prompt file missing")
                return False
                
            with open(diagnostic_path, 'r') as f:
                diagnostic_content = f.read()
                
            rv_terms_present = all([
                "converter/charger" in diagnostic_content,
                "inverter" in diagnostic_content,
                "battery type/bank" in diagnostic_content,
                "NON-COMPLEX UNIT REPAIR LIMITS" in diagnostic_content
            ])
            
            if not rv_terms_present:
                print("  ❌ Required RV terminology missing from diagnostic prompt")
                return False
                
            # Test final report prompt
            final_report_path = os.path.join(self.base_dir, "prompts/modes/MODE_PROMPT_FINAL_REPORT.txt") 
            if not os.path.exists(final_report_path):
                print("  ❌ Final report prompt file missing")
                return False
                
            with open(final_report_path, 'r') as f:
                final_report_content = f.read()
                
            final_report_structure = all([
                "Complaint:" in final_report_content,
                "Diagnostic Procedure:" in final_report_content,
                "Verified Condition:" in final_report_content,
                "--- TRANSLATION ---" in final_report_content
            ])
            
            if not final_report_structure:
                print("  ❌ Required structure missing from final report prompt")
                return False
                
            print("  ✓ All prompt files contain required content")
            return True
            
        except Exception as e:
            print(f"Prompt file integrity test error: {e}")
            return False

    def test_typescript_compilation_clean(self):
        """Test TypeScript compilation is clean"""
        try:
            result = subprocess.run([
                "npx", "tsc", "--noEmit", "--project", "tsconfig.json"
            ], cwd=self.base_dir, capture_output=True, text=True)
            
            # Count critical errors in key files
            key_files = ["prompt-composer.ts", "mode-validators.ts", "chat/route.ts"]
            critical_errors = []
            
            for line in result.stderr.split('\n'):
                if 'error TS' in line:
                    for file in key_files:
                        if file in line:
                            critical_errors.append(line.strip())
            
            if len(critical_errors) == 0:
                print("  ✓ No critical TypeScript errors in prompt orchestration files")
                return True
            else:
                print(f"  ❌ Found {len(critical_errors)} critical errors:")
                for error in critical_errors[:3]:  # Show first 3
                    print(f"    {error}")
                return False
                
        except Exception as e:
            print(f"TypeScript compilation test error: {e}")
            return False

def main():
    tester = PrismaV7MigrationTester()
    
    print("🚀 Starting Prisma v7 Migration Tests")
    print("=" * 50)
    
    # Run all tests
    tests = [
        ("TypeScript db.ts compilation", tester.test_typescript_db_compilation),
        ("TypeScript dependent files", tester.test_typescript_dependent_files),
        ("Total TypeScript errors count", tester.test_total_typescript_errors),
        ("ESLint db.ts", tester.test_eslint_db),
        ("Runtime with DATABASE_URL", tester.test_runtime_with_database_url),
        ("Singleton behavior", tester.test_singleton_behavior),
        ("Environment validation", tester.test_env_validation),
        ("Export stability", tester.test_export_stability),
    ]
    
    for test_name, test_func in tests:
        tester.run_test(test_name, test_func)
    
    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed! Prisma v7 migration is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())