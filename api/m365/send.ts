import {
  fetchWithTimeout,
  getGraphAccessToken,
  resolveMailboxTarget,
} from './_graphHelper';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
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
      to,
      cc,
      subject,
      bodyText,
      bodyHtml,
      attachments,
      conversationId,
    } = body;

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const fromAddress = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({ success: false, error: '認証情報が不足しています。' });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, fromAddress, userPrincipalName);
    const senderUserId = resolution.userId || resolution.userPrincipalName || fromAddress;

    const toRecipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map((addr: string) => ({
      emailAddress: { address: addr.trim() },
    }));

    const ccRecipients = (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean).map((addr: string) => ({
      emailAddress: { address: addr.trim() },
    }));

    const messagePayload: any = {
      subject: subject || '（件名なし）',
      body: {
        contentType: bodyHtml ? 'HTML' : 'Text',
        content: bodyHtml || bodyText || '',
      },
      toRecipients,
      ccRecipients,
    };

    if (Array.isArray(attachments) && attachments.length > 0) {
      messagePayload.attachments = attachments.map((att: any) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.fileName || att.name || 'attachment.pdf',
        contentType: att.contentType || 'application/pdf',
        contentBytes: att.contentBytes || (att.dataUrl ? att.dataUrl.split(',')[1] : ''),
      }));
    }

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUserId)}/sendMail`;
    const sendResp = await fetchWithTimeout(
      sendUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: messagePayload, saveToSentItems: true }),
      },
      15000
    );

    if (!sendResp.ok) {
      const errData = ((await sendResp.json().catch(() => ({})))) as any;
      return res.status(400).json({
        success: false,
        error: `送信失敗 (${sendResp.status}): ${errData.error?.message || sendResp.statusText}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Microsoft 365 経由でメールを正常に送信しました。',
      sentAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/send handler:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'メール送信処理中にサーバーエラーが発生しました。',
    });
  }
}
