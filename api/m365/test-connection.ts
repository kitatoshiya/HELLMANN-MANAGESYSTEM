import {
  fetchWithTimeout,
  getGraphAccessToken,
  resolveMailboxTarget,
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
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName } = body;
    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Microsoft Entra ID（Azure AD）の資格情報（Tenant ID, Client ID, Client Secret）が設定されていません。',
      });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);

    if (!resolution.success) {
      return res.status(400).json({
        success: false,
        userNotFound: resolution.userNotFound,
        error: resolution.error,
        availableUsers: resolution.availableUsers || [],
      });
    }

    return res.status(200).json({
      success: true,
      mailbox: {
        userId: resolution.userId,
        displayName: resolution.displayName,
        mail: resolution.mail,
        userPrincipalName: resolution.userPrincipalName,
        isGroup: resolution.isGroup,
      },
      message: `Microsoft Graph API 接続成功: 共有メールボックス「${resolution.displayName} (${resolution.userPrincipalName || resolution.mail})」にアクセス可能です。`,
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/test-connection handler:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Microsoft Graph API への接続テストに失敗しました。',
    });
  }
}
