import express from 'express';

export const m365Router = express.Router();

/**
 * Acquire Microsoft Graph OAuth 2.0 Access Token using client credentials
 */
async function getGraphAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'client_credentials');

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = (await resp.json()) as any;
  if (!resp.ok || !data.access_token) {
    const errDesc = data.error_description || data.error || 'Failed to obtain access token from Microsoft Entra ID';
    throw new Error(`[M365 Auth Error] ${errDesc}`);
  }

  return data.access_token as string;
}

export interface MailboxResolution {
  success: boolean;
  userId?: string;
  userPrincipalName?: string;
  displayName?: string;
  mail?: string;
  isGroup?: boolean;
  error?: string;
  userNotFound?: boolean;
  availableUsers?: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>;
}

/**
 * Robustly resolve target email or UPN to an accessible Microsoft Graph identifier
 */
async function resolveMailboxTarget(
  token: string,
  targetEmail: string,
  explicitUpnOrId?: string
): Promise<MailboxResolution> {
  const identifierToTry = explicitUpnOrId?.trim() || targetEmail.trim();
  if (!identifierToTry) {
    return { success: false, error: '対象のメールアドレスまたはUPNが指定されていません。' };
  }

  // 1. If explicit UPN or direct email, attempt direct user lookup
  try {
    const directResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identifierToTry)}?$select=id,displayName,mail,userPrincipalName`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (directResp.ok) {
      const u = (await directResp.json()) as any;
      return {
        success: true,
        userId: u.id,
        userPrincipalName: u.userPrincipalName,
        displayName: u.displayName || u.mail || identifierToTry,
        mail: u.mail || u.userPrincipalName || identifierToTry,
      };
    }
  } catch (err) {
    console.warn('Direct user lookup warning:', err);
  }

  // 2. Query users where mail == targetEmail or userPrincipalName == targetEmail
  try {
    const filterQuery = encodeURIComponent(
      `mail eq '${targetEmail}' or userPrincipalName eq '${targetEmail}'`
    );
    const filterResp = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=${filterQuery}&$select=id,displayName,mail,userPrincipalName`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (filterResp.ok) {
      const data = (await filterResp.json()) as any;
      if (Array.isArray(data.value) && data.value.length > 0) {
        const u = data.value[0];
        return {
          success: true,
          userId: u.id,
          userPrincipalName: u.userPrincipalName,
          displayName: u.displayName || u.mail || targetEmail,
          mail: u.mail || u.userPrincipalName || targetEmail,
        };
      }
    }
  } catch (err) {
    console.warn('Filter user lookup warning:', err);
  }

  // 3. Check proxyAddresses (common for aliases and shared mailboxes)
  try {
    const proxyQuery = encodeURIComponent(
      `proxyAddresses/any(p:p eq 'smtp:${targetEmail}') or proxyAddresses/any(p:p eq 'SMTP:${targetEmail}')`
    );
    const proxyResp = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=${proxyQuery}&$select=id,displayName,mail,userPrincipalName`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (proxyResp.ok) {
      const data = (await proxyResp.json()) as any;
      if (Array.isArray(data.value) && data.value.length > 0) {
        const u = data.value[0];
        return {
          success: true,
          userId: u.id,
          userPrincipalName: u.userPrincipalName,
          displayName: u.displayName || u.mail || targetEmail,
          mail: u.mail || u.userPrincipalName || targetEmail,
        };
      }
    }
  } catch (err) {
    console.warn('Proxy addresses lookup warning:', err);
  }

  // 4. Check if it's a Microsoft 365 Group (Unified Group)
  let groupPermissionDenied = false;
  try {
    const emailPrefix = targetEmail.split('@')[0] || '';
    const groupFilters = [
      `mail eq '${targetEmail}'`,
      `mailNickname eq '${emailPrefix}'`,
      `displayName eq 'TAC Hellmann TEAM'`,
      `mail eq '${emailPrefix}@tacjapan.onmicrosoft.com'`,
      `proxyAddresses/any(p:p eq 'smtp:${targetEmail}') or proxyAddresses/any(p:p eq 'SMTP:${targetEmail}')`,
    ];

    // If identifier is a GUID (Object ID), try direct group lookup
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifierToTry);
    if (isGuid) {
      const directGroupResp = await fetch(
        `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(identifierToTry)}?$select=id,displayName,mail`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      );
      if (directGroupResp.ok) {
        const g = (await directGroupResp.json()) as any;
        return {
          success: true,
          userId: g.id,
          userPrincipalName: (g.mail && !isGuid) ? g.mail : (targetEmail && !isGuid) ? targetEmail : '',
          displayName: g.displayName || targetEmail,
          mail: g.mail || targetEmail,
          isGroup: true,
        };
      }
    }

    for (const f of groupFilters) {
      const groupResp = await fetch(
        `https://graph.microsoft.com/v1.0/groups?$filter=${encodeURIComponent(f)}&$select=id,displayName,mail`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }
      );

      if (groupResp.status === 403) {
        groupPermissionDenied = true;
        break;
      }

      if (groupResp.ok) {
        const data = (await groupResp.json()) as any;
        if (Array.isArray(data.value) && data.value.length > 0) {
          const g = data.value[0];
          return {
            success: true,
            userId: g.id,
            userPrincipalName: (g.mail && !isGuid) ? g.mail : (targetEmail && !isGuid) ? targetEmail : '',
            displayName: g.displayName || targetEmail,
            mail: g.mail || targetEmail,
            isGroup: true,
          };
        }
      }
    }
  } catch (err) {
    console.warn('Group lookup warning:', err);
  }

  // 5. Fetch candidate users and groups from the tenant to assist diagnosis
  let availableUsers: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }> = [];
  try {
    const listResp = await fetch(
      `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=25`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (listResp.ok) {
      const data = (await listResp.json()) as any;
      if (Array.isArray(data.value)) {
        availableUsers = data.value.map((u: any) => ({
          id: u.id,
          displayName: u.displayName || '',
          mail: u.mail || '',
          userPrincipalName: u.userPrincipalName || '',
        }));

        // Prefix match check (e.g. tac-hellmann)
        const prefix = targetEmail.split('@')[0]?.toLowerCase();
        if (prefix) {
          const match = availableUsers.find(
            (u) =>
              (u.userPrincipalName && u.userPrincipalName.toLowerCase().startsWith(prefix)) ||
              (u.mail && u.mail.toLowerCase().startsWith(prefix)) ||
              (u.displayName && u.displayName.toLowerCase().includes(prefix))
          );
          if (match) {
            return {
              success: true,
              userId: match.id,
              userPrincipalName: match.userPrincipalName,
              displayName: match.displayName,
              mail: match.mail || match.userPrincipalName,
              availableUsers,
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('Tenant users listing warning:', err);
  }

  if (groupPermissionDenied) {
    return {
      success: false,
      userNotFound: true,
      error: `「${targetEmail}」はMicrosoft 365グループ（TAC Hellmann TEAM）として構成されていますが、Azure AD（Entra ID）のアプリ登録に【Group.Read.All】または【Group.ReadWrite.All】のAPIアクセス許可が付与されていません。Azure Portalの [APIのアクセス許可] にて追加し「管理者の同意」を与えてください。`,
      availableUsers,
    };
  }

  return {
    success: false,
    userNotFound: true,
    error: `指定されたアドレス「${targetEmail}」は接続先Entra IDテナント内でユーザーまたはM365グループとして検出されませんでした。「TAC Hellmann TEAM」のグループIDまたはUPNをご確認ください。`,
    availableUsers,
  };
}

/**
 * List tenant users, shared mailboxes, and M365 Groups to assist configuration
 */
m365Router.post('/users', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret } = req.body;
    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({ success: false, error: '認証情報が不足しています。' });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);

    const [usersResp, groupsResp] = await Promise.all([
      fetch(
        'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=50',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      ),
      fetch(
        'https://graph.microsoft.com/v1.0/groups?$select=id,displayName,mail,mailNickname&$top=50',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
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
          userPrincipalName: g.id, // Group ID for direct resolution
          isGroup: true,
        }));
      }
    }

    const combined = [...groupsData, ...usersData];
    return res.json({ success: true, users: combined });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Test Microsoft Graph API Connection
 */
m365Router.post('/test-connection', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName } = req.body;

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Tenant ID、Client ID、Client Secret（クライアントシークレット）のすべてが必要です。',
      });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);

    const emailToTest = groupEmail || process.env.M365_GROUP_EMAIL;
    if (!emailToTest) {
      return res.json({
        success: true,
        message: 'Microsoft Graph API 認証成功: Entra ID トークンの発行に成功しました。',
        mailboxChecked: false,
      });
    }

    const resolution = await resolveMailboxTarget(token, emailToTest, userPrincipalName);

    if (!resolution.success) {
      return res.json({
        success: false,
        userNotFound: true,
        mailboxChecked: false,
        message: resolution.error || `メールアドレス「${emailToTest}」が見つかりませんでした。`,
        availableUsers: resolution.availableUsers || [],
      });
    }

    return res.json({
      success: true,
      mailboxChecked: true,
      mailbox: {
        id: resolution.userId,
        displayName: resolution.displayName,
        mail: resolution.mail,
        userPrincipalName: resolution.userPrincipalName,
        isGroup: resolution.isGroup,
      },
      message: `Microsoft Graph API 接続成功: 共有メールボックス「${resolution.displayName} (${resolution.userPrincipalName || resolution.mail})」にアクセス可能です。`,
    });
  } catch (err: any) {
    console.warn('M365 test-connection warning:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Microsoft Graph API への接続テストに失敗しました。',
    });
  }
});

/**
 * Extract distinct email addresses from arbitrary text
 */
function extractEmailAddressesList(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.trim().toLowerCase())));
}

/**
 * Extract To and CC headers embedded in email content or body (e.g., forwarded or routing headers)
 */
function extractHeaderRecipientsFromText(content: string): { to: string[]; cc: string[] } {
  const toList: string[] = [];
  const ccList: string[] = [];
  if (!content) return { to: toList, cc: ccList };

  const plain = content
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const lines = plain.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(?:To|宛先|送信先|To Recipients|宛先アドレス)[:：]/i.test(line)) {
      toList.push(...extractEmailAddressesList(line));
    } else if (/^(?:Cc|CC|カーボンコピー)[:：]/i.test(line)) {
      ccList.push(...extractEmailAddressesList(line));
    }
  }

  return {
    to: Array.from(new Set(toList)),
    cc: Array.from(new Set(ccList)),
  };
}

/**
 * Helper to normalize Graph API recipient arrays (objects with emailAddress or strings)
 */
function parseGraphRecipientsList(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const list: string[] = [];
    for (const r of raw) {
      if (typeof r === 'string' && r.includes('@')) {
        list.push(r.trim());
      } else if (r && typeof r === 'object') {
        const addr = r.emailAddress?.address || r.address || r.email;
        if (typeof addr === 'string' && addr.includes('@')) {
          list.push(addr.trim());
        }
      }
    }
    return Array.from(new Set(list));
  }
  if (typeof raw === 'string') {
    return extractEmailAddressesList(raw);
  }
  return [];
}

/**
 * Sync emails from Microsoft 365 Shared Mailbox
 * Fetches inbox and sentitems messages, including attachments
 */
m365Router.post('/sync', async (req, res) => {
  try {
    const {
      tenantId,
      clientId,
      clientSecret,
      groupEmail,
      userPrincipalName,
      top,
      folder = 'both',
      retentionDays = 7,
      retentionStartDate,
    } = req.body;
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
      return res.status(400).json({
        success: false,
        error: 'Microsoft Entra ID（Azure AD）の資格情報（Tenant ID, Client ID, Client Secret）が設定されていません。',
      });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const limit = Math.min(Number(top) || 50, 100);

    // Resolve target mailbox or user identifier
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);
    if (!resolution.success) {
      return res.json({
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
      let attachmentFetchCount = 0;
      const threadsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
        resolution.userId
      )}/threads?$top=${limit}&$orderby=lastDeliveredDateTime%20desc&$select=id,topic,hasAttachments,lastDeliveredDateTime,uniqueSenders,toRecipients,ccRecipients`;

      const threadsResp = await fetch(threadsUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (!threadsResp.ok) {
        const errJson = (await threadsResp.json().catch(() => ({}))) as any;
        console.warn(`[M365 Group Sync Warning] (${threadsResp.status}):`, errJson.error?.message || threadsResp.statusText);
        return res.json({
          success: false,
          userNotFound: threadsResp.status === 404,
          error: `M365グループ「${targetEmail}」の会話取得失敗 (${threadsResp.status}): ${errJson.error?.message || threadsResp.statusText}。Azure ADアプリ登録の【Group.Read.All】APIアクセス許可をご確認ください。`,
          availableUsers: resolution.availableUsers || [],
          inboxCount: 0,
          sentCount: 0,
          inbox: [],
          sent: [],
        });
      }

      const threadsData = (await threadsResp.json()) as any;
      const threads: any[] = Array.isArray(threadsData.value) ? threadsData.value : [];
      const processedInbox: any[] = [];
      const processedSent: any[] = [];

      // Fetch posts for top threads
      for (const thread of threads.slice(0, 30)) {
        try {
          const threadLastDelivered = thread.lastDeliveredDateTime ? new Date(thread.lastDeliveredDateTime).getTime() : 0;
          if (cutoffTime > 0 && threadLastDelivered > 0 && threadLastDelivered < cutoffTime) {
            // Skip threads whose last delivered message is older than cutoff
            continue;
          }

          const threadTo = parseGraphRecipientsList(thread.toRecipients);
          const threadCc = parseGraphRecipientsList(thread.ccRecipients);

          // Note: Graph API /groups/{id}/threads/{id}/posts does NOT support $orderby or bodyPreview in $select, so we fetch without bodyPreview and sort in memory
          const postsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
            resolution.userId
          )}/threads/${thread.id}/posts?$top=30&$select=id,from,sender,body,receivedDateTime,hasAttachments,newParticipants`;
          const postsResp = await fetch(postsUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          });

          if (!postsResp.ok) {
            const pErr = (await postsResp.json().catch(() => ({}))) as any;
            console.warn(`[Group Post Fetch Error] Thread ${thread.id} (${postsResp.status}):`, pErr.error?.message || postsResp.statusText);
            continue;
          }
          const postsData = (await postsResp.json()) as any;
          const posts: any[] = Array.isArray(postsData.value) ? postsData.value : [];

          // Sort posts in memory by receivedDateTime desc
          posts.sort((a, b) => new Date(b.receivedDateTime || 0).getTime() - new Date(a.receivedDateTime || 0).getTime());

          for (const post of posts) {
            let attachments: any[] = [];
            if (post.hasAttachments) {
              try {
                const attachResp = await fetch(
                  `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
                    resolution.userId
                  )}/threads/${thread.id}/posts/${post.id}/attachments`,
                  { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
                );
                if (attachResp.ok) {
                  const aData = (await attachResp.json()) as any;
                  if (Array.isArray(aData.value)) {
                    attachments = aData.value.map((att: any) => {
                      const isPdf =
                        (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
                        (att.name && att.name.toLowerCase().endsWith('.pdf'));
                      return {
                        id: att.id,
                        fileName: att.name || 'attachment',
                        contentType: att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
                        sizeBytes: att.size || 0,
                        isPdf: !!isPdf,
                        dataUrl: att.contentBytes
                          ? `data:${att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream')};base64,${att.contentBytes}`
                          : undefined,
                        contentId: att.contentId || att.name || '',
                        isInline: !!att.isInline,
                      };
                    });
                  }
                }
              } catch (e) {
                console.warn('Group post attachment fetch error:', e);
              }
            }

            const senderAddress = post.from?.emailAddress?.address?.toLowerCase() || '';
            const isUserSender =
              (userPrincipalName && senderAddress === userPrincipalName.toLowerCase()) ||
              senderAddress.startsWith('kita@') ||
              senderAddress.includes('tac-japan.co.jp');

            // Extract recipients from post, thread, and body headers
            const postNewParticipants = parseGraphRecipientsList(post.newParticipants);
            const contentHeaders = extractHeaderRecipientsFromText(post.body?.content || '');

            const combinedToSet = new Set<string>();
            for (const t of [...threadTo, ...postNewParticipants, ...contentHeaders.to]) {
              if (t && t.toLowerCase() !== senderAddress) combinedToSet.add(t);
            }
            if (combinedToSet.size === 0 && targetEmail) {
              combinedToSet.add(targetEmail);
            }
            const finalToRecipients = Array.from(combinedToSet);

            const combinedCcSet = new Set<string>();
            for (const c of [...threadCc, ...contentHeaders.cc]) {
              if (c && !combinedToSet.has(c) && c.toLowerCase() !== senderAddress) {
                combinedCcSet.add(c);
              }
            }
            const finalCcRecipients = Array.from(combinedCcSet);

            const item = {
              id: `graph_${post.id}`,
              graphMessageId: post.id,
              conversationId: thread.id,
              direction: 'INCOMING' as const,
              folder: 'INBOX' as const,
              isRead: true,
              receivedDateTime: post.receivedDateTime || thread.lastDeliveredDateTime || new Date().toISOString(),
              subject: thread.topic || '（件名なし）',
              sender: {
                name: post.from?.emailAddress?.name || post.from?.emailAddress?.address || 'TAC Hellmann TEAM',
                email: post.from?.emailAddress?.address || targetEmail,
              },
              toRecipients: finalToRecipients,
              ccRecipients: finalCcRecipients,
              bodyText: post.body?.contentType === 'text' 
                ? (post.body.content || '') 
                : (post.body?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
              bodyHtml: post.body?.contentType === 'html' ? post.body.content : undefined,
              attachments,
            };

            // All group posts are part of the Group Inbox
            processedInbox.push(item);

            // If sent by active user, also include a copy in Sent items
            if (isUserSender) {
              processedSent.push({
                ...item,
                direction: 'OUTGOING' as const,
                folder: 'SENT' as const,
              });
            }
          }
        } catch (postErr) {
          console.warn('Thread posts error:', postErr);
        }
      }

      return res.json({
        success: true,
        inboxCount: processedInbox.length,
        sentCount: processedSent.length,
        inbox: processedInbox,
        sent: processedSent,
        syncedAt: new Date().toISOString(),
      });
    }

    // B. If target is a standard User or Shared Mailbox
    // 1. Fetch messages from Inbox (only if requested)
    const inboxUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/mailFolders/inbox/messages?$top=${limit}&$orderby=receivedDateTime%20desc&$select=id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead`;

    // 2. Fetch messages from SentItems (only if requested)
    const sentUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/mailFolders/sentitems/messages?$top=${limit}&$orderby=sentDateTime%20desc&$select=id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,sentDateTime,hasAttachments,isRead`;

    const [inboxResp, sentResp] = await Promise.all([
      fetchInbox
        ? fetch(inboxUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
        : Promise.resolve(null),
      fetchSent
        ? fetch(sentUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
        : Promise.resolve(null),
    ]);

    if (inboxResp && !inboxResp.ok) {
      const errJson = (await inboxResp.json().catch(() => ({}))) as any;
      console.warn(`[M365 Sync Warning] Inbox fetch (${inboxResp.status}):`, errJson.error?.message || inboxResp.statusText);
      return res.json({
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
      const errJson = (await sentResp.json().catch(() => ({}))) as any;
      console.warn(`[M365 Sync Warning] SentItems fetch (${sentResp.status}):`, errJson.error?.message || sentResp.statusText);
      if (!fetchInbox) {
        return res.json({
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

    const inboxData = inboxResp && inboxResp.ok ? ((await inboxResp.json()) as any) : { value: [] };
    const sentData = sentResp && sentResp.ok ? ((await sentResp.json()) as any) : { value: [] };

    const rawInboxMessages: any[] = Array.isArray(inboxData.value) ? inboxData.value : [];
    const rawSentMessages: any[] = Array.isArray(sentData.value) ? sentData.value : [];

    // Helper to fetch attachments for messages that have attachments
    async function getMessageAttachments(messageId: string): Promise<any[]> {
      try {
        const attResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUserIdentifier)}/messages/${messageId}/attachments`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        );
        if (!attResp.ok) return [];
        const attData = (await attResp.json()) as any;
        if (!Array.isArray(attData.value)) return [];

        return attData.value.map((att: any) => {
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
      } catch (e) {
        console.warn(`Failed to fetch attachments for message ${messageId}:`, e);
        return [];
      }
    }

    // Process inbox items
    const processedInbox: any[] = [];
    for (const msg of rawInboxMessages) {
      const mailReceivedTime = msg.receivedDateTime || msg.createdDateTime || msg.sentDateTime || new Date().toISOString();
      const mailTimestamp = new Date(mailReceivedTime).getTime();
      if (cutoffTime > 0 && mailTimestamp > 0 && mailTimestamp < cutoffTime) {
        // Skip messages older than cutoff retention limit
        continue;
      }

      let attachments: any[] = [];
      if (msg.hasAttachments) {
        attachments = await getMessageAttachments(msg.id);
      }

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
      });
    }

    // Process sent items
    const processedSent: any[] = [];
    for (const msg of rawSentMessages) {
      const mailSentTime = msg.sentDateTime || msg.receivedDateTime || msg.createdDateTime || new Date().toISOString();
      const mailTimestamp = new Date(mailSentTime).getTime();
      if (cutoffTime > 0 && mailTimestamp > 0 && mailTimestamp < cutoffTime) {
        // Skip sent messages older than cutoff retention limit
        continue;
      }

      let attachments: any[] = [];
      if (msg.hasAttachments) {
        attachments = await getMessageAttachments(msg.id);
      }
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
      });
    }

    return res.json({
      success: true,
      inboxCount: processedInbox.length,
      sentCount: processedSent.length,
      inbox: processedInbox,
      sent: processedSent,
      syncedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn('M365 sync warning:', err?.message || err);
    return res.json({
      success: false,
      error: err.message || 'Microsoft Graph API からのメール同期に失敗しました。',
      inbox: [],
      sent: [],
    });
  }
});

/**
 * Send email via Microsoft Graph API
 */
m365Router.post('/send', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, toRecipients, ccRecipients, subject, body, isHtml } = req.body;

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Microsoft Entra ID の資格情報が設定されていません。',
      });
    }

    if (!Array.isArray(toRecipients) || toRecipients.length === 0) {
      return res.status(400).json({ success: false, error: '宛先 (toRecipients) を指定してください。' });
    }

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);

    const isGuidStr = (str?: string) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());

    // /users/{userIdentifier}/sendMail requires a User or Shared Mailbox UPN / email address.
    // It CANNOT be a Group Object ID or a Group Email Address (e.g. tac-hellmann@tac-japan.co.jp if it's a M365 Group).
    let targetUserIdentifier = '';

    // Check if userPrincipalName in request is a valid USER UPN (not equal to group email or GUID)
    if (
      userPrincipalName &&
      !isGuidStr(userPrincipalName) &&
      userPrincipalName.includes('@') &&
      (!resolution.isGroup || userPrincipalName.toLowerCase() !== targetEmail.toLowerCase())
    ) {
      targetUserIdentifier = userPrincipalName.trim();
    }

    // If target is NOT a group, targetEmail / resolution.mail / resolution.userPrincipalName can be used directly
    if (!targetUserIdentifier && !resolution.isGroup) {
      if (targetEmail && !isGuidStr(targetEmail) && targetEmail.includes('@')) {
        targetUserIdentifier = targetEmail.trim();
      } else if (resolution.mail && !isGuidStr(resolution.mail) && resolution.mail.includes('@')) {
        targetUserIdentifier = resolution.mail.trim();
      } else if (resolution.userPrincipalName && !isGuidStr(resolution.userPrincipalName) && resolution.userPrincipalName.includes('@')) {
        targetUserIdentifier = resolution.userPrincipalName.trim();
      }
    }

    // If target IS a group (or targetUserIdentifier is empty/GUID/group email), resolve a real user UPN in the tenant
    if (!targetUserIdentifier || resolution.isGroup || isGuidStr(targetUserIdentifier) || targetUserIdentifier.toLowerCase() === targetEmail.toLowerCase()) {
      // 1. Try group owners / members
      if (resolution.userId) {
        try {
          const ownersResp = await fetch(`https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(resolution.userId)}/owners?$select=id,userPrincipalName,mail`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          });
          if (ownersResp.ok) {
            const oData = (await ownersResp.json()) as any;
            if (Array.isArray(oData.value) && oData.value.length > 0) {
              const owner = oData.value.find(
                (u: any) =>
                  u.userPrincipalName &&
                  u.userPrincipalName.includes('@') &&
                  !isGuidStr(u.userPrincipalName) &&
                  u.userPrincipalName.toLowerCase() !== targetEmail.toLowerCase()
              );
              if (owner) {
                targetUserIdentifier = owner.userPrincipalName || owner.mail || '';
              }
            }
          }
        } catch (e) {
          console.warn('Group owners lookup failed:', e);
        }
      }

      // 2. Fallback: fetch top users from tenant and pick the first real user UPN
      if (!targetUserIdentifier || isGuidStr(targetUserIdentifier) || targetUserIdentifier.toLowerCase() === targetEmail.toLowerCase()) {
        try {
          const uResp = await fetch(`https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,mail&$top=10`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          });
          if (uResp.ok) {
            const uData = (await uResp.json()) as any;
            if (Array.isArray(uData.value) && uData.value.length > 0) {
              const foundUser =
                uData.value.find(
                  (u: any) =>
                    u.userPrincipalName &&
                    u.userPrincipalName.includes('@') &&
                    u.userPrincipalName.toLowerCase() !== targetEmail.toLowerCase()
                ) || uData.value[0];
              targetUserIdentifier = foundUser.userPrincipalName || foundUser.mail || '';
            }
          }
        } catch (err) {
          console.warn('Fallback tenant user lookup failed:', err);
        }
      }
    }

    if (!targetUserIdentifier || isGuidStr(targetUserIdentifier)) {
      return res.status(400).json({
        success: false,
        error: `メール送信元のユーザー指定が無効です (${targetEmail})。M365グループ（${targetEmail}）は直接メール送信APIのエンドポイントとして使用できません。M365連携設定の「UPN / ユーザー識別子」欄に差出人となるユーザーのUPN (例: kita@tac-japan.co.jp) をご指定ください。`,
      });
    }

    const fromAddress = (targetEmail && !isGuidStr(targetEmail) && targetEmail.includes('@'))
      ? targetEmail.trim()
      : (resolution.mail && !isGuidStr(resolution.mail) && resolution.mail.includes('@'))
      ? resolution.mail.trim()
      : targetUserIdentifier;

    const shouldSendAsHtml = isHtml ?? (typeof body === 'string' && (/<[a-z][\s\S]*>/i.test(body) || body.includes('<br') || body.includes('<table')));

    const messagePayload = {
      message: {
        subject: subject || '',
        body: {
          contentType: shouldSendAsHtml ? 'HTML' : 'Text',
          content: body || '',
        },
        toRecipients: toRecipients.map((email: string) => ({
          emailAddress: { address: email.trim() },
        })),
        ccRecipients: Array.isArray(ccRecipients)
          ? ccRecipients.map((email: string) => ({
              emailAddress: { address: email.trim() },
            }))
          : [],
        from: { emailAddress: { address: fromAddress } },
      },
      saveToSentItems: true,
    };

    const sendResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUserIdentifier)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      }
    );

    if (!sendResp.ok) {
      const errJson = (await sendResp.json().catch(() => ({}))) as any;
      const code = errJson.error?.code || '';
      const message = errJson.error?.message || sendResp.statusText;
      console.warn(`[M365 Send Warning] (${sendResp.status}):`, code, message);

      let detailedHint = '';
      if (sendResp.status === 403 || code.includes('AccessDenied') || code.includes('Authorization_RequestDenied')) {
        detailedHint = ' Azure AD（Entra ID）のアプリ登録に【Mail.Send】（Application/アプリケーションの許可）が未許可、または「管理者の同意」が未実施です。';
      } else if (code.includes('SendAsDenied') || message.includes('SendAsDenied')) {
        detailedHint = ' 差出人アカウントに共有メールボックスの「差出人として送信 (Send As)」アクセス許可が不足しています。Exchange管理センターをご確認ください。';
      } else if (sendResp.status === 404 || code.includes('ErrorItemNotFound') || code.includes('ResourceNotFound')) {
        detailedHint = ` 指定された送信元「${targetUserIdentifier}」がGraph APIのユーザーメールボックスとして見つかりません。M365グループの場合は設定で特定ユーザーのUPN（kita@tac-japan.co.jp 等）を指定するか、共有メールボックスアドレスをご使用ください。`;
      }

      return res.status(400).json({
        success: false,
        error: `メール送信失敗 (HTTP ${sendResp.status} - ${code}): ${message}.${detailedHint}`,
      });
    }

    return res.json({
      success: true,
      message: 'Microsoft 365 共有メールボックスよりメールを送信しました。',
      sentAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn('M365 send warning:', err?.message || err);
    return res.status(400).json({
      success: false,
      error: err.message || 'メールの送信に失敗しました。',
    });
  }
});

/**
 * Fetch a specific attachment on-demand directly from Microsoft Graph API
 */
m365Router.post('/attachment', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, messageId, attachmentId } = req.body;

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      return res.status(400).json({ success: false, error: 'Microsoft 365 の認証資格情報が設定されていません。' });
    }

    if (!messageId || !attachmentId) {
      return res.status(400).json({ success: false, error: 'messageId と attachmentId が必要です。' });
    }

    const cleanMessageId = String(messageId).replace(/^graph_/, '').replace(/_\d+$/, '');
    const cleanAttachmentId = String(attachmentId).replace(/^att_/, '');

    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);
    const targetUserIdentifier = resolution.userId || resolution.userPrincipalName || targetEmail;

    // 1. Try standard user / shared mailbox attachment endpoint
    let attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/messages/${encodeURIComponent(cleanMessageId)}/attachments/${encodeURIComponent(cleanAttachmentId)}`;

    let attResp = await fetch(attUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    // 2. If 404 and userPrincipalName differs from targetUserIdentifier, try userPrincipalName
    if (!attResp.ok && userPrincipalName && userPrincipalName !== targetUserIdentifier) {
      const altUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userPrincipalName
      )}/messages/${encodeURIComponent(cleanMessageId)}/attachments/${encodeURIComponent(cleanAttachmentId)}`;
      const altResp = await fetch(altUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (altResp.ok) {
        attResp = altResp;
      }
    }

    // 3. If 404 and target is a group, try group posts attachment endpoint
    if (!attResp.ok && resolution.isGroup && resolution.userId) {
      const groupAttUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
        resolution.userId
      )}/threads/${encodeURIComponent(cleanMessageId)}/posts/${encodeURIComponent(cleanMessageId)}/attachments/${encodeURIComponent(cleanAttachmentId)}`;
      const gResp = await fetch(groupAttUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (gResp.ok) {
        attResp = gResp;
      }
    }

    if (!attResp.ok) {
      const errJson = (await attResp.json().catch(() => ({}))) as any;
      return res.status(attResp.status).json({
        success: false,
        error: `添付ファイルの取得に失敗しました (${attResp.status}): ${errJson?.error?.message || attResp.statusText}`,
      });
    }

    const att = (await attResp.json()) as any;
    const isPdf =
      (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
      (att.name && att.name.toLowerCase().endsWith('.pdf'));

    let dataUrl: string | undefined;
    if (att.contentBytes) {
      const mime = att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream');
      dataUrl = `data:${mime};base64,${att.contentBytes}`;
    }

    return res.json({
      success: true,
      attachment: {
        id: att.id || attachmentId,
        fileName: att.name || 'attachment',
        contentType: att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        sizeBytes: att.size || 0,
        isPdf: !!isPdf,
        dataUrl,
        contentId: att.contentId || att.name || '',
      },
    });
  } catch (err: any) {
    console.warn('Attachment on-demand fetch warning:', err);
    return res.status(500).json({
      success: false,
      error: err.message || '添付ファイルのオンデマンド取得中にエラーが発生しました。',
    });
  }
});

/**
 * POST /api/m365/message-attachments
 * Fetch all attachments list for a specific message from Microsoft Graph API
 */
m365Router.post('/message-attachments', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, messageId } = req.body as any;

    const actualTenantId = tenantId || process.env.M365_TENANT_ID;
    const actualClientId = clientId || process.env.M365_CLIENT_ID;
    const actualClientSecret = clientSecret || process.env.M365_CLIENT_SECRET;
    const targetEmail = groupEmail || process.env.M365_GROUP_EMAIL || 'tac-hellmann@tac-japan.co.jp';

    if (!actualTenantId || !actualClientId || !actualClientSecret) {
      res.status(400).json({ success: false, error: 'Microsoft 365 の認証資格情報が設定されていません。' });
      return;
    }

    if (!messageId) {
      res.status(400).json({ success: false, error: 'messageId が必要です。' });
      return;
    }

    const cleanMessageId = String(messageId).replace(/^graph_/, '').replace(/_\d+$/, '');
    const token = await getGraphAccessToken(actualTenantId, actualClientId, actualClientSecret);
    const resolution = await resolveMailboxTarget(token, targetEmail, userPrincipalName);
    const targetUserIdentifier = resolution.userId || resolution.userPrincipalName || targetEmail;

    // 1. Try standard user / shared mailbox
    let attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      targetUserIdentifier
    )}/messages/${encodeURIComponent(cleanMessageId)}/attachments`;

    let attResp = await fetch(attUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    // 2. If 404 and userPrincipalName differs from targetUserIdentifier, try userPrincipalName
    if (!attResp.ok && userPrincipalName && userPrincipalName !== targetUserIdentifier) {
      const altUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userPrincipalName
      )}/messages/${encodeURIComponent(cleanMessageId)}/attachments`;
      const altResp = await fetch(altUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (altResp.ok) {
        attResp = altResp;
      }
    }

    // 3. If 404 and target is a group, search group threads/posts
    if (!attResp.ok && resolution.isGroup && resolution.userId) {
      const groupThreadsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
        resolution.userId
      )}/threads?$top=20`;
      const gThreadsResp = await fetch(groupThreadsUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (gThreadsResp.ok) {
        const tData = (await gThreadsResp.json()) as any;
        const threads = Array.isArray(tData.value) ? tData.value : [];
        for (const thread of threads) {
          const pUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
            resolution.userId
          )}/threads/${thread.id}/posts/${encodeURIComponent(cleanMessageId)}/attachments`;
          const pResp = await fetch(pUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          });
          if (pResp.ok) {
            attResp = pResp;
            break;
          }
        }
      }
    }

    if (!attResp.ok) {
      res.json({
        success: true,
        attachments: [],
      });
      return;
    }

    const aData = (await attResp.json()) as any;
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

    res.json({
      success: true,
      attachments,
    });
  } catch (err: any) {
    console.warn('Message attachments fetch warning:', err);
    res.json({
      success: true,
      attachments: [],
    });
  }
});

