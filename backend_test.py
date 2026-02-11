#!/usr/bin/env python3

import subprocess
import sys
import os
from datetime import datetime

class PrismaV7MigrationTester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.base_dir = "/app"

    def run_test(self, name, test_func, *args, **kwargs):
        """Run a single test"""
        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            success = test_func(*args, **kwargs)
            if success:
                self.tests_passed += 1
                print(f"✅ {name} - PASSED")
            else:
                print(f"❌ {name} - FAILED")
            return success
        except Exception as e:
            print(f"❌ {name} - ERROR: {str(e)}")
            return False

    def test_typescript_db_compilation(self):
        """Test TypeScript compilation for db.ts"""
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit", "--project", "tsconfig.json"],
                cwd=self.base_dir,
                capture_output=True,
                text=True
            )
            
            # Check for any db.ts errors
            db_errors = [line for line in result.stderr.split('\n') if 'db.ts' in line and 'error TS' in line]
            return len(db_errors) == 0
        except Exception as e:
            print(f"TypeScript test error: {e}")
            return False

    def test_typescript_dependent_files(self):
        """Test TypeScript compilation for storage.ts, auth.ts, analytics.ts"""
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit", "--project", "tsconfig.json"],
                cwd=self.base_dir,
                capture_output=True,
                text=True
            )
            
            # Check for errors in dependent files
            dependent_errors = [line for line in result.stderr.split('\n') 
                              if any(file in line for file in ['storage.ts', 'auth.ts', 'analytics.ts']) 
                              and 'error TS' in line]
            return len(dependent_errors) == 0
        except Exception as e:
            print(f"Dependent files test error: {e}")
            return False

    def test_total_typescript_errors(self):
        """Test that total TS errors are around 20, not 41+"""
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit", "--project", "tsconfig.json"],
                cwd=self.base_dir,
                capture_output=True,
                text=True
            )
            
            # Count lines containing 'error TS' - errors show up in stderr
            all_output = result.stderr + result.stdout
            error_lines = [line for line in all_output.split('\n') if 'error TS' in line and line.strip()]
            error_count = len(error_lines)
            print(f"Total TypeScript errors: {error_count}")
            print(f"Sample error lines: {error_lines[:3] if error_lines else 'None'}")
            
            # Should be around 20, definitely not 41+
            return 15 <= error_count <= 25
        except Exception as e:
            print(f"Total TS errors test error: {e}")
            return False

    def test_eslint_db(self):
        """Test ESLint on db.ts"""
        try:
            result = subprocess.run(
                ["npx", "eslint", "src/lib/db.ts"],
                cwd=self.base_dir,
                capture_output=True,
                text=True
            )
            return result.returncode == 0
        except Exception as e:
            print(f"ESLint test error: {e}")
            return False

    def test_runtime_with_database_url(self):
        """Test runtime behavior with DATABASE_URL"""
        try:
            env = os.environ.copy()
            env["DATABASE_URL"] = "postgresql://dummy:dummy@localhost:5432/testdb"
            
            result = subprocess.run([
                "npx", "tsx", "-e", 
                "import { getPrisma } from './src/lib/db'; getPrisma().then(p => { console.log('OK:', typeof p.case); return p.$disconnect() }).then(() => process.exit(0))"
            ], cwd=self.base_dir, capture_output=True, text=True, env=env)
            
            return result.returncode == 0 and "OK: object" in result.stdout
        except Exception as e:
            print(f"Runtime test error: {e}")
            return False

    def test_singleton_behavior(self):
        """Test singleton behavior"""
        try:
            env = os.environ.copy()
            env["DATABASE_URL"] = "postgresql://dummy:dummy@localhost:5432/testdb"
            
            result = subprocess.run([
                "npx", "tsx", "-e",
                "import { getPrisma } from './src/lib/db'; (async () => { const p1 = await getPrisma(); const p2 = await getPrisma(); console.log('Singleton:', p1 === p2 ? 'PASS' : 'FAIL'); await p1.$disconnect(); process.exit(p1 === p2 ? 0 : 1); })()"
            ], cwd=self.base_dir, capture_output=True, text=True, env=env)
            
            return result.returncode == 0 and "Singleton: PASS" in result.stdout
        except Exception as e:
            print(f"Singleton test error: {e}")
            return False

    def test_env_validation(self):
        """Test environment validation"""
        try:
            env = os.environ.copy()
            env.pop("DATABASE_URL", None)  # Remove DATABASE_URL
            
            result = subprocess.run([
                "npx", "tsx", "-e",
                "import { getPrisma } from './src/lib/db'; getPrisma().catch(err => { console.log('Error:', err.message); process.exit(err.message.includes('DATABASE_URL is not set') ? 0 : 1); })"
            ], cwd=self.base_dir, capture_output=True, text=True, env=env)
            
            return result.returncode == 0 and "DATABASE_URL is not set" in result.stdout
        except Exception as e:
            print(f"Env validation test error: {e}")
            return False

    def test_export_stability(self):
        """Test export stability"""
        try:
            env = os.environ.copy()
            env["DATABASE_URL"] = "postgresql://dummy:dummy@localhost:5432/testdb"
            
            result = subprocess.run([
                "npx", "tsx", "-e",
                "import { getPrisma, PrismaClientType } from './src/lib/db'; console.log('Exports OK'); process.exit(0);"
            ], cwd=self.base_dir, capture_output=True, text=True, env=env)
            
            return result.returncode == 0 and "Exports OK" in result.stdout
        except Exception as e:
            print(f"Export stability test error: {e}")
            return False

def main():
    tester = PrismaV7MigrationTester()
    
    print("🚀 Starting Prisma v7 Migration Tests")
    print("=" * 50)
    
    # Run all tests
    tests = [
        ("TypeScript db.ts compilation", tester.test_typescript_db_compilation),
        ("TypeScript dependent files", tester.test_typescript_dependent_files),
        ("Total TypeScript errors count", tester.test_total_typescript_errors),
        ("ESLint db.ts", tester.test_eslint_db),
        ("Runtime with DATABASE_URL", tester.test_runtime_with_database_url),
        ("Singleton behavior", tester.test_singleton_behavior),
        ("Environment validation", tester.test_env_validation),
        ("Export stability", tester.test_export_stability),
    ]
    
    for test_name, test_func in tests:
        tester.run_test(test_name, test_func)
    
    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed! Prisma v7 migration is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())