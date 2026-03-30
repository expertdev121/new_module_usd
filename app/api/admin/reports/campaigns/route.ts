import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { campaign, contact } from '@/lib/db/schema';
import { sql, ilike, desc, eq ,and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const locationId = session.user.locationId;

    const campaignsQuery = db
      .select({
        id: campaign.id,
        name: campaign.name,
      })
      .from(campaign)
      .where(
        and(
          ilike(campaign.name, `%${search}%`),
          eq(campaign.locationId, locationId)
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
