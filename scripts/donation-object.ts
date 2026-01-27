// scripts/send-to-webhook.ts
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CSV_PATH = './data/for Benchmark upload.csv';
const WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/4Nzcp3vUgVbOoN9uxu5F/webhook-trigger/bec4816f-c48b-4612-9d7a-2cb881bf3808';
const DELAY_MS = 1000; // Delay between requests (1 second)
const OUTPUT_DIR = './data/webhook-logs';

interface WebhookResult {
  row: any;
  index: number;
  status: 'success' | 'failed';
  statusCode?: number;
  message?: string;
  error?: string;
}

// Parse CSV file
function parseCSV(filePath: string): any[] {
  console.log(`📂 Reading CSV: ${path.resolve(filePath)}`);
  
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors.length > 0) {
    console.error('❌ CSV Parse Error:', parsed.errors[0]);
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data;
}

// Send data to webhook
async function sendToWebhook(data: any, index: number): Promise<WebhookResult> {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const statusCode = response.status;
    const isSuccess = response.ok;

    let responseText = '';
    try {
      responseText = await response.text();
    } catch (e) {
      // Ignore if we can't read response
    }

    return {
      row: data,
      index,
      status: isSuccess ? 'success' : 'failed',
      statusCode,
      message: isSuccess ? 'Successfully sent' : `Failed with status ${statusCode}`,
    };
  } catch (error: any) {
    return {
      row: data,
      index,
      status: 'failed',
      error: error.message,
      message: `Network error: ${error.message}`,
    };
  }
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Write results to CSV
function writeResultsCsv(filePath: string, results: WebhookResult[]) {
  const csvData = results.map(r => ({
    'Row Index': r.index + 1,
    'Status': r.status,
    'Status Code': r.statusCode || '',
    'Message': r.message || '',
    'Error': r.error || '',
    'First Name': r.row['First Name/Org Name'] || '',
    'Last Name': r.row['Last Name'] || '',
    'Email': r.row['Email'] || '',
    'Amount': r.row['Amount'] || '',
  }));

  const csv = Papa.unparse(csvData);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main function
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     CSV TO WEBHOOK SENDER SCRIPT       ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`🌐 Webhook URL: ${WEBHOOK_URL}`);
  console.log(`⏱️  Delay between requests: ${DELAY_MS}ms\n`);

  // Parse CSV
  const rows = parseCSV(CSV_PATH);
  console.log(`✓ Loaded ${rows.length} rows\n`);

  if (rows.length === 0) {
    console.log('⚠️  No data to send. Exiting.\n');
    return;
  }

  // Send to webhook
  console.log('🚀 Starting to send data to webhook...\n');
  const results: WebhookResult[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    process.stdout.write(`\r  Progress: ${i + 1}/${rows.length} | ✅ ${successCount} | ❌ ${failedCount}`);

    const result = await sendToWebhook(row, i);
    results.push(result);

    if (result.status === 'success') {
      successCount++;
    } else {
      failedCount++;
      console.log(`\n  ⚠️  Row ${i + 1} failed: ${result.message}`);
    }

    // Add delay between requests (except for the last one)
    if (i < rows.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log('\n');

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SUMMARY                   ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows:        ${rows.length}`);
  console.log(`✅ Successful:        ${successCount}`);
  console.log(`❌ Failed:            ${failedCount}\n`);

  // Write results to CSV
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultPath = path.join(OUTPUT_DIR, `webhook-results-${timestamp}.csv`);
  writeResultsCsv(resultPath, results);
  console.log(`📤 Results saved to: ${resultPath}\n`);

  // Show failed rows if any
  if (failedCount > 0) {
    console.log('❌ Failed rows:');
    results
      .filter(r => r.status === 'failed')
      .forEach(r => {
        const name = `${r.row['First Name/Org Name'] || ''} ${r.row['Last Name'] || ''}`.trim();
        console.log(`  - Row ${r.index + 1}: ${name} - ${r.message}`);
      });
    console.log('');
  }

  console.log('✅ Complete!\n');
}

// Run the script
main().catch((error) => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});