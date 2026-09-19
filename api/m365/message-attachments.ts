import {
  fetchWithTimeout,
  getGraphAccessToken,
  resolveMailboxTarget,
} from './_graphHelper';

export const config = {
  maxDuration: 60,
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
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, messageId } = body;

    if (!messageId) {
      return res.status(200).json({ success: true, attachments: [] });
    }

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(200).json({ success: true, attachments: [] });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);
    const targetUser = resolution.userId || resolution.userPrincipalName || targetEmail;

    let cleanMsgId = String(messageId);
    if (cleanMsgId.startsWith('graph_')) {
      cleanMsgId = cleanMsgId.slice(6);
    }

    const attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUser
    )}/messages/${encodeURIComponent(cleanMsgId)}/attachments?$select=id,name,contentType,size,isInline`;

    const attResp = await fetchWithTimeout(
      attUrl,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      8000
    );

    if (!attResp.ok) {
      return res.status(200).json({ success: true, attachments: [] });
    }

    const aData = ((await attResp.json()) as any) || {};
    const rawList: any[] = Array.isArray(aData.value) ? aData.value : [];

    const attachments = rawList.map((att: any) => {
      const isPdf =
        (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
        (att.name && att.name.toLowerCase().endsWith('.pdf'));

      let dataUrl: string | undefined;
      if (att.contentBytes) {
        const mime = att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream');
        dataUrl = `data:${mime};base64,${att.contentBytes}`;
      }

      return {
        id: att.id,
        fileName: att.name || 'attachment',
        contentType: att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        sizeBytes: att.size || 0,
        isPdf: !!isPdf,
        dataUrl,
        contentId: att.contentId || att.name || '',
        isInline: !!att.isInline,
      };
    });

    return res.status(200).json({ success: true, attachments });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/message-attachments handler:', err);
    return res.status(200).json({ success: true, attachments: [] });
  }
}
