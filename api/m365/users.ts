import {
  fetchWithTimeout,
  getGraphAccessToken,
} from './_graphHelper';

export const config = {
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  try {
    const { tenantId, clientId, clientSecret } = body;
    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({ success: false, error: '認証情報が不足しています。' });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);

    const [usersResp, groupsResp] = await Promise.all([
      fetchWithTimeout(
        'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=50',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      ),
      fetchWithTimeout(
        'https://graph.microsoft.com/v1.0/groups?$select=id,displayName,mail,mailNickname&$top=50',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      ).catch(() => null),
    ]);

    const usersData = usersResp.ok ? (((await usersResp.json()) as any).value || []) : [];
    let groupsData: any[] = [];
    if (groupsResp && groupsResp.ok) {
      const gJson = (await groupsResp.json()) as any;
      if (Array.isArray(gJson.value)) {
        groupsData = gJson.value.map((g: any) => ({
          id: g.id,
          displayName: `【M365グループ】${g.displayName || g.mailNickname || 'グループ'}`,
          mail: g.mail || '',
          userPrincipalName: g.id,
          isGroup: true,
        }));
      }
    }

    const combined = [...groupsData, ...usersData];
    return res.status(200).json({ success: true, users: combined });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/users handler:', err);
    return res.status(500).json({ success: false, error: err.message || 'ユーザー一覧取得中にエラーが発生しました。' });
  }
}
