#!/usr/bin/env python3
"""
Backend test suite for Prisma v7 retention cleanup script and CI workflow.
Tests TypeScript compilation, ESLint, runtime initialization, and configuration.
"""

import subprocess
import sys
import os
import json
from typing import Dict, List, Tuple, Any

class PrismaV7Tester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results: List[Dict[str, Any]] = []

    def log_test_result(self, name: str, success: bool, details: str = "", error_msg: str = ""):
        """Log test result with details"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}: PASSED")
        else:
            print(f"❌ {name}: FAILED")
            if error_msg:
                print(f"   Error: {error_msg}")
        
        if details:
            print(f"   Details: {details}")
        
        self.test_results.append({
            "test_name": name,
            "success": success,
            "details": details,
            "error_msg": error_msg
        })
        print()

    def run_command(self, cmd: str, cwd: str = "/app", env_vars: Dict[str, str] = None) -> Tuple[bool, str, str]:
        """Run a shell command and return success, stdout, stderr"""
        try:
            env = os.environ.copy()
            if env_vars:
                env.update(env_vars)
            
            result = subprocess.run(
                cmd.split(),
                cwd=cwd,
                capture_output=True,
                text=True,
                env=env,
                timeout=60
            )
            
            return result.returncode == 0, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return False, "", "Command timed out after 60 seconds"
        except Exception as e:
            return False, "", str(e)

    def test_typescript_compilation(self):
        """Test TypeScript compilation with no errors"""
        print("🔍 Testing TypeScript compilation...")
        success, stdout, stderr = self.run_command("npx tsc --noEmit --project tsconfig.json")
        
        if success:
            self.log_test_result(
                "TypeScript Compilation",
                True,
                "All TypeScript files compile without errors"
            )
        else:
            # Check if error is specifically related to cleanup-retention.ts
            error_details = stderr + stdout
            if "scripts/cleanup-retention.ts" in error_details:
                self.log_test_result(
                    "TypeScript Compilation",
                    False,
                    "TypeScript compilation failed with errors in cleanup-retention.ts",
                    error_details
                )
            else:
                self.log_test_result(
                    "TypeScript Compilation",
                    False,
                    "TypeScript compilation failed",
                    error_details
                )

    def test_eslint_validation(self):
        """Test ESLint validation for cleanup-retention.ts"""
        print("🔍 Testing ESLint validation...")
        success, stdout, stderr = self.run_command("npx eslint scripts/cleanup-retention.ts")
        
        if success:
            self.log_test_result(
                "ESLint Validation",
                True,
                "ESLint passes with 0 errors for cleanup-retention.ts"
            )
        else:
            error_details = stderr + stdout
            self.log_test_result(
                "ESLint Validation",
                False,
                "ESLint found errors in cleanup-retention.ts",
                error_details
            )

    def test_runtime_initialization_with_dummy_url(self):
        """Test runtime initialization with dummy DATABASE_URL"""
        print("🔍 Testing runtime initialization with dummy DATABASE_URL...")
        
        dummy_url = "postgresql://dummy:dummy@localhost:5432/testdb"
        env_vars = {"DATABASE_URL": dummy_url}
        
        success, stdout, stderr = self.run_command(
            "npx tsx scripts/cleanup-retention.ts",
            env_vars=env_vars
        )
        
        output = stdout + stderr
        
        # We expect this to fail with P2010 (Can't reach database server) but NOT PrismaClientInitializationError
        if "PrismaClientInitializationError" in output:
            self.log_test_result(
                "Runtime Initialization (Dummy URL)",
                False,
                "PrismaClient initialization failed - this suggests adapter issue",
                output
            )
        elif "P2010" in output or "Can't reach database server" in output or "getaddrinfo ENOTFOUND" in output:
            self.log_test_result(
                "Runtime Initialization (Dummy URL)",
                True,
                "PrismaClient initializes successfully, fails at connection as expected"
            )
        else:
            # Check if script completed successfully (unlikely with dummy URL)
            if "Retention cleanup completed" in output:
                self.log_test_result(
                    "Runtime Initialization (Dummy URL)",
                    True,
                    "Script completed successfully (unexpected but good)"
                )
            else:
                self.log_test_result(
                    "Runtime Initialization (Dummy URL)",
                    False,
                    "Unexpected error during initialization",
                    output
                )

    def test_missing_database_url_validation(self):
        """Test that script throws error when DATABASE_URL is not defined"""
        print("🔍 Testing missing DATABASE_URL validation...")
        
        # Remove DATABASE_URL from environment
        env_vars = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
        
        success, stdout, stderr = self.run_command(
            "npx tsx scripts/cleanup-retention.ts",
            env_vars=env_vars
        )
        
        output = stdout + stderr
        
        if "DATABASE_URL is not defined" in output:
            self.log_test_result(
                "DATABASE_URL Validation",
                True,
                "Script correctly throws error when DATABASE_URL is missing"
            )
        else:
            self.log_test_result(
                "DATABASE_URL Validation",
                False,
                "Script should throw 'DATABASE_URL is not defined' error",
                output
            )

    def test_package_json_script(self):
        """Verify package.json has retention:cleanup script"""
        print("🔍 Testing package.json script configuration...")
        
        try:
            with open("/app/package.json", "r") as f:
                package_data = json.load(f)
            
            scripts = package_data.get("scripts", {})
            retention_script = scripts.get("retention:cleanup")
            
            if retention_script == "tsx scripts/cleanup-retention.ts":
                self.log_test_result(
                    "Package.json Script",
                    True,
                    "retention:cleanup script is correctly configured"
                )
            else:
                self.log_test_result(
                    "Package.json Script",
                    False,
                    f"Expected 'tsx scripts/cleanup-retention.ts', got '{retention_script}'"
                )
        except Exception as e:
            self.log_test_result(
                "Package.json Script",
                False,
                "Failed to read package.json",
                str(e)
            )

    def test_required_dependencies(self):
        """Verify @prisma/adapter-pg and pg are in dependencies"""
        print("🔍 Testing required dependencies...")
        
        try:
            with open("/app/package.json", "r") as f:
                package_data = json.load(f)
            
            dependencies = package_data.get("dependencies", {})
            
            has_adapter = "@prisma/adapter-pg" in dependencies
            has_pg = "pg" in dependencies
            
            if has_adapter and has_pg:
                adapter_version = dependencies["@prisma/adapter-pg"]
                pg_version = dependencies["pg"]
                self.log_test_result(
                    "Required Dependencies",
                    True,
                    f"@prisma/adapter-pg: {adapter_version}, pg: {pg_version}"
                )
            else:
                missing = []
                if not has_adapter:
                    missing.append("@prisma/adapter-pg")
                if not has_pg:
                    missing.append("pg")
                
                self.log_test_result(
                    "Required Dependencies",
                    False,
                    f"Missing dependencies: {', '.join(missing)}"
                )
        except Exception as e:
            self.log_test_result(
                "Required Dependencies",
                False,
                "Failed to read package.json",
                str(e)
            )

    def test_ci_workflow_configuration(self):
        """Verify CI workflow has required configuration"""
        print("🔍 Testing CI workflow configuration...")
        
        try:
            with open("/app/.github/workflows/retention-cleanup.yml", "r") as f:
                workflow_content = f.read()
            
            checks = {
                "DATABASE_URL from secrets": "${{ secrets.DATABASE_URL }}" in workflow_content,
                "prisma generate step": "yarn prisma generate" in workflow_content,
                "retention cleanup step": "yarn retention:cleanup" in workflow_content,
                "DATABASE_URL env in generate": workflow_content.count("DATABASE_URL: ${{ secrets.DATABASE_URL }}") >= 2
            }
            
            all_passed = all(checks.values())
            
            if all_passed:
                self.log_test_result(
                    "CI Workflow Configuration",
                    True,
                    "All required steps and environment variables are configured"
                )
            else:
                failed_checks = [k for k, v in checks.items() if not v]
                self.log_test_result(
                    "CI Workflow Configuration",
                    False,
                    f"Missing configurations: {', '.join(failed_checks)}"
                )
        except Exception as e:
            self.log_test_result(
                "CI Workflow Configuration",
                False,
                "Failed to read workflow file",
                str(e)
            )

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting Prisma v7 retention cleanup tests...\n")
        
        # Test 1: TypeScript compilation
        self.test_typescript_compilation()
        
        # Test 2: ESLint validation
        self.test_eslint_validation()
        
        # Test 3: Runtime initialization with dummy URL
        self.test_runtime_initialization_with_dummy_url()
        
        # Test 4: Missing DATABASE_URL validation
        self.test_missing_database_url_validation()
        
        # Test 5: Package.json script configuration
        self.test_package_json_script()
        
        # Test 6: Required dependencies
        self.test_required_dependencies()
        
        # Test 7: CI workflow configuration
        self.test_ci_workflow_configuration()
        
        # Print summary
        print("=" * 50)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"📈 Success Rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed! Prisma v7 retention cleanup is working correctly.")
            return 0
        else:
            print("⚠️  Some tests failed. Please review the issues above.")
            return 1

def main():
    """Main test execution"""
    os.chdir("/app")
    tester = PrismaV7Tester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())