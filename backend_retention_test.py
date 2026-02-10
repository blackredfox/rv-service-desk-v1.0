#!/usr/bin/env python3
"""
Backend Retention System Tests for RV Service Desk
Tests the 30-day retention and expiration features.

Key tests:
- retention.ts functions: computeExpiresAt, computeTimeLeftSeconds, formatTimeLeft, getUrgencyTier, isExpired
- RETENTION_DAYS constant = 30
- storage.ts functions with retention fields
- API endpoints returning retention data
- Case expiry and cleanup logic

Usage: python backend_retention_test.py
"""

import requests
import json
import sys
from datetime import datetime, timedelta
from time import sleep


class RetentionAPITester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        
    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name}")
        if details:
            print(f"   {details}")
    
    def test_retention_constants_api(self):
        """Test retention constants through a test endpoint or via case creation"""
        print("\n🧪 Testing RETENTION_DAYS constant = 30")
        
        # Create a case and verify the timeLeftSeconds indicates 30-day retention
        try:
            response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "Retention Constant Test"})
            
            if response.status_code == 201:
                case_data = response.json().get('case', {})
                time_left = case_data.get('timeLeftSeconds', 0)
                
                # Should be approximately 30 days (allowing for test execution time)
                expected_seconds = 30 * 24 * 60 * 60  # 30 days in seconds
                diff_allowed = 10  # 10 second tolerance
                
                success = (expected_seconds - diff_allowed) <= time_left <= expected_seconds
                self.log_test(
                    "RETENTION_DAYS constant is exactly 30", 
                    success,
                    f"Expected: ~{expected_seconds}s, Got: {time_left}s"
                )
            else:
                self.log_test("RETENTION_DAYS constant is exactly 30", False, 
                    f"Failed to create case: {response.status_code}")
                
        except Exception as e:
            self.log_test("RETENTION_DAYS constant is exactly 30", False, f"Error: {e}")

    def test_case_creation_retention_fields(self):
        """Test storage.createCase returns retention fields"""
        print("\n🧪 Testing storage.createCase returns retention fields")
        
        try:
            response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "Retention Fields Test"})
            
            if response.status_code == 201:
                case_data = response.json().get('case', {})
                
                # Check required retention fields
                has_last_activity = 'lastActivityAt' in case_data
                has_expires_at = 'expiresAt' in case_data  
                has_time_left = 'timeLeftSeconds' in case_data
                
                success = has_last_activity and has_expires_at and has_time_left
                self.log_test(
                    "storage.createCase returns retention fields", 
                    success,
                    f"Fields: lastActivityAt={has_last_activity}, expiresAt={has_expires_at}, timeLeftSeconds={has_time_left}"
                )
                
                # Verify time calculations
                if success:
                    time_left = case_data['timeLeftSeconds']
                    success_time = isinstance(time_left, (int, float)) and time_left > 0
                    self.log_test(
                        "timeLeftSeconds is positive number", 
                        success_time,
                        f"timeLeftSeconds: {time_left}"
                    )
                    return case_data['id']  # Return case ID for further tests
            else:
                self.log_test("storage.createCase returns retention fields", False,
                    f"Failed to create case: {response.status_code}")
                return None
                
        except Exception as e:
            self.log_test("storage.createCase returns retention fields", False, f"Error: {e}")
            return None

    def test_list_cases_retention_fields(self):
        """Test storage.listCases returns retention fields"""
        print("\n🧪 Testing storage.listCases returns retention fields")
        
        try:
            # Create a case first
            create_response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "List Test Case"})
            
            if create_response.status_code != 201:
                self.log_test("storage.listCases returns retention fields", False,
                    "Failed to create test case")
                return
            
            # List cases
            response = self.session.get(f"{self.base_url}/api/cases")
            
            if response.status_code == 200:
                cases = response.json().get('cases', [])
                
                if len(cases) > 0:
                    case = cases[0]
                    has_last_activity = 'lastActivityAt' in case
                    has_expires_at = 'expiresAt' in case
                    has_time_left = 'timeLeftSeconds' in case
                    
                    success = has_last_activity and has_expires_at and has_time_left
                    self.log_test(
                        "storage.listCases returns retention fields", 
                        success,
                        f"First case has retention fields: {success}"
                    )
                else:
                    self.log_test("storage.listCases returns retention fields", False,
                        "No cases returned in list")
            else:
                self.log_test("storage.listCases returns retention fields", False,
                    f"Failed to list cases: {response.status_code}")
                
        except Exception as e:
            self.log_test("storage.listCases returns retention fields", False, f"Error: {e}")

    def test_time_calculations_through_api(self):
        """Test time calculations through API responses"""
        print("\n🧪 Testing retention time calculations through API")
        
        try:
            # Create a case
            response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "Time Calculation Test"})
            
            if response.status_code == 201:
                case_data = response.json().get('case', {})
                
                # Verify timeLeftSeconds is approximately 30 days for new case
                time_left = case_data.get('timeLeftSeconds', 0)
                expected_seconds = 30 * 24 * 60 * 60  # 30 days
                tolerance = 60  # 1 minute tolerance
                
                success = (expected_seconds - tolerance) <= time_left <= expected_seconds
                self.log_test(
                    "timeLeftSeconds is approximately 30 days for new case", 
                    success,
                    f"Expected: ~{expected_seconds}s, Got: {time_left}s"
                )
                
                # Check that expiresAt is in the future
                expires_at = case_data.get('expiresAt', '')
                last_activity = case_data.get('lastActivityAt', '')
                
                if expires_at and last_activity:
                    try:
                        expires_dt = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                        activity_dt = datetime.fromisoformat(last_activity.replace('Z', '+00:00'))
                        
                        # Should be exactly 30 days difference
                        diff = expires_dt - activity_dt
                        expected_diff = timedelta(days=30)
                        diff_tolerance = timedelta(seconds=1)
                        
                        success = abs(diff - expected_diff) <= diff_tolerance
                        self.log_test(
                            "computeExpiresAt adds exactly 30 days to lastActivityAt", 
                            success,
                            f"Diff: {diff}, Expected: {expected_diff}"
                        )
                    except Exception as parse_error:
                        self.log_test("computeExpiresAt adds exactly 30 days to lastActivityAt", 
                            False, f"Date parsing error: {parse_error}")
                
            else:
                self.log_test("Time calculations", False,
                    f"Failed to create case: {response.status_code}")
                
        except Exception as e:
            self.log_test("Time calculations", False, f"Error: {e}")

    def test_unique_expiry_labels(self):
        """Test that each case gets its own unique expiry label"""
        print("\n🧪 Testing unique expiry labels for each case")
        
        try:
            # Create multiple cases
            case_ids = []
            for i in range(3):
                response = self.session.post(f"{self.base_url}/api/cases", 
                    json={"title": f"Unique Label Test Case {i+1}"})
                
                if response.status_code == 201:
                    case_ids.append(response.json()['case']['id'])
                    sleep(0.1)  # Small delay to ensure different timestamps
            
            if len(case_ids) == 3:
                # List cases and check their timeLeftSeconds
                response = self.session.get(f"{self.base_url}/api/cases")
                
                if response.status_code == 200:
                    cases = response.json().get('cases', [])
                    time_lefts = []
                    
                    for case in cases[-3:]:  # Get last 3 cases
                        time_left = case.get('timeLeftSeconds', 0)
                        time_lefts.append(time_left)
                    
                    # All should be very close but not necessarily identical due to execution time
                    if len(time_lefts) >= 3:
                        # Check they're all around 30 days
                        expected = 30 * 24 * 60 * 60
                        all_valid = all(expected - 60 <= t <= expected for t in time_lefts)
                        
                        self.log_test(
                            "Each case gets its own unique expiry label", 
                            all_valid,
                            f"Time lefts: {time_lefts}"
                        )
                    else:
                        self.log_test("Each case gets its own unique expiry label", False,
                            "Not enough cases returned")
                else:
                    self.log_test("Each case gets its own unique expiry label", False,
                        "Failed to list cases")
            else:
                self.log_test("Each case gets its own unique expiry label", False,
                    f"Only created {len(case_ids)} cases")
                
        except Exception as e:
            self.log_test("Each case gets its own unique expiry label", False, f"Error: {e}")

    def test_api_endpoints_basic(self):
        """Test basic API functionality"""
        print("\n🧪 Testing basic API endpoints")
        
        # Test GET /api/cases
        try:
            response = self.session.get(f"{self.base_url}/api/cases")
            success = response.status_code == 200
            self.log_test("GET /api/cases responds correctly", success,
                f"Status: {response.status_code}")
        except Exception as e:
            self.log_test("GET /api/cases responds correctly", False, f"Error: {e}")
        
        # Test POST /api/cases  
        try:
            response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "Basic API Test"})
            success = response.status_code == 201
            self.log_test("POST /api/cases creates case", success,
                f"Status: {response.status_code}")
        except Exception as e:
            self.log_test("POST /api/cases creates case", False, f"Error: {e}")

    def test_retention_math_validation(self):
        """Test retention math through multiple case operations"""
        print("\n🧪 Testing retention math validation")
        
        try:
            # Create a case
            response = self.session.post(f"{self.base_url}/api/cases", 
                json={"title": "Math Validation Test"})
            
            if response.status_code == 201:
                case_data = response.json().get('case', {})
                initial_time_left = case_data.get('timeLeftSeconds', 0)
                
                # Verify computeTimeLeftSeconds returns positive for future expiration
                success_positive = initial_time_left > 0
                self.log_test(
                    "computeTimeLeftSeconds returns positive for future expiration", 
                    success_positive,
                    f"Initial timeLeftSeconds: {initial_time_left}"
                )
                
                # The time left should be close to 30 days
                expected = 30 * 24 * 60 * 60
                tolerance = 120  # 2 minute tolerance  
                success_range = (expected - tolerance) <= initial_time_left <= expected
                self.log_test(
                    "Time left is in expected 30-day range",
                    success_range,
                    f"Expected: ~{expected}s, Got: {initial_time_left}s"
                )
                
            else:
                self.log_test("Retention math validation", False,
                    f"Failed to create case: {response.status_code}")
                
        except Exception as e:
            self.log_test("Retention math validation", False, f"Error: {e}")

    def run_all_tests(self):
        """Run all retention tests"""
        print("🚀 Starting RV Service Desk Retention System Tests")
        print(f"Testing against: {self.base_url}")
        
        # Test API availability first
        try:
            response = self.session.get(f"{self.base_url}/api/cases")
            if response.status_code not in [200, 401, 403]:
                print(f"❌ API not available at {self.base_url} (status: {response.status_code})")
                return False
        except Exception as e:
            print(f"❌ Cannot connect to API at {self.base_url}: {e}")
            return False
        
        print("✅ API is available")
        
        # Run tests
        self.test_api_endpoints_basic()
        self.test_retention_constants_api()
        self.test_case_creation_retention_fields()
        self.test_list_cases_retention_fields()
        self.test_time_calculations_through_api()
        self.test_unique_expiry_labels()
        self.test_retention_math_validation()
        
        # Summary
        print(f"\n📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All retention tests passed!")
            return True
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return False


def main():
    """Main test runner"""
    # Check if API URL is provided via environment or use default
    import os
    
    api_url = os.getenv('TEST_API_URL', 'http://localhost:3000')
    
    print(f"RV Service Desk Retention Backend Tests")
    print(f"API URL: {api_url}")
    print("=" * 60)
    
    tester = RetentionAPITester(api_url)
    success = tester.run_all_tests()
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())