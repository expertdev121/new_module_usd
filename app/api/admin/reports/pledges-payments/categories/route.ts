import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { category, contact, pledge } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'admin' && session.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { locationId } = await request.json();

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
