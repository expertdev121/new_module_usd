import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const upgradeSchema = z.object({
  name: z.string().optional(),         // {{contact.name}} from GHL custom data
  email: z.string().email('Invalid email format'),
  ghlcontactid: z.string().optional(), // {{contact.id}} from GHL custom data
}).catchall(z.string().optional());

function flattenCustomDataKeys(data: Record<string, string>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const match = key.match(/^customData\[(.+)\]$/);
    flat[match ? match[1] : key] = value;
  }
  return flat;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    const url = new URL(request.url);
    let data: Record<string, string> = Object.fromEntries(url.searchParams.entries());

    if (!Object.keys(data).length) {
      if (contentType.includes('application/json')) {
        const json = await request.json();
        data = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]));
      } else {
        const formData = await request.formData();
        for (const [k, v] of formData.entries()) data[k] = v.toString();
      }
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ success: false, message: 'No data received', code: 'NO_DATA' }, { status: 400 });
    }

    data = flattenCustomDataKeys(data);

    const parsed = upgradeSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      }, { status: 400 });
    }

    const { email } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const found = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

    if (!found.length) {
      return NextResponse.json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      }, { status: 404 });
    }

    const existingUser = found[0];

    // Only upgrade admins and super admins
    if (existingUser.role !== 'admin' && existingUser.role !== 'super_admin') {
      return NextResponse.json({
        success: true,
        message: 'User is not an admin — no changes made',
        code: 'NOT_ADMIN',
        user: { id: existingUser.id, email: existingUser.email, role: existingUser.role },
      }, { status: 200 });
    }

    // Already on full access — nothing to do
    if (existingUser.accessType === 'full') {
      return NextResponse.json({
        success: true,
        message: 'User already has full access',
        code: 'ALREADY_FULL',
        user: { id: existingUser.id, email: existingUser.email, role: existingUser.role, accessType: existingUser.accessType },
      }, { status: 200 });
    }

    const updated = await db
      .update(user)
      .set({ accessType: 'full', updatedAt: new Date() })
      .where(eq(user.id, existingUser.id))
      .returning();

    return NextResponse.json({
      success: true,
      message: 'User access upgraded to full',
      code: 'ACCESS_UPGRADED',
      user: { id: updated[0].id, email: updated[0].email, role: updated[0].role, accessType: updated[0].accessType },
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Upgrade webhook error:', message);
    return NextResponse.json({
      success: false,
      message: 'Unexpected server error',
      code: 'SERVER_ERROR',
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Upgrade webhook endpoint is active',
    methods: ['POST'],
    note: 'Finds a user by email, checks if they are admin/super_admin, then upgrades accessType from trial to full.',
    fields: { required: ['email'], optional: ['name', 'ghlcontactid'] },
  });
}
