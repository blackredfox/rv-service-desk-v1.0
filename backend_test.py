#!/usr/bin/env python3

import requests
import json
import sys
from datetime import datetime

class B2BBillingAPITester:
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

    # === B2B BILLING API TESTS ===
    
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

    def test_typescript_compilation(self):
        """Test TypeScript compilation"""
        print(f"\n🔍 Testing TypeScript Compilation...")
        try:
            import subprocess
            result = subprocess.run(
                ["yarn", "build"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=120
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - TypeScript compilation successful")
                return True
            else:
                print(f"❌ Failed - TypeScript compilation failed")
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

    def run_all_tests(self):
        """Run all B2B Billing API tests"""
        print("🚀 Starting B2B Billing API Tests")
        print("=" * 50)

        # Test frontend loading
        print("\n" + "=" * 30 + " FRONTEND TESTS " + "=" * 30)
        self.test_frontend_loading()
        
        # Test unauthenticated API endpoints
        print("\n" + "=" * 30 + " UNAUTHENTICATED API TESTS " + "=" * 30)
        self.test_auth_me_unauthenticated()
        self.test_billing_checkout_unauthenticated()
        self.test_billing_checkout_missing_orgid()
        self.test_billing_webhook_no_signature()
        self.test_org_unauthenticated()
        
        # Test TypeScript compilation
        print("\n" + "=" * 30 + " TYPESCRIPT COMPILATION " + "=" * 30)
        self.test_typescript_compilation()

        # Print results
        print("\n" + "=" * 50)
        print(f"📊 B2B Billing API Tests Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All B2B Billing API tests passed!")
            return 0
        else:
            print("⚠️  Some B2B Billing API tests failed")
            return 1

def main():
    tester = B2BBillingAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())