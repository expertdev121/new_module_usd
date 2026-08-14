import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { sql, ilike, or, desc, eq ,and} from 'drizzle-orm';
import { getReportContext } from '@/lib/reports/guard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    // Phase-0 security hotfix: tenant scope comes from the SESSION.
    const guard = await getReportContext(searchParams.get('locationId') ?? undefined);
    if (guard.error) return guard.error;
    const locationId = guard.ctx.locationId;

    const contactsQuery = db
      .select({
        id: contact.id,
        displayName: contact.displayName,
        firstName: contact.firstName,
        lastName: contact.lastName,
      })
      .from(contact)
      .where(
        and(
          or(
            ilike(contact.displayName, `%${search}%`),
            ilike(contact.firstName, `%${search}%`),
            ilike(contact.lastName, `%${search}%`)
          ),
          eq(contact.locationId, locationId)
        )
      )
      .orderBy(desc(contact.displayName ?? sql`''`))
      .limit(50);

    const contacts = await contactsQuery.execute();

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
