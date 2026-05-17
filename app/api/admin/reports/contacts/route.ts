import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { sql, ilike, or, desc, eq ,and} from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin' && session.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const locationId = session.user.locationId;
    if (!locationId) {
      return NextResponse.json({ error: 'Admin location not found' }, { status: 400 });
    }

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
