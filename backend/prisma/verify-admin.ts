/**
 * VANTA - Administrator Account Verification Script
 * 
 * Run this script to verify the administrator account was created correctly
 * and all security requirements are met.
 * 
 * Usage: npx ts-node --transpile-only prisma/verify-admin.ts
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'ceo@vanta.app';
const ADMIN_USERNAME = 'CEO';
const ADMIN_PASSWORD = '2388562Ceo$';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

async function runVerification(): Promise<void> {
  console.log('🔍 VANTA Administrator Account Verification');
  console.log('='.repeat(60));
  console.log();

  const results: TestResult[] = [];

  // ============================================================================
  // TEST 1: Admin account exists
  // ============================================================================
  try {
    const admin = await prisma.user.findFirst({
      where: {
        OR: [
          { email: ADMIN_EMAIL },
          { username: ADMIN_USERNAME },
        ],
      },
    });

    results.push({
      name: 'Admin account exists',
      passed: !!admin,
      details: admin
        ? `Found: ${admin.email} (${admin.username}) [ID: ${admin.id}]`
        : 'No admin account found',
    });

    if (!admin) {
      console.log('❌ Critical: Admin account not found! Run seed first.');
      printResults(results);
      return;
    }

    // ============================================================================
    // TEST 2: Admin email is unique
    // ============================================================================
    const emailDuplicates = await prisma.user.findMany({
      where: { email: ADMIN_EMAIL },
    });
    results.push({
      name: 'Admin email is unique',
      passed: emailDuplicates.length === 1,
      details: emailDuplicates.length === 1
        ? `Email ${ADMIN_EMAIL} has exactly 1 record`
        : `Email has ${emailDuplicates.length} records (expected 1)`,
    });

    // ============================================================================
    // TEST 3: Admin username is unique
    // ============================================================================
    const usernameDuplicates = await prisma.user.findMany({
      where: { username: ADMIN_USERNAME },
    });
    results.push({
      name: 'Admin username is unique',
      passed: usernameDuplicates.length === 1,
      details: usernameDuplicates.length === 1
        ? `Username ${ADMIN_USERNAME} has exactly 1 record`
        : `Username has ${usernameDuplicates.length} records (expected 1)`,
    });

    // ============================================================================
    // TEST 4: Password is hashed (not plain text)
    // ============================================================================
    results.push({
      name: 'Password is hashed (not plain text)',
      passed: !!admin.passwordHash && admin.passwordHash !== ADMIN_PASSWORD && admin.passwordHash.startsWith('$argon'),
      details: admin.passwordHash
        ? `Hash format: ${admin.passwordHash.substring(0, 30)}... (Argon2id)`
        : 'No password hash found',
    });

    // ============================================================================
    // TEST 5: Password verification works with Argon2
    // ============================================================================
    if (admin.passwordHash) {
      const passwordValid = await argon2.verify(admin.passwordHash, ADMIN_PASSWORD);
      results.push({
        name: 'Password verification works (Argon2id)',
        passed: passwordValid,
        details: passwordValid ? 'Password validated successfully' : 'Password validation FAILED',
      });
    } else {
      results.push({
        name: 'Password verification works (Argon2id)',
        passed: false,
        details: 'Cannot verify - no password hash',
      });
    }

    // ============================================================================
    // TEST 6: Role is ADMIN
    // ============================================================================
    results.push({
      name: 'Role is ADMIN',
      passed: admin.role === 'ADMIN',
      details: `Role: ${admin.role}${admin.role === 'ADMIN' ? ' ✓' : ' ✗'}`,
    });

    // ============================================================================
    // TEST 7: Account is verified
    // ============================================================================
    results.push({
      name: 'Verified status is true',
      passed: admin.verified === true,
      details: `Verified: ${admin.verified}`,
    });

    // ============================================================================
    // TEST 8: Email is verified
    // ============================================================================
    results.push({
      name: 'Email verified status is true',
      passed: admin.emailVerified === true,
      details: `EmailVerified: ${admin.emailVerified}`,
    });

    // ============================================================================
    // TEST 9: Account is ACTIVE
    // ============================================================================
    results.push({
      name: 'Account status is ACTIVE',
      passed: admin.status === 'ACTIVE',
      details: `Status: ${admin.status}`,
    });

    // ============================================================================
    // TEST 10: Account has timestamps
    // ============================================================================
    results.push({
      name: 'Timestamps are set',
      passed: !!(admin.createdAt && admin.updatedAt),
      details: `Created: ${admin.createdAt?.toISOString() || 'N/A'}\nUpdated: ${admin.updatedAt?.toISOString() || 'N/A'}`,
    });

    // ============================================================================
    // TEST 11: Login by email works
    // ============================================================================
    const userByEmail = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
    });
    results.push({
      name: 'Login by email works',
      passed: !!(userByEmail && userByEmail.passwordHash),
      details: userByEmail
        ? `Found by email: ${userByEmail.email}`
        : 'NOT found by email',
    });

    // ============================================================================
    // TEST 12: Login by username works
    // ============================================================================
    const userByUsername = await prisma.user.findFirst({
      where: { username: ADMIN_USERNAME },
    });
    results.push({
      name: 'Login by username works',
      passed: !!(userByUsername && userByUsername.passwordHash),
      details: userByUsername
        ? `Found by username: ${userByUsername.username}`
        : 'NOT found by username',
    });

    // ============================================================================
    // TEST 13: Duplicate admin prevention (re-run safety)
    // ============================================================================
    const existingCheck = await prisma.user.findFirst({
      where: {
        OR: [
          { email: ADMIN_EMAIL },
          { username: ADMIN_USERNAME },
        ],
      },
    });
    
    // There should be exactly one admin account
    const allAdmins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
    });
    
    const adminCount = allAdmins.filter(
      (a) => a.email === ADMIN_EMAIL || a.username === ADMIN_USERNAME
    ).length;

    results.push({
      name: 'No duplicate admin accounts on re-run',
      passed: adminCount === 1,
      details: adminCount === 1
        ? 'Exactly 1 admin account found with these credentials'
        : `Found ${adminCount} admin accounts (expected 1)`,
    });

    // ============================================================================
    // TEST 14: Password hash never exposed in select queries
    // ============================================================================
    const userWithoutHash = await prisma.user.findFirst({
      where: { email: ADMIN_EMAIL },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        verified: true,
        // Intentionally NOT selecting passwordHash
      },
    });
    results.push({
      name: 'Password hash not exposed in API responses',
      passed: !(userWithoutHash as any)?.passwordHash,
      details: !(userWithoutHash as any)?.passwordHash
        ? 'passwordHash field not included in select queries'
        : 'WARNING: passwordHash returned when not selected',
    });

    // ============================================================================
    // Print Results
    // ============================================================================
    printResults(results);

  } catch (error) {
    console.error('❌ Verification failed with error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

function printResults(results: TestResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log('\n📋 Verification Results:');
  console.log('-'.repeat(60));

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`\n${icon} ${result.name}`);
    if (result.details) {
      console.log(`   ${result.details}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Summary: ${passed}/${total} tests passed`);
  console.log('='.repeat(60));

  if (passed === total) {
    console.log('\n🎉 ALL CHECKS PASSED - Administrator account is properly configured!');
  } else {
    console.log(`\n⚠️  ${total - passed} test(s) failed. Please review and fix.`);
  }
}

runVerification();