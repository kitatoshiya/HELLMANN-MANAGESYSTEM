/**
 * Microsoft 365 Graph API Integration Helpers for Vercel Serverless & Express
 */

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

const mailboxResolutionCache = new Map<string, { data: MailboxResolution; expiresAt: number }>();

/**
 * Helper to fetch with a timeout
 */
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
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
export async function getGraphAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'client_credentials');

  const resp = await fetchWithTimeout(
    tokenEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
    5000
  );

  const data = (await resp.json()) as any;
  if (!resp.ok || !data.access_token) {
    const errDesc = data.error_description || data.error || 'Failed to obtain access token from Microsoft Entra ID';
    throw new Error(`Graph API トークン取得エラー: ${errDesc}`);
  }

  return data.access_token;
}

/**
 * Resolve whether target email is a standard User Mailbox or Unified M365 Group
 */
export async function resolveMailboxTarget(
  token: string,
  targetEmail: string,
  targetUpnHint?: string
): Promise<MailboxResolution> {
  const cacheKey = `${targetEmail}__${targetUpnHint || ''}`;
  const cached = mailboxResolutionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. If explicit UPN hint is given and it's a GUID, check group directly
  const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUpnHint || '');
  if (isGuid) {
    try {
      const gResp = await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(targetUpnHint!)}?$select=id,displayName,mail,mailNickname`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        4000
      );
      if (gResp.ok) {
        const g = (await gResp.json()) as any;
        const res: MailboxResolution = {
          success: true,
          userId: g.id,
          displayName: g.displayName || 'M365 Group',
          mail: g.mail || targetEmail,
          isGroup: true,
        };
        mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
        return res;
      }
    } catch {}
  }

  // 2. Try fetching as a standard user or shared mailbox
  try {
    const targetUser = targetUpnHint || targetEmail;
    const uResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUser)}?$select=id,displayName,mail,userPrincipalName`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      4000
    );
    if (uResp.ok) {
      const u = (await uResp.json()) as any;
      const res: MailboxResolution = {
        success: true,
        userId: u.id,
        userPrincipalName: u.userPrincipalName,
        displayName: u.displayName || u.userPrincipalName,
        mail: u.mail || u.userPrincipalName,
        isGroup: false,
      };
      mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
      return res;
    }
  } catch {}

  // 3. Try searching in groups by mail or mailNickname
  try {
    const encodedMail = encodeURIComponent(targetEmail);
    const gResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${encodedMail}' or mailNickname eq '${encodeURIComponent(
        targetEmail.split('@')[0]
      )}'&$select=id,displayName,mail,mailNickname`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      4000
    );
    if (gResp.ok) {
      const gJson = (await gResp.json()) as any;
      if (Array.isArray(gJson.value) && gJson.value.length > 0) {
        const g = gJson.value[0];
        const res: MailboxResolution = {
          success: true,
          userId: g.id,
          displayName: g.displayName || 'M365 Group',
          mail: g.mail || targetEmail,
          isGroup: true,
        };
        mailboxResolutionCache.set(cacheKey, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
        return res;
      }
    }
  } catch {}

  // 4. Fallback: Lookup candidate users from tenant
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

export function extractEmailAddressesList(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.trim().toLowerCase())));
}

export function extractHeaderRecipientsFromText(text: string): { to: string[]; cc: string[] } {
  if (!text) return { to: [], cc: [] };
  const toList: string[] = [];
  const ccList: string[] = [];

  const toMatch = text.match(/(?:To|宛先|TO):\s*([^\n\r]+)/i);
  if (toMatch && toMatch[1]) {
    toList.push(...extractEmailAddressesList(toMatch[1]));
  }

  const ccMatch = text.match(/(?:Cc|CC|シーシー):\s*([^\n\r]+)/i);
  if (ccMatch && ccMatch[1]) {
    ccList.push(...extractEmailAddressesList(ccMatch[1]));
  }

  return { to: toList, cc: ccList };
}

export function parseGraphRecipientsList(recipients: any[]): string[] {
  if (!Array.isArray(recipients)) return [];
  const list: string[] = [];
  for (const r of recipients) {
    const addr = r?.emailAddress?.address;
    if (addr && typeof addr === 'string') {
      list.push(addr.trim().toLowerCase());
    }
  }
  return Array.from(new Set(list));
}

export function mapAttachments(msg: any): any[] {
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
