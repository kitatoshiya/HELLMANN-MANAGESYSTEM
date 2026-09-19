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
    const {
      tenantId,
      clientId,
      clientSecret,
      groupEmail,
      userPrincipalName,
      messageId,
      attachmentId,
    } = body;

    if (!messageId || !attachmentId) {
      return res.status(400).json({ success: false, error: 'messageId と attachmentId は必須です。' });
    }

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({ success: false, error: '認証情報が不足しています。' });
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
    )}/messages/${encodeURIComponent(cleanMsgId)}/attachments/${encodeURIComponent(attachmentId)}`;

    const attResp = await fetchWithTimeout(
      attUrl,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      10000
    );

    if (!attResp.ok) {
      const errData = ((await attResp.json().catch(() => ({})))) as any;
      return res.status(400).json({
        success: false,
        error: `添付ファイル取得失敗 (${attResp.status}): ${errData.error?.message || attResp.statusText}`,
      });
    }

    const att = ((await attResp.json()) as any) || {};
    const isPdf =
      (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
      (att.name && att.name.toLowerCase().endsWith('.pdf'));

    let dataUrl: string | undefined;
    if (att.contentBytes) {
      const mime = att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream');
      dataUrl = `data:${mime};base64,${att.contentBytes}`;
    }

    return res.status(200).json({
      success: true,
      attachment: {
        id: att.id,
        fileName: att.name || 'attachment',
        contentType: att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        sizeBytes: att.size || 0,
        isPdf: !!isPdf,
        dataUrl,
        contentId: att.contentId || att.name || '',
        isInline: !!att.isInline,
      },
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/attachment handler:', err);
    return res.status(500).json({
      success: false,
      error: err.message || '添付ファイル取得中にエラーが発生しました。',
    });
  }
}
