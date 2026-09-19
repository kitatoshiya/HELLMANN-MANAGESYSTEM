import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();


export const m365Router = express.Router();

/**
 * In-memory resolution cache to avoid redundant round-trips to Microsoft Graph
 */
const mailboxResolutionCache = new Map<string, { data: MailboxResolution; expiresAt: number }>();

/**
 * Helper to fetch with a timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

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

  const resp = await fetchWithTimeout(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  }, 5000);

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

  const cacheKey = `${identifierToTry.toLowerCase()}`;
  const cached = mailboxResolutionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. Direct user / group lookup by ID or UPN
  try {
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifierToTry);

    const [directUserResp, directGroupResp] = await Promise.all([
      fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identifierToTry)}?$select=id,displayName,mail,userPrincipalName`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      ).catch(() => null),
      isGuid
        ? fetchWithTimeout(
            `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(identifierToTry)}?$select=id,displayName,mail`,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
            4000
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (directUserResp && directUserResp.ok) {
      const u = (await directUserResp.json()) as any;
      const res: MailboxResolution = {
        success: true,
        userId: u.id,
        userPrincipalName: u.userPrincipalName,
        displayName: u.displayName || u.mail || identifierToTry,
        mail: u.mail || u.userPrincipalName || identifierToTry,
      };
      mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
      return res;
    }

    if (directGroupResp && directGroupResp.ok) {
      const g = (await directGroupResp.json()) as any;
      const res: MailboxResolution = {
        success: true,
        userId: g.id,
        userPrincipalName: g.mail || targetEmail || '',
        displayName: g.displayName || targetEmail,
        mail: g.mail || targetEmail,
        isGroup: true,
      };
      mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
      return res;
    }
  } catch (err) {
    console.warn('Direct user/group lookup error:', err);
  }

  // 2. Parallel query across Users & Groups
  try {
    const emailPrefix = targetEmail.split('@')[0] || '';
    const userFilter = encodeURIComponent(`mail eq '${targetEmail}' or userPrincipalName eq '${targetEmail}'`);
    const groupFilter = encodeURIComponent(`mail eq '${targetEmail}' or mailNickname eq '${emailPrefix}'`);

    const [userFilterResp, groupFilterResp] = await Promise.all([
      fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/users?$filter=${userFilter}&$select=id,displayName,mail,userPrincipalName`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      ).catch(() => null),
      fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/groups?$filter=${groupFilter}&$select=id,displayName,mail`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      ).catch(() => null),
    ]);

    if (userFilterResp && userFilterResp.ok) {
      const uData = (await userFilterResp.json()) as any;
      if (Array.isArray(uData.value) && uData.value.length > 0) {
        const u = uData.value[0];
        const res: MailboxResolution = {
          success: true,
          userId: u.id,
          userPrincipalName: u.userPrincipalName,
          displayName: u.displayName || u.mail || targetEmail,
          mail: u.mail || u.userPrincipalName || targetEmail,
        };
        mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
        return res;
      }
    }

    if (groupFilterResp && groupFilterResp.ok) {
      const gData = (await groupFilterResp.json()) as any;
      if (Array.isArray(gData.value) && gData.value.length > 0) {
        const g = gData.value[0];
        const res: MailboxResolution = {
          success: true,
          userId: g.id,
          userPrincipalName: g.mail || targetEmail || '',
          displayName: g.displayName || targetEmail,
          mail: g.mail || targetEmail,
          isGroup: true,
        };
        mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
        return res;
      }
    }
  } catch (err) {
    console.warn('Parallel user/group query error:', err);
  }

  // 3. Fallback: Lookup candidate users from tenant
  let availableUsers: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }> = [];
  try {
    const listResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=25`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      3000
    ).catch(() => null);

    if (listResp && listResp.ok) {
      const data = (await listResp.json()) as any;
      if (Array.isArray(data.value)) {
        availableUsers = data.value.map((u: any) => ({
          id: u.id,
          displayName: u.displayName || '',
          mail: u.mail || '',
          userPrincipalName: u.userPrincipalName || '',
        }));

        const prefix = targetEmail.split('@')[0]?.toLowerCase();
        if (prefix) {
          const match = availableUsers.find(
            (u) =>
              (u.userPrincipalName && u.userPrincipalName.toLowerCase().startsWith(prefix)) ||
              (u.mail && u.mail.toLowerCase().startsWith(prefix)) ||
              (u.displayName && u.displayName.toLowerCase().includes(prefix))
          );
          if (match) {
            const res: MailboxResolution = {
              success: true,
              userId: match.id,
              userPrincipalName: match.userPrincipalName,
              displayName: match.displayName,
              mail: match.mail || match.userPrincipalName,
              availableUsers,
            };
            mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
            return res;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Tenant users listing warning:', err);
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
    const { tenantId, clientId, clientSecret } = req.body || {};
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
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName } = req.body || {};

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
    } = req.body || {};
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
      const threadsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
        resolution.userId
      )}/threads?$top=${Math.min(limit, 20)}&$orderby=lastDeliveredDateTime%20desc&$select=id,topic,hasAttachments,lastDeliveredDateTime,uniqueSenders,toRecipients,ccRecipients`;

      const threadsResp = await fetchWithTimeout(threadsUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }, 5000).catch(() => null);

      if (!threadsResp || !threadsResp.ok) {
        const status = threadsResp ? threadsResp.status : 504;
        const errJson = threadsResp ? ((await threadsResp.json().catch(() => ({}))) as any) : {};
        console.warn(`[M365 Group Sync Warning] (${status}):`, errJson.error?.message || (threadsResp ? threadsResp.statusText : 'Timeout'));
        return res.json({
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

      const threadsData = (await threadsResp.json().catch(() => ({}))) as any;
      const threads: any[] = Array.isArray(threadsData.value) ? threadsData.value : [];
      const processedInbox: any[] = [];
      const processedSent: any[] = [];

      // Fetch posts for top active threads in parallel (max 8 threads for speed)
      const targetThreads = threads.slice(0, 8);
      const threadResults = await Promise.all(
        targetThreads.map(async (thread) => {
          try {
            const threadLastDelivered = thread.lastDeliveredDateTime ? new Date(thread.lastDeliveredDateTime).getTime() : 0;
            if (cutoffTime > 0 && threadLastDelivered > 0 && threadLastDelivered < cutoffTime) {
              return { inbox: [], sent: [] };
            }

            const threadTo = parseGraphRecipientsList(thread.toRecipients);
            const threadCc = parseGraphRecipientsList(thread.ccRecipients);

            const postsUrl = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(
              resolution.userId
            )}/threads/${thread.id}/posts?$top=10&$select=id,from,sender,body,receivedDateTime,hasAttachments,newParticipants`;
            const postsResp = await fetchWithTimeout(postsUrl, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            }, 3500).catch(() => null);

            if (!postsResp || !postsResp.ok) return { inbox: [], sent: [] };
            const postsData = (await postsResp.json().catch(() => ({}))) as any;
            const posts: any[] = Array.isArray(postsData.value) ? postsData.value : [];

            const threadInbox: any[] = [];
            const threadSent: any[] = [];

            for (const post of posts) {
              const senderAddress = post.from?.emailAddress?.address?.toLowerCase() || '';
              const isUserSender =
                (userPrincipalName && senderAddress === userPrincipalName.toLowerCase()) ||
                senderAddress.startsWith('kita@') ||
                senderAddress.includes('tac-japan.co.jp');

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
                attachments: [],
                hasAttachments: !!post.hasAttachments,
              };

              threadInbox.push(item);
              if (isUserSender) {
                threadSent.push({
                  ...item,
                  direction: 'OUTGOING' as const,
                  folder: 'SENT' as const,
                });
              }
            }
            return { inbox: threadInbox, sent: threadSent };
          } catch {
            return { inbox: [], sent: [] };
          }
        })
      );

      for (const resItem of threadResults) {
        processedInbox.push(...resItem.inbox);
        processedSent.push(...resItem.sent);
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

    // Map attachment metadata directly without making extra HTTP calls
    function mapAttachments(msg: any): any[] {
      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        return msg.attachments.map((att: any) => {
          const isPdf =
            (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
            (att.name && att.name.toLowerCase().endsWith('.pdf'));
          return {
            id: att.id,
            fileName: att.name || 'attachment',
            contentType: att.contentType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
            sizeBytes: att.size || 0,
            isPdf: !!isPdf,
            contentId: att.contentId || att.name || '',
            isInline: !!att.isInline,
          };
        });
      }
      return [];
    }

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
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, toRecipients, ccRecipients, subject, body, isHtml } = req.body || {};

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
    const { tenantId, clientId, clientSecret, groupEmail, userPrincipalName, messageId, attachmentId } = req.body || {};

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





const app = express();
const PORT = 3000;

// CORS headers middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Serve public static assets (including pdf.worker.min.mjs and cmaps)
const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Body parser middleware (supports large PDF payloads base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount Microsoft 365 Graph API proxy router
app.use(['/api/m365', '/m365'], m365Router);

// Initialize Gemini SDK lazily
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});


/**
 * Server-side persistent PDF storage for multi-user / multi-terminal access
 */
const pdfServerCache = new Map<string, string>();

function getPdfStoreDir(): string | null {
  try {
    const primaryDir = path.join(process.cwd(), 'data', 'pdfs');
    if (fs.existsSync(primaryDir)) return primaryDir;
    
    const tmpDir = path.join(os.tmpdir(), 'export_mgmt_pdfs');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  } catch {
    return null;
  }
}

app.get('/api/shipment-pdfs/:id', (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId) return res.status(200).json({ success: false, pdfDataUrl: null, error: 'ID required' });

    const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    if (pdfServerCache.has(safeId)) {
      return res.json({ success: true, pdfDataUrl: pdfServerCache.get(safeId) });
    }

    try {
      const storeDir = getPdfStoreDir();
      if (storeDir) {
        const filePath = path.join(storeDir, `${safeId}.json`);
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (data && data.pdfDataUrl) {
            pdfServerCache.set(safeId, data.pdfDataUrl);
            return res.json({ success: true, pdfDataUrl: data.pdfDataUrl });
          }
        }
      }
    } catch (e) {
      // Ignored if disk read fails in serverless
    }

    return res.json({ success: false, pdfDataUrl: null, message: 'PDF not found on server' });
  } catch (err: any) {
    console.error('Error in GET /api/shipment-pdfs:', err);
    return res.status(200).json({ success: false, pdfDataUrl: null, error: err?.message || 'Server error' });
  }
});

/**
 * Direct PDF asset stream handler for iframe embed requests (/pdfs/:id or /shipment_pdfs/:id)
 * Serves raw PDF buffer if found, or clean HTML fallback (prevents 404 network errors in DevTools)
 */
app.get(['/pdfs/:id', '/shipment_pdfs/:id'], (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<html><body>PDF未指定</body></html>');
    }

    const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    let pdfUrl: string | null = pdfServerCache.get(safeId) || null;

    if (!pdfUrl) {
      try {
        const storeDir = getPdfStoreDir();
        if (storeDir) {
          const filePath = path.join(storeDir, `${safeId}.json`);
          if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            pdfUrl = data?.pdfDataUrl || null;
          }
        }
      } catch (e) {
        // Ignored in read-only environment
      }
    }

    if (pdfUrl && pdfUrl.startsWith('data:application/pdf')) {
      const base64Data = pdfUrl.split(',')[1];
      if (base64Data) {
        const pdfBuffer = Buffer.from(base64Data, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        return res.status(200).send(pdfBuffer);
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;margin:0;"><div style="text-align:center;">PDFドキュメントが準備されていないか、存在しません</div></body></html>'
    );
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;margin:0;"><div style="text-align:center;">PDFデータの読み込みエラー</div></body></html>'
    );
  }
});

/**
 * Handle /upload/* static and dynamic upload route fallbacks
 * Returns valid file if present, or 1x1 transparent PNG fallback (prevents 404 network errors)
 */
app.all(['/upload/*', '//upload/*', '/upload', '/api/upload/*'], (req, res) => {
  const reqPath = req.path.replace(/^\/+/, '');
  const possiblePaths = [
    path.join(process.cwd(), reqPath),
    path.join(process.cwd(), 'public', reqPath),
    path.join(process.cwd(), 'data', reqPath),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return res.sendFile(p);
    }
  }

  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  res.setHeader('Content-Type', 'image/png');
  return res.status(200).send(transparentPng);
});

app.post('/api/shipment-pdfs', (req, res) => {
  try {
    const { shipmentId, pdfDataUrl, aliases } = req.body || {};
    if (!shipmentId || !pdfDataUrl) {
      return res.status(400).json({ success: false, error: 'shipmentId and pdfDataUrl required' });
    }

    const idsToSave = [shipmentId, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);

    for (const rawId of idsToSave) {
      const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      pdfServerCache.set(safeId, pdfDataUrl);

      try {
        const storeDir = getPdfStoreDir();
        if (storeDir) {
          const filePath = path.join(storeDir, `${safeId}.json`);
          fs.writeFileSync(
            filePath,
            JSON.stringify({ shipmentId: rawId, pdfDataUrl, updatedAt: new Date().toISOString() }),
            'utf8'
          );
        }
      } catch (e) {
        // Disk write fallback in read-only environment
      }
    }

    return res.json({ success: true, savedIds: idsToSave });
  } catch (err: any) {
    console.error('Error in POST /api/shipment-pdfs:', err);
    return res.status(200).json({ success: false, error: err?.message || 'Failed to save PDF' });
  }
});

/**
 * Shared Server-side Billing Pattern Presets Store
 */
function getPresetsFilePath(): string {
  const dataDir = path.join(process.cwd(), 'data');
  return path.join(dataDir, 'billing_presets.json');
}

const INITIAL_BILLING_PRESETS = [
  {
    id: 'preset_standard_export',
    name: '1. 標準航空輸出通関プラン',
    isDefault: true,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '取扱料 (Handling Fee)', amount: 5000 },
      { taxable: false, name: '上屋使用料 (Terminal)', amount: 3200 },
      { taxable: true, name: 'X線検査費用', amount: 2500 },
      { taxable: false, name: 'トラック集荷料', amount: '' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'preset_customs_only',
    name: '2. 通関申告のみ',
    isDefault: false,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '書類点検作成料', amount: 3000 },
    ],
    createdAt: '2026-01-01T00:01:00.000Z',
  },
  {
    id: 'preset_express_dg',
    name: '3. 危険物・緊急出荷フルセット',
    isDefault: false,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '危険物点検梱包費', amount: 15000 },
      { taxable: true, name: 'X線・爆発物検査費', amount: 3500 },
      { taxable: true, name: 'アタッチ書類作成費', amount: 4000 },
      { taxable: false, name: '時間外緊急対応費', amount: '' },
    ],
    createdAt: '2026-01-01T00:02:00.000Z',
  },
];

let serverMemoryPresets: any[] | null = null;

function readServerPresets() {
  if (serverMemoryPresets && serverMemoryPresets.length > 0) {
    return serverMemoryPresets;
  }
  const presetsFile = getPresetsFilePath();
  try {
    if (fs.existsSync(presetsFile)) {
      const content = fs.readFileSync(presetsFile, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasDefault = parsed.some((p: any) => p.isDefault);
        if (!hasDefault && parsed.length > 0) {
          parsed[0].isDefault = true;
        }
        serverMemoryPresets = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading billing presets file:', e);
  }
  // Initialize file if missing or empty
  try {
    const dataDir = path.dirname(presetsFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(presetsFile, JSON.stringify(INITIAL_BILLING_PRESETS, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing initial billing presets:', e);
  }
  serverMemoryPresets = INITIAL_BILLING_PRESETS;
  return INITIAL_BILLING_PRESETS;
}

function writeServerPresets(presets: any[]) {
  serverMemoryPresets = presets;
  try {
    const presetsFile = getPresetsFilePath();
    const dataDir = path.dirname(presetsFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(presetsFile, JSON.stringify(presets, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing billing presets:', e);
  }
}

app.get('/api/billing-presets', (req, res) => {
  try {
    const presets = readServerPresets();
    return res.json({ success: true, presets });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/billing-presets', (req, res) => {
  try {
    const { name, items, isDefault } = req.body;
    if (!name || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Name and items required' });
    }

    const presets = readServerPresets();
    const id = `preset_${Date.now()}`;
    const shouldBeDefault = Boolean(isDefault);

    const newPreset = {
      id,
      name: String(name).trim().slice(0, 30),
      isDefault: shouldBeDefault,
      items: items.map((it: any) => ({
        taxable: Boolean(it.taxable),
        name: String(it.name || '').slice(0, 20),
        amount: it.amount === '' || it.amount === null ? '' : Number(it.amount),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let updated = [newPreset, ...presets.filter((p: any) => p.name !== newPreset.name)].slice(0, 10);
    if (shouldBeDefault) {
      updated = updated.map((p: any) => ({
        ...p,
        isDefault: p.id === id,
      }));
    } else if (!updated.some((p: any) => p.isDefault) && updated.length > 0) {
      updated[0].isDefault = true;
    }
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Set default preset pattern
app.post('/api/billing-presets/:id/default', (req, res) => {
  try {
    const presetId = req.params.id;
    const presets = readServerPresets();
    const target = presets.find((p: any) => p.id === presetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Preset not found' });
    }

    const updated = presets.map((p: any) => ({
      ...p,
      isDefault: p.id === presetId,
    }));
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/billing-presets/:id', (req, res) => {
  try {
    const presetId = req.params.id;
    if (!presetId) return res.status(400).json({ success: false, error: 'Preset ID required' });

    const presets = readServerPresets();
    let updated = presets.filter((p: any) => p.id !== presetId);
    if (updated.length > 0 && !updated.some((p: any) => p.isDefault)) {
      updated[0].isDefault = true;
    }
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Gemini In-Memory SHA-256 Response Cache (Zero Token Duplication)
// -------------------------------------------------------------
interface CachedParseEntry {
  data: any;
  cachedAt: number;
}
const geminiParseCache = new Map<string, CachedParseEntry>();
const MAX_CACHE_ENTRIES = 300;

function getCachedGeminiResult(cacheKey: string): any | null {
  const entry = geminiParseCache.get(cacheKey);
  if (!entry) return null;
  // Expire after 48 hours
  if (Date.now() - entry.cachedAt > 48 * 60 * 60 * 1000) {
    geminiParseCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedGeminiResult(cacheKey: string, data: any) {
  if (geminiParseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = geminiParseCache.keys().next().value;
    if (oldestKey) geminiParseCache.delete(oldestKey);
  }
  geminiParseCache.set(cacheKey, { data, cachedAt: Date.now() });
}

/**
 * Helper to generate content with exponential backoff retries and model fallback
 * Prioritizes high-efficiency gemini-3.1-flash-lite (lowest token cost) and gemini-3.8-flash
 */
async function generateContentWithRetryAndFallback(ai: GoogleGenAI, requestParams: any) {
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini API] Requesting model ${modelName} (attempt ${attempt}/2)...`);
        const response = await ai.models.generateContent({
          ...requestParams,
          model: modelName,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        const errStr = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));

        const isModelUnavailable =
          errStr.includes('not found') ||
          errStr.includes('NOT_FOUND') ||
          errStr.includes('404') ||
          errStr.includes('no longer available');

        if (isModelUnavailable) {
          console.warn(`[Gemini API] Model ${modelName} is not available, falling back to next model...`);
          break;
        }

        const isTransientOrQuota =
          errStr.includes('503') ||
          errStr.includes('UNAVAILABLE') ||
          errStr.includes('Deadline expired') ||
          errStr.includes('deadline') ||
          errStr.includes('high demand') ||
          errStr.includes('rate limit') ||
          errStr.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('quota');

        console.warn(`[Gemini API] Error on model ${modelName} (attempt ${attempt}/2):`, errStr);

        if (isTransientOrQuota && attempt < 2 && !errStr.includes('RESOURCE_EXHAUSTED')) {
          const delayMs = attempt * 600;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          console.warn(`[Gemini API] Failed on model ${modelName}. Moving to next fallback model...`);
          break;
        }
      }
    }
  }

  throw lastError;
}

/**
 * API Endpoint: Parse Shipping Instruction (PDF or Text) via Gemini Flash
 * Optimized for token conservation:
 * 1. Checks in-memory cache by SHA-256 hash first (0 tokens on hit).
 * 2. If textContent is available, sends compact text (~200 tokens) instead of heavy base64 PDF (~3,000 tokens).
 * 3. Concise prompt reduces input token count by ~60%.
 */
app.post('/api/parse-pdf', async (req, res) => {
  try {
    const { pdfBase64, textContent, fileName } = req.body;

    if (!pdfBase64 && !textContent) {
      return res.status(400).json({ error: 'pdfBase64 or textContent is required' });
    }

    // 1. Calculate Cache Key from input content (with versioning v8)
    const rawContentForHash = (textContent && textContent.trim().length >= 40)
      ? `v8_TEXT:${textContent.trim()}`
      : `v8_PDF:${pdfBase64 ? pdfBase64.slice(0, 4000) + pdfBase64.length : ''}`;
    const cacheKey = crypto.createHash('sha256').update(rawContentForHash).digest('hex');

    // 2. Cache Check (Zero Token Savings)
    const cached = getCachedGeminiResult(cacheKey);
    if (cached) {
      console.log(`[Gemini API /parse-pdf] Cache hit (0 tokens consumed, hash: ${cacheKey.slice(0, 8)})`);
      return res.json({
        success: true,
        data: cached,
        fromCache: true,
        tokensSaved: true,
        parsedAt: new Date().toISOString(),
      });
    }

    const ai = getGeminiClient();

    // High precision extraction prompt for Japanese Air Cargo Shipping Instructions (SI)
    const promptText = `あなたは日本の航空貨物輸出入およびフォワーダー業務（Shipping Instruction / SI指示書）の精密解析エンジンです。
提示されたドキュメント（テキストまたはPDF画像）から以下のルールに従い厳密に各項目を抽出してください。

【厳格な抽出ルール】
1. mawbNumber (MAWB番号 / Master Air Waybill No.):
   - 形式は「3桁プレフィックス - 8桁通し番号」（例: "189-04358045", "618-55129605", "804-22772584"）。
   - 【最重要】後半の8桁の中に余分なハイフンを入れて "189-0435-8045" のように分割しないでください。必ず "189-04358045" の形式で抽出すること。

2. hawbNumber (HAWB番号 / House Air Waybill No.):
   - "HAWB", "H-AWB", "ハウスAWB" の項目欄・枠内に記載されている番号（例: "S2602006126", "HLM-99218", "H260100123" など）。
   - 【最重要】"S2602006126"のように「S」から始まる番号であっても、HAWB欄に記載されている場合は必ず "hawbNumber" に設定してください。
   - HAWB欄に値が存在する場合は、絶対に null や "なし" にしないでください。
   - HAWB欄が完全に空欄、または「直截」「DIRECT」と明記されている場合のみ null にしてください。

3. orderNumber (受注NO. / 注文番号):
   - "受注NO.", "受注番号", "PO NO.", "Order No" の横に記載されている番号。
   - 【最重要】HAWB番号を受注番号として誤って入れないでください。「受注NO.」欄が空白の場合は空文字 "" または null にしてください。

4. invoiceNumber (インボイス番号):
   - "INVOICE NO.", "インボイス番号", "INV NO." の横に明記されている番号（例: "R260914005 (L)"）。
   - 【最重要・厳格禁止】"INVOICE NO." 欄が空白、未記載、またはコロンのみの場合は、必ず空文字 "" にしてください。
   - **絶対に近隣の上屋コード「4MW49」、場所「4MW49」、通関業者コード「100OSA0」、通関コード「D8TKF」などをインボイス番号として誤取得しないでください。**

5. shipper (荷主):
   - "SHIPPER : " の横または直下に記載されている荷主企業名（例: "Golden Cargo S.A.", "KB Trans"）。
   - 【最重要】"サブ代理店"（SUB AGENT, 例: "HELLMANN WORLDWIDE LOGISTICS INC."）や "コード:..."、"TEL:..."、"担当者:..." は **SHIPPER名に絶対に含めないでください**。純粋な荷主名のみを抽出すること。

6. consignee (荷受人):
   - "CONSIGNEE : " の横または直下に記載されている荷受人企業名・船名等（例: "HYUNDAI BUSAN", "OCEAN FORTUNE"）。
   - 【最重要】"行先"（例: "SIN", "PVG"）や "請求先 国内"、"サブ代理店" を CONSIGNEE に誤認してはなりません。CONSIGNEE欄に記載された値（"HYUNDAI BUSAN" など）を抽出すること。

7. portOfLoading (積地 / POL): 出発空港コードまたは名称（例: "KIX", "NRT", "HND"）。
8. destination (向地 / 行先 / DEST): 目的空港コードまたは名称（例: "SIN", "PVG", "CGK", "LAX", "FRA"）。
9. customsClearanceDate (通関日 / 仕立日): YYYY-MM-DD 形式（例: 2026年09月14日 → "2026-09-14"）。
10. flightRoute (フライト / ルート): 便名および路線（例: "KIX -> SIN", "KIX -> PVG", "KIX -> CGK"）。
11. pieces (個数): 例 "1", "2", "2 CARTON", "12 WOODEN CASES"。
12. grossWeight (総重量): 例 "6.0", "6.0 kg", "21.2 kg", "22.5 kg"。
13. specialNotes (特記事項):
    - 指示書左下等の「特記事項」専用枠の中に記載されているテキスト（例：「ヘルマンシップスパーツ\n船名でご確認下さい\nHYUNDAI BUSAN\n9月14日搬入予定」）。
    - 【最重要・混入厳禁】営業担当者名（例: "TAC62 浪口 茜"）や、ヘッダーの項目名（"HAWB", "MAWB", "FLT.", "ROUTE", "積地", "行先" など）は**絶対に特記事項に含めないでください**。
    - 指示書に記載された改行（\\n）をそのまま保持して抽出すること。
14. cutTime (カット時間): HH:MM または null。
15. primaryKey: hawbNumber が存在する場合は hawbNumber、なければ mawbNumber。
16. suggestedTasks: 輸出業務の標準工程タスク（5〜7件の順序付き配列）。`;

    const contents: any[] = [{ text: promptText }];

    // Multimodal input: always include PDF inlineData if available for 2D spatial layout understanding
    if (pdfBase64) {
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      contents.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: cleanBase64,
        },
      });
      if (textContent && textContent.trim().length >= 40) {
        contents.push({
          text: `SI OCR Text Reference:\n${textContent.slice(0, 4000)}`,
        });
      }
    } else if (textContent) {
      contents.push({
        text: `SI Text Content:\n${textContent}`,
      });
    }

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: { parts: contents },
      config: {
        systemInstruction: 'Output strict valid JSON following schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mawbNumber: { type: Type.STRING },
            hawbNumber: { type: Type.STRING, nullable: true },
            orderNumber: { type: Type.STRING },
            invoiceNumber: { type: Type.STRING },
            shipper: { type: Type.STRING },
            consignee: { type: Type.STRING },
            portOfLoading: { type: Type.STRING, nullable: true },
            destination: { type: Type.STRING, nullable: true },
            customsClearanceDate: { type: Type.STRING },
            flightRoute: { type: Type.STRING },
            pieces: { type: Type.STRING, nullable: true },
            grossWeight: { type: Type.STRING, nullable: true },
            specialNotes: { type: Type.STRING, nullable: true },
            cutTime: { type: Type.STRING, nullable: true, description: 'カット時間 (e.g. 17:00). Null if not present.' },
            primaryKey: { type: Type.STRING },
            suggestedTasks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'mawbNumber',
            'orderNumber',
            'invoiceNumber',
            'shipper',
            'consignee',
            'customsClearanceDate',
            'flightRoute',
            'primaryKey',
            'suggestedTasks',
          ],
        },
      },
    });

    let jsonText = response.text || '{}';
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    const parsedData = JSON.parse(jsonText);

    // --- Deterministic Post-processing & Normalization ---

    // 1. Normalize MAWB to 3 digits - 8 digits (e.g. 189-04358045)
    let mawbClean = String(parsedData.mawbNumber || '').trim();
    const mawb344 = mawbClean.match(/^(\d{3})[-\s](\d{4})[-\s](\d{4})$/);
    if (mawb344) {
      mawbClean = `${mawb344[1]}-${mawb344[2]}${mawb344[3]}`;
    } else {
      const mawb38 = mawbClean.match(/^(\d{3})[-\s]?(\d{8})$/);
      if (mawb38) {
        mawbClean = `${mawb38[1]}-${mawb38[2]}`;
      }
    }

    // 2. Clean HAWB Number
    let hawbClean: string | null = null;
    if (
      parsedData.hawbNumber &&
      String(parsedData.hawbNumber).trim() !== '' &&
      !['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '直截', 'direct', 'なし (直截)'].includes(
        String(parsedData.hawbNumber).trim().toLowerCase()
      )
    ) {
      hawbClean = String(parsedData.hawbNumber).trim();
    }

    // 3. Clean Order Number
    let orderNumberClean = parsedData.orderNumber ? String(parsedData.orderNumber).trim() : '';
    if (['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-'].includes(orderNumberClean.toLowerCase())) {
      orderNumberClean = '';
    }

    // 4. Clean Invoice Number
    let invoiceNumberClean = parsedData.invoiceNumber ? String(parsedData.invoiceNumber).trim() : '';
    if (['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '（空欄）', '(空欄)', '空欄', '未設定'].includes(invoiceNumberClean.toLowerCase())) {
      invoiceNumberClean = '';
    }
    // Reject warehouse/terminal/customs code false positives (e.g. 4MW49, 100OSA0, D8TKF)
    if (
      /^(?:4MW49|100OSA0|D8TKF|TAC\s*OSAKA|TAC\d+|OSA\d+)$/i.test(invoiceNumberClean) ||
      /(?:上屋|場所|通関コード|通関業者)/.test(invoiceNumberClean)
    ) {
      invoiceNumberClean = '';
    }

    // 5. Clean Shipper Name (remove Sub-agent / サブ代理店, TEL, FAX, etc.)
    let shipperClean = parsedData.shipper ? String(parsedData.shipper).trim() : '';
    // If raw text has explicit "SHIPPER : <name>", check for clean match
    if (textContent) {
      const shipperMatch = textContent.match(/SHIPPER\s*[:：]\s*([^\r\n]+)/i);
      if (shipperMatch && shipperMatch[1]) {
        let candidate = shipperMatch[1].trim()
          .replace(/サブ代理店.*$/i, '')
          .replace(/SUB\s*AGENT.*$/i, '')
          .replace(/コード\s*[:：].*$/i, '')
          .replace(/TEL\s*[:：].*$/i, '')
          .replace(/FAX\s*[:：].*$/i, '')
          .replace(/担当者\s*[:：].*$/i, '')
          .replace(/輸出者符号\s*[:：].*$/i, '')
          .trim();
        if (candidate.length >= 2 && !/^(?:なし|null|-)$/i.test(candidate)) {
          shipperClean = candidate;
        }
      }
    }
    shipperClean = shipperClean
      .replace(/(?:サブ代理店|SUB\s*AGENT)\s*[:：]?\s*[^\n\r,]+/gi, '')
      .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/担当者\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/輸出者符号\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/^SHIPPER\s*[:：]\s*/i, '')
      .trim();

    // 6. Clean Consignee Name (ensure true consignee e.g. "OCEAN FORTUNE" is extracted, not forwarder/subagent)
    let consigneeClean = parsedData.consignee ? String(parsedData.consignee).trim() : '';
    if (textContent) {
      const consigneeMatch = textContent.match(/CONSIGNEE\s*[:：]\s*([^\r\n]+)/i);
      if (consigneeMatch && consigneeMatch[1]) {
        let candidate = consigneeMatch[1].trim()
          .replace(/コード\s*[:：].*$/i, '')
          .replace(/TEL\s*[:：].*$/i, '')
          .replace(/FAX\s*[:：].*$/i, '')
          .replace(/NOTIFY\s*[:：].*$/i, '')
          .replace(/INVOICE\s*NO.*$/i, '')
          .replace(/請求先.*$/i, '')
          .trim();
        if (candidate.length >= 2 && !/^(?:なし|null|-)$/i.test(candidate)) {
          consigneeClean = candidate;
        }
      }
    }
    consigneeClean = consigneeClean
      .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/NOTIFY\s*[:：].*$/i, '')
      .replace(/^CONSIGNEE\s*[:：]\s*/i, '')
      .trim();

    // 7. Disambiguation: If HAWB was not recognized and got placed into orderNumber (e.g. S2602006126)
    if (!hawbClean && orderNumberClean) {
      if (/^S\d{7,14}$/i.test(orderNumberClean) || /^[A-Z]{1,4}[0-9\-_]{5,20}$/i.test(orderNumberClean)) {
        hawbClean = orderNumberClean;
        orderNumberClean = '';
      }
    }

    // 8. Fallback text scanning for HAWB from textContent if still missing
    const combinedRaw = (textContent || '') + '\n' + (parsedData.specialNotes || '');
    if (!hawbClean && combinedRaw) {
      const rawHawbMatch = combinedRaw.match(/(?:HAWB|H-AWB|ハウスAWB)[:\s\t\n]*([A-Za-z0-9\-_]{5,20})/i);
      if (
        rawHawbMatch &&
        rawHawbMatch[1] &&
        !['direct', '直截', 'なし', 'none', 'null'].includes(rawHawbMatch[1].toLowerCase())
      ) {
        hawbClean = rawHawbMatch[1].trim();
      }
    }

    // If orderNumber is identical to HAWB, clear orderNumber
    if (orderNumberClean && hawbClean && orderNumberClean === hawbClean) {
      orderNumberClean = '';
    }

    // 9. Format Special Notes with proper line breaks & remove header artifacts
    let specialNotesClean = parsedData.specialNotes ? String(parsedData.specialNotes).trim() : '';
    
    // Filter out forbidden header keywords that might come from text stream order
    const forbiddenHeaderRegexes = [
      /^営業担当者/i,
      /^TAC\d+/i,
      /^浪口/i,
      /^茜/i,
      /^HAWB$/i,
      /^MAWB$/i,
      /^FLT\.?$/i,
      /^ROUTE$/i,
      /^積地/i,
      /^行先/i,
      /^海外代理店/i,
      /^早出し/i,
      /^超早出し/i,
      /^RO\s+LOCAL/i,
      /^ETD\s*-\s*ETA/i,
      /^ＢＬ返却先/i,
      /^アタッチ書類/i,
      /^受注[NＮ][OＯ]/i,
      /^通関業者/i,
    ];

    if (specialNotesClean) {
      if (specialNotesClean.includes('\n')) {
        const cleanedLines = specialNotesClean
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)));
        specialNotesClean = cleanedLines.join('\n');
      } else {
        specialNotesClean = specialNotesClean
          .replace(/\s*(<MARKING>|\[MARKING\]|【MARKING】)\s*/gi, '\n$1\n')
          .replace(/\s*(SHIP\s+SPARES\s+IN\s+TRANSIT)\s*/gi, '\n$1\n')
          .replace(/\s*(船名でご確認下さい|船名確認|船名で確認)\s*/gi, '\n$1\n')
          .replace(/\s*(M\/V\s+[A-Za-z0-9\s&.,'-]+?)(?=\s+C\/NO|\s*<|\s*\d+月|\s*船名|\s*$)/gi, '\n$1\n')
          .replace(/\s*(HYUNDAI\s+BUSAN|OCEAN\s+FORTUNE)\s*/gi, '\n$1\n')
          .replace(/\s*(C\/NO\.?\s*\d+)/gi, '\n$1\n')
          .replace(/\s*(\d{1,2}月\d{1,2}日[^\s\n\r]*搬入[^\s\n\r]*|\d{1,2}\/\d{1,2}[^\s\n\r]*搬入[^\s\n\r]*)\s*/gi, '\n$1\n')
          .replace(/\s*([・•*])\s*/g, '\n$1 ')
          .replace(/\s*(インボイス番号[:：]|マーク[:：]|個数[:：]|GW[:：]|Size[:：]|ファーストにて搬入|保税[:：])/gi, '\n$1');

        specialNotesClean = specialNotesClean
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)))
          .join('\n');
      }
    }

    const primaryKey = hawbClean || mawbClean;

    const finalResult = {
      ...parsedData,
      mawbNumber: mawbClean,
      hawbNumber: hawbClean,
      orderNumber: orderNumberClean,
      invoiceNumber: invoiceNumberClean,
      shipper: shipperClean,
      consignee: consigneeClean,
      specialNotes: specialNotesClean,
      primaryKey,
    };

    // Save to Cache for subsequent calls
    setCachedGeminiResult(cacheKey, finalResult);

    return res.json({
      success: true,
      data: finalResult,
      fromCache: false,
      parsedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in /api/parse-pdf:', err);
    let userMsg = err.message || 'Failed to parse Shipping Instruction PDF with Gemini API';
    if (userMsg.includes('GEMINI_API_KEY')) {
      userMsg = 'PUBLISH環境（本番サーバー）に GEMINI_API_KEY 環境変数が設定されていません。画面左上の Settings メニューにて GEMINI_API_KEY を設定してデプロイしてください。';
    }
    return res.status(err.isQuotaError ? 429 : 500).json({
      success: false,
      error: userMsg,
      isQuotaError: !!err.isQuotaError,
    });
  }
});

/**
 * API Endpoint: Analyze X-ray Inspection PDF Page via Gemini Vision AI
 * High-accuracy Image OCR to fully transcribe scanned PDF pages, detect "爆発物検査依頼書" and extract AWB No.
 */
app.post('/api/analyze-xray-pdf', async (req, res) => {
  try {
    const { pdfBase64, imageBase64, textContent, pageNumber, totalPages } = req.body;

    if (!pdfBase64 && !imageBase64 && !textContent) {
      return res.status(400).json({ success: false, error: 'pdfBase64, imageBase64 or textContent is required' });
    }

    // Cache check for X-ray scan page
    const rawForHash = `XRAY_P${pageNumber || 1}_${textContent ? textContent.slice(0, 1000) : ''}_${imageBase64 ? imageBase64.slice(0, 500) + imageBase64.length : (pdfBase64 ? pdfBase64.slice(0, 500) + pdfBase64.length : '')}`;
    const cacheKey = crypto.createHash('sha256').update(rawForHash).digest('hex');
    const cached = getCachedGeminiResult(cacheKey);
    if (cached) {
      console.log(`[Gemini API /analyze-xray-pdf] Cache hit (0 tokens, page ${pageNumber || 1})`);
      return res.json({
        success: true,
        pageNumber,
        data: cached,
        fromCache: true,
        tokensSaved: true,
      });
    }

    const ai = getGeminiClient();
    let mimeType = 'image/jpeg';
    let cleanBase64 = '';

    // Prefer pdfBase64 if available (contains full lossless scan data directly ingestible by Gemini), or fallback to imageBase64
    if (pdfBase64) {
      mimeType = 'application/pdf';
      cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    } else if (imageBase64) {
      mimeType = 'image/jpeg';
      if (imageBase64.startsWith('data:image/png')) {
        mimeType = 'image/png';
      }
      cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    }

    const promptText = `
あなたは日本の航空貨物輸出検査書類（X線検査結果報告書、爆発物検査依頼書、航空貨物安全確認状、貨物受領書等）を高精度に画像解析・OCRテキスト化する専門AIです。
対象の文書はスキャン画像・FAX画像・デジタル画像から成るPDF（画像情報）です。
添付された画像（ページ ${pageNumber || 1} / ${totalPages || 1}）の全領域（上部タイトル、ヘッダー、表組み、印字テキスト、スタンプ・印影、手書き文字、チェックボックス、注釈、下部フッター）をくまなくスキャンし、高精度なOCRテキスト化を実施して以下のJSON形式で出力してください：

1. "hasExplosiveInspectionRequest": ページ内に「爆発物検査依頼書」という文字・タイトル・項目名が存在するかどうか。論理値 (true または false)。
   ※「爆発物検査依頼書」または「爆発物検査」の表記・依頼書タイトルが見つかる場合は true、それ以外の書類（例: 航空貨物安全確認状、受領書、通常X線検査結果表など）の場合は false。

2. "awbNumber": 書類に記載されている Air Waybill Number (AWB No / MAWB No / HAWB No)。
   ・印字テキスト、スタンプ印影、および手書き数字のいずれも高精度に認識してください。
   ・例: "074-71650644", "074 7165 0644", "123-45678901", "074-7165-0644" など。
   ・抽出の際は "074-71650644" のようにハイフン区切りの形式に正規化して出力してください。見つからない場合は null。

3. "documentTitle": ページの主要なタイトルまたは文書種別（例: "爆発物検査依頼書", "航空貨物安全確認状", "X線検査結果報告書", "貨物受領書" など）。

4. "summaryText": ページの主要記載内容の要約（例: "依頼年月日: 2026年08月13日, 代理店: TOKYO AIRCARGO, 荷主: KB TRANS, 個数: 9個, 重量: 1,012.0 KG, 検査結果: 異常なし" など）。

5. "extractedRawText": 画像から高精度OCRにて読み取れた全ての文字列・項目・値（OCR生テキスト全文）。
   ・表内の全項目名と値、日付、会社名、担当者署名・印影、個数・重量、品名、便名・行先、検査項目・判定結果などを改行区切りで漏れなく正確に文字起こししてください。

6. "detectedDate": 記載されている日付（例: "2026/08/13", "令和8年8月13日" など）。見つからない場合は null。
7. "agentOrShipper": 代理店名・荷主名・依頼者名。見つからない場合は null。
8. "piecesAndWeight": 個数・重量（例: "9 PKG / 1,012.0 KGS"）。見つからない場合は null。
9. "inspectionResultText": 検査結果・判定（例: "異常なし", "X線検査済", "合格" など）。見つからない場合は null。

${textContent ? `【参考テキスト（PDF内部テキストレイヤー）】:\n${textContent}\n` : ''}

厳格なJSONフォーマットで回答してください。
`;

    const parts: any[] = [{ text: promptText }];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      });
    }

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: { parts },
      config: {
        systemInstruction: 'You are a professional Japanese OCR and Document Analysis engine. Transcribe every text, number, and table from the image accurately into valid JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hasExplosiveInspectionRequest: { type: Type.BOOLEAN },
            awbNumber: { type: Type.STRING, nullable: true },
            documentTitle: { type: Type.STRING },
            summaryText: { type: Type.STRING },
            extractedRawText: { type: Type.STRING },
            detectedDate: { type: Type.STRING, nullable: true },
            agentOrShipper: { type: Type.STRING, nullable: true },
            piecesAndWeight: { type: Type.STRING, nullable: true },
            inspectionResultText: { type: Type.STRING, nullable: true },
          },
          required: ['hasExplosiveInspectionRequest', 'documentTitle', 'summaryText', 'extractedRawText'],
        },
      },
    });

    let jsonText = response.text || '{}';
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsedData: any = {};
    try {
      parsedData = JSON.parse(jsonText);
    } catch {
      // Fallback regex parsing if raw json has minor flaws
      const hasExplosive = /"hasExplosiveInspectionRequest"\s*:\s*true/i.test(jsonText) || /爆発物検査依頼書/.test(jsonText);
      const awbMatch = jsonText.match(/"awbNumber"\s*:\s*"([^"]+)"/i) || jsonText.match(/(\d{3}[-\s]?\d{8})/);
      const titleMatch = jsonText.match(/"documentTitle"\s*:\s*"([^"]+)"/i);
      const rawTextMatch = jsonText.match(/"extractedRawText"\s*:\s*"([^"]+)"/i);
      parsedData = {
        hasExplosiveInspectionRequest: hasExplosive,
        awbNumber: awbMatch ? awbMatch[1] : null,
        documentTitle: titleMatch ? titleMatch[1] : (hasExplosive ? '爆発物検査依頼書' : '検査書類'),
        summaryText: 'AI 画像OCR解析完了',
        extractedRawText: rawTextMatch ? rawTextMatch[1] : (textContent || 'OCR解析テキスト取得'),
      };
    }

    if (!parsedData.extractedRawText) {
      parsedData.extractedRawText = textContent || `${parsedData.documentTitle}\n${parsedData.summaryText}`;
    }

    // Save to Cache for subsequent calls
    setCachedGeminiResult(cacheKey, parsedData);

    return res.json({
      success: true,
      pageNumber,
      data: parsedData,
      fromCache: false,
    });
  } catch (err: any) {
    console.error('Error in /api/analyze-xray-pdf:', err);
    return res.status(err.isQuotaError ? 429 : 500).json({
      success: false,
      error: err.message || 'X線検査PDFの画像解析OCRに失敗しました。',
      isQuotaError: !!err.isQuotaError,
    });
  }
});

// Global Express Error Handling Middleware
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    error: err?.message || 'サーバー内部エラーが発生しました。',
  });
});



export { app };

export default function handler(req: any, res: any) {
  // Ensure the original URL is preserved if Vercel rewrote it to /api/index
  const originalPath = (req.headers && (req.headers['x-matched-path'] || req.headers['x-vercel-original-url'] || req.headers['x-forwarded-uri'])) as string | undefined;
  if (originalPath && (req.url === '/api/index' || req.url.startsWith('/api/index?'))) {
    const queryIdx = req.url.indexOf('?');
    const queryString = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
    req.url = originalPath + queryString;
  }
  return app(req, res);
}
