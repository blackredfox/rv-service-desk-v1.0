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

    # === CASES API TESTS ===

    def test_cases_list_empty(self):
        """Test GET /api/cases (should be empty initially)"""
        success, response, cookies = self.run_test(
            "List Cases (Empty)",
            "GET",
            "api/cases",
            200
        )
        if success and 'cases' in response:
            print(f"   Found {len(response['cases'])} cases")
            return True
        return False

    def test_create_case(self):
        """Test POST /api/cases"""
        success, response, cookies = self.run_test(
            "Create Case",
            "POST",
            "api/cases",
            201,
            data={"title": "Test Case"}
        )
        if success and 'case' in response:
            self.case_id = response['case']['id']
            print(f"   Created case ID: {self.case_id}")
            return True
        return False

    def test_get_case(self):
        """Test GET /api/cases/[id]"""
        if not self.case_id:
            print("❌ No case ID available for testing")
            return False
            
        success, response, cookies = self.run_test(
            "Get Case by ID",
            "GET",
            f"api/cases/{self.case_id}",
            200
        )
        if success and 'case' in response and 'messages' in response:
            print(f"   Case title: {response['case'].get('title')}")
            print(f"   Messages count: {len(response['messages'])}")
            return True
        return False

    def test_update_case(self):
        """Test PATCH /api/cases/[id]"""
        if not self.case_id:
            print("❌ No case ID available for testing")
            return False
            
        success, response, cookies = self.run_test(
            "Update Case",
            "PATCH",
            f"api/cases/{self.case_id}",
            200,
            data={"title": "Updated Test Case", "languageMode": "EN"}
        )
        if success and 'case' in response:
            print(f"   Updated case title: {response['case'].get('title')}")
            return True
        return False

    def test_delete_case(self):
        """Test DELETE /api/cases/[id]"""
        if not self.case_id:
            print("❌ No case ID available for testing")
            return False
            
        success, response, cookies = self.run_test(
            "Delete Case",
            "DELETE",
            f"api/cases/{self.case_id}",
            200
        )
        return success

    # === CHAT API TESTS ===

    def test_chat_without_openai_key(self):
        """Test POST /api/chat without OPENAI_API_KEY"""
        success, response, cookies = self.run_test(
            "Chat without OpenAI Key",
            "POST",
            "api/chat",
            500,  # Should return 500 for missing API key
            data={"message": "Test message", "languageMode": "EN"}
        )
        return success

    def test_chat_missing_message(self):
        """Test POST /api/chat without message"""
        success, response, cookies = self.run_test(
            "Chat without Message",
            "POST",
            "api/chat",
            400,  # Should return 400 for missing message
            data={"languageMode": "EN"}
        )
        return success

    # === BILLING API TESTS ===

    def test_billing_checkout_unauthenticated(self):
        """Test POST /api/billing/checkout-session without auth"""
        success, response, cookies = self.run_test(
            "Billing Checkout - Unauthenticated",
            "POST",
            "api/billing/checkout-session",
            401,
            data={"plan": "PREMIUM", "origin": "http://localhost:3000"},
            cookies={}
        )
        return success

    def test_billing_checkout_authenticated(self):
        """Test POST /api/billing/checkout-session with auth (should fail due to missing Stripe config)"""
        success, response, cookies = self.run_test(
            "Billing Checkout - Authenticated (No Stripe Config)",
            "POST",
            "api/billing/checkout-session",
            500,  # Should fail due to missing Stripe configuration
            data={"plan": "PREMIUM", "origin": "http://localhost:3000"}
        )
        return success

    def test_billing_checkout_invalid_plan(self):
        """Test POST /api/billing/checkout-session with invalid plan"""
        success, response, cookies = self.run_test(
            "Billing Checkout - Invalid Plan",
            "POST",
            "api/billing/checkout-session",
            400,
            data={"plan": "INVALID", "origin": "http://localhost:3000"}
        )
        return success

    def test_billing_webhook_no_signature(self):
        """Test POST /api/billing/webhook without stripe-signature header"""
        success, response, cookies = self.run_test(
            "Billing Webhook - No Signature",
            "POST",
            "api/billing/webhook",
            400,
            data={"type": "test"},
            cookies={}
        )
        return success

    def test_billing_webhook_invalid_signature(self):
        """Test POST /api/billing/webhook with invalid signature"""
        success, response, cookies = self.run_test(
            "Billing Webhook - Invalid Signature",
            "POST",
            "api/billing/webhook",
            400,  # Should fail signature verification
            data={"type": "test"},
            headers={"stripe-signature": "invalid_signature"},
            cookies={}
        )
        return success

    # === ANALYTICS API TESTS ===

    def test_analytics_unauthenticated(self):
        """Test POST /api/analytics/event without auth"""
        success, response, cookies = self.run_test(
            "Analytics Event - Unauthenticated",
            "POST",
            "api/analytics/event",
            401,
            data={"eventName": "page.view", "payload": {"page": "/test"}},
            cookies={}
        )
        return success

    def test_analytics_authenticated_valid(self):
        """Test POST /api/analytics/event with auth and valid data"""
        success, response, cookies = self.run_test(
            "Analytics Event - Valid",
            "POST",
            "api/analytics/event",
            200,
            data={"eventName": "page.view", "payload": {"page": "/test"}}
        )
        return success

    def test_analytics_invalid_event(self):
        """Test POST /api/analytics/event with invalid event name"""
        success, response, cookies = self.run_test(
            "Analytics Event - Invalid Event Name",
            "POST",
            "api/analytics/event",
            400,
            data={"eventName": "invalid.event", "payload": {"page": "/test"}}
        )
        return success

    def test_analytics_missing_event_name(self):
        """Test POST /api/analytics/event without event name"""
        success, response, cookies = self.run_test(
            "Analytics Event - Missing Event Name",
            "POST",
            "api/analytics/event",
            400,
            data={"payload": {"page": "/test"}}
        )
        return success

    def test_analytics_large_payload(self):
        """Test POST /api/analytics/event with large payload"""
        large_payload = {"data": "x" * 5000}  # > 4KB limit
        success, response, cookies = self.run_test(
            "Analytics Event - Large Payload",
            "POST",
            "api/analytics/event",
            400,
            data={"eventName": "page.view", "payload": large_payload}
        )
        return success

    # === TERMS API TEST ===

    def test_terms_api(self):
        """Test /api/terms endpoint"""
        success, response, cookies = self.run_test(
            "Terms API",
            "GET",
            "api/terms",
            200
        )
        if success:
            if 'version' in response and 'markdown' in response:
                print(f"   Terms version: {response.get('version')}")
                print(f"   Markdown length: {len(response.get('markdown', ''))}")
                return True
        return False

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting RV Service Desk API Tests")
        print("=" * 50)

        # Test terms API (no auth required)
        self.test_terms_api()
        
        # Test auth registration flow
        print("\n" + "=" * 30 + " AUTH TESTS " + "=" * 30)
        self.test_auth_register_invalid_data()
        self.test_auth_register_valid()
        self.test_auth_register_duplicate()
        self.test_auth_me_authenticated()
        
        # Test logout and unauthenticated access
        self.test_auth_logout()
        self.test_auth_me_unauthenticated()
        
        # Test login flow
        self.test_auth_login_invalid()
        self.test_auth_login_valid()
        
        # Test cases API (some endpoints work without auth for backward compatibility)
        print("\n" + "=" * 30 + " CASES TESTS " + "=" * 30)
        self.test_cases_list_empty()
        self.test_create_case()
        self.test_get_case()
        self.test_update_case()
        
        # Test chat API (should fail without OpenAI key)
        print("\n" + "=" * 30 + " CHAT TESTS " + "=" * 30)
        self.test_chat_without_openai_key()
        self.test_chat_missing_message()
        
        # Test billing API (requires auth and Stripe config)
        print("\n" + "=" * 30 + " BILLING TESTS " + "=" * 30)
        self.test_billing_checkout_unauthenticated()
        self.test_billing_checkout_authenticated()
        self.test_billing_checkout_invalid_plan()
        self.test_billing_webhook_no_signature()
        self.test_billing_webhook_invalid_signature()
        
        # Test analytics API (requires auth)
        print("\n" + "=" * 30 + " ANALYTICS TESTS " + "=" * 30)
        self.test_analytics_unauthenticated()
        self.test_analytics_authenticated_valid()
        self.test_analytics_invalid_event()
        self.test_analytics_missing_event_name()
        self.test_analytics_large_payload()
        
        # Clean up - delete test case
        print("\n" + "=" * 30 + " CLEANUP " + "=" * 30)
        self.test_delete_case()

        # Print results
        print("\n" + "=" * 50)
        print(f"📊 API Tests Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All API tests passed!")
            return 0
        else:
            print("⚠️  Some API tests failed")
            return 1

def main():
    tester = RVServiceDeskAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())