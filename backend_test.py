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
        self.case_id = None
        self.session_cookies = None
        self.test_user_email = f"test_{datetime.now().strftime('%H%M%S')}@example.com"
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

    # === AUTH TESTS ===
    
    def test_auth_register_invalid_data(self):
        """Test POST /api/auth/register with invalid data"""
        # Test missing email
        success, response, cookies = self.run_test(
            "Auth Register - Missing Email",
            "POST",
            "api/auth/register",
            400,
            data={"password": self.test_user_password}
        )
        
        # Test missing password
        success, response, cookies = self.run_test(
            "Auth Register - Missing Password",
            "POST",
            "api/auth/register",
            400,
            data={"email": self.test_user_email}
        )
        
        # Test invalid email format
        success, response, cookies = self.run_test(
            "Auth Register - Invalid Email",
            "POST",
            "api/auth/register",
            400,
            data={"email": "invalid-email", "password": self.test_user_password}
        )
        
        # Test weak password
        success, response, cookies = self.run_test(
            "Auth Register - Weak Password",
            "POST",
            "api/auth/register",
            400,
            data={"email": self.test_user_email, "password": "123"}
        )
        
        return True

    def test_auth_register_valid(self):
        """Test POST /api/auth/register with valid data"""
        success, response, cookies = self.run_test(
            "Auth Register - Valid Data",
            "POST",
            "api/auth/register",
            201,
            data={"email": self.test_user_email, "password": self.test_user_password}
        )
        
        if success and cookies:
            self.session_cookies = cookies
            print(f"   Registered user: {response.get('user', {}).get('email')}")
            return True
        return False

    def test_auth_register_duplicate(self):
        """Test POST /api/auth/register with duplicate email"""
        success, response, cookies = self.run_test(
            "Auth Register - Duplicate Email",
            "POST",
            "api/auth/register",
            409,
            data={"email": self.test_user_email, "password": self.test_user_password}
        )
        return success

    def test_auth_me_authenticated(self):
        """Test GET /api/auth/me when authenticated"""
        success, response, cookies = self.run_test(
            "Auth Me - Authenticated",
            "GET",
            "api/auth/me",
            200
        )
        
        if success:
            print(f"   User info: {response}")
            return True
        return False

    def test_auth_logout(self):
        """Test POST /api/auth/logout"""
        success, response, cookies = self.run_test(
            "Auth Logout",
            "POST",
            "api/auth/logout",
            200
        )
        
        if success:
            self.session_cookies = None  # Clear session
            return True
        return False

    def test_auth_me_unauthenticated(self):
        """Test GET /api/auth/me when not authenticated"""
        success, response, cookies = self.run_test(
            "Auth Me - Unauthenticated",
            "GET",
            "api/auth/me",
            401,
            cookies={}  # No cookies
        )
        return success

    def test_auth_login_invalid(self):
        """Test POST /api/auth/login with invalid credentials"""
        # Test wrong password
        success, response, cookies = self.run_test(
            "Auth Login - Wrong Password",
            "POST",
            "api/auth/login",
            401,
            data={"email": self.test_user_email, "password": "wrongpassword"},
            cookies={}
        )
        
        # Test non-existent user
        success, response, cookies = self.run_test(
            "Auth Login - Non-existent User",
            "POST",
            "api/auth/login",
            401,
            data={"email": "nonexistent@example.com", "password": self.test_user_password},
            cookies={}
        )
        
        return True

    def test_auth_login_valid(self):
        """Test POST /api/auth/login with valid credentials"""
        success, response, cookies = self.run_test(
            "Auth Login - Valid Credentials",
            "POST",
            "api/auth/login",
            200,
            data={"email": self.test_user_email, "password": self.test_user_password},
            cookies={}
        )
        
        if success and cookies:
            self.session_cookies = cookies
            print(f"   Logged in user: {response.get('user', {}).get('email')}")
            return True
        return False

    def test_cases_list_empty(self):
        """Test GET /api/cases (should be empty initially)"""
        success, response = self.run_test(
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
        success, response = self.run_test(
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
            
        success, response = self.run_test(
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

    def test_search_cases(self):
        """Test GET /api/search"""
        success, response = self.run_test(
            "Search Cases",
            "GET",
            "api/search?q=Test",
            200
        )
        if success and 'cases' in response:
            print(f"   Search results: {len(response['cases'])} cases")
            return True
        return False

    def test_chat_without_openai_key(self):
        """Test POST /api/chat without OPENAI_API_KEY"""
        success, response = self.run_test(
            "Chat without OpenAI Key",
            "POST",
            "api/chat",
            500,  # Should return 500 for missing API key
            data={"message": "Test message", "languageMode": "EN"}
        )
        return success

    def test_delete_case(self):
        """Test DELETE /api/cases/[id]"""
        if not self.case_id:
            print("❌ No case ID available for testing")
            return False
            
        success, response = self.run_test(
            "Delete Case",
            "DELETE",
            f"api/cases/{self.case_id}",
            200
        )
        return success

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting RV Service Desk API Tests")
        print("=" * 50)

        # Test terms API
        self.test_terms_api()
        
        # Test cases API
        self.test_cases_list_empty()
        self.test_create_case()
        self.test_get_case()
        self.test_search_cases()
        
        # Test chat API (should fail without OpenAI key)
        self.test_chat_without_openai_key()
        
        # Test delete case
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