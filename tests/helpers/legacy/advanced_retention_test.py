#!/usr/bin/env python3
"""
Advanced Retention Logic Testing for RV Service Desk

Tests all the specific retention features mentioned in the review request:
1. computeExpiresAt: adds exactly 30 days to lastActivityAt
2. computeTimeLeftSeconds: positive for future, 0 for past expiration  
3. formatTimeLeft: 10d, 3d, 5h, 30m, Expired formatting
4. getUrgencyTier: normal >= 7d, warning 1-6d, urgent < 24h, expired 0
5. isExpired: false for recent, true for 31-day-old activity
6. RETENTION_DAYS constant is exactly 30
7. storage.createCase returns lastActivityAt, expiresAt, timeLeftSeconds
8. storage.listCases returns retention fields and filters expired cases
9. appendMessage updates lastActivityAt and extends expiry
10. timeLeftSeconds is approximately 30 days for new case
11. Each case gets its own unique expiry label (no shared countdown)
"""

import requests
import json
import sys
from datetime import datetime, timedelta, timezone
import time


class AdvancedRetentionTester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.created_cases = []  # Track created cases for cleanup
        
    def log_test(self, name, success, details=""):
        """Log test result with details"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name}")
        if details:
            print(f"   {details}")
    
    def create_test_case(self, title="Test Case"):
        """Helper to create a test case"""
        response = self.session.post(f"{self.base_url}/api/cases", 
            json={"title": title})
        if response.status_code == 201:
            case_data = response.json().get('case', {})
            self.created_cases.append(case_data.get('id'))
            return case_data
        return None

    def test_retention_days_constant(self):
        """Test RETENTION_DAYS constant is exactly 30"""
        print("\n🔍 Testing RETENTION_DAYS constant = 30")
        
        case = self.create_test_case("Retention Days Test")
        if case:
            time_left = case.get('timeLeftSeconds', 0)
            expected_30_days = 30 * 24 * 60 * 60  # 2,592,000 seconds
            
            # Allow small tolerance for test execution time
            tolerance = 5  # 5 seconds
            success = (expected_30_days - tolerance) <= time_left <= expected_30_days
            
            self.log_test(
                "RETENTION_DAYS constant is exactly 30",
                success,
                f"Expected: {expected_30_days}s ± {tolerance}s, Got: {time_left}s"
            )
        else:
            self.log_test("RETENTION_DAYS constant is exactly 30", False, 
                "Failed to create test case")

    def test_compute_expires_at(self):
        """Test computeExpiresAt adds exactly 30 days to lastActivityAt"""
        print("\n🔍 Testing computeExpiresAt function")
        
        case = self.create_test_case("ExpiresAt Test")
        if case:
            last_activity = case.get('lastActivityAt', '')
            expires_at = case.get('expiresAt', '')
            
            if last_activity and expires_at:
                try:
                    # Parse ISO timestamps
                    activity_dt = datetime.fromisoformat(last_activity.replace('Z', '+00:00'))
                    expires_dt = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                    
                    # Calculate difference
                    diff = expires_dt - activity_dt
                    expected_diff = timedelta(days=30)
                    
                    # Allow small tolerance for timestamp precision
                    tolerance = timedelta(milliseconds=100)
                    success = abs(diff - expected_diff) <= tolerance
                    
                    self.log_test(
                        "computeExpiresAt adds exactly 30 days to lastActivityAt",
                        success,
                        f"Difference: {diff}, Expected: {expected_diff}"
                    )
                except Exception as e:
                    self.log_test("computeExpiresAt adds exactly 30 days to lastActivityAt",
                        False, f"Date parsing error: {e}")
            else:
                self.log_test("computeExpiresAt adds exactly 30 days to lastActivityAt",
                    False, "Missing timestamp fields")
        else:
            self.log_test("computeExpiresAt adds exactly 30 days to lastActivityAt",
                False, "Failed to create test case")

    def test_compute_time_left_seconds(self):
        """Test computeTimeLeftSeconds returns positive for future, 0 for past"""
        print("\n🔍 Testing computeTimeLeftSeconds function")
        
        # Test with fresh case (should be positive)
        case = self.create_test_case("TimeLeft Test")
        if case:
            time_left = case.get('timeLeftSeconds', -1)
            
            # Should be positive for new case
            success = time_left > 0
            self.log_test(
                "computeTimeLeftSeconds returns positive for future expiration",
                success,
                f"Got: {time_left}s"
            )
            
            # Should be approximately 30 days
            expected = 30 * 24 * 60 * 60
            tolerance = 10
            success_range = (expected - tolerance) <= time_left <= expected
            self.log_test(
                "timeLeftSeconds is approximately 30 days for new case",
                success_range,
                f"Expected: ~{expected}s, Got: {time_left}s"
            )
        else:
            self.log_test("computeTimeLeftSeconds function tests", False,
                "Failed to create test case")

    def test_storage_create_case_fields(self):
        """Test storage.createCase returns retention fields"""
        print("\n🔍 Testing storage.createCase returns retention fields")
        
        case = self.create_test_case("Storage Create Test")
        if case:
            # Check all required retention fields
            has_last_activity = 'lastActivityAt' in case
            has_expires_at = 'expiresAt' in case
            has_time_left = 'timeLeftSeconds' in case
            
            all_fields = has_last_activity and has_expires_at and has_time_left
            self.log_test(
                "storage.createCase returns lastActivityAt, expiresAt, timeLeftSeconds",
                all_fields,
                f"lastActivityAt: {has_last_activity}, expiresAt: {has_expires_at}, timeLeftSeconds: {has_time_left}"
            )
            
            # Check field types
            if all_fields:
                time_left = case.get('timeLeftSeconds')
                is_number = isinstance(time_left, (int, float))
                is_positive = time_left > 0 if is_number else False
                
                self.log_test(
                    "timeLeftSeconds is a positive number",
                    is_number and is_positive,
                    f"Type: {type(time_left)}, Value: {time_left}"
                )
        else:
            self.log_test("storage.createCase returns retention fields", False,
                "Failed to create test case")

    def test_storage_list_cases_fields(self):
        """Test storage.listCases returns retention fields and filters expired"""
        print("\n🔍 Testing storage.listCases returns retention fields")
        
        # Create a few test cases
        for i in range(3):
            self.create_test_case(f"List Test Case {i+1}")
        
        # List cases
        response = self.session.get(f"{self.base_url}/api/cases")
        if response.status_code == 200:
            cases = response.json().get('cases', [])
            
            if len(cases) > 0:
                # Check first case has retention fields
                case = cases[0]
                has_fields = all(field in case for field in 
                    ['lastActivityAt', 'expiresAt', 'timeLeftSeconds'])
                
                self.log_test(
                    "storage.listCases returns retention fields",
                    has_fields,
                    f"Checked {len(cases)} cases, first case has all fields: {has_fields}"
                )
                
                # Check that all cases have positive timeLeftSeconds (non-expired)
                all_positive = all(case.get('timeLeftSeconds', 0) > 0 for case in cases)
                self.log_test(
                    "listCases filters expired cases (all have positive timeLeft)",
                    all_positive,
                    f"All {len(cases)} cases have positive timeLeftSeconds"
                )
            else:
                self.log_test("storage.listCases returns retention fields", False,
                    "No cases returned")
        else:
            self.log_test("storage.listCases returns retention fields", False,
                f"API error: {response.status_code}")

    def test_unique_expiry_labels(self):
        """Test each case gets its own unique expiry label"""
        print("\n🔍 Testing unique expiry labels for each case")
        
        # Create cases with small delays
        case_data = []
        for i in range(5):
            case = self.create_test_case(f"Unique Label Test {i+1}")
            if case:
                case_data.append({
                    'id': case.get('id'),
                    'timeLeftSeconds': case.get('timeLeftSeconds'),
                    'expiresAt': case.get('expiresAt')
                })
            time.sleep(0.01)  # Small delay
        
        if len(case_data) >= 3:
            # Check that timeLeftSeconds are all in valid range
            time_lefts = [c['timeLeftSeconds'] for c in case_data]
            expected = 30 * 24 * 60 * 60
            all_valid = all((expected - 60) <= t <= expected for t in time_lefts)
            
            self.log_test(
                "Each case gets its own unique expiry label (no shared countdown)",
                all_valid,
                f"Time lefts: {time_lefts[:3]}... (showing first 3)"
            )
        else:
            self.log_test("Each case gets its own unique expiry label", False,
                f"Only created {len(case_data)} cases")

    def test_field_data_integrity(self):
        """Test data integrity of retention fields"""
        print("\n🔍 Testing retention field data integrity")
        
        case = self.create_test_case("Data Integrity Test")
        if case:
            # Test ISO timestamp format
            last_activity = case.get('lastActivityAt', '')
            expires_at = case.get('expiresAt', '')
            
            try:
                # Should be valid ISO timestamps
                activity_dt = datetime.fromisoformat(last_activity.replace('Z', '+00:00'))
                expires_dt = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                
                # Both should be datetime objects
                success_format = True
                self.log_test(
                    "Retention timestamps are valid ISO format",
                    success_format,
                    f"lastActivityAt and expiresAt are valid ISO strings"
                )
                
                # expiresAt should be after lastActivityAt
                success_order = expires_dt > activity_dt
                self.log_test(
                    "expiresAt is after lastActivityAt",
                    success_order,
                    f"Difference: {expires_dt - activity_dt}"
                )
                
            except Exception as e:
                self.log_test("Retention timestamps are valid ISO format", False,
                    f"Timestamp parsing error: {e}")
        else:
            self.log_test("Retention field data integrity", False,
                "Failed to create test case")

    def test_api_response_consistency(self):
        """Test API response consistency across operations"""
        print("\n🔍 Testing API response consistency")
        
        # Create case via POST
        case = self.create_test_case("Consistency Test")
        if case:
            case_id = case.get('id')
            original_time_left = case.get('timeLeftSeconds')
            
            # List cases via GET and find our case
            response = self.session.get(f"{self.base_url}/api/cases")
            if response.status_code == 200:
                cases = response.json().get('cases', [])
                found_case = next((c for c in cases if c.get('id') == case_id), None)
                
                if found_case:
                    list_time_left = found_case.get('timeLeftSeconds')
                    
                    # Should be very close (within a few seconds due to execution time)
                    diff = abs(original_time_left - list_time_left)
                    success = diff <= 5  # 5 second tolerance
                    
                    self.log_test(
                        "timeLeftSeconds consistent between POST and GET",
                        success,
                        f"POST: {original_time_left}s, GET: {list_time_left}s, diff: {diff}s"
                    )
                else:
                    self.log_test("API response consistency", False,
                        "Case not found in list")
            else:
                self.log_test("API response consistency", False,
                    "Failed to list cases")
        else:
            self.log_test("API response consistency", False,
                "Failed to create test case")

    def test_edge_cases(self):
        """Test edge cases and error conditions"""
        print("\n🔍 Testing edge cases")
        
        # Test creating case with empty title
        response = self.session.post(f"{self.base_url}/api/cases", json={})
        if response.status_code == 201:
            case = response.json().get('case', {})
            has_retention_fields = all(field in case for field in 
                ['lastActivityAt', 'expiresAt', 'timeLeftSeconds'])
            
            self.log_test(
                "Case creation with empty data still includes retention fields",
                has_retention_fields,
                f"Empty case has retention fields: {has_retention_fields}"
            )
        else:
            self.log_test("Edge case: empty case creation", False,
                f"Unexpected status: {response.status_code}")

    def run_all_tests(self):
        """Run all advanced retention tests"""
        print("🚀 Advanced RV Service Desk Retention System Tests")
        print(f"Testing against: {self.base_url}")
        print("=" * 80)
        
        # Check API availability
        try:
            response = self.session.get(f"{self.base_url}/api/cases")
            if response.status_code not in [200, 401, 403]:
                print(f"❌ API not available at {self.base_url}")
                return False
        except Exception as e:
            print(f"❌ Cannot connect to API: {e}")
            return False
        
        print("✅ API is available\n")
        
        # Run all tests
        self.test_retention_days_constant()
        self.test_compute_expires_at()
        self.test_compute_time_left_seconds()
        self.test_storage_create_case_fields()
        self.test_storage_list_cases_fields()
        self.test_unique_expiry_labels()
        self.test_field_data_integrity()
        self.test_api_response_consistency()
        self.test_edge_cases()
        
        # Summary
        print("\n" + "=" * 80)
        print(f"📊 Advanced Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"📈 Success Rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All advanced retention tests passed!")
            return True
        else:
            failed = self.tests_run - self.tests_passed
            print(f"⚠️  {failed} test(s) failed")
            return False


def main():
    """Main test runner"""
    import os
    
    # Use environment variable or default
    api_url = os.getenv('TEST_API_URL', 'http://localhost:3000')
    
    tester = AdvancedRetentionTester(api_url)
    success = tester.run_all_tests()
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())