// scripts/integrity-checker.ts

import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, and, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import ws from 'ws';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// Load environment variables
config();

// Configure WebSocket constructor for Node.js environments
neonConfig.webSocketConstructor = ws;

import {
  pledge,
  paymentPlan,
  payment,
  contact,
  exchangeRate as exchangeRateTable,
  installmentSchedule,
  paymentAllocations,
} from '../lib/db/schema';

// Configuration
const DATABASE_URL = process.env.DATABASE_URL!;
const TOLERANCE = 0.01;

// Database connection check only
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('💡 Make sure you have a .env or .env.local file with:');
  console.error('   DATABASE_URL=your_connection_string_here');
  process.exit(1);
}

interface IntegrityIssue {
  id: string;
  type: 'pledge_balance' | 'payment_plan_amounts' | 'payment_conversion' | 'plan_conversion' | 'installment_conversion' | 'third_party_conversion' | 'allocation_conversion';
  severity: 'critical' | 'warning';
  contactId: number;
  contactName: string;
  recordId: number;
  recordType: 'pledge' | 'payment_plan' | 'payment' | 'installment_schedule' | 'payment_allocation';
  description: string;
  currentValue: any;
  expectedValue: any;
  affectedFields: string[];
  fixValue: string;
  fixRecordId: number;
}

interface CheckSummary {
  totalIssues: number;
  criticalIssues: number;
  warningIssues: number;
  affectedContacts: number;
  timestamp: string;
}

interface ExchangeRatesResponse {
  success: boolean;
  data: {
    rates: Record<string, string>;
    date: string;
  } | null;
  error?: string;
}

/**
 * Simple HTTP(S) request function to replace node-fetch
 */
function httpRequest(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const module = parsedUrl.protocol === 'https:' ? https : http;

    const req = module.request(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse JSON response: ${error}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

class CurrencyIntegrityService {
  private db: ReturnType<typeof drizzle>;
  private exchangeRateCache: Map<string, { rates: Record<string, string>; date: string }> = new Map();

  constructor() {
    const pool = new Pool({
      connectionString: DATABASE_URL
    });
    this.db = drizzle(pool, {
      logger: true
    });
  }

  async checkDatabaseConnection(): Promise<boolean> {
    try {
      console.log('Testing database connection...');
      const result = await this.db.execute(sql`SELECT 1 as test`);
      console.log('✅ Database connection successful');
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }
  }

  async checkTablesExist(): Promise<{ exists: boolean; missing: string[] }> {
    const requiredTables = ['pledge', 'payment', 'contact', 'payment_plan', 'installment_schedule', 'payment_allocations'];
    const missing: string[] = [];

    try {
      console.log('Checking if required tables exist...');

      console.log('🔍 Listing all tables in database...');
      const allTablesResult = await this.db.execute(sql`
        SELECT table_name, table_schema 
        FROM information_schema.tables 
        WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('information_schema', 'pg_catalog')
        ORDER BY table_schema, table_name;
      `);

      console.log('📋 Found tables:');
      if (allTablesResult.rows.length === 0) {
        console.log('  ❌ NO TABLES FOUND - Database appears to be empty!');
      } else {
        allTablesResult.rows.forEach((row: any) => {
          const tableName = row.table_name || row[0];
          const schemaName = row.table_schema || row[1];
          console.log(`  - ${schemaName}.${tableName}`);
        });
      }

      console.log('\n🔍 Searching for our required tables in all schemas...');
      for (const tableName of requiredTables) {
        try {
          const result = await this.db.execute(sql`
            SELECT table_schema, table_name
            FROM information_schema.tables 
            WHERE LOWER(table_name) = LOWER(${tableName})
            AND table_type = 'BASE TABLE';
          `);

          if (result.rows.length > 0) {
            const foundSchema = result.rows[0].table_schema || result.rows[0][0];
            const foundTable = result.rows[0].table_name || result.rows[0][1];
            console.log(`✅ Table '${tableName}' found as '${foundSchema}.${foundTable}'`);
          } else {
            missing.push(tableName);
            console.log(`❌ Table '${tableName}' not found in any schema`);
          }
        } catch (error) {
          console.error(`❌ Error checking table '${tableName}':`, error);
          missing.push(tableName);
        }
      }

      return { exists: missing.length === 0, missing };
    } catch (error) {
      console.error('Error checking tables:', error);
      return { exists: false, missing: requiredTables };
    }
  }

  /**
   * FINANCIAL BEST PRACTICE: Get conversion date - NEVER future dates
   * Uses received_date if available and not in future, otherwise today's date
   */
  getConversionDate(paymentRecord: any): string {
    const today = new Date().toISOString().split('T')[0];

    // 1. Use receivedDate if it exists and is not in future
    if (paymentRecord.receivedDate) {
      const receivedDate = new Date(paymentRecord.receivedDate).toISOString().split('T')[0];

      // Only use received date if it's not in the future
      if (receivedDate <= today) {
        console.log(`📅 Using received_date: ${receivedDate}`);
        return receivedDate;
      } else {
        console.log(`⚠️ Future received_date detected (${receivedDate}), using today's date (${today})`);
        return today;
      }
    }

    // 2. NEVER use payment_date - always fallback to today's date
    console.log(`📅 No received_date found, using today's date: ${today}`);
    return today;
  }

  public async storeRateInDatabase(fromCurrency: string, toCurrency: string, rate: number, date: string): Promise<void> {
    try {
      const now = new Date().toISOString().split('T')[0];

      // Use raw SQL to avoid TypeScript issues
      await this.db.execute(sql`
      INSERT INTO exchange_rate (base_currency, target_currency, rate, date, created_at, updated_at)
      VALUES (${fromCurrency}, ${toCurrency}, ${rate}, ${date}, ${now}, ${now})
      ON CONFLICT (base_currency, target_currency, date) 
      DO UPDATE SET 
        rate = ${rate}, 
        updated_at = ${now}
    `);

      console.log(`📝 Stored precise rate in database: ${fromCurrency}/${toCurrency} = ${rate} on ${date}`);
    } catch (error) {
      console.error(`Failed to store rate in database:`, error);
    }
  }

  /**
   * Fetch exchange rates using your existing API endpoint
   * Updated to work with your API structure using built-in Node.js HTTP
   */
  private async fetchExchangeRatesFromAPI(date?: string): Promise<ExchangeRatesResponse> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const cacheKey = targetDate;

    // Check cache first
    if (this.exchangeRateCache.has(cacheKey)) {
      const cached = this.exchangeRateCache.get(cacheKey)!;
      return {
        success: true,
        data: {
          rates: cached.rates,
          date: cached.date
        }
      };
    }

    try {
      // Use environment variable for API base URL, fallback to localhost for dev
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://new-module-usd.vercel.app/";
      const apiUrl = `${baseUrl}/api/exchange-rates?date=${targetDate}`;

      console.log(`🔍 Fetching exchange rates from API: ${apiUrl}`);

      // Use built-in Node.js HTTP instead of fetch or node-fetch
      const apiData = await httpRequest(apiUrl);

      if (apiData.data && apiData.data.rates) {
        // Cache the result
        this.exchangeRateCache.set(cacheKey, {
          rates: apiData.data.rates,
          date: targetDate
        });

        console.log(`✅ Retrieved exchange rates from API for ${targetDate}`);
        return {
          success: true,
          data: {
            rates: apiData.data.rates,
            date: targetDate
          }
        };
      } else {
        throw new Error("Invalid API response structure");
      }
    } catch (error) {
      console.warn(`⚠️ API request failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * FINANCIAL BEST PRACTICE: Always use current rates for all calculations
   * Uses the same API as your form for consistency
   */
  async getExchangeRate(fromCurrency: string, toCurrency: string, date?: string): Promise<number> {
    if (fromCurrency === toCurrency) return 1;

    // FINANCIAL BEST PRACTICE: Always use TODAY'S rate for any calculations
    const today = new Date().toISOString().split('T')[0];
    const useDate = today; // Always use today's date for consistency

    console.log(`🔄 Getting exchange rate for ${fromCurrency} → ${toCurrency} (${useDate})`);

    // 1. FIRST: Check database for today's rate
    try {
      console.log(`🏦 Checking database first for ${fromCurrency} → ${toCurrency} on ${useDate}`);

      const dbRates = await this.db.execute(sql`
        SELECT rate, date
        FROM exchange_rate
        WHERE base_currency = ${fromCurrency}
        AND target_currency = ${toCurrency}
        AND date = ${useDate}
        LIMIT 1
      `);

      if (dbRates.rows.length > 0) {
        const row = dbRates.rows[0] as any;
        const rate = parseFloat(String(row.rate));
        if (rate > 0) {
          console.log(`✅ DB EXACT rate: 1 ${fromCurrency} = ${rate} ${toCurrency} (${useDate})`);
          return rate;
        }
      }

      // Try recent rate within 30 days
      const recentRates = await this.db.execute(sql`
        SELECT rate, date
        FROM exchange_rate
        WHERE base_currency = ${fromCurrency}
        AND target_currency = ${toCurrency}
        AND date <= ${useDate}
        AND ABS(EXTRACT(EPOCH FROM (date::date - ${useDate}::date))) <= 2592000
        ORDER BY date DESC
        LIMIT 1
      `);

      if (recentRates.rows.length > 0) {
        const row = recentRates.rows[0] as any;
        const rate = parseFloat(String(row.rate));
        const rateDate = String(row.date);
        if (rate > 0) {
          const daysDiff = Math.abs((new Date(rateDate).getTime() - new Date(useDate).getTime()) / (1000 * 60 * 60 * 24));
          console.log(`⚠️ Using recent DB rate from ${rateDate} (${daysDiff.toFixed(0)} days old): 1 ${fromCurrency} = ${rate} ${toCurrency}`);
          return rate;
        }
      }

      // Try inverse rate
      const inverseRates = await this.db.execute(sql`
        SELECT rate, date
        FROM exchange_rate
        WHERE base_currency = ${toCurrency}
        AND target_currency = ${fromCurrency}
        AND date = ${useDate}
        LIMIT 1
      `);

      if (inverseRates.rows.length > 0) {
        const row = inverseRates.rows[0] as any;
        const inverseRate = parseFloat(String(row.rate));
        if (inverseRate > 0) {
          const rate = 1 / inverseRate;
          console.log(`✅ DB inverse rate: 1 ${fromCurrency} = ${rate} ${toCurrency} (${useDate})`);
          return rate;
        }
      }

    } catch (error) {
      console.warn(`Database lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. THEN: Use the same API as your form
    try {
      console.log(`🌐 Fetching from API (same as form) for ${fromCurrency} → ${toCurrency} on ${useDate}`);

      const apiResult = await this.fetchExchangeRatesFromAPI(useDate);

      if (apiResult.success && apiResult.data?.rates) {
        const fromRate = parseFloat(apiResult.data.rates[fromCurrency]);
        const toRate = parseFloat(apiResult.data.rates[toCurrency]);

        if (fromRate && toRate) {
          // Convert through USD: fromCurrency -> USD -> toCurrency
          const rate = toRate / fromRate;

          console.log(`✅ API rate: 1 ${fromCurrency} = ${rate} ${toCurrency} (${apiResult.data.date})`);

          // STORE IN DATABASE for future precision
          await this.storeRateInDatabase(fromCurrency, toCurrency, rate, useDate);

          return rate;
        }
      }

    } catch (error) {
      console.warn(`API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // NO APPROXIMATIONS - Fail if no precise rate found
    throw new Error(`❌ No current exchange rate found for ${fromCurrency} to ${toCurrency} on ${useDate}. Please add rate to database manually using: add-rate ${fromCurrency} ${toCurrency} RATE ${useDate}`);
  }

  /**
   * Convert currency amount using current rates (financial best practice)
   */
  async convertCurrency(amount: number, fromCurrency: string, toCurrency: string, date?: string): Promise<{
    convertedAmount: number;
    exchangeRate: number;
  }> {
    if (fromCurrency === toCurrency) {
      return { convertedAmount: amount, exchangeRate: 1 };
    }

    // FINANCIAL BEST PRACTICE: Always use current rates (ignore date parameter)
    const today = new Date().toISOString().split('T')[0];
    console.log(`🔄 Converting ${amount} ${fromCurrency} → ${toCurrency} (using TODAY'S rate: ${today})`);

    const exchangeRate = await this.getExchangeRate(fromCurrency, toCurrency, today);
    const convertedAmount = parseFloat((amount * exchangeRate).toFixed(2));

    console.log(`✅ Conversion: ${amount} ${fromCurrency} × ${exchangeRate} = ${convertedAmount} ${toCurrency}`);

    return { convertedAmount, exchangeRate };
  }

  private isAmountEqual(amount1: number | null, amount2: number | null): boolean {
    if (amount1 === null && amount2 === null) return true;
    if (amount1 === null || amount2 === null) return false;
    return Math.abs(amount1 - amount2) <= TOLERANCE;
  }

  async checkPledgeBalances(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL pledge balances (multi-currency support)...');

    try {
      const pledgeData = await this.db
        .select({
          id: pledge.id,
          contactId: pledge.contactId,
          originalAmount: pledge.originalAmount,
          totalPaid: pledge.totalPaid,
          balance: pledge.balance,
          currency: pledge.currency,
          isActive: pledge.isActive,
        })
        .from(pledge);

      console.log(`📊 Found ${pledgeData.length} total pledges in database`);

      if (pledgeData.length === 0) {
        console.log('No pledges found in database');
        return issues;
      }

      const activePledges = pledgeData.filter(p => p.isActive === true);
      console.log(`📊 Active pledges: ${activePledges.length}`);

      if (activePledges.length === 0) {
        console.log('No active pledges found');
        return issues;
      }

      for (const pledgeRecord of activePledges) {
        try {
          // Get contact name
          const contactData = await this.db
            .select({
              firstName: contact.firstName,
              lastName: contact.lastName,
            })
            .from(contact)
            .where(eq(contact.id, pledgeRecord.contactId))
            .limit(1);

          const contactName = contactData.length > 0
            ? `${contactData[0].firstName || ''} ${contactData[0].lastName || ''}`.trim()
            : 'Unknown Contact';

          // Sum amount_in_pledge_currency for multi-currency support
          const paymentSum = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(amount_in_pledge_currency), 0)`,
              count: sql<number>`COUNT(*)`,
            })
            .from(payment)
            .where(
              and(
                eq(payment.pledgeId, pledgeRecord.id),
                sql`${payment.paymentStatus} = 'completed'`,
                sql`${payment.receivedDate} IS NOT NULL`,
                sql`${payment.amountInPledgeCurrency} IS NOT NULL`
              )
            );

          const actualTotalPaid = paymentSum.length > 0 ? Number(paymentSum[0].total) : 0;
          const expectedBalance = Number(pledgeRecord.originalAmount) - actualTotalPaid;

          if (!this.isAmountEqual(actualTotalPaid, Number(pledgeRecord.totalPaid))) {
            issues.push({
              id: `pledge_total_paid_${pledgeRecord.id}`,
              type: 'pledge_balance',
              severity: 'critical',
              contactId: pledgeRecord.contactId,
              contactName,
              recordId: pledgeRecord.id,
              recordType: 'pledge',
              description: `Multi-currency total paid mismatch. Recorded: ${pledgeRecord.totalPaid} ${pledgeRecord.currency}, Actual: ${actualTotalPaid} ${pledgeRecord.currency}`,
              currentValue: Number(pledgeRecord.totalPaid),
              expectedValue: actualTotalPaid,
              affectedFields: ['total_paid'],
              fixValue: actualTotalPaid.toFixed(2),
              fixRecordId: pledgeRecord.id
            });
          }

          if (!this.isAmountEqual(Number(pledgeRecord.balance), expectedBalance)) {
            issues.push({
              id: `pledge_balance_${pledgeRecord.id}`,
              type: 'pledge_balance',
              severity: 'critical',
              contactId: pledgeRecord.contactId,
              contactName,
              recordId: pledgeRecord.id,
              recordType: 'pledge',
              description: `Multi-currency balance incorrect. Recorded: ${pledgeRecord.balance} ${pledgeRecord.currency}, Expected: ${expectedBalance} ${pledgeRecord.currency}`,
              currentValue: Number(pledgeRecord.balance),
              expectedValue: expectedBalance,
              affectedFields: ['balance'],
              fixValue: expectedBalance.toFixed(2),
              fixRecordId: pledgeRecord.id
            });
          }

        } catch (error) {
          console.error(`Error checking pledge ${pledgeRecord.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkPledgeBalances:', error);
      throw error;
    }

    return issues;
  }

  async checkPaymentPlanIntegrity(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL payment plan amounts (multi-currency support)...');

    try {
      const planData = await this.db
        .select({
          id: paymentPlan.id,
          totalPlannedAmount: paymentPlan.totalPlannedAmount,
          totalPaid: paymentPlan.totalPaid,
          remainingAmount: paymentPlan.remainingAmount,
          installmentAmount: paymentPlan.installmentAmount,
          numberOfInstallments: paymentPlan.numberOfInstallments,
          currency: paymentPlan.currency,
          isActive: paymentPlan.isActive,
          pledgeId: paymentPlan.pledgeId,
        })
        .from(paymentPlan);

      console.log(`📊 Found ${planData.length} total payment plans in database`);

      if (planData.length === 0) {
        console.log('No payment plans found in database');
        return issues;
      }

      const activePlans = planData.filter(p => p.isActive === true);
      console.log(`📊 Active payment plans: ${activePlans.length}`);

      if (activePlans.length === 0) {
        console.log('No active payment plans found');
        return issues;
      }

      for (const plan of activePlans) {
        try {
          // Get contact information through pledge
          let contactName = 'Unknown Contact';
          let contactId: number = 0;

          if (plan.pledgeId) {
            const pledgeWithContact = await this.db
              .select({
                contactId: pledge.contactId,
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(pledge)
              .leftJoin(contact, eq(pledge.contactId, contact.id))
              .where(eq(pledge.id, plan.pledgeId))
              .limit(1);

            if (pledgeWithContact.length > 0 && pledgeWithContact[0].contactId !== null) {
              contactId = pledgeWithContact[0].contactId;
              contactName = `${pledgeWithContact[0].firstName || ''} ${pledgeWithContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          // Sum amount_in_plan_currency for multi-currency support
          const paymentSum = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(amount_in_plan_currency), 0)`,
              count: sql<number>`COUNT(*)`,
            })
            .from(payment)
            .where(
              and(
                eq(payment.paymentPlanId, plan.id),
                sql`${payment.paymentStatus} = 'completed'`,
                sql`${payment.receivedDate} IS NOT NULL`,
                sql`${payment.amountInPlanCurrency} IS NOT NULL`
              )
            );

          const actualTotalPaid = paymentSum.length > 0 ? Number(paymentSum[0].total) : 0;
          const expectedRemainingAmount = Number(plan.totalPlannedAmount) - actualTotalPaid;

          if (!this.isAmountEqual(actualTotalPaid, Number(plan.totalPaid))) {
            issues.push({
              id: `plan_total_paid_${plan.id}`,
              type: 'payment_plan_amounts',
              severity: 'critical',
              contactId,
              contactName,
              recordId: plan.id,
              recordType: 'payment_plan',
              description: `Multi-currency plan total paid mismatch. Recorded: ${plan.totalPaid} ${plan.currency}, Actual: ${actualTotalPaid} ${plan.currency}`,
              currentValue: Number(plan.totalPaid),
              expectedValue: actualTotalPaid,
              affectedFields: ['total_paid'],
              fixValue: actualTotalPaid.toFixed(2),
              fixRecordId: plan.id
            });
          }

          if (!this.isAmountEqual(Number(plan.remainingAmount), expectedRemainingAmount)) {
            issues.push({
              id: `plan_remaining_${plan.id}`,
              type: 'payment_plan_amounts',
              severity: 'critical',
              contactId,
              contactName,
              recordId: plan.id,
              recordType: 'payment_plan',
              description: `Multi-currency remaining amount incorrect. Recorded: ${plan.remainingAmount} ${plan.currency}, Expected: ${expectedRemainingAmount} ${plan.currency}`,
              currentValue: Number(plan.remainingAmount),
              expectedValue: expectedRemainingAmount,
              affectedFields: ['remaining_amount'],
              fixValue: expectedRemainingAmount.toFixed(2),
              fixRecordId: plan.id
            });
          }

        } catch (error) {
          console.error(`Error checking payment plan ${plan.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkPaymentPlanIntegrity:', error);
      throw error;
    }

    return issues;
  }

  // Check payment plan USD conversions - ALWAYS use today's rate
  async checkPaymentPlanCurrencyConversions(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL payment plan USD conversions (using TODAY\'S rates via API)...');

    try {
      const planData = await this.db
        .select({
          id: paymentPlan.id,
          totalPlannedAmount: paymentPlan.totalPlannedAmount,
          totalPlannedAmountUsd: paymentPlan.totalPlannedAmountUsd,
          installmentAmount: paymentPlan.installmentAmount,
          installmentAmountUsd: paymentPlan.installmentAmountUsd,
          totalPaid: paymentPlan.totalPaid,
          totalPaidUsd: paymentPlan.totalPaidUsd,
          remainingAmount: paymentPlan.remainingAmount,
          remainingAmountUsd: paymentPlan.remainingAmountUsd,
          currency: paymentPlan.currency,
          exchangeRate: paymentPlan.exchangeRate,
          startDate: paymentPlan.startDate,
          isActive: paymentPlan.isActive,
          pledgeId: paymentPlan.pledgeId,
        })
        .from(paymentPlan);

      console.log(`📊 Found ${planData.length} total payment plans to check USD conversions`);

      for (const planRecord of planData) {
        try {
          let contactName = 'Unknown Contact';
          let contactId: number = 0;

          if (planRecord.pledgeId) {
            const pledgeWithContact = await this.db
              .select({
                contactId: pledge.contactId,
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(pledge)
              .leftJoin(contact, eq(pledge.contactId, contact.id))
              .where(eq(pledge.id, planRecord.pledgeId))
              .limit(1);

            if (pledgeWithContact.length > 0 && pledgeWithContact[0].contactId !== null) {
              contactId = pledgeWithContact[0].contactId;
              contactName = `${pledgeWithContact[0].firstName || ''} ${pledgeWithContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          // FINANCIAL BEST PRACTICE: ALWAYS use today's date for currency conversions
          const today = new Date().toISOString().split('T')[0];
          const originalStartDate = planRecord.startDate;

          if (originalStartDate && originalStartDate > today) {
            console.log(`💡 Plan ${planRecord.id} has future start date (${originalStartDate}), using today's rate (${today}) for USD conversions`);
          }

          console.log(`🔍 Checking payment plan ${planRecord.id}:`);
          console.log(`  - Contact: ${contactName}`);
          console.log(`  - Plan Currency: ${planRecord.currency}`);
          console.log(`  - Original start date: ${originalStartDate}`);
          console.log(`  - Using current rate from: ${today}`);

          // Check USD conversions for non-USD plans using TODAY'S rate
          if (planRecord.currency !== 'USD') {
            try {
              // 1. Check total planned amount USD conversion
              const { convertedAmount: expectedTotalUsd, exchangeRate: planRate } = await this.convertCurrency(
                Number(planRecord.totalPlannedAmount),
                planRecord.currency,
                'USD',
                today // Always use today's date
              );

              const recordedTotalUsd = Number(planRecord.totalPlannedAmountUsd || 0);
              const totalErrorPercentage = expectedTotalUsd > 0
                ? Math.abs((recordedTotalUsd - expectedTotalUsd) / expectedTotalUsd) * 100
                : (recordedTotalUsd > 0 ? 100 : 0);

              console.log(`  - Total Planned USD Check: Expected ${expectedTotalUsd}, Got ${recordedTotalUsd}, Error: ${totalErrorPercentage.toFixed(1)}%`);

              if (totalErrorPercentage > 1 || recordedTotalUsd === 0) {
                issues.push({
                  id: `plan_total_usd_conversion_${planRecord.id}`,
                  type: 'plan_conversion',
                  severity: (totalErrorPercentage > 10 || recordedTotalUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: planRecord.id,
                  recordType: 'payment_plan',
                  description: `Payment plan total planned amount USD conversion incorrect (${totalErrorPercentage.toFixed(1)}% error). Expected: ${expectedTotalUsd}, Got: ${recordedTotalUsd}`,
                  currentValue: recordedTotalUsd,
                  expectedValue: expectedTotalUsd,
                  affectedFields: ['total_planned_amount_usd', 'exchange_rate'],
                  fixValue: `${expectedTotalUsd.toFixed(2)}|${planRate}`,
                  fixRecordId: planRecord.id
                });
              }

              // 2. Check installment amount USD conversion
              const { convertedAmount: expectedInstallmentUsd } = await this.convertCurrency(
                Number(planRecord.installmentAmount),
                planRecord.currency,
                'USD',
                today // Always use today's date
              );

              const recordedInstallmentUsd = Number(planRecord.installmentAmountUsd || 0);
              const installmentErrorPercentage = expectedInstallmentUsd > 0
                ? Math.abs((recordedInstallmentUsd - expectedInstallmentUsd) / expectedInstallmentUsd) * 100
                : (recordedInstallmentUsd > 0 ? 100 : 0);

              console.log(`  - Installment USD Check: Expected ${expectedInstallmentUsd}, Got ${recordedInstallmentUsd}, Error: ${installmentErrorPercentage.toFixed(1)}%`);

              if (installmentErrorPercentage > 1 || recordedInstallmentUsd === 0) {
                issues.push({
                  id: `plan_installment_usd_conversion_${planRecord.id}`,
                  type: 'plan_conversion',
                  severity: (installmentErrorPercentage > 10 || recordedInstallmentUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: planRecord.id,
                  recordType: 'payment_plan',
                  description: `Payment plan installment amount USD conversion incorrect (${installmentErrorPercentage.toFixed(1)}% error). Expected: ${expectedInstallmentUsd}, Got: ${recordedInstallmentUsd}`,
                  currentValue: recordedInstallmentUsd,
                  expectedValue: expectedInstallmentUsd,
                  affectedFields: ['installment_amount_usd'],
                  fixValue: expectedInstallmentUsd.toFixed(2),
                  fixRecordId: planRecord.id
                });
              }

              // 3. Check remaining amount USD conversion
              const { convertedAmount: expectedRemainingUsd } = await this.convertCurrency(
                Number(planRecord.remainingAmount),
                planRecord.currency,
                'USD',
                today // Always use today's date
              );

              const recordedRemainingUsd = Number(planRecord.remainingAmountUsd || 0);
              const remainingErrorPercentage = expectedRemainingUsd > 0
                ? Math.abs((recordedRemainingUsd - expectedRemainingUsd) / expectedRemainingUsd) * 100
                : (recordedRemainingUsd > 0 ? 100 : 0);

              console.log(`  - Remaining USD Check: Expected ${expectedRemainingUsd}, Got ${recordedRemainingUsd}, Error: ${remainingErrorPercentage.toFixed(1)}%`);

              if (remainingErrorPercentage > 1 || recordedRemainingUsd === 0) {
                issues.push({
                  id: `plan_remaining_usd_conversion_${planRecord.id}`,
                  type: 'plan_conversion',
                  severity: (remainingErrorPercentage > 10 || recordedRemainingUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: planRecord.id,
                  recordType: 'payment_plan',
                  description: `Payment plan remaining amount USD conversion incorrect (${remainingErrorPercentage.toFixed(1)}% error). Expected: ${expectedRemainingUsd}, Got: ${recordedRemainingUsd}`,
                  currentValue: recordedRemainingUsd,
                  expectedValue: expectedRemainingUsd,
                  affectedFields: ['remaining_amount_usd'],
                  fixValue: expectedRemainingUsd.toFixed(2),
                  fixRecordId: planRecord.id
                });
              }

            } catch (error) {
              console.warn(`  ❌ Payment plan USD conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

        } catch (error) {
          console.error(`Error checking payment plan ${planRecord.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkPaymentPlanCurrencyConversions:', error);
      throw error;
    }

    return issues;
  }

  // Check installment schedule USD conversions - ALWAYS use today's rate
  async checkInstallmentScheduleCurrencyConversions(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL installment schedule USD conversions (using TODAY\'S rates via API)...');

    try {
      const installmentData = await this.db
        .select({
          id: installmentSchedule.id,
          paymentPlanId: installmentSchedule.paymentPlanId,
          installmentAmount: installmentSchedule.installmentAmount,
          installmentAmountUsd: installmentSchedule.installmentAmountUsd,
          currency: installmentSchedule.currency,
          installmentDate: installmentSchedule.installmentDate,
        })
        .from(installmentSchedule);

      console.log(`📊 Found ${installmentData.length} total installments to check USD conversions`);

      for (const installment of installmentData) {
        try {
          let contactName = 'Unknown Contact';
          let contactId: number = 0;

          // Get contact info through payment plan -> pledge -> contact
          if (installment.paymentPlanId) {
            const planWithContact = await this.db
              .select({
                contactId: pledge.contactId,
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(paymentPlan)
              .leftJoin(pledge, eq(paymentPlan.pledgeId, pledge.id))
              .leftJoin(contact, eq(pledge.contactId, contact.id))
              .where(eq(paymentPlan.id, installment.paymentPlanId))
              .limit(1);

            if (planWithContact.length > 0 && planWithContact[0].contactId !== null) {
              contactId = planWithContact[0].contactId;
              contactName = `${planWithContact[0].firstName || ''} ${planWithContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          // FINANCIAL BEST PRACTICE: ALWAYS use today's date for currency conversions
          const today = new Date().toISOString().split('T')[0];
          const originalInstallmentDate = installment.installmentDate;

          if (originalInstallmentDate && originalInstallmentDate > today) {
            console.log(`💡 Installment ${installment.id} has future date (${originalInstallmentDate}), using today's rate (${today}) for USD conversion`);
          }

          // Check USD conversions for non-USD installments using TODAY'S rate
          if (installment.currency !== 'USD') {
            try {
              const { convertedAmount: expectedInstallmentUsd } = await this.convertCurrency(
                Number(installment.installmentAmount),
                installment.currency,
                'USD',
                today // Always use today's date
              );

              const recordedInstallmentUsd = Number(installment.installmentAmountUsd || 0);
              const errorPercentage = expectedInstallmentUsd > 0
                ? Math.abs((recordedInstallmentUsd - expectedInstallmentUsd) / expectedInstallmentUsd) * 100
                : (recordedInstallmentUsd > 0 ? 100 : 0);

              if (errorPercentage > 1 || recordedInstallmentUsd === 0) {
                issues.push({
                  id: `installment_usd_conversion_${installment.id}`,
                  type: 'installment_conversion',
                  severity: (errorPercentage > 10 || recordedInstallmentUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: installment.id,
                  recordType: 'installment_schedule',
                  description: `Installment USD conversion incorrect (${errorPercentage.toFixed(1)}% error). Expected: ${expectedInstallmentUsd}, Got: ${recordedInstallmentUsd}`,
                  currentValue: recordedInstallmentUsd,
                  expectedValue: expectedInstallmentUsd,
                  affectedFields: ['installment_amount_usd'],
                  fixValue: expectedInstallmentUsd.toFixed(2),
                  fixRecordId: installment.id
                });
              }

            } catch (error) {
              console.warn(`  ❌ Installment USD conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

        } catch (error) {
          console.error(`Error checking installment ${installment.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkInstallmentScheduleCurrencyConversions:', error);
      throw error;
    }

    return issues;
  }

  // Check third-party payment currency conversions
  async checkThirdPartyPaymentConversions(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL third-party payment currency conversions...');

    try {
      const thirdPartyPayments = await this.db
        .select({
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          amountUsd: payment.amountUsd,
          exchangeRate: payment.exchangeRate,
          payerContactId: payment.payerContactId,
          isThirdPartyPayment: payment.isThirdPartyPayment,
          pledgeId: payment.pledgeId,
          receivedDate: payment.receivedDate,
          paymentStatus: payment.paymentStatus,
        })
        .from(payment)
        .where(
          and(
            sql`${payment.isThirdPartyPayment} = true`,
            sql`${payment.paymentStatus} = 'completed'`,
            sql`${payment.payerContactId} IS NOT NULL`
          )
        );

      console.log(`📊 Found ${thirdPartyPayments.length} third-party payments to check`);

      for (const paymentRecord of thirdPartyPayments) {
        try {
          let contactName = 'Unknown Contact';
          let contactId: number = 0;

          // Get payer contact info
          if (paymentRecord.payerContactId !== null) {
            const payerContact = await this.db
              .select({
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(contact)
              .where(eq(contact.id, paymentRecord.payerContactId))
              .limit(1);

            if (payerContact.length > 0) {
              contactId = paymentRecord.payerContactId;
              contactName = `${payerContact[0].firstName || ''} ${payerContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          const conversionDate = this.getConversionDate(paymentRecord);

          console.log(`🔍 Checking payment ${paymentRecord.id}:`);
          console.log(`  - Contact: ${contactName}`);
          console.log(`  - Payment: ${paymentRecord.amount} ${paymentRecord.currency}`);
          console.log(`  - Conversion date: ${conversionDate} (from ${paymentRecord.receivedDate ? 'received_date' : 'today'})`);

          // Check USD conversion for non-USD third-party payments
          if (paymentRecord.currency !== 'USD') {
            try {
              const { convertedAmount: expectedAmountUsd, exchangeRate: usdRate } = await this.convertCurrency(
                Number(paymentRecord.amount),
                paymentRecord.currency,
                'USD',
                conversionDate
              );

              const recordedUsd = Number(paymentRecord.amountUsd || 0);
              const errorPercentage = expectedAmountUsd > 0
                ? Math.abs((recordedUsd - expectedAmountUsd) / expectedAmountUsd) * 100
                : (recordedUsd > 0 ? 100 : 0);

              console.log(`  - Third-party USD Check: Expected ${expectedAmountUsd}, Got ${recordedUsd}, Error: ${errorPercentage.toFixed(1)}%`);

              if (errorPercentage > 1 || recordedUsd === 0) {
                issues.push({
                  id: `third_party_usd_conversion_${paymentRecord.id}`,
                  type: 'third_party_conversion',
                  severity: (errorPercentage > 10 || recordedUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: paymentRecord.id,
                  recordType: 'payment',
                  description: `Third-party payment USD conversion incorrect (${errorPercentage.toFixed(1)}% error). Payer: ${contactName}, Expected: ${expectedAmountUsd}, Got: ${recordedUsd}`,
                  currentValue: recordedUsd,
                  expectedValue: expectedAmountUsd,
                  affectedFields: ['amount_usd', 'exchange_rate'],
                  fixValue: `${expectedAmountUsd.toFixed(2)}|${usdRate}`,
                  fixRecordId: paymentRecord.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ Third-party USD conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

        } catch (error) {
          console.error(`Error checking third-party payment ${paymentRecord.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkThirdPartyPaymentConversions:', error);
      throw error;
    }

    return issues;
  }

  // Check payment allocation currency conversions
  async checkPaymentAllocationConversions(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL payment allocation currency conversions...');

    try {
      const allocations = await this.db
        .select({
          id: paymentAllocations.id,
          paymentId: paymentAllocations.paymentId,
          pledgeId: paymentAllocations.pledgeId,
          allocatedAmount: paymentAllocations.allocatedAmount,
          currency: paymentAllocations.currency,
          allocatedAmountUsd: paymentAllocations.allocatedAmountUsd,
          allocatedAmountInPledgeCurrency: paymentAllocations.allocatedAmountInPledgeCurrency,
          payerContactId: paymentAllocations.payerContactId,
        })
        .from(paymentAllocations);

      console.log(`📊 Found ${allocations.length} payment allocations to check`);

      for (const allocation of allocations) {
        try {
          let contactName = 'Unknown Contact';
          let contactId: number = 0;
          let pledgeCurrency = 'USD';

          // Get contact and pledge info
          if (allocation.pledgeId !== null) {
            const pledgeWithContact = await this.db
              .select({
                contactId: pledge.contactId,
                currency: pledge.currency,
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(pledge)
              .leftJoin(contact, eq(pledge.contactId, contact.id))
              .where(eq(pledge.id, allocation.pledgeId))
              .limit(1);

            if (pledgeWithContact.length > 0 && pledgeWithContact[0].contactId !== null) {
              contactId = pledgeWithContact[0].contactId;
              pledgeCurrency = pledgeWithContact[0].currency || 'USD';
              contactName = `${pledgeWithContact[0].firstName || ''} ${pledgeWithContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          // Get payment date for conversion
          let conversionDate = new Date().toISOString().split('T')[0];
          if (allocation.paymentId !== null) {
            const paymentInfo = await this.db
              .select({
                receivedDate: payment.receivedDate,
                paymentDate: payment.paymentDate,
              })
              .from(payment)
              .where(eq(payment.id, allocation.paymentId))
              .limit(1);

            if (paymentInfo.length > 0) {
              conversionDate = this.getConversionDate(paymentInfo[0]);
            }
          }

          console.log(`🔍 Checking allocation ${allocation.id}:`);
          console.log(`  - Contact: ${contactName}`);
          console.log(`  - Allocation: ${allocation.allocatedAmount} ${allocation.currency}`);
          console.log(`  - Pledge Currency: ${pledgeCurrency}`);

          // 1. Check USD conversion for allocations
          if (allocation.currency !== 'USD') {
            try {
              const { convertedAmount: expectedAllocatedUsd } = await this.convertCurrency(
                Number(allocation.allocatedAmount),
                allocation.currency,
                'USD',
                conversionDate
              );

              const recordedAllocatedUsd = Number(allocation.allocatedAmountUsd || 0);
              const errorPercentage = expectedAllocatedUsd > 0
                ? Math.abs((recordedAllocatedUsd - expectedAllocatedUsd) / expectedAllocatedUsd) * 100
                : (recordedAllocatedUsd > 0 ? 100 : 0);

              if (errorPercentage > 1 || recordedAllocatedUsd === 0) {
                issues.push({
                  id: `allocation_usd_conversion_${allocation.id}`,
                  type: 'allocation_conversion',
                  severity: (errorPercentage > 10 || recordedAllocatedUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: allocation.id,
                  recordType: 'payment_allocation',
                  description: `Payment allocation USD conversion incorrect (${errorPercentage.toFixed(1)}% error). Expected: ${expectedAllocatedUsd}, Got: ${recordedAllocatedUsd}`,
                  currentValue: recordedAllocatedUsd,
                  expectedValue: expectedAllocatedUsd,
                  affectedFields: ['allocated_amount_usd'],
                  fixValue: expectedAllocatedUsd.toFixed(2),
                  fixRecordId: allocation.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ Allocation USD conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          // 2. Check pledge currency conversion for allocations
          if (allocation.currency !== pledgeCurrency) {
            try {
              const { convertedAmount: expectedPledgeAmount } = await this.convertCurrency(
                Number(allocation.allocatedAmount),
                allocation.currency,
                pledgeCurrency,
                conversionDate
              );

              const recordedPledgeAmount = Number(allocation.allocatedAmountInPledgeCurrency || 0);
              const errorPercentage = expectedPledgeAmount > 0
                ? Math.abs((recordedPledgeAmount - expectedPledgeAmount) / expectedPledgeAmount) * 100
                : (recordedPledgeAmount > 0 ? 100 : 0);

              if (errorPercentage > 1 || recordedPledgeAmount === 0) {
                issues.push({
                  id: `allocation_pledge_conversion_${allocation.id}`,
                  type: 'allocation_conversion',
                  severity: (errorPercentage > 10 || recordedPledgeAmount === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: allocation.id,
                  recordType: 'payment_allocation',
                  description: `Payment allocation pledge currency conversion incorrect (${errorPercentage.toFixed(1)}% error). Expected: ${expectedPledgeAmount} ${pledgeCurrency}, Got: ${recordedPledgeAmount} ${pledgeCurrency}`,
                  currentValue: recordedPledgeAmount,
                  expectedValue: expectedPledgeAmount,
                  affectedFields: ['allocated_amount_in_pledge_currency'],
                  fixValue: expectedPledgeAmount.toFixed(2),
                  fixRecordId: allocation.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ Allocation pledge currency conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

        } catch (error) {
          console.error(`Error checking allocation ${allocation.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkPaymentAllocationConversions:', error);
      throw error;
    }

    return issues;
  }

  // Validate third-party payment allocation totals
  async validateThirdPartyPaymentIntegrity(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Validating third-party payment allocation integrity...');

    try {
      const thirdPartyPayments = await this.db
        .select({
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          payerContactId: payment.payerContactId,
          isThirdPartyPayment: payment.isThirdPartyPayment,
        })
        .from(payment)
        .where(
          and(
            sql`${payment.isThirdPartyPayment} = true`,
            sql`${payment.paymentStatus} = 'completed'`
          )
        );

      for (const paymentRecord of thirdPartyPayments) {
        try {
          // Sum allocations for this payment
          const allocationSum = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(allocated_amount), 0)`,
              count: sql<number>`COUNT(*)`,
            })
            .from(paymentAllocations)
            .where(
              and(
                eq(paymentAllocations.paymentId, paymentRecord.id),
                eq(paymentAllocations.currency, paymentRecord.currency)
              )
            );

          const totalAllocated = allocationSum.length > 0 ? Number(allocationSum[0].total) : 0;
          const paymentAmount = Number(paymentRecord.amount);
          const allocationCount = allocationSum.length > 0 ? Number(allocationSum[0].count) : 0;

          if (!this.isAmountEqual(totalAllocated, paymentAmount)) {
            let contactName = 'Unknown Contact';
            let contactId: number = 0;

            if (paymentRecord.payerContactId !== null) {
              const payerContact = await this.db
                .select({
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                })
                .from(contact)
                .where(eq(contact.id, paymentRecord.payerContactId))
                .limit(1);

              if (payerContact.length > 0) {
                contactId = paymentRecord.payerContactId;
                contactName = `${payerContact[0].firstName || ''} ${payerContact[0].lastName || ''}`.trim() || 'Unknown Contact';
              }
            }

            issues.push({
              id: `third_party_allocation_mismatch_${paymentRecord.id}`,
              type: 'payment_plan_amounts',
              severity: 'critical',
              contactId,
              contactName,
              recordId: paymentRecord.id,
              recordType: 'payment',
              description: `Third-party payment allocation mismatch. Payment: ${paymentAmount} ${paymentRecord.currency}, Allocated: ${totalAllocated} ${paymentRecord.currency}, Allocations: ${allocationCount}`,
              currentValue: totalAllocated,
              expectedValue: paymentAmount,
              affectedFields: ['allocations_total'],
              fixValue: paymentAmount.toFixed(2),
              fixRecordId: paymentRecord.id
            });
          }

        } catch (error) {
          console.error(`Error validating third-party payment ${paymentRecord.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in validateThirdPartyPaymentIntegrity:', error);
      throw error;
    }

    return issues;
  }

  async checkPaymentConversions(): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    console.log('🔍 Checking ALL payment conversions (multi-currency support)...');

    try {
      const paymentData = await this.db
        .select({
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          amountUsd: payment.amountUsd,
          amountInPledgeCurrency: payment.amountInPledgeCurrency,
          amountInPlanCurrency: payment.amountInPlanCurrency,
          paymentDate: payment.paymentDate,
          receivedDate: payment.receivedDate,
          paymentStatus: payment.paymentStatus,
          pledgeId: payment.pledgeId,
          paymentPlanId: payment.paymentPlanId,
          exchangeRate: payment.exchangeRate,
          pledgeCurrencyExchangeRate: payment.pledgeCurrencyExchangeRate,
          planCurrencyExchangeRate: payment.planCurrencyExchangeRate,
        })
        .from(payment);

      console.log(`📊 Found ${paymentData.length} total payments to check`);

      for (const paymentRecord of paymentData) {
        try {
          let pledgeCurrency = null;
          let planCurrency = null;
          let contactName = 'Unknown Contact';
          let contactId: number = 0;

          // Get pledge currency and contact info
          if (paymentRecord.pledgeId) {
            const pledgeWithContact = await this.db
              .select({
                contactId: pledge.contactId,
                currency: pledge.currency,
                firstName: contact.firstName,
                lastName: contact.lastName,
              })
              .from(pledge)
              .leftJoin(contact, eq(pledge.contactId, contact.id))
              .where(eq(pledge.id, paymentRecord.pledgeId))
              .limit(1);

            if (pledgeWithContact.length > 0 && pledgeWithContact[0].contactId !== null) {
              contactId = pledgeWithContact[0].contactId;
              pledgeCurrency = pledgeWithContact[0].currency;
              contactName = `${pledgeWithContact[0].firstName || ''} ${pledgeWithContact[0].lastName || ''}`.trim() || 'Unknown Contact';
            }
          }

          // Get plan currency
          if (paymentRecord.paymentPlanId) {
            const planData = await this.db
              .select({ currency: paymentPlan.currency })
              .from(paymentPlan)
              .where(eq(paymentPlan.id, paymentRecord.paymentPlanId))
              .limit(1);

            if (planData.length > 0) {
              planCurrency = planData[0].currency;
            }
          }

          // Use received_date or today's date for conversion (never future dates)
          const conversionDate = this.getConversionDate(paymentRecord);

          console.log(`🔍 Checking payment ${paymentRecord.id}:`);
          console.log(`  - Contact: ${contactName}`);
          console.log(`  - Payment: ${paymentRecord.amount} ${paymentRecord.currency}`);
          console.log(`  - Conversion date: ${conversionDate}`);
          console.log(`  - Pledge Currency: ${pledgeCurrency || 'N/A'}`);
          console.log(`  - Plan Currency: ${planCurrency || 'N/A'}`);

          // 1. Check USD conversion (for non-USD payments)
          if (paymentRecord.currency !== 'USD') {
            try {
              const { convertedAmount: expectedAmountUsd, exchangeRate: usdRate } = await this.convertCurrency(
                Number(paymentRecord.amount),
                paymentRecord.currency,
                'USD',
                conversionDate
              );

              const recordedUsd = Number(paymentRecord.amountUsd || 0);
              const errorPercentage = expectedAmountUsd > 0
                ? Math.abs((recordedUsd - expectedAmountUsd) / expectedAmountUsd) * 100
                : (recordedUsd > 0 ? 100 : 0);

              console.log(`  - USD Check: Expected ${expectedAmountUsd}, Got ${recordedUsd}, Error: ${errorPercentage.toFixed(1)}%`);

              if (errorPercentage > 1 || recordedUsd === 0) {
                issues.push({
                  id: `payment_usd_conversion_${paymentRecord.id}`,
                  type: 'payment_conversion',
                  severity: (errorPercentage > 10 || recordedUsd === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: paymentRecord.id,
                  recordType: 'payment',
                  description: `USD conversion incorrect (${errorPercentage.toFixed(1)}% error). ${paymentRecord.amount} ${paymentRecord.currency} → Expected: ${expectedAmountUsd}, Got: ${recordedUsd}`,
                  currentValue: recordedUsd,
                  expectedValue: expectedAmountUsd,
                  affectedFields: ['amount_usd', 'exchange_rate'],
                  fixValue: `${expectedAmountUsd.toFixed(2)}|${usdRate}`,
                  fixRecordId: paymentRecord.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ USD conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          // 2. Check pledge currency conversion
          if (pledgeCurrency) {
            try {
              const { convertedAmount: expectedPledgeAmount, exchangeRate: pledgeRate } = await this.convertCurrency(
                Number(paymentRecord.amount),
                paymentRecord.currency,
                pledgeCurrency,
                conversionDate
              );

              const recordedPledgeAmount = Number(paymentRecord.amountInPledgeCurrency || 0);
              const errorPercentage = expectedPledgeAmount > 0
                ? Math.abs((recordedPledgeAmount - expectedPledgeAmount) / expectedPledgeAmount) * 100
                : (recordedPledgeAmount > 0 ? 100 : 0);

              console.log(`  - Pledge Currency Check: Expected ${expectedPledgeAmount} ${pledgeCurrency}, Got ${recordedPledgeAmount} ${pledgeCurrency}, Error: ${errorPercentage.toFixed(1)}%`);

              if (recordedPledgeAmount === 0 || errorPercentage > 1) {
                issues.push({
                  id: `payment_pledge_conversion_${paymentRecord.id}`,
                  type: 'payment_conversion',
                  severity: (errorPercentage > 10 || recordedPledgeAmount === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: paymentRecord.id,
                  recordType: 'payment',
                  description: `Pledge currency conversion incorrect (${errorPercentage.toFixed(1)}% error). Expected: ${expectedPledgeAmount} ${pledgeCurrency}, Got: ${recordedPledgeAmount} ${pledgeCurrency}`,
                  currentValue: recordedPledgeAmount,
                  expectedValue: expectedPledgeAmount,
                  affectedFields: ['amount_in_pledge_currency', 'pledge_currency_exchange_rate'],
                  fixValue: `${expectedPledgeAmount.toFixed(2)}|${pledgeRate}`,
                  fixRecordId: paymentRecord.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ Pledge currency conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          // 3. Check plan currency conversion
          if (planCurrency) {
            try {
              const { convertedAmount: expectedPlanAmount, exchangeRate: planRate } = await this.convertCurrency(
                Number(paymentRecord.amount),
                paymentRecord.currency,
                planCurrency,
                conversionDate
              );

              const recordedPlanAmount = Number(paymentRecord.amountInPlanCurrency || 0);
              const errorPercentage = expectedPlanAmount > 0
                ? Math.abs((recordedPlanAmount - expectedPlanAmount) / expectedPlanAmount) * 100
                : (recordedPlanAmount > 0 ? 100 : 0);

              console.log(`  - Plan Currency Check: Expected ${expectedPlanAmount} ${planCurrency}, Got ${recordedPlanAmount} ${planCurrency}, Error: ${errorPercentage.toFixed(1)}%`);

              if (recordedPlanAmount === 0 || errorPercentage > 1) {
                issues.push({
                  id: `payment_plan_conversion_${paymentRecord.id}`,
                  type: 'payment_conversion',
                  severity: (errorPercentage > 10 || recordedPlanAmount === 0) ? 'critical' : 'warning',
                  contactId,
                  contactName,
                  recordId: paymentRecord.id,
                  recordType: 'payment',
                  description: `Plan currency conversion incorrect (${errorPercentage.toFixed(1)}% error). Expected: ${expectedPlanAmount} ${planCurrency}, Got: ${recordedPlanAmount} ${planCurrency}`,
                  currentValue: recordedPlanAmount,
                  expectedValue: expectedPlanAmount,
                  affectedFields: ['amount_in_plan_currency', 'plan_currency_exchange_rate'],
                  fixValue: `${expectedPlanAmount.toFixed(2)}|${planRate}`,
                  fixRecordId: paymentRecord.id
                });
              }
            } catch (error) {
              console.warn(`  ❌ Plan currency conversion failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

        } catch (error) {
          console.error(`Error checking payment ${paymentRecord.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in checkPaymentConversions:', error);
      throw error;
    }

    return issues;
  }

  async fixPledgeTotalsAfterPaymentCorrections(): Promise<void> {
    console.log('\n🔄 Recalculating pledge totals after multi-currency payment corrections...');

    try {
      const pledgesWithPayments = await this.db
        .selectDistinct({
          pledgeId: payment.pledgeId,
        })
        .from(payment)
        .where(
          and(
            sql`${payment.pledgeId} IS NOT NULL`,
            sql`${payment.paymentStatus} = 'completed'`,
            sql`${payment.receivedDate} IS NOT NULL`,
            sql`${payment.amountInPledgeCurrency} IS NOT NULL`
          )
        );

      console.log(`Found ${pledgesWithPayments.length} pledges with completed payments to recalculate`);

      for (const pledgeRow of pledgesWithPayments) {
        const pledgeId = pledgeRow.pledgeId;

        if (!pledgeId || isNaN(Number(pledgeId))) {
          console.warn(`Skipping invalid pledge ID: ${pledgeId}`);
          continue;
        }

        try {
          console.log(`🔄 Recalculating multi-currency totals for pledge ${pledgeId}...`);

          const paymentSum = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(amount_in_pledge_currency), 0)`,
              count: sql<number>`COUNT(*)`,
            })
            .from(payment)
            .where(
              and(
                eq(payment.pledgeId, pledgeId),
                sql`${payment.paymentStatus} = 'completed'`,
                sql`${payment.receivedDate} IS NOT NULL`,
                sql`${payment.amountInPledgeCurrency} IS NOT NULL`
              )
            );

          const pledgeData = await this.db
            .select({
              originalAmount: pledge.originalAmount,
              currentTotalPaid: pledge.totalPaid,
              currentBalance: pledge.balance,
              currency: pledge.currency,
            })
            .from(pledge)
            .where(eq(pledge.id, pledgeId))
            .limit(1);

          if (pledgeData.length > 0 && paymentSum.length > 0) {
            const actualTotalPaid = Number(paymentSum[0].total) || 0;
            const paymentCount = Number(paymentSum[0].count) || 0;
            const originalAmount = Number(pledgeData[0].originalAmount) || 0;
            const correctBalance = originalAmount - actualTotalPaid;

            const currentTotalPaid = Number(pledgeData[0].currentTotalPaid) || 0;
            const currentBalance = Number(pledgeData[0].currentBalance) || 0;

            const needsUpdate = !this.isAmountEqual(currentTotalPaid, actualTotalPaid) ||
              !this.isAmountEqual(currentBalance, correctBalance);

            if (needsUpdate) {
              await this.db.update(pledge)
                .set({
                  totalPaid: actualTotalPaid.toFixed(2),
                  balance: correctBalance.toFixed(2),
                  updatedAt: new Date()
                })
                .where(eq(pledge.id, pledgeId));

              console.log(`  ✅ Updated pledge ${pledgeId}: paid=${actualTotalPaid.toFixed(2)}, balance=${correctBalance.toFixed(2)}`);
            } else {
              console.log(`  ✅ Pledge ${pledgeId} already correct, no update needed`);
            }
          }
        } catch (error) {
          console.error(`❌ Failed to update pledge ${pledgeId}:`, error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      console.error('❌ Error in fixPledgeTotalsAfterPaymentCorrections:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async runCompleteCheck(): Promise<{ summary: CheckSummary; issues: IntegrityIssue[] }> {
    console.log('CONSISTENT API Multi-Currency Integrity Service - Starting Complete Check');
    console.log('🔗 USES SAME API as your form (/api/exchange-rates) for consistency');
    console.log('💰 ALWAYS USES CURRENT RATES for future calculations (Financial Standard)');
    console.log('📅 Never requests future dates from APIs - prevents all future date errors');
    console.log('💡 Updates ALL currency conversion fields: payments, plans, installments, third-party');
    console.log('========================================================================\n');

    const connected = await this.checkDatabaseConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    const { exists, missing } = await this.checkTablesExist();
    if (!exists) {
      throw new Error(`Required tables missing: ${missing.join(', ')}`);
    }

    const allIssues: IntegrityIssue[] = [];

    try {
      const pledgeIssues = await this.checkPledgeBalances();
      allIssues.push(...pledgeIssues);

      const planIssues = await this.checkPaymentPlanIntegrity();
      allIssues.push(...planIssues);

      const paymentIssues = await this.checkPaymentConversions();
      allIssues.push(...paymentIssues);

      const planConversionIssues = await this.checkPaymentPlanCurrencyConversions();
      allIssues.push(...planConversionIssues);

      const installmentConversionIssues = await this.checkInstallmentScheduleCurrencyConversions();
      allIssues.push(...installmentConversionIssues);

      // Third-party payment checks
      const thirdPartyIssues = await this.checkThirdPartyPaymentConversions();
      allIssues.push(...thirdPartyIssues);

      const allocationIssues = await this.checkPaymentAllocationConversions();
      allIssues.push(...allocationIssues);

      const integrityIssues = await this.validateThirdPartyPaymentIntegrity();
      allIssues.push(...integrityIssues);

    } catch (error) {
      console.error('Error during integrity check:', error);
      throw error;
    }

    const criticalIssues = allIssues.filter(i => i.severity === 'critical').length;
    const warningIssues = allIssues.filter(i => i.severity === 'warning').length;
    const affectedContacts = new Set(allIssues.map(i => i.contactId)).size;

    const summary: CheckSummary = {
      totalIssues: allIssues.length,
      criticalIssues,
      warningIssues,
      affectedContacts,
      timestamp: new Date().toISOString()
    };

    return { summary, issues: allIssues };
  }

  async applyFixes(issuesToFix: IntegrityIssue[]): Promise<{ fixed: number; failed: number; errors: string[] }> {
    console.log(`\nApplying precision multi-currency fixes for ${issuesToFix.length} issues...`);

    let fixed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const issue of issuesToFix) {
      try {
        if (issue.recordType === 'payment') {
          if (issue.affectedFields.includes('amount_usd') || issue.affectedFields.includes('exchange_rate')) {
            const [amountUsd, exchangeRate] = issue.fixValue.split('|');
            await this.db.update(payment)
              .set({
                amountUsd: amountUsd,
                exchangeRate: exchangeRate,
                updatedAt: new Date()
              })
              .where(eq(payment.id, issue.fixRecordId));
          }

          if (issue.affectedFields.includes('amount_in_pledge_currency') || issue.affectedFields.includes('pledge_currency_exchange_rate')) {
            const [pledgeAmount, pledgeRate] = issue.fixValue.split('|');
            await this.db.update(payment)
              .set({
                amountInPledgeCurrency: pledgeAmount,
                pledgeCurrencyExchangeRate: pledgeRate,
                updatedAt: new Date()
              })
              .where(eq(payment.id, issue.fixRecordId));
          }

          if (issue.affectedFields.includes('amount_in_plan_currency') || issue.affectedFields.includes('plan_currency_exchange_rate')) {
            const [planAmount, planRate] = issue.fixValue.split('|');
            await this.db.update(payment)
              .set({
                amountInPlanCurrency: planAmount,
                planCurrencyExchangeRate: planRate,
                updatedAt: new Date()
              })
              .where(eq(payment.id, issue.fixRecordId));
          }
        }
        else if (issue.recordType === 'payment_plan') {
          if (issue.affectedFields.includes('total_paid')) {
            await this.db.update(paymentPlan)
              .set({
                totalPaid: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentPlan.id, issue.fixRecordId));
          }
          if (issue.affectedFields.includes('remaining_amount')) {
            await this.db.update(paymentPlan)
              .set({
                remainingAmount: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentPlan.id, issue.fixRecordId));
          }
          // Fix payment plan USD conversions
          if (issue.affectedFields.includes('total_planned_amount_usd') || issue.affectedFields.includes('exchange_rate')) {
            const [totalUsd, exchangeRate] = issue.fixValue.split('|');
            await this.db.update(paymentPlan)
              .set({
                totalPlannedAmountUsd: totalUsd,
                exchangeRate: exchangeRate,
                updatedAt: new Date()
              })
              .where(eq(paymentPlan.id, issue.fixRecordId));
          }
          if (issue.affectedFields.includes('installment_amount_usd')) {
            await this.db.update(paymentPlan)
              .set({
                installmentAmountUsd: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentPlan.id, issue.fixRecordId));
          }
          if (issue.affectedFields.includes('remaining_amount_usd')) {
            await this.db.update(paymentPlan)
              .set({
                remainingAmountUsd: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentPlan.id, issue.fixRecordId));
          }
        }
        else if (issue.recordType === 'installment_schedule') {
          if (issue.affectedFields.includes('installment_amount_usd')) {
            await this.db.update(installmentSchedule)
              .set({
                installmentAmountUsd: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(installmentSchedule.id, issue.fixRecordId));
          }
        }
        // Fix payment allocation issues
        else if (issue.recordType === 'payment_allocation') {
          if (issue.affectedFields.includes('allocated_amount_usd')) {
            await this.db.update(paymentAllocations)
              .set({
                allocatedAmountUsd: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentAllocations.id, issue.fixRecordId));
          }
          if (issue.affectedFields.includes('allocated_amount_in_pledge_currency')) {
            await this.db.update(paymentAllocations)
              .set({
                allocatedAmountInPledgeCurrency: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(paymentAllocations.id, issue.fixRecordId));
          }
        }
        else if (issue.recordType === 'pledge') {
          if (issue.affectedFields.includes('total_paid')) {
            await this.db.update(pledge)
              .set({
                totalPaid: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(pledge.id, issue.fixRecordId));
          }
          if (issue.affectedFields.includes('balance')) {
            await this.db.update(pledge)
              .set({
                balance: issue.fixValue,
                updatedAt: new Date()
              })
              .where(eq(pledge.id, issue.fixRecordId));
          }
        }

        fixed++;
        console.log(`✅ Fixed: ${issue.recordType} ${issue.recordId}`);

      } catch (error) {
        failed++;
        const errorMsg = `❌ Failed to fix ${issue.recordType} ${issue.fixRecordId}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { fixed, failed, errors };
  }

  displaySummary(summary: CheckSummary): void {
    console.log('\n📊 CONSISTENT API CURRENCY CONVERSION SUMMARY');
    console.log('==============================================');
    console.log(`🕒 Date: ${new Date(summary.timestamp).toLocaleString()}`);
    console.log(`📋 Issues: ${summary.totalIssues} (Critical: ${summary.criticalIssues}, Warnings: ${summary.warningIssues})`);
    console.log(`👥 Affected Contacts: ${summary.affectedContacts}`);
    console.log(`🔗 Using same API as your forms for consistency`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  const service = new CurrencyIntegrityService();

  try {
    switch (command) {
      case 'add-rate':
        const [fromCurr, toCurr, rate, dateStr] = args.slice(1);
        if (!fromCurr || !toCurr || !rate || !dateStr) {
          console.log('Usage: add-rate FROM_CURRENCY TO_CURRENCY RATE DATE');
          console.log('Example: add-rate USD ILS 3.3891 2025-08-26');
          return;
        }

        await service.storeRateInDatabase(fromCurr, toCurr, parseFloat(rate), dateStr);
        console.log(`✅ Added precise rate: ${fromCurr}/${toCurr} = ${rate} on ${dateStr}`);
        break;

      case 'check':
        console.log('🔗 Running CONSISTENT API multi-currency integrity check...');
        console.log('🌐 Uses the SAME API endpoint as your form (/api/exchange-rates)');
        console.log('💰 ALWAYS USES CURRENT RATES for future calculations (Financial Standard)');
        console.log('📅 Never requests future dates from APIs - prevents all future date errors');
        console.log('💡 Updates ALL currency conversion fields: payments, plans, installments, third-party');
        console.log('💯 100% consistency with your application\'s exchange rate logic\n');

        const { summary, issues } = await service.runCompleteCheck();
        service.displaySummary(summary);

        if (issues.length === 0) {
          console.log('\n✅ No currency conversion issues found!');
          return;
        }

        const criticalIssues = issues.filter(i => i.severity === 'critical');
        if (criticalIssues.length > 0) {
          console.log('\n🔧 Auto-fixing critical currency conversion issues...');
          const result = await service.applyFixes(criticalIssues);
          console.log(`\n✅ Fixed: ${result.fixed}, ❌ Failed: ${result.failed}`);

          if (result.fixed > 0) {
            await service.fixPledgeTotalsAfterPaymentCorrections();
          }
        }
        break;

      case 'fix-conversions':
        console.log('🔧 Running CONSISTENT API currency conversion fixes...');
        console.log('🌐 Uses the SAME API endpoint as your form for maximum consistency');
        console.log('💰 Uses current rates for historical rates, today\'s rate for future dates');
        console.log('💡 Updates payments, payment plans, installments, and third-party payments');
        console.log('🔗 GUARANTEED consistency with your application\'s rate logic!\n');

        const checkResult = await service.runCompleteCheck();
        const conversionIssues = checkResult.issues.filter(i =>
          i.type === 'payment_conversion' ||
          i.type === 'plan_conversion' ||
          i.type === 'installment_conversion' ||
          i.type === 'third_party_conversion' ||
          i.type === 'allocation_conversion'
        );

        if (conversionIssues.length > 0) {
          const result = await service.applyFixes(conversionIssues);
          console.log(`\n✅ Fixed: ${result.fixed}, ❌ Failed: ${result.failed}`);

          if (result.fixed > 0) {
            await service.fixPledgeTotalsAfterPaymentCorrections();
          }
        } else {
          console.log('✅ No currency conversion issues found');
        }
        break;

      default:
        console.log(`
🔗 CONSISTENT API Multi-Currency Integrity Service
==================================================

✅ NO EXTERNAL DEPENDENCIES REQUIRED!
• Uses built-in Node.js HTTP/HTTPS modules
• Calls your /api/exchange-rates endpoint (same as useExchangeRates)
• Uses identical rate calculation logic as your forms
• Eliminates discrepancies between form and integrity checker
• No more "why are rates different?" issues

🔧 Complete Coverage:
• NEVER requests future dates from APIs (prevents all future date errors)
• Uses received_date when available, today's rate for future calculations
• Updates ALL currency conversion fields:
  - Payment conversions (USD, pledge currency, plan currency)
  - Payment plan USD conversions (total, installments, remaining)
  - Installment schedule USD conversions
  - Third-party payment conversions  
  - Payment allocation conversions
• Financial best practice: current rates for future calculations

Commands:
  add-rate FROM TO RATE DATE    Add precise exchange rate manually
                               Example: add-rate USD ILS 3.3891 2025-08-26
  check                        Run full check and auto-fix critical issues  
  fix-conversions             Focus on currency conversion fixes only

🎯 Perfect CongetConversionDatesistency: Your forms and integrity checker now use 
the EXACT SAME exchange rate API and logic - no more discrepancies!
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
