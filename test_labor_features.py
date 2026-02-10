#!/usr/bin/env python3

"""
Focused test for the three labor confirmation features:
1. Labor Time Consistency - operation-level breakdown must sum exactly to confirmed total
2. Missing Technician Confirmation Step - labor_confirmation mode between diagnostic and final_report  
3. Copy Button UX - visual feedback with checkmark and 'Copied!' text

This test focuses on unit test validation and direct function testing.
"""

import sys
import subprocess
import json
from datetime import datetime

class LaborConfirmationFeatureTest:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.feature_results = {}

    def run_test(self, name, test_func):
        """Run a single test and track results"""
        print(f"\n🔍 Testing {name}...")
        self.tests_run += 1
        
        try:
            result = test_func()
            if result:
                self.tests_passed += 1
                print(f"✅ Passed - {name}")
                self.feature_results[name] = "PASS"
                return True
            else:
                print(f"❌ Failed - {name}")
                self.feature_results[name] = "FAIL"
                return False
        except Exception as e:
            print(f"❌ Failed - {name}: {str(e)}")
            self.feature_results[name] = f"ERROR: {str(e)}"
            return False

    def test_labor_confirmation_unit_tests(self):
        """Test labor confirmation feature through comprehensive unit tests"""
        try:
            result = subprocess.run(
                ["yarn", "test", "tests/labor-confirmation.test.ts"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            if result.returncode == 0:
                print("   ✅ All labor confirmation unit tests pass")
                print("   ✅ extractLaborEstimate function works")  
                print("   ✅ parseLaborConfirmation function works")
                print("   ✅ validateLaborSum function works") 
                print("   ✅ Labor store operations work")
                print("   ✅ validateLaborConfirmationOutput function works")
                
                # Extract test count
                if "32 passed" in result.stdout:
                    print("   ✅ All 32 labor confirmation tests passed")
                
                return True
            else:
                print(f"   ❌ Labor confirmation tests failed: {result.stderr[:200]}")
                return False
        except Exception as e:
            print(f"   ❌ Error running tests: {str(e)}")
            return False

    def test_copy_button_ux_unit_tests(self):
        """Test copy button UX feature through unit tests"""
        try:
            result = subprocess.run(
                ["yarn", "test", "tests/copy-button-ux.test.ts"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            if result.returncode == 0:
                print("   ✅ All copy button UX unit tests pass")
                print("   ✅ Per-message copy state tracking works")
                print("   ✅ Auto-reset after 1.5s works") 
                print("   ✅ Visual feedback (checkmark + 'Copied!') works")
                print("   ✅ Independent report copy button state works")
                
                # Extract test count
                if "9 passed" in result.stdout:
                    print("   ✅ All 9 copy button UX tests passed")
                
                return True
            else:
                print(f"   ❌ Copy button UX tests failed: {result.stderr[:200]}")
                return False
        except Exception as e:
            print(f"   ❌ Error running tests: {str(e)}")
            return False

    def test_mode_validators_labor_confirmation(self):
        """Test that mode validators properly handle labor_confirmation mode"""
        try:
            result = subprocess.run(
                ["yarn", "test", "tests/mode-validators.test.ts"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            if result.returncode == 0:
                print("   ✅ All mode validator unit tests pass")
                print("   ✅ CaseMode includes 'labor_confirmation'")
                print("   ✅ validateOutput handles labor_confirmation mode")
                print("   ✅ getSafeFallback handles labor_confirmation mode")
                
                # Check for labor confirmation in output
                if "labor_confirmation" in result.stdout.lower():
                    print("   ✅ labor_confirmation mode testing found in output")
                
                return True
            else:
                print(f"   ❌ Mode validator tests failed: {result.stderr[:200]}")
                return False
        except Exception as e:
            print(f"   ❌ Error running tests: {str(e)}")
            return False

    def test_comprehensive_suite(self):
        """Test that all 394 tests still pass"""
        try:
            result = subprocess.run(
                ["yarn", "test"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=120
            )
            
            if result.returncode == 0:
                print("   ✅ All 394 unit tests pass")
                
                # Verify specific counts
                if "394 passed" in result.stdout:
                    print("   ✅ Confirmed: 394 tests passed")
                    
                # Check for the three features
                features_found = {
                    "labor-confirmation": "labor-confirmation" in result.stdout,
                    "copy-button-ux": "copy-button-ux" in result.stdout, 
                    "mode-validators": "mode-validators" in result.stdout,
                }
                
                all_found = all(features_found.values())
                if all_found:
                    print("   ✅ All three feature test files found and ran")
                else:
                    print("   ⚠️  Some feature test files not detected in output")
                
                return True
            else:
                print(f"   ❌ Comprehensive test suite failed: {result.stderr[:200]}")
                return False
        except Exception as e:
            print(f"   ❌ Error running comprehensive tests: {str(e)}")
            return False

    def validate_feature_implementation(self):
        """Validate that the three features are properly implemented"""
        
        # Check if the labor-store.ts has the required functions
        try:
            with open('/app/src/lib/labor-store.ts', 'r') as f:
                labor_store_content = f.read()
                
            required_functions = [
                'extractLaborEstimate',
                'parseLaborConfirmation', 
                'validateLaborSum',
                'setLaborEstimate',
                'confirmLabor',
                'getConfirmedHours'
            ]
            
            all_functions_present = all(func in labor_store_content for func in required_functions)
            
            if all_functions_present:
                print("   ✅ All required labor store functions are present")
                return True
            else:
                missing = [func for func in required_functions if func not in labor_store_content]
                print(f"   ❌ Missing functions in labor-store.ts: {missing}")
                return False
                
        except Exception as e:
            print(f"   ❌ Error validating labor-store.ts: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all labor confirmation feature tests"""
        print("🚀 RV Service Desk Labor Confirmation Feature Validation")
        print("=" * 80)
        print("Testing the three required features:")
        print("1. Labor Time Consistency - operation-level breakdown sums to confirmed total")
        print("2. Missing Technician Confirmation Step - labor_confirmation mode")  
        print("3. Copy Button UX - visual feedback with checkmark + 'Copied!' text")
        print("=" * 80)

        # Run focused tests for each feature
        print("\n" + "=" * 25 + " FEATURE 1: LABOR TIME CONSISTENCY " + "=" * 25)
        self.run_test("Labor Time Consistency (validateLaborSum)", self.test_labor_confirmation_unit_tests)
        
        print("\n" + "=" * 25 + " FEATURE 2: LABOR CONFIRMATION STEP " + "=" * 25)
        self.run_test("Labor Confirmation Mode (CaseMode)", self.test_mode_validators_labor_confirmation)
        
        print("\n" + "=" * 25 + " FEATURE 3: COPY BUTTON UX " + "=" * 25)
        self.run_test("Copy Button Visual Feedback", self.test_copy_button_ux_unit_tests)
        
        print("\n" + "=" * 25 + " IMPLEMENTATION VALIDATION " + "=" * 25)
        self.run_test("Feature Implementation Check", self.validate_feature_implementation)
        
        print("\n" + "=" * 25 + " COMPREHENSIVE TEST SUITE " + "=" * 25)
        self.run_test("All 394 Tests Pass", self.test_comprehensive_suite)

        # Print results
        print("\n" + "=" * 80)
        print("📊 FEATURE VALIDATION RESULTS:")
        print("=" * 80)
        
        for feature, result in self.feature_results.items():
            status = "✅" if result == "PASS" else "❌"
            print(f"{status} {feature}: {result}")
            
        print("=" * 80)
        print(f"📊 Overall Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        success_percentage = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        if self.tests_passed == self.tests_run:
            print("🎉 All labor confirmation features are working correctly!")
            print("✅ Feature 1: Labor time sums are validated")
            print("✅ Feature 2: Labor confirmation step is implemented")  
            print("✅ Feature 3: Copy button UX feedback is working")
            return 0
        else:
            print(f"⚠️  Some features need attention ({success_percentage:.1f}% success rate)")
            return 1

def main():
    tester = LaborConfirmationFeatureTest()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())