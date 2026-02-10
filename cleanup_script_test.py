#!/usr/bin/env python3
"""
Test the retention cleanup script logic without requiring database setup
Tests the cleanup script's date calculation and logic
"""

import subprocess
import sys
from datetime import datetime, timedelta


def test_cleanup_script_constants():
    """Test that cleanup script uses the correct RETENTION_DAYS constant"""
    print("🧪 Testing cleanup script constants")
    
    try:
        # Read the cleanup script
        with open('/app/scripts/cleanup-retention.ts', 'r') as f:
            script_content = f.read()
        
        # Check for RETENTION_DAYS import and usage
        has_import = 'import { RETENTION_DAYS }' in script_content
        has_usage = 'RETENTION_DAYS * 24 * 60 * 60 * 1000' in script_content
        
        success = has_import and has_usage
        print(f"✅ Cleanup script imports RETENTION_DAYS: {has_import}")
        print(f"✅ Cleanup script uses RETENTION_DAYS for calculation: {has_usage}")
        
        return success
        
    except Exception as e:
        print(f"❌ Error reading cleanup script: {e}")
        return False


def test_retention_constants_match():
    """Test that retention constants match between modules"""
    print("\n🧪 Testing retention constants consistency")
    
    try:
        # Read retention.ts
        with open('/app/src/lib/retention.ts', 'r') as f:
            retention_content = f.read()
        
        # Read cleanup script
        with open('/app/scripts/cleanup-retention.ts', 'r') as f:
            cleanup_content = f.read()
        
        # Check both use RETENTION_DAYS = 30
        retention_has_30 = 'export const RETENTION_DAYS = 30' in retention_content
        cleanup_imports_retention = 'from "../src/lib/retention"' in cleanup_content
        
        success = retention_has_30 and cleanup_imports_retention
        print(f"✅ retention.ts exports RETENTION_DAYS = 30: {retention_has_30}")
        print(f"✅ cleanup script imports from retention module: {cleanup_imports_retention}")
        
        return success
        
    except Exception as e:
        print(f"❌ Error checking constants: {e}")
        return False


def test_cleanup_script_features():
    """Test cleanup script features without running it"""
    print("\n🧪 Testing cleanup script features")
    
    try:
        with open('/app/scripts/cleanup-retention.ts', 'r') as f:
            script_content = f.read()
        
        # Check for key features
        has_dry_run = '--dry-run' in script_content and 'DRY_RUN' in script_content
        has_cutoff_calc = 'const cutoffDate = new Date(Date.now() - RETENTION_DAYS' in script_content
        has_case_deletion = 'prisma.case.deleteMany' in script_content
        has_message_deletion = 'prisma.message.deleteMany' in script_content
        has_logging = 'console.log' in script_content
        
        features = {
            "Dry run support": has_dry_run,
            "Cutoff date calculation": has_cutoff_calc, 
            "Case deletion logic": has_case_deletion,
            "Message deletion logic": has_message_deletion,
            "Logging functionality": has_logging
        }
        
        all_success = True
        for feature, present in features.items():
            status = "✅" if present else "❌"
            print(f"{status} {feature}: {present}")
            if not present:
                all_success = False
        
        return all_success
        
    except Exception as e:
        print(f"❌ Error analyzing cleanup script: {e}")
        return False


def test_vitest_coverage():
    """Verify the vitest tests cover retention functionality"""
    print("\n🧪 Testing vitest retention test coverage")
    
    try:
        with open('/app/tests/retention.test.ts', 'r') as f:
            test_content = f.read()
        
        # Check for key test coverage
        tests_to_check = [
            "computeExpiresAt",
            "computeTimeLeftSeconds", 
            "formatTimeLeft",
            "getUrgencyTier",
            "isExpired",
            "RETENTION_DAYS",
            "storage.createCase",
            "storage.listCases",
            "appendMessage"
        ]
        
        coverage = {}
        for test in tests_to_check:
            coverage[test] = test in test_content
        
        covered_count = sum(coverage.values())
        total_count = len(coverage)
        
        for test, covered in coverage.items():
            status = "✅" if covered else "❌"
            print(f"{status} {test} test coverage: {covered}")
        
        success_rate = (covered_count / total_count) * 100
        print(f"📊 Test coverage: {covered_count}/{total_count} ({success_rate:.1f}%)")
        
        return covered_count == total_count
        
    except Exception as e:
        print(f"❌ Error checking test coverage: {e}")
        return False


def main():
    """Run all cleanup and coverage tests"""
    print("🚀 RV Service Desk Cleanup Script and Test Coverage Verification")
    print("=" * 80)
    
    tests = [
        test_cleanup_script_constants,
        test_retention_constants_match,
        test_cleanup_script_features,
        test_vitest_coverage
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        try:
            if test():
                passed += 1
            print()  # Add spacing
        except Exception as e:
            print(f"❌ Test {test.__name__} failed with error: {e}\n")
    
    print("=" * 80)
    print(f"📊 Cleanup Script Tests: {passed}/{total} passed")
    
    if passed == total:
        print("🎉 All cleanup script and coverage tests passed!")
        return 0
    else:
        print(f"⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())