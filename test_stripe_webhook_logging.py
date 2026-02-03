#!/usr/bin/env python3

import requests
import json
import sys
from datetime import datetime

class StripeWebhookLoggingTester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
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
                
            if method == 'GET':
                response = requests.get(url, **kwargs)
            elif method == 'POST':
                response = requests.post(url, json=data, **kwargs)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)[:300]}...")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error text: {response.text[:200]}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_webhook_endpoint_missing_signature(self):
        """Test webhook endpoint returns 400 for missing stripe-signature header"""
        success, response = self.run_test(
            "Webhook - Missing Stripe Signature",
            "POST",
            "api/billing/webhook",
            400,
            data={"type": "customer.subscription.updated", "data": {"object": {}}}
        )
        
        # Check if response mentions missing signature
        if success and "signature" in str(response).lower():
            print(f"   ✅ Webhook correctly rejects missing signature")
            return True
        elif success:
            print(f"   ✅ Webhook endpoint exists and returns 400 as expected")
            return True
        return False

    def test_debug_org_seats_endpoint(self):
        """Test /api/debug/org-seats endpoint exists"""
        success, response = self.run_test(
            "Debug Org Seats Endpoint",
            "GET",
            "api/debug/org-seats",
            401  # Should return 401 for unauthenticated, not 404 for missing endpoint
        )
        
        if success:
            print(f"   ✅ /api/debug/org-seats endpoint exists (returns 401 for auth)")
            return True
        return False

    def test_auth_me_endpoint(self):
        """Test /api/auth/me endpoint exists and returns org data structure"""
        success, response = self.run_test(
            "Auth Me Endpoint",
            "GET", 
            "api/auth/me",
            401  # Should return 401 for unauthenticated, not 404 for missing endpoint
        )
        
        if success:
            print(f"   ✅ /api/auth/me endpoint exists (returns 401 for auth)")
            return True
        return False

    def test_stripe_webhook_unit_tests(self):
        """Test Stripe webhook unit tests pass with logging verification"""
        print(f"\n🔍 Testing Stripe Webhook Unit Tests...")
        try:
            import subprocess
            # Run the stripe webhook tests specifically
            result = subprocess.run(
                ["yarn", "test", "tests/stripe-webhook.test.ts", "--run"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - Stripe webhook tests pass")
                
                # Check for specific logging patterns mentioned in the request
                output = result.stdout + result.stderr
                
                logging_checks = [
                    ("[Stripe Webhook] Received event:", "Webhook event logging"),
                    ("[Stripe Sync] Updating org", "Org update logging"),
                    ("[Stripe Sync] Looking up org by stripeCustomerId", "Customer ID lookup logging"),
                    ("customer.subscription.updated", "Subscription update event handling")
                ]
                
                for pattern, description in logging_checks:
                    if pattern in output:
                        print(f"   ✅ Found expected log pattern: {description}")
                    else:
                        print(f"   ⚠️  Log pattern not found in test output: {description}")
                
                # Extract test count
                if "Tests" in output and "passed" in output:
                    lines = output.split('\n')
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

    def test_billing_portal_upgrade_tests(self):
        """Test billing portal upgrade tests pass"""
        print(f"\n🔍 Testing Billing Portal Upgrade Tests...")
        try:
            import subprocess
            # Run the billing portal upgrade tests
            result = subprocess.run(
                ["yarn", "test", "tests/billing-portal-upgrades.test.ts", "--run"], 
                cwd="/app",
                capture_output=True, 
                text=True, 
                timeout=60
            )
            
            self.tests_run += 1
            if result.returncode == 0:
                self.tests_passed += 1
                print(f"✅ Passed - Billing portal upgrade tests pass")
                
                # Check for seat limit update functionality
                output = result.stdout + result.stderr
                
                if "seatLimit" in output:
                    print(f"   ✅ Tests verify seatLimit functionality")
                if "subscription" in output:
                    print(f"   ✅ Tests verify subscription functionality")
                
                # Extract test count
                if "Tests" in output and "passed" in output:
                    lines = output.split('\n')
                    for line in lines:
                        if "Tests" in line and "passed" in line:
                            print(f"   {line.strip()}")
                return True
            else:
                print(f"❌ Failed - Billing portal upgrade tests failed")
                print(f"   Error: {result.stderr[:300]}")
                return False
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_all_unit_tests_pass(self):
        """Test that all 103 unit tests still pass"""
        print(f"\n🔍 Testing All Unit Tests Pass...")
        try:
            import subprocess
            result = subprocess.run(
                ["yarn", "test", "--run"], 
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
                output = result.stdout + result.stderr
                if "Tests" in output:
                    lines = output.split('\n')
                    for line in lines:
                        if "Tests" in line and "passed" in line:
                            print(f"   {line.strip()}")
                            # Check if it's 103 tests as mentioned in the request
                            if "103 passed" in line:
                                print(f"   ✅ Confirmed: All 103 tests pass as required")
                return True
            else:
                print(f"❌ Failed - Unit tests failed")
                print(f"   Error: {result.stderr[:200]}")
                return False
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all Stripe webhook logging tests"""
        print("🚀 Starting Stripe Webhook Logging & Fallback Testing")
        print("=" * 70)

        # Test API endpoints exist
        print("\n" + "=" * 30 + " API ENDPOINT TESTS " + "=" * 30)
        self.test_webhook_endpoint_missing_signature()
        self.test_debug_org_seats_endpoint()
        self.test_auth_me_endpoint()
        
        # Test specific webhook functionality
        print("\n" + "=" * 30 + " STRIPE WEBHOOK TESTS " + "=" * 30)
        self.test_stripe_webhook_unit_tests()
        self.test_billing_portal_upgrade_tests()
        
        # Test all unit tests pass
        print("\n" + "=" * 30 + " ALL UNIT TESTS " + "=" * 30)
        self.test_all_unit_tests_pass()

        # Print results
        print("\n" + "=" * 70)
        print(f"📊 Stripe Webhook Logging Tests Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All Stripe webhook logging tests passed!")
            return 0
        else:
            print("⚠️  Some Stripe webhook logging tests failed")
            return 1

def main():
    tester = StripeWebhookLoggingTester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())