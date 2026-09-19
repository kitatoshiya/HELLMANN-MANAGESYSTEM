import {
  fetchWithTimeout,
  getGraphAccessToken,
  resolveMailboxTarget,
  extractHeaderRecipientsFromText,
  parseGraphRecipientsList,
  mapAttachments,
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
      top,
      limit: bodyLimit,
      folder = 'both',
      retentionDays = 7,
      retentionStartDate,
    } = body;

    const fetchInbox = folder === 'both' || folder === 'inbox';
    const fetchSent = folder === 'both' || folder === 'sent';

    let cutoffTime = 0;
    if (retentionStartDate && typeof retentionStartDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(retentionStartDate)) {
      const parsedStart = new Date(`${retentionStartDate.slice(0, 10)}T00:00:00`);
      if (!isNaN(parsedStart.getTime())) {
        cutoffTime = parsedStart.getTime();
      }
    } else {
      const daysLimit = Number(retentionDays);
      cutoffTime = daysLimit > 0 ? Date.now() - daysLimit * 24 * 60 * 60 * 1000 : 0;
    }

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(200).json({
        success: false,
        error: 'Microsoft Entra ID（Azure AD）の資格情報（Tenant ID, Client ID, Client Secret）が設定されていません。',
        inbox: [],
        sent: [],
      });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const limit = Math.min(Number(top) || Number(bodyLimit) || 50, 100);

    // Resolve target mailbox or user identifier
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);
    if (!resolution.success) {
      return res.status(200).json({
        success: false,
        userNotFound: true,
        error: resolution.error,
        targetEmail,
        availableUsers: resolution.availableUsers || [],
        inboxCount: 0,
        sentCount: 0,
        inbox: [],
        sent: [],
      });
    }

    const targetUserIdentifier = resolution.userId || resolution.userPrincipalName || targetEmail;

    // A. If target is a Microsoft 365 Group (Unified Group)
    if (resolution.isGroup) {
      const threadsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
        resolution.userId!
      )}/threads?$top=${Math.min(limit, 20)}&$orderby=lastDeliveredDateTime%20desc&$select=id,topic,hasAttachments,lastDeliveredDateTime,uniqueSenders,toRecipients,ccRecipients`;

      const threadsResp = await fetchWithTimeout(
        threadsUrl,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        },
        5000
      ).catch(() => null);

      if (!threadsResp || !threadsResp.ok) {
        const status = threadsResp ? threadsResp.status : 504;
        const errJson = threadsResp ? (((await threadsResp.json().catch(() => ({})))) as any) : {};
        console.warn(`[M365 Group Sync Warning] (${status}):`, errJson.error?.message || (threadsResp ? threadsResp.statusText : 'Timeout'));
        return res.status(200).json({
          success: false,
          userNotFound: status === 404,
          error: `M365グループ「${targetEmail}」の会話取得失敗 (${status}): ${errJson.error?.message || (threadsResp ? threadsResp.statusText : '接続タイムアウト')}。Azure ADアプリ登録の【Group.Read.All】APIアクセス許可をご確認ください。`,
          availableUsers: resolution.availableUsers || [],
          inboxCount: 0,
          sentCount: 0,
          inbox: [],
          sent: [],
        });
      }

      const threadsData = ((await threadsResp.json()) as any) || {};
      const threads: any[] = Array.isArray(threadsData.value) ? threadsData.value : [];

      const processedInbox: any[] = [];
      const processedSent: any[] = [];

      const threadResults = await Promise.all(
        threads.map(async (th: any) => {
          try {
            const postsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
              resolution.userId!
            )}/threads/${encodeURIComponent(th.id)}/posts?$top=5&$select=id,body,from,sender,createdDateTime,hasAttachments`;

            const postsResp = await fetchWithTimeout(
              postsUrl,
              {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
              },
              3500
            ).catch(() => null);

            if (!postsResp || !postsResp.ok) return { inbox: [], sent: [] };

            const postsData = ((await postsResp.json()) as any) || {};
            const posts: any[] = Array.isArray(postsData.value) ? postsData.value : [];

            const thInbox: any[] = [];
            const thSent: any[] = [];

            for (const post of posts) {
              const msgTime = post.createdDateTime || th.lastDeliveredDateTime || new Date().toISOString();
              const msgTimestamp = new Date(msgTime).getTime();
              if (cutoffTime > 0 && msgTimestamp > 0 && msgTimestamp < cutoffTime) {
                continue;
              }

              const senderEmail = post.from?.emailAddress?.address || post.sender?.emailAddress?.address || '';
              const senderName = post.from?.emailAddress?.name || post.sender?.emailAddress?.name || 'TAC Hellmann';
              const isOutgoing = senderEmail.toLowerCase().includes('tac-') || senderEmail.toLowerCase().includes('tac-japan');

              const bodyContent = post.body?.content || '';
              const headerRecipients = extractHeaderRecipientsFromText(bodyContent);

              const toRecipients = Array.from(
                new Set([...parseGraphRecipientsList(th.toRecipients), ...headerRecipients.to, targetEmail])
              );
              const ccRecipients = Array.from(
                new Set([...parseGraphRecipientsList(th.ccRecipients), ...headerRecipients.cc])
              ).filter((e) => !toRecipients.includes(e));

              const item = {
                id: `graph_${post.id}`,
                graphMessageId: post.id,
                conversationId: th.id,
                direction: isOutgoing ? 'OUTGOING' : 'INCOMING',
                folder: isOutgoing ? 'SENT' : 'INBOX',
                isRead: true,
                receivedDateTime: msgTime,
                receivedOrSentAt: msgTime,
                subject: th.topic || '（件名なし）',
                sender: { name: senderName, email: senderEmail },
                toRecipients,
                ccRecipients,
                bodyText: post.body?.contentType === 'text' ? post.body.content : bodyContent.replace(/<[^>]+>/g, ' '),
                bodyHtml: post.body?.contentType === 'html' ? post.body.content : undefined,
                attachments: [],
                hasAttachments: !!post.hasAttachments || !!th.hasAttachments,
              };

              if (isOutgoing && fetchSent) {
                thSent.push(item);
              } else if (!isOutgoing && fetchInbox) {
                thInbox.push(item);
              }
            }

            return { inbox: thInbox, sent: thSent };
          } catch {
            return { inbox: [], sent: [] };
          }
        })
      );

      for (const resItem of threadResults) {
        processedInbox.push(...resItem.inbox);
        processedSent.push(...resItem.sent);
      }

      return res.status(200).json({
        success: true,
        inboxCount: processedInbox.length,
        sentCount: processedSent.length,
        inbox: processedInbox,
        sent: processedSent,
        syncedAt: new Date().toISOString(),
      });
    }

    // B. If target is a standard User or Shared Mailbox
    const inboxUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/mailFolders/inbox/messages?$top=${limit}&$orderby=receivedDateTime%20desc&$select=id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead`;

    const sentUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/mailFolders/sentitems/messages?$top=${limit}&$orderby=sentDateTime%20desc&$select=id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,sentDateTime,hasAttachments,isRead`;

    const [inboxResp, sentResp] = await Promise.all([
      fetchInbox
        ? fetchWithTimeout(inboxUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, 5000).catch(() => null)
        : Promise.resolve(null),
      fetchSent
        ? fetchWithTimeout(sentUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, 5000).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (inboxResp && !inboxResp.ok) {
      const errJson = (((await inboxResp.json().catch(() => ({})))) as any) || {};
      console.warn(`[M365 Sync Warning] Inbox fetch (${inboxResp.status}):`, errJson.error?.message || inboxResp.statusText);
      return res.status(200).json({
        success: false,
        userNotFound: inboxResp.status === 404,
        error: `メールボックス「${targetEmail}」の受信トレイ取得失敗 (${inboxResp.status}): ${errJson.error?.message || inboxResp.statusText}。UPNまたはExchange Onlineライセンス割り当てをご確認ください。`,
        availableUsers: resolution.availableUsers || [],
        inboxCount: 0,
        sentCount: 0,
        inbox: [],
        sent: [],
      });
    }

    if (sentResp && !sentResp.ok) {
      const errJson = (((await sentResp.json().catch(() => ({})))) as any) || {};
      console.warn(`[M365 Sync Warning] SentItems fetch (${sentResp.status}):`, errJson.error?.message || sentResp.statusText);
      if (!fetchInbox) {
        return res.status(200).json({
          success: false,
          userNotFound: sentResp.status === 404,
          error: `メールボックス「${targetEmail}」の送信済みトレイ取得失敗 (${sentResp.status}): ${errJson.error?.message || sentResp.statusText}`,
          availableUsers: resolution.availableUsers || [],
          inboxCount: 0,
          sentCount: 0,
          inbox: [],
          sent: [],
        });
      }
    }

    const inboxData = inboxResp && inboxResp.ok ? (((await inboxResp.json())) as any) : { value: [] };
    const sentData = sentResp && sentResp.ok ? (((await sentResp.json())) as any) : { value: [] };

    const rawInboxMessages: any[] = Array.isArray(inboxData.value) ? inboxData.value : [];
    const rawSentMessages: any[] = Array.isArray(sentData.value) ? sentData.value : [];

    // Process inbox items
    const processedInbox: any[] = [];
    for (const msg of rawInboxMessages) {
      const mailReceivedTime = msg.receivedDateTime || msg.createdDateTime || msg.sentDateTime || new Date().toISOString();
      const mailTimestamp = new Date(mailReceivedTime).getTime();
      if (cutoffTime > 0 && mailTimestamp > 0 && mailTimestamp < cutoffTime) {
        continue;
      }

      const attachments = mapAttachments(msg);
      const msgTo = parseGraphRecipientsList(msg.toRecipients);
      const msgCc = parseGraphRecipientsList(msg.ccRecipients);
      const contentHeaders = extractHeaderRecipientsFromText(msg.body?.content || msg.bodyPreview || '');

      const combinedToSet = new Set<string>(msgTo);
      for (const t of contentHeaders.to) {
        combinedToSet.add(t);
      }
      if (combinedToSet.size === 0 && targetEmail) {
        combinedToSet.add(targetEmail);
      }

      const combinedCcSet = new Set<string>(msgCc);
      for (const c of contentHeaders.cc) {
        if (!combinedToSet.has(c)) {
          combinedCcSet.add(c);
        }
      }

      processedInbox.push({
        id: `graph_${msg.id}`,
        graphMessageId: msg.id,
        conversationId: msg.conversationId || `conv_${msg.id}`,
        direction: 'INCOMING',
        folder: 'INBOX',
        isRead: !!msg.isRead,
        receivedDateTime: mailReceivedTime,
        receivedOrSentAt: mailReceivedTime,
        subject: msg.subject || '（件名なし）',
        sender: {
          name: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || '不明',
          email: msg.from?.emailAddress?.address || '',
        },
        toRecipients: Array.from(combinedToSet),
        ccRecipients: Array.from(combinedCcSet),
        bodyText: msg.body?.contentType === 'text' ? msg.body.content : (msg.bodyPreview || ''),
        bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : undefined,
        attachments,
        hasAttachments: !!msg.hasAttachments || attachments.length > 0,
      });
    }

    // Process sent items
    const processedSent: any[] = [];
    for (const msg of rawSentMessages) {
      const mailSentTime = msg.sentDateTime || msg.receivedDateTime || msg.createdDateTime || new Date().toISOString();
      const mailTimestamp = new Date(mailSentTime).getTime();
      if (cutoffTime > 0 && mailTimestamp > 0 && mailTimestamp < cutoffTime) {
        continue;
      }

      const attachments = mapAttachments(msg);
      const msgTo = parseGraphRecipientsList(msg.toRecipients);
      const msgCc = parseGraphRecipientsList(msg.ccRecipients);
      const contentHeaders = extractHeaderRecipientsFromText(msg.body?.content || msg.bodyPreview || '');

      const combinedToSet = new Set<string>(msgTo);
      for (const t of contentHeaders.to) {
        combinedToSet.add(t);
      }

      const combinedCcSet = new Set<string>(msgCc);
      for (const c of contentHeaders.cc) {
        if (!combinedToSet.has(c)) {
          combinedCcSet.add(c);
        }
      }

      processedSent.push({
        id: `graph_${msg.id}`,
        graphMessageId: msg.id,
        conversationId: msg.conversationId || `conv_${msg.id}`,
        direction: 'OUTGOING',
        folder: 'SENT',
        isRead: true,
        receivedDateTime: mailSentTime,
        receivedOrSentAt: mailSentTime,
        subject: msg.subject || '（件名なし）',
        sender: {
          name: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'TAC Hellmann TEAM',
          email: msg.from?.emailAddress?.address || targetEmail,
        },
        toRecipients: Array.from(combinedToSet),
        ccRecipients: Array.from(combinedCcSet),
        bodyText: msg.body?.contentType === 'text' ? msg.body.content : (msg.bodyPreview || ''),
        bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : undefined,
        attachments,
        hasAttachments: !!msg.hasAttachments || attachments.length > 0,
      });
    }

    return res.status(200).json({
      success: true,
      inboxCount: processedInbox.length,
      sentCount: processedSent.length,
      inbox: processedInbox,
      sent: processedSent,
      syncedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/sync handler:', err);
    return res.status(200).json({
      success: false,
      error: err.message || 'M365同期処理中にサーバーエラーが発生しました。',
      inbox: [],
      sent: [],
    });
  }
}
