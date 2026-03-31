#!/usr/bin/env python3
"""
Pro-Tech Diagnostic Backend Test Suite
Testing Pro-Tech Diagnostic Behavior implementation with 11 RV system procedures

Features to test:
1. detectSystem: identifies all 11 systems from messages, returns null for unknown
2. getProcedure: returns correct procedure for each system with unique step IDs 
3. getNextStep: returns first step with no completions, skips completed, respects prerequisites
4. LP Gas: pressure test (lpg_2) precedes ignition (lpg_5) — correct prerequisite chain
5. mapInitialMessageToSteps: maps voltage/ground readings to completed steps
6. mapInitialMessageToSteps: does not over-map ambiguous messages
7. buildProcedureContext: shows ACTIVE DIAGNOSTIC PROCEDURE, completed steps, next step
8. initializeCase: initializes procedure from first message, pre-completes steps
9. processUserMessage: tracks completed steps and unable-to-verify steps
10. shouldPivot: returns true for key findings, false otherwise
11. Falls back to legacy topic tracking when no procedure matches
12. All 504 existing tests pass
"""

import subprocess
import sys
import json
import os
from pathlib import Path
from datetime import datetime

class ProTechDiagnosticTester:
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
        self.log(f"Testing: {test_name}")
        
        try:
            result = test_func()
            if result:
                self.tests_passed += 1
                self.results.append({"test": test_name, "status": "PASS"})
                self.log(f"✅ PASS - {test_name}")
            else:
                self.results.append({"test": test_name, "status": "FAIL"})
                self.log(f"❌ FAIL - {test_name}")
            return result
        except Exception as e:
            self.results.append({"test": test_name, "status": "ERROR", "message": str(e)})
            self.log(f"❌ ERROR - {test_name}: {str(e)}")
            return False
    
    def run_vitest_command(self, pattern="", json_output=False):
        """Run vitest with optional pattern filter"""
        os.chdir(self.app_dir)
        cmd = ["npx", "vitest", "run"]
        if json_output:
            cmd.append("--reporter=json")
        if pattern:
            cmd.extend(["--testNamePattern", pattern])
            
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            return result.returncode == 0, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return False, "", "Test timeout"
        except Exception as e:
            return False, "", str(e)

    def test_all_vitest_suite(self):
        """Test 1: All 504 existing tests pass"""
        success, stdout, stderr = self.run_vitest_command("", json_output=True)
        if success:
            try:
                # Parse JSON to get exact test count
                json_lines = [line for line in stdout.split('\n') if line.strip().startswith('{')]
                if json_lines:
                    result = json.loads(json_lines[-1])  # Last line should be summary
                    total_tests = result.get('numTotalTests', 0)
                    passed_tests = result.get('numPassedTests', 0)
                    
                    self.log(f"Vitest results: {passed_tests}/{total_tests} tests passed")
                    
                    # Check if we have 504 tests and all pass
                    if total_tests == 504 and passed_tests == 504:
                        self.log("✅ All 504 tests pass as required")
                        return True
                    else:
                        self.log(f"❌ Expected 504 tests all passing, got {passed_tests}/{total_tests}")
                        return False
                else:
                    self.log("❌ Could not parse vitest JSON output")
                    return False
            except json.JSONDecodeError:
                self.log("❌ Invalid JSON in vitest output")
                return False
        else:
            self.log(f"❌ Vitest suite failed: {stderr[:200]}...")
            return False

    def test_diagnostic_procedures_module(self):
        """Test 2: Diagnostic procedures specific tests"""
        success, stdout, stderr = self.run_vitest_command("diagnostic-procedures")
        if success:
            self.log("✅ diagnostic-procedures.test.ts passes")
            return True
        else:
            self.log(f"❌ diagnostic-procedures.test.ts failed: {stderr[:200]}")
            return False

    def test_diagnostic_registry_module(self):
        """Test 3: Diagnostic registry specific tests"""
        success, stdout, stderr = self.run_vitest_command("diagnostic-registry")  
        if success:
            self.log("✅ diagnostic-registry.test.ts passes")
            return True
        else:
            self.log(f"❌ diagnostic-registry.test.ts failed: {stderr[:200]}")
            return False

    def test_detect_system_coverage(self):
        """Test 4: detectSystem identifies all 11 systems + returns null for unknown"""
        # This is verified by the vitest test, but we can check the function exists and works
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('detectSystem Coverage Test', () => {
          it('should detect all 11 systems and return null for unknown', async () => {
            const { detectSystem } = await import('/app/src/lib/diagnostic-procedures.ts');
            
            // Test all 11 systems
            expect(detectSystem("Water pump not working")).toBe("water_pump");
            expect(detectSystem("LP gas system issue")).toBe("lp_gas");
            expect(detectSystem("Furnace won't ignite")).toBe("furnace");
            expect(detectSystem("AC not cooling")).toBe("roof_ac");
            expect(detectSystem("Fridge not cooling")).toBe("refrigerator");
            expect(detectSystem("Slide-out won't extend")).toBe("slide_out");
            expect(detectSystem("Leveling system not working")).toBe("leveling");
            expect(detectSystem("Inverter not working")).toBe("inverter_converter");
            expect(detectSystem("12V lights not working")).toBe("electrical_12v");
            expect(detectSystem("120V outlet not working")).toBe("electrical_ac");
            expect(detectSystem("TV won't turn on")).toBe("consumer_appliance");
            
            // Test unknown system returns null
            expect(detectSystem("Warp drive malfunction")).toBeNull();
          });
        });
        """
        return self.run_temp_test(test_script, "detect-system-coverage")

    def test_get_procedure_functionality(self):
        """Test 5: getProcedure returns correct procedures with unique step IDs"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('getProcedure Functionality', () => {
          it('should return procedures for all systems with unique step IDs', async () => {
            const { getProcedure, getRegisteredSystems } = await import('/app/src/lib/diagnostic-procedures.ts');
            
            const systems = getRegisteredSystems();
            expect(systems.length).toBe(11); // All 11 systems registered
            
            for (const system of systems) {
              const proc = getProcedure(system);
              expect(proc).not.toBeNull();
              expect(proc.system).toBe(system);
              expect(proc.steps.length).toBeGreaterThan(0);
              
              // Check unique step IDs
              const ids = proc.steps.map(s => s.id);
              const uniqueIds = new Set(ids);
              expect(ids.length).toBe(uniqueIds.size);
            }
            
            // Test unknown system returns null
            expect(getProcedure("antigrav_drive")).toBeNull();
          });
        });
        """
        return self.run_temp_test(test_script, "get-procedure-func")

    def test_lp_gas_prerequisite_chain(self):
        """Test 6: LP Gas pressure test precedes ignition - prerequisite validation"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('LP Gas Prerequisites', () => {
          it('should enforce pressure test before ignition', async () => {
            const { getProcedure, getNextStep } = await import('/app/src/lib/diagnostic-procedures.ts');
            
            const proc = getProcedure("lp_gas");
            expect(proc).not.toBeNull();
            
            // Find pressure test and ignition steps
            const pressureStep = proc.steps.find(s => s.id === "lpg_2");
            const ignitionStep = proc.steps.find(s => s.id === "lpg_5");
            
            expect(pressureStep).toBeDefined();
            expect(ignitionStep).toBeDefined();
            
            // Verify prerequisite chain: lpg_5 should require lpg_4, which requires lpg_2
            expect(ignitionStep.prerequisites).toContain("lpg_4");
            const manualValveStep = proc.steps.find(s => s.id === "lpg_4");
            expect(manualValveStep.prerequisites).toContain("lpg_2");
            
            // Test getNextStep respects this order
            let completed = new Set(["lpg_1"]); // Tank check done
            let next = getNextStep(proc, completed, new Set());
            expect(next.id).toBe("lpg_2"); // Pressure test next
            
            completed.add("lpg_2");
            completed.add("lpg_3"); // Also do leak test
            next = getNextStep(proc, completed, new Set());
            expect(next.id).toBe("lpg_4"); // Manual valve next
            
            completed.add("lpg_4");
            next = getNextStep(proc, completed, new Set());
            expect(next.id).toBe("lpg_5"); // NOW ignition can be done
          });
        });
        """
        return self.run_temp_test(test_script, "lp-gas-prereq")

    def test_initial_message_mapping(self):
        """Test 7: mapInitialMessageToSteps functionality"""  
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Initial Message Mapping', () => {
          it('should map voltage/ground readings but not over-map ambiguous messages', async () => {
            const { getProcedure, mapInitialMessageToSteps } = await import('/app/src/lib/diagnostic-procedures.ts');
            
            const proc = getProcedure("water_pump");
            
            // Detailed message should map multiple steps
            const detailed = "Water pump dead. Measured 12.4V at terminals. Ground is good, 0.2 ohms.";
            const completed = mapInitialMessageToSteps(detailed, proc);
            expect(completed.length).toBeGreaterThan(1);
            expect(completed).toContain("wp_2"); // voltage step
            expect(completed).toContain("wp_3"); // ground step
            
            // Ambiguous message should not over-map
            const ambiguous = "Pump not working";
            const ambiguousCompleted = mapInitialMessageToSteps(ambiguous, proc);
            expect(ambiguousCompleted.length).toBeLessThanOrEqual(1);
          });
        });
        """
        return self.run_temp_test(test_script, "initial-message-map")

    def test_procedure_context_building(self):
        """Test 8: buildProcedureContext shows active procedure and progress"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Procedure Context Building', () => {
          it('should show ACTIVE DIAGNOSTIC PROCEDURE with progress', async () => {
            const { getProcedure, buildProcedureContext } = await import('/app/src/lib/diagnostic-procedures.ts');
            
            const proc = getProcedure("water_pump");
            
            // Test with no completed steps
            let context = buildProcedureContext(proc, new Set(), new Set());
            expect(context).toContain("ACTIVE DIAGNOSTIC PROCEDURE: Water Pump");
            expect(context).toContain("NEXT REQUIRED STEP: wp_1");
            expect(context).toContain("Do NOT invent diagnostic steps");
            
            // Test with some completed steps
            const completed = new Set(["wp_1", "wp_2"]);
            context = buildProcedureContext(proc, completed, new Set());
            expect(context).toContain("[DONE] wp_1");
            expect(context).toContain("[DONE] wp_2");
            expect(context).toContain("Progress: 2/5");
            
            // Test with unable-to-verify steps
            const unable = new Set(["wp_3"]);
            context = buildProcedureContext(proc, completed, unable);
            expect(context).toContain("[SKIP] wp_3");
          });
        });
        """
        return self.run_temp_test(test_script, "procedure-context")

    def test_case_initialization(self):
        """Test 9: initializeCase initializes procedure and pre-completes steps"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Case Initialization', () => {
          it('should initialize procedure and pre-complete steps from initial message', async () => {
            const { initializeCase, clearRegistry, getRegistryEntry } = await import('/app/src/lib/diagnostic-registry.ts');
            
            // Clear any existing state
            clearRegistry("test-case-1");
            
            // Test initialization with water pump message
            const result = initializeCase("test-case-1", "Water pump dead. Voltage at terminals is 12.4V");
            expect(result.system).toBe("water_pump");
            expect(result.procedure).not.toBeNull();
            expect(result.procedure.displayName).toBe("Water Pump");
            expect(result.preCompletedSteps.length).toBeGreaterThan(0);
            
            // Verify the registry was updated
            const entry = getRegistryEntry("test-case-1");
            expect(entry.procedureSystem).toBe("water_pump");
            expect(entry.completedStepIds.size).toBeGreaterThan(0);
            
            // Test re-initialization doesn't change system
            const result2 = initializeCase("test-case-1", "Furnace also broken");
            expect(result2.system).toBe("water_pump"); // Should stay water_pump
          });
        });
        """
        return self.run_temp_test(test_script, "case-init")

    def test_pivot_detection(self):
        """Test 10: shouldPivot returns true for key findings"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Pivot Detection', () => {
          it('should detect key findings and trigger pivots', async () => {
            const { initializeCase, processUserMessage, shouldPivot, clearRegistry } = await import('/app/src/lib/diagnostic-registry.ts');
            
            clearRegistry("test-pivot");
            
            // Initialize with normal message - no pivot
            initializeCase("test-pivot", "Furnace not working");
            let pivotResult = shouldPivot("test-pivot");
            expect(pivotResult.pivot).toBe(false);
            
            // Process message with key finding
            processUserMessage("test-pivot", "The motor is seized and won't turn at all");
            pivotResult = shouldPivot("test-pivot");
            expect(pivotResult.pivot).toBe(true);
            expect(pivotResult.finding).toContain("seized");
            
            // Test other key findings
            clearRegistry("test-pivot-2");
            initializeCase("test-pivot-2", "AC not working");
            processUserMessage("test-pivot-2", "There's a missing blade on the fan");
            pivotResult = shouldPivot("test-pivot-2");
            expect(pivotResult.pivot).toBe(true);
            expect(pivotResult.finding).toContain("blade");
          });
        });
        """
        return self.run_temp_test(test_script, "pivot-detect")

    def test_legacy_fallback(self):
        """Test 11: Falls back to legacy topic tracking when no procedure matches"""
        test_script = """
        import { describe, it, expect } from 'vitest';
        
        describe('Legacy Fallback', () => {
          it('should fall back to legacy topic tracking for unknown systems', async () => {
            const { initializeCase, processUserMessage, buildRegistryContext, clearRegistry } = await import('/app/src/lib/diagnostic-registry.ts');
            
            clearRegistry("legacy-test");
            
            // Initialize with unknown system message
            const result = initializeCase("legacy-test", "Something is broken");
            expect(result.system).toBeNull();
            expect(result.procedure).toBeNull();
            
            // Process message with diagnostic topics
            processUserMessage("legacy-test", "I checked the voltage, it's 12V");
            
            // Should use legacy context
            const context = buildRegistryContext("legacy-test");
            expect(context).toContain("ALREADY ANSWERED");
            expect(context).toContain("voltage");
          });
        });
        """
        return self.run_temp_test(test_script, "legacy-fallback")

    def run_temp_test(self, test_script, test_name):
        """Helper to run a temporary test script"""
        temp_test = f"/app/temp-{test_name}.ts"
        try:
            with open(temp_test, "w") as f:
                f.write(test_script)
                
            os.chdir(self.app_dir)
            result = subprocess.run(["npx", "vitest", "run", temp_test, "--reporter=verbose"], 
                                    capture_output=True, text=True, timeout=60)
            
            # Clean up
            if os.path.exists(temp_test):
                os.remove(temp_test)
                
            return result.returncode == 0
                
        except Exception as e:
            # Clean up on error
            if os.path.exists(temp_test):
                os.remove(temp_test)
            self.log(f"Error in temp test {test_name}: {e}")
            return False

    def test_required_files(self):
        """Test 12: All required files exist"""
        required_files = [
            "/app/src/lib/diagnostic-procedures.ts",
            "/app/src/lib/diagnostic-registry.ts", 
            "/app/src/app/api/chat/route.ts",
            "/app/prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt",
            "/app/tests/diagnostic-procedures.test.ts",
            "/app/tests/diagnostic-registry.test.ts",
            "/app/vitest.config.ts"
        ]
        
        missing = []
        for file_path in required_files:
            if not os.path.exists(file_path):
                missing.append(file_path)
                
        if missing:
            self.log(f"Missing required files: {missing}")
            return False
        return True

    def run_all_tests(self):
        """Run all Pro-Tech Diagnostic tests"""
        self.log("=" * 60)
        self.log("Pro-Tech Diagnostic Backend Test Suite")
        self.log("Testing 11 RV System Procedures Implementation")
        self.log("=" * 60)
        
        # Define all tests
        tests = [
            ("Required Files Present", self.test_required_files),
            ("All 504 Existing Tests Pass", self.test_all_vitest_suite),
            ("Diagnostic Procedures Module", self.test_diagnostic_procedures_module),
            ("Diagnostic Registry Module", self.test_diagnostic_registry_module), 
            ("detectSystem: 11 Systems + Null for Unknown", self.test_detect_system_coverage),
            ("getProcedure: Correct Procedures with Unique IDs", self.test_get_procedure_functionality),
            ("LP Gas: Pressure Before Ignition Prerequisites", self.test_lp_gas_prerequisite_chain),
            ("mapInitialMessageToSteps: Maps but Not Over-Maps", self.test_initial_message_mapping),
            ("buildProcedureContext: Active Procedure Display", self.test_procedure_context_building),
            ("initializeCase: Initialize + Pre-complete Steps", self.test_case_initialization),
            ("shouldPivot: Key Findings Trigger Pivot", self.test_pivot_detection),
            ("Legacy Fallback: Unknown Systems Use Topics", self.test_legacy_fallback),
        ]
        
        # Run each test
        for test_name, test_func in tests:
            self.run_test(test_name, test_func)
            
        self.log("=" * 60)
        self.log(f"TEST SUMMARY: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 ALL TESTS PASSED - Pro-Tech Diagnostic implementation verified!")
            return True
        else:
            self.log("⚠️  SOME TESTS FAILED")
            for result in self.results:
                if result["status"] != "PASS":
                    self.log(f"   {result['status']}: {result['test']}")
            return False

def main():
    tester = ProTechDiagnosticTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())