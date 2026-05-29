// scripts/fix-razor-categories-to-tags.ts
// For location THqkrbnBD2Eim1tdklWp: categories on manual donations are actually
// tags that should be attached to the contact. This script creates tags from those
// categories and links them to the contacts via contact_tags.
import 'dotenv/config';
import { db } from '@/lib/db';
import { contact, manualDonation, category, tag, contactTags } from '@/lib/db/schema';
import { eq, isNotNull, inArray, and } from 'drizzle-orm';

const LOCATION_ID = 'THqkrbnBD2Eim1tdklWp';
const DRY_RUN = false;

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   FIX RAZOR: CATEGORIES → CONTACT TAGS ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no changes will be written\n');
  }

  // 1. Verify DB connection
  await db.select().from(contact).limit(1).execute().catch((e) => {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  });
  console.log('✓ Database connected\n');

  // 2. Get all contacts for this location
  console.log(`📍 Loading contacts for location: ${LOCATION_ID}`);
  const locationContacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();

  const contactIds = locationContacts.map((c) => c.id);
  console.log(`✓ Found ${contactIds.length} contacts\n`);

  if (contactIds.length === 0) {
    console.log('⚠️  No contacts found for this location. Exiting.');
    process.exit(0);
  }

  // 3. Find all manual donations for these contacts that have a categoryId
  console.log('📂 Loading manual donations with categories...');
  const donations = await db
    .select({
      contactId: manualDonation.contactId,
      categoryId: manualDonation.categoryId,
    })
    .from(manualDonation)
    .where(
      and(
        inArray(manualDonation.contactId, contactIds),
        isNotNull(manualDonation.categoryId)
      )
    )
    .execute();

  console.log(`✓ Found ${donations.length} manual donations with a category\n`);

  if (donations.length === 0) {
    console.log('⚠️  No manual donations with categories found. Nothing to migrate.');
    process.exit(0);
  }

  // 4. Collect unique categoryIds and (contactId, categoryId) pairs
  const uniqueCategoryIds = [...new Set(donations.map((d) => d.categoryId!))] as number[];
  const pairs = donations.map((d) => ({ contactId: d.contactId!, categoryId: d.categoryId! }));

  console.log(`📋 Distinct categories: ${uniqueCategoryIds.length}`);
  console.log(`👥 Contact-category pairs: ${pairs.length}\n`);

  // 5. Load the category names
  const categories = await db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(inArray(category.id, uniqueCategoryIds))
    .execute();

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  console.log('Categories to migrate:');
  categories.forEach((c) => console.log(`  [${c.id}] ${c.name}`));
  console.log();

  // 6. Find or create a tag for each category (same name, same location)
  const categoryToTagId = new Map<number, number>();

  console.log('🏷️  Resolving tags...');
  for (const cat of categories) {
    const existing = await db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.locationId, LOCATION_ID), eq(tag.name, cat.name)))
      .limit(1)
      .execute();

    if (existing.length > 0) {
      categoryToTagId.set(cat.id, existing[0].id);
      console.log(`  ✓ Tag exists: "${cat.name}" → id ${existing[0].id}`);
    } else {
      if (!DRY_RUN) {
        const [created] = await db
          .insert(tag)
          .values({
            name: cat.name,
            locationId: LOCATION_ID,
            isActive: true,
            showOnPayment: true,
            showOnPledge: true,
          })
          .returning({ id: tag.id });
        categoryToTagId.set(cat.id, created.id);
        console.log(`  ➕ Created tag: "${cat.name}" → id ${created.id}`);
      } else {
        console.log(`  ➕ [DRY RUN] Would create tag: "${cat.name}"`);
      }
    }
  }
  console.log();

  // 7. Build unique (contactId, tagId) pairs to insert
  const contactTagPairs = new Map<string, { contactId: number; tagId: number }>();
  for (const { contactId, categoryId } of pairs) {
    const tagId = categoryToTagId.get(categoryId);
    if (!tagId) continue;
    const key = `${contactId}:${tagId}`;
    if (!contactTagPairs.has(key)) {
      contactTagPairs.set(key, { contactId, tagId });
    }
  }

  const toInsert = Array.from(contactTagPairs.values());
  console.log(`🔗 Unique contact-tag links to create: ${toInsert.length}\n`);

  // 8. Insert contact_tags (ON CONFLICT DO NOTHING via unique index)
  if (!DRY_RUN && toInsert.length > 0) {
    const BATCH_SIZE = 100;
    let totalInserted = 0;

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const inserted = await db
        .insert(contactTags)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: contactTags.id });
      totalInserted += inserted.length;
      console.log(
        `  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${inserted.length} / ${batch.length} (skipped ${batch.length - inserted.length} duplicates)`
      );
    }

    console.log(`\n✅ Done — ${totalInserted} contact-tag links created.\n`);
  } else if (DRY_RUN) {
    console.log('✅ DRY RUN complete — no changes written.\n');
    console.log('Sample pairs that would be inserted:');
    toInsert.slice(0, 10).forEach(({ contactId, tagId }) =>
      console.log(`  contactId=${contactId} → tagId=${tagId}`)
    );
    if (toInsert.length > 10) {
      console.log(`  ... and ${toInsert.length - 10} more`);
    }
  }
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});
