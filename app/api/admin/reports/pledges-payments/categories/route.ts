import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { category, contact, pledge } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getReportContext } from '@/lib/reports/guard';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Phase-0 security hotfix: tenant scope comes from the SESSION, never
    // from the request body (super_admin may override).
    const guard = await getReportContext(body?.locationId);
    if (guard.error) return guard.error;
    const locationId = guard.ctx.locationId;

    // Get distinct categories that have pledges
    const categoriesResult = await db
      .select({
        name: category.name,
      })
      .from(category)
      .innerJoin(pledge, eq(category.id, pledge.categoryId))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(contact.locationId, locationId),
        eq(pledge.isActive, true)
      ))
      .groupBy(category.name)
      .orderBy(category.name);

    const categories = categoriesResult.map(row => row.name).filter(Boolean);

    return NextResponse.json({ categories });

  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
