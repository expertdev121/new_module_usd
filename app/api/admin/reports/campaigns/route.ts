import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaign, contact } from '@/lib/db/schema';
import { sql, ilike, desc, eq ,and } from 'drizzle-orm';
import { getReportContext } from '@/lib/reports/guard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    // Phase-0 security hotfix: tenant scope comes from the SESSION.
    const guard = await getReportContext(searchParams.get('locationId') ?? undefined);
    if (guard.error) return guard.error;
    const safeLocationId = guard.ctx.locationId;

    const campaignsQuery = db
      .select({
        id: campaign.id,
        name: campaign.name,
      })
      .from(campaign)
      .where(
        and(
          ilike(campaign.name, `%${search}%`),
          eq(campaign.locationId, safeLocationId)
        )
      )
      .orderBy(desc(campaign.name))
      .limit(50);

    const campaigns = await campaignsQuery.execute();

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
