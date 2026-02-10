#!/usr/bin/env python3
"""
Backend Test Suite for RV Service Desk Diagnostic Agent
Five Behavioral Fixes Testing

Tests the five behavioral fixes:
1. Diagnostic Question Registry - track answered/unable-to-verify topics per case
2. Diagnostic Pivot Rules - key findings trigger immediate isolation completion
3. Fact-Locked Final Report - build fact pack from only technician-stated facts
4. Tone Adjustment - remove over-polite 'Thank you' defaults, one-word acknowledgments only
5. Labor Confirmation Input Parsing - accept '2.5', '2.5h' formats

This is a Next.js TypeScript application with Vitest testing framework.
Since there's no traditional REST API server, we test the underlying modules directly.
"""

import subprocess
import sys
import json
import os
from pathlib import Path
from datetime import datetime

class RVServiceDeskBackendTester:
    def __init__(self):
        self.app_dir = "/app"
        self.tests_run = 0
        self.tests_passed = 0
        self.results = []
        
    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")
        
    def run_test(self, test_name, test_func):
        """Run a single test and track results"""
        self.tests_run += 1
        self.log(f"Running test: {test_name}")
        
        try:
            result = test_func()
            if result:
                self.tests_passed += 1
                self.results.append({"test": test_name, "status": "PASS", "message": "✅"})
                self.log(f"✅ PASS - {test_name}")
            else:
                self.results.append({"test": test_name, "status": "FAIL", "message": "❌"})
                self.log(f"❌ FAIL - {test_name}")
        except Exception as e:
            self.results.append({"test": test_name, "status": "ERROR", "message": str(e)})
            self.log(f"❌ ERROR - {test_name}: {str(e)}")
            
        return result
    
    def check_file_exists(self, filepath):
        """Check if a file exists"""
        return os.path.exists(filepath)
    
    def run_vitest_command(self, pattern=""):
        """Run vitest with optional pattern filter"""
        os.chdir(self.app_dir)
        cmd = ["npx", "vitest", "run", "--reporter=json"]
        if pattern:
            cmd.extend(["--testNamePattern", pattern])
            
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return False, "", "Test timeout"
        except Exception as e:
            return False, "", str(e)

    def test_project_structure(self):
        """Test 1: Verify all required files exist"""
        required_files = [
            "/app/src/lib/diagnostic-registry.ts",
            "/app/src/lib/fact-pack.ts", 
            "/app/src/lib/labor-store.ts",
            "/app/src/lib/prompt-composer.ts",
            "/app/src/lib/mode-validators.ts",
            "/app/src/app/api/chat/route.ts",
            "/app/prompts/system/SYSTEM_PROMPT_BASE.txt",
            "/app/prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt",
            "/app/tests/diagnostic-registry.test.ts",
            "/app/tests/fact-pack.test.ts",
            "/app/tests/tone-adjustment.test.ts",
            "/app/tests/labor-confirmation.test.ts",
            "/app/vitest.config.ts"
        ]
        
        missing = []
        for file_path in required_files:
            if not self.check_file_exists(file_path):
                missing.append(file_path)
                
        if missing:
            self.log(f"Missing files: {missing}")
            return False
        return True

    def test_diagnostic_registry_tests(self):
        """Test 2: Run diagnostic registry specific tests"""
        success, stdout, stderr = self.run_vitest_command("diagnostic-registry")
        if success:
            self.log("Diagnostic registry tests passed")
            return True
        else:
            self.log(f"Diagnostic registry tests failed: {stderr}")
            return False

    def test_fact_pack_tests(self):
        """Test 3: Run fact pack specific tests"""  
        success, stdout, stderr = self.run_vitest_command("fact-pack")
        if success:
            self.log("Fact pack tests passed")
            return True
        else:
            self.log(f"Fact pack tests failed: {stderr}")
            return False

    def test_tone_adjustment_tests(self):
        """Test 4: Run tone adjustment specific tests"""
        success, stdout, stderr = self.run_vitest_command("tone-adjustment")
        if success:
            self.log("Tone adjustment tests passed")
            return True
        else:
            self.log(f"Tone adjustment tests failed: {stderr}")
            return False

    def test_labor_confirmation_tests(self):
        """Test 5: Run labor confirmation specific tests"""
        success, stdout, stderr = self.run_vitest_command("labor-confirmation")
        if success:
            self.log("Labor confirmation tests passed")
            return True
        else:
            self.log(f"Labor confirmation tests failed: {stderr}")
            return False

    def test_all_vitest_suite(self):
        """Test 6: Run complete vitest suite to ensure all 447 tests pass"""
        success, stdout, stderr = self.run_vitest_command("")
        if success and "447 passed" in (stdout + stderr):
            self.log("All 447 vitest tests passed")
            return True
        else:
            self.log(f"Vitest suite failed or doesn't have 447 passing tests: {stderr}")
            return False

    def test_prompt_files_content(self):
        """Test 7: Verify prompt files contain required content for tone adjustment"""
        try:
            # Check SYSTEM_PROMPT_BASE.txt
            with open("/app/prompts/system/SYSTEM_PROMPT_BASE.txt", "r") as f:
                base_content = f.read()
                
            # Should contain tone adjustment directives
            required_base = [
                "Do NOT say \"Thank you\"",
                "Prefer silence over politeness",
                "Professional and concise",
                "Never repeat what the technician just said"
            ]
            
            for req in required_base:
                if req not in base_content:
                    self.log(f"Missing in SYSTEM_PROMPT_BASE.txt: {req}")
                    return False
                    
            # Check MODE_PROMPT_DIAGNOSTIC.txt
            with open("/app/prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt", "r") as f:
                diag_content = f.read()
                
            # Should contain registry and pivot rules
            required_diag = [
                "DIAGNOSTIC REGISTRY RULES",
                "ALREADY ANSWERED",
                "UNABLE TO VERIFY", 
                "PIVOT RULES",
                "KEY FINDING",
                "ONE short acknowledgment"
            ]
            
            for req in required_diag:
                if req not in diag_content:
                    self.log(f"Missing in MODE_PROMPT_DIAGNOSTIC.txt: {req}")
                    return False
                    
            self.log("Prompt files contain required content")
            return True
            
        except Exception as e:
            self.log(f"Error checking prompt files: {e}")
            return False

    def test_typescript_compilation(self):
        """Test 8: Verify TypeScript compilation works"""
        os.chdir(self.app_dir)
        try:
            result = subprocess.run(["npx", "tsc", "--noEmit"], capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                self.log("TypeScript compilation successful")
                return True
            else:
                self.log(f"TypeScript compilation errors: {result.stderr}")
                return False
        except Exception as e:
            self.log(f"TypeScript compilation error: {e}")
            return False

    def test_module_imports(self):
        """Test 9: Verify all main modules can be imported (via vitest)"""
        # This tests that the modules have correct syntax and dependencies
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Module Import Test', () => {
          it('should import diagnostic-registry', async () => {
            const mod = await import('/app/src/lib/diagnostic-registry.ts');
            expect(mod.detectAlreadyAnswered).toBeDefined();
            expect(mod.extractTopics).toBeDefined();
            expect(mod.detectKeyFinding).toBeDefined();
          });
          
          it('should import fact-pack', async () => {
            const mod = await import('/app/src/lib/fact-pack.ts');
            expect(mod.buildFactPack).toBeDefined();
            expect(mod.buildFactLockConstraint).toBeDefined();
          });
          
          it('should import labor-store', async () => {
            const mod = await import('/app/src/lib/labor-store.ts');
            expect(mod.parseLaborConfirmation).toBeDefined();
            expect(mod.extractLaborEstimate).toBeDefined();
          });
        });
        """
        
        # Write temp test file
        temp_test = "/app/temp-import-test.ts"
        try:
            with open(temp_test, "w") as f:
                f.write(test_script)
                
            os.chdir(self.app_dir)
            result = subprocess.run(["npx", "vitest", "run", temp_test], capture_output=True, text=True, timeout=30)
            
            # Clean up
            if os.path.exists(temp_test):
                os.remove(temp_test)
                
            if result.returncode == 0:
                self.log("Module imports successful")
                return True
            else:
                self.log(f"Module import errors: {result.stderr}")
                return False
                
        except Exception as e:
            # Clean up on error
            if os.path.exists(temp_test):
                os.remove(temp_test)
            self.log(f"Module import test error: {e}")
            return False

    def test_package_json_dependencies(self):
        """Test 10: Verify package.json has required dependencies"""
        try:
            with open("/app/package.json", "r") as f:
                package_data = json.load(f)
                
            dependencies = {**package_data.get("dependencies", {}), **package_data.get("devDependencies", {})}
            
            required_deps = [
                "vitest",
                "typescript",
                "@types/node",
                "next"
            ]
            
            missing = []
            for dep in required_deps:
                if dep not in dependencies:
                    missing.append(dep)
                    
            if missing:
                self.log(f"Missing dependencies: {missing}")
                return False
                
            self.log("All required dependencies present")
            return True
            
        except Exception as e:
            self.log(f"Error checking package.json: {e}")
            return False

    def run_all_tests(self):
        """Run all backend tests"""
        self.log("=" * 60)
        self.log("RV Service Desk Backend Test Suite")
        self.log("Testing Five Behavioral Fixes Implementation")
        self.log("=" * 60)
        
        # Define all tests
        tests = [
            ("Project Structure", self.test_project_structure),
            ("TypeScript Compilation", self.test_typescript_compilation),
            ("Package Dependencies", self.test_package_json_dependencies),
            ("Module Imports", self.test_module_imports),
            ("Prompt Files Content", self.test_prompt_files_content),
            ("Diagnostic Registry Tests", self.test_diagnostic_registry_tests),
            ("Fact Pack Tests", self.test_fact_pack_tests),
            ("Tone Adjustment Tests", self.test_tone_adjustment_tests), 
            ("Labor Confirmation Tests", self.test_labor_confirmation_tests),
            ("Complete Vitest Suite (447 tests)", self.test_all_vitest_suite),
        ]
        
        # Run each test
        for test_name, test_func in tests:
            self.run_test(test_name, test_func)
            
        self.log("=" * 60)
        self.log(f"TEST SUMMARY: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 ALL TESTS PASSED - Five behavioral fixes implementation verified!")
            return True
        else:
            self.log("⚠️  SOME TESTS FAILED")
            for result in self.results:
                if result["status"] != "PASS":
                    self.log(f"   {result['status']}: {result['test']} - {result['message']}")
            return False

def main():
    tester = RVServiceDeskBackendTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())