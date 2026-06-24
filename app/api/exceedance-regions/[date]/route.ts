import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from 'app/lib/api-fetch';

export async function GET(request: NextRequest, { params }: { params: { date: string } }) {
  const sp = request.nextUrl.searchParams;
  const window = sp.get('window') ?? '24h';
  const rp = sp.get('rp') ?? '10yr';
  const hazard = sp.get('hazard') ?? 'flood';
  const res = await apiFetch(
    `/api/exceedance-regions/${encodeURIComponent(params.date)}?window=${window}&rp=${rp}&hazard=${hazard}`,
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
