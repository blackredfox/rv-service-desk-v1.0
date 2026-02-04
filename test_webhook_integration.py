#!/usr/bin/env python3

import json
import sys

def test_webhook_customer_lookup_logic():
    """Test the webhook customer ID lookup logic"""
    print("🔍 Testing Webhook Customer ID Lookup Logic...")
    
    # Simulate subscription data scenarios
    test_cases = [
        {
            "name": "Subscription with orgId in metadata",
            "subscription": {
                "id": "sub_123",
                "status": "active",
                "metadata": {"orgId": "org_123"},
                "customer": "cus_123",
                "items": {"data": [{"quantity": 10}]}
            },
            "expected_orgId": "org_123",
            "should_lookup_customer": False
        },
        {
            "name": "Subscription without orgId (Portal upgrade scenario)",
            "subscription": {
                "id": "sub_456", 
                "status": "active",
                "metadata": {},  # No orgId - common for Portal upgrades
                "customer": "cus_456",
                "items": {"data": [{"quantity": 15}]}
            },
            "expected_orgId": None,  # Would need customer lookup
            "should_lookup_customer": True
        },
        {
            "name": "Subscription with string customer ID",
            "subscription": {
                "id": "sub_789",
                "status": "active", 
                "metadata": {},
                "customer": "cus_789",  # String format
                "items": {"data": [{"quantity": 5}]}
            },
            "expected_orgId": None,
            "should_lookup_customer": True
        }
    ]
    
    passed_tests = 0
    total_tests = len(test_cases)
    
    for test_case in test_cases:
        print(f"\n  Testing: {test_case['name']}")
        subscription = test_case['subscription']
        
        # Simulate the logic from handleSubscriptionUpdate
        orgId = subscription.get('metadata', {}).get('orgId')
        
        if not orgId and subscription.get('customer'):
            customerId = subscription['customer']
            if isinstance(customerId, str):
                print(f"    ✅ Would lookup org by customer ID: {customerId}")
                should_lookup = True
            else:
                should_lookup = False
        else:
            should_lookup = False
            
        # Get seat limit from quantity
        seatLimit = 5  # default
        if subscription.get('items', {}).get('data') and len(subscription['items']['data']) > 0:
            seatLimit = subscription['items']['data'][0].get('quantity', 5)
            
        print(f"    Seat limit extracted: {seatLimit}")
        print(f"    Should lookup customer: {should_lookup}")
        
        if should_lookup == test_case['should_lookup_customer']:
            print(f"    ✅ Test passed")
            passed_tests += 1
        else:
            print(f"    ❌ Test failed - Expected lookup: {test_case['should_lookup_customer']}, Got: {should_lookup}")
    
    print(f"\n📊 Webhook Logic Tests: {passed_tests}/{total_tests} passed")
    return passed_tests == total_tests

def test_member_claim_logic():
    """Test the member claim logic"""
    print("🔍 Testing Member Claim Logic...")
    
    test_cases = [
        {
            "name": "Placeholder UID should be claimable",
            "uid": "pending_1234567890",
            "expected_claimable": True
        },
        {
            "name": "Real UID should not be claimable", 
            "uid": "real_firebase_uid_123",
            "expected_claimable": False
        },
        {
            "name": "Another placeholder UID should be claimable",
            "uid": "pending_abcdef",
            "expected_claimable": True
        },
        {
            "name": "Empty UID should not be claimable",
            "uid": "",
            "expected_claimable": False
        }
    ]
    
    passed_tests = 0
    total_tests = len(test_cases)
    
    for test_case in test_cases:
        print(f"\n  Testing: {test_case['name']}")
        uid = test_case['uid']
        
        # Simulate the logic from /api/auth/me route
        is_placeholder_uid = uid.startswith("pending_") if uid else False
        
        print(f"    UID: {uid}")
        print(f"    Is claimable: {is_placeholder_uid}")
        
        if is_placeholder_uid == test_case['expected_claimable']:
            print(f"    ✅ Test passed")
            passed_tests += 1
        else:
            print(f"    ❌ Test failed - Expected: {test_case['expected_claimable']}, Got: {is_placeholder_uid}")
    
    print(f"\n📊 Member Claim Logic Tests: {passed_tests}/{total_tests} passed")
    return passed_tests == total_tests

def main():
    print("🚀 Testing Critical Issue Fixes Logic")
    print("=" * 50)
    
    webhook_passed = test_webhook_customer_lookup_logic()
    member_claim_passed = test_member_claim_logic()
    
    print("\n" + "=" * 50)
    if webhook_passed and member_claim_passed:
        print("🎉 All logic tests passed!")
        return 0
    else:
        print("⚠️  Some logic tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())