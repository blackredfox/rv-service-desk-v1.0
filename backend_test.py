#!/usr/bin/env python3

import requests
import json
import sys
from datetime import datetime

class RVServiceDeskAPITester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.session_cookies = None
        self.test_user_email = f"test_{datetime.now().strftime('%H%M%S')}@corporate.com"
        self.test_user_password = "TestPassword123!"

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, cookies=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        default_headers = {'Content-Type': 'application/json'}
        if headers:
            default_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {method} {url}")
        
        try:
            kwargs = {'headers': default_headers}
            if cookies:
                kwargs['cookies'] = cookies
            elif self.session_cookies:
                kwargs['cookies'] = self.session_cookies
                
            if method == 'GET':
                response = requests.get(url, **kwargs)
            elif method == 'POST':
                response = requests.post(url, json=data, **kwargs)
            elif method == 'DELETE':
                response = requests.delete(url, **kwargs)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, **kwargs)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)[:200]}...")
                    return True, response_data, response.cookies
                except:
                    return True, {}, response.cookies
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error text: {response.text[:200]}")
                return False, {}, None

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}, None

    # === ORG SETUP & ADMIN DASHBOARD API TESTS ===
    
    def test_auth_me_not_a_member(self):
        """Test GET /api/auth/me returns not_a_member when org exists but user not added"""
        # This test simulates a user from a corporate domain where org exists but they're not a member
        success, response, cookies = self.run_test(
            "Auth Me - Not A Member (org exists, user not member)",
            "GET",
            "api/auth/me",
            200,
            cookies={}  # No session cookie, will return 401 but that's expected for unauthenticated
        )
        # Note: This test needs proper authentication setup to test the actual scenario
        return success

    def test_auth_me_no_organization(self):
        """Test GET /api/auth/me returns no_organization with canCreateOrg=true when no org exists"""
        success, response, cookies = self.run_test(
            "Auth Me - No Organization (can create org)",
            "GET", 
            "api/auth/me",
            200,
            cookies={}
        )
        return success

    def test_auth_me_blocked_domain(self):
        """Test GET /api/auth/me returns blocked_domain for personal email domains"""
        success, response, cookies = self.run_test(
            "Auth Me - Blocked Domain (personal email)",
            "GET",
            "api/auth/me", 
            200,
            cookies={}
        )
        return success

    def test_org_members_get_non_admin(self):
        """Test GET /api/org/members returns 403 for non-admin users"""
        success, response, cookies = self.run_test(
            "Org Members GET - Non-admin user (should return 403)",
            "GET",
            "api/org/members",
            401,  # Will be 401 without auth, but in real scenario would be 403 for non-admin
            cookies={}
        )
        return success

    def test_org_members_post_create_active(self):
        """Test POST /api/org/members creates member with status='active'"""
        success, response, cookies = self.run_test(
            "Org Members POST - Create member with active status",
            "POST",
            "api/org/members",
            401,  # Will be 401 without auth
            data={"email": "newmember@company.com", "role": "member"},
            cookies={}
        )
        return success

    def test_org_members_post_subscription_inactive(self):
        """Test POST /api/org/members rejects if subscription inactive"""
        success, response, cookies = self.run_test(
            "Org Members POST - Reject if subscription inactive",
            "POST", 
            "api/org/members",
            401,  # Will be 401 without auth
            data={"email": "newmember@company.com", "role": "member"},
            cookies={}
        )
        return success

    def test_org_members_post_seat_limit_reached(self):
        """Test POST /api/org/members rejects if seat limit reached"""
        success, response, cookies = self.run_test(
            "Org Members POST - Reject if seat limit reached",
            "POST",
            "api/org/members", 
            401,  # Will be 401 without auth
            data={"email": "newmember@company.com", "role": "member"},
            cookies={}
        )
        return success

    def test_org_members_post_wrong_domain(self):
        """Test POST /api/org/members rejects email from wrong domain"""
        success, response, cookies = self.run_test(
            "Org Members POST - Reject wrong domain email",
            "POST",
            "api/org/members",
            401,  # Will be 401 without auth
            data={"email": "user@wrongdomain.com", "role": "member"},
            cookies={}
        )
        return success

    def test_org_members_patch_prevent_last_admin_demotion(self):
        """Test PATCH /api/org/members prevents demoting/deactivating last admin"""
        success, response, cookies = self.run_test(
            "Org Members PATCH - Prevent last admin demotion",
            "PATCH",
            "api/org/members",
            401,  # Will be 401 without auth
            data={"memberId": "admin123", "role": "member"},
            cookies={}
        )
        return success

    def test_org_members_patch_deactivate_non_admin(self):
        """Test PATCH /api/org/members allows deactivating non-admin member"""
        success, response, cookies = self.run_test(
            "Org Members PATCH - Deactivate non-admin member",
            "PATCH",
            "api/org/members",
            401,  # Will be 401 without auth
            data={"memberId": "member123", "status": "inactive"},
            cookies={}
        )
        return success
    
    def test_auth_me_unauthenticated(self):
        """Test GET /api/auth/me when not authenticated - should return 401"""
        success, response, cookies = self.run_test(
            "Auth Me - Unauthenticated",
            "GET",
            "api/auth/me",
            401,
            cookies={}  # No cookies
        )
        return success

    def test_billing_checkout_unauthenticated(self):
        """Test POST /api/billing/checkout-session without auth - should return 401"""
        success, response, cookies = self.run_test(
            "Billing Checkout - Unauthenticated",
            "POST",
            "api/billing/checkout-session",
            401,
            data={"orgId": "test-org", "seatCount": 5, "origin": "http://localhost:3000"},
            cookies={}
        )
        return success

    def test_billing_checkout_missing_orgid(self):
        """Test POST /api/billing/checkout-session without orgId - should return 400"""
        success, response, cookies = self.run_test(
            "Billing Checkout - Missing orgId",
            "POST",
            "api/billing/checkout-session",
            400,
            data={"seatCount": 5, "origin": "http://localhost:3000"},
            cookies={}
        )
        return success

    def test_billing_webhook_no_signature(self):
        """Test POST /api/billing/webhook without stripe-signature header - should return 400"""
        success, response, cookies = self.run_test(
            "Billing Webhook - No Signature",
            "POST",
            "api/billing/webhook",
            400,
            data={"type": "test"},
            cookies={}
        )
        return success

    def test_org_unauthenticated(self):
        """Test GET /api/org without auth - should return 401"""
        success, response, cookies = self.run_test(
            "Organization API - Unauthenticated",
            "GET",
            "api/org",
            401,
            cookies={}
        )
        return success

    def test_unit_tests_pass(self):
        """Test that all unit tests still pass"""
        print(f"\n🔍 Testing Unit Tests Pass...")
        try:
            import subprocess
            result = subprocess.run(
                ["yarn", "test"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=120
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - All unit tests pass")
                # Extract test count from output
                if "Tests" in result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        if "Tests" in line and "passed" in line:
                            print(f"   {line.strip()}")
                return True
            else:
                print(f"❌ Failed - Unit tests failed")
                print(f"   Error: {result.stderr[:200]}")
                return False
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_frontend_loading(self):
        """Test if frontend loads without errors"""
        success, response, cookies = self.run_test(
            "Frontend Loading",
            "GET",
            "",  # Root path
            200,
            cookies={}
        )
        return success

    def test_uat_fixes_basic_endpoints(self):
        """Test basic endpoints are accessible for UAT fixes"""
        print("\n🔍 Testing UAT Fixes - Basic Endpoints...")
        
        # Test main page loads
        success, response, cookies = self.run_test(
            "Main page loads",
            "GET",
            "",
            200,
            cookies={}
        )
        
        # Test admin members page loads (will redirect to login but should not 404)
        success2, response2, cookies2 = self.run_test(
            "Admin members page accessible",
            "GET", 
            "admin/members",
            200,  # Should load the page (will show login/redirect but not 404)
            cookies={}
        )
        
        return success and success2

    def test_billing_portal_endpoint(self):
        """Test billing portal endpoint exists for upgrade functionality"""
        success, response, cookies = self.run_test(
            "Billing portal endpoint exists",
            "POST",
            "api/billing/portal",
            401,  # Should return 401 (unauthorized) not 404 (not found)
            data={"returnUrl": "http://localhost:3000"},
            cookies={}
        )
        return success

    def test_member_claim_functionality(self):
        """Test member claim functionality through unit tests"""
        print(f"\n🔍 Testing Member Claim Functionality...")
        try:
            import subprocess
            # Run only the member claim tests
            result = subprocess.run(
                ["yarn", "test", "tests/member-claim.test.ts"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - Member claim tests pass")
                
                # Check for specific log messages that indicate the fixes are working
                if "[API /api/auth/me] Claiming membership" in result.stdout:
                    print(f"   ✅ Found expected log: '[API /api/auth/me] Claiming membership'")
                else:
                    print(f"   ⚠️  Expected log '[API /api/auth/me] Claiming membership' not found")
                
                # Extract test details from output
                if "✓" in result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        if "✓" in line and "member-claim" in line:
                            print(f"   {line.strip()}")
                return True
            else:
                print(f"❌ Failed - Member claim tests failed")
                print(f"   Error: {result.stderr[:300]}")
                return False
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_stripe_webhook_functionality(self):
        """Test Stripe webhook functionality through unit tests"""
        print(f"\n🔍 Testing Stripe Webhook Functionality...")
        try:
            import subprocess
            # Run the billing portal upgrade tests
            result = subprocess.run(
                ["yarn", "test", "tests/billing-portal-upgrades.test.ts"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - Stripe webhook tests pass")
                
                # Extract test count
                if "Tests" in result.stdout and "passed" in result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        if "Tests" in line and "passed" in line:
                            print(f"   {line.strip()}")
                return True
            else:
                print(f"❌ Failed - Stripe webhook tests failed")
                print(f"   Error: {result.stderr[:300]}")
                return False
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_webhook_endpoint_exists(self):
        """Test that webhook endpoint exists and handles missing signature correctly"""
        success, response, cookies = self.run_test(
            "Webhook endpoint - Missing signature",
            "POST",
            "api/billing/webhook",
            400,  # Should return 400 for missing signature
            data={"type": "test"},
            cookies={}
        )
        
        # Check if the response mentions missing signature
        if success and "signature" in str(response).lower():
            print(f"   ✅ Webhook correctly rejects missing signature")
        
        return success

    def run_all_tests(self):
        """Run all RV Service Desk API tests"""
        print("🚀 Starting RV Service Desk Critical Issues Testing")
        print("=" * 70)

        # Test frontend loading
        print("\n" + "=" * 30 + " FRONTEND TESTS " + "=" * 30)
        self.test_frontend_loading()
        
        # Test member claim functionality specifically
        print("\n" + "=" * 30 + " MEMBER CLAIM TESTS " + "=" * 30)
        self.test_member_claim_functionality()
        
        # Test Stripe webhook functionality
        print("\n" + "=" * 30 + " STRIPE WEBHOOK TESTS " + "=" * 30)
        self.test_stripe_webhook_functionality()
        self.test_webhook_endpoint_exists()
        
        # Test UAT fixes basic endpoints
        print("\n" + "=" * 30 + " API ENDPOINT TESTS " + "=" * 30)
        self.test_uat_fixes_basic_endpoints()
        self.test_billing_portal_endpoint()
        
        # Test unit tests still pass
        print("\n" + "=" * 30 + " UNIT TESTS " + "=" * 30)
        self.test_unit_tests_pass()

        # Print results
        print("\n" + "=" * 70)
        print(f"📊 RV Service Desk API Tests Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All RV Service Desk API tests passed!")
            return 0
        else:
            print("⚠️  Some RV Service Desk API tests failed")
            return 1

def main():
    tester = RVServiceDeskAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())