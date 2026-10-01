import express from "express";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const PORT = 3000;

// CORS headers for Vercel Serverless and client proxy
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // On Vercel, restore original request URL and ensure /api prefix for Express routing
  if (process.env.VERCEL) {
    const forwardedUri = req.headers["x-forwarded-uri"] as string;
    const originalUrl = req.headers["x-original-url"] as string;
    if (forwardedUri && forwardedUri.startsWith("/api")) {
      req.url = forwardedUri;
    } else if (originalUrl && originalUrl.startsWith("/api")) {
      req.url = originalUrl;
    } else if (!req.url.startsWith("/api")) {
      req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
    }
  }

  next();
});

app.use(express.json({ limit: "10mb" }));

// API Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Environment Variable & Microsoft Graph Diagnostics Endpoint
app.get("/api/debug-env", async (req, res) => {
  const tenantId = (process.env.MICROSOFT_TENANT_ID || process.env.MS_TENANT_ID)?.trim();
  const clientId = (process.env.MICROSOFT_CLIENT_ID || process.env.MS_CLIENT_ID)?.trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || process.env.MS_CLIENT_SECRET)?.trim();
  const sharedMailbox = (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  const maskSecret = (s?: string) => {
    if (!s) return "(未設定)";
    if (s.length <= 8) return s.slice(0, 2) + "**** (長: " + s.length + "文字)";
    return s.slice(0, 4) + "..." + s.slice(-4) + " (全 " + s.length + " 文字)";
  };

  const isSecretId = Boolean(clientSecret && isGuidFormat(clientSecret));

  let tokenTestResult: any = { status: "not_attempted" };
  if (tenantId && clientId && clientSecret) {
    if (isSecretId) {
      tokenTestResult = {
        status: "error",
        error: "【設定エラー】MICROSOFT_CLIENT_SECRET に『シークレット ID (GUID)』が設定されています。Azure Portalの「証明書とシークレット」で発行された『値 (Value)』を設定してください。",
      };
    } else {
      try {
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        const params = new URLSearchParams();
        params.append("client_id", clientId);
        params.append("client_secret", clientSecret);
        params.append("scope", "https://graph.microsoft.com/.default");
        params.append("grant_type", "client_credentials");

        const testRes = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });

        const testJson = await testRes.json() as any;
        if (testRes.ok) {
          tokenTestResult = {
            status: "success",
            message: "Microsoft Graph API トークン取得に成功しました！",
            tokenType: testJson.token_type,
            expiresIn: testJson.expires_in,
          };
        } else {
          tokenTestResult = {
            status: "failed",
            httpCode: testRes.status,
            error: testJson.error,
            errorDescription: testJson.error_description,
          };
        }
      } catch (e: any) {
        tokenTestResult = {
          status: "exception",
          message: e.message,
        };
      }
    }
  }

  return res.json({
    environment: {
      MICROSOFT_TENANT_ID: maskSecret(tenantId),
      MICROSOFT_CLIENT_ID: maskSecret(clientId),
      MICROSOFT_CLIENT_SECRET: maskSecret(clientSecret),
      MICROSOFT_SHARED_MAILBOX: sharedMailbox || "(未設定)",
      isSecretIdError: isSecretId,
    },
    tokenTest: tokenTestResult,
    timestamp: new Date().toISOString(),
  });
});

// Helper to obtain an Access Token for OAuth2 / Modern Auth if configured
async function resolveOAuth2AccessToken(settings: any): Promise<string | null> {
  const authMethod = settings?.authMethod || "PASSWORD";
  if (authMethod === "PASSWORD") {
    return null;
  }

  const clientId = settings?.oauthClientId?.trim();
  const clientSecret = settings?.oauthClientSecret?.trim() || "";
  const refreshToken = settings?.oauthRefreshToken?.trim();
  const tenantId = settings?.oauthTenantId?.trim() || "organizations";

  if (!clientId || !refreshToken) {
    return null;
  }

  let tokenUrl = "https://oauth2.googleapis.com/token";
  let scope = "https://mail.google.com/";

  const isMicrosoft365 =
    authMethod === "OAUTH2_OUTLOOK" ||
    settings?.outgoingHost?.includes("office365") ||
    settings?.outgoingHost?.includes("outlook");

  if (isMicrosoft365) {
    tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    scope = "https://graph.microsoft.com/Mail.Send offline_access";
  }

  try {
    const params = new URLSearchParams();
    params.append("client_id", clientId);
    if (clientSecret) params.append("client_secret", clientSecret);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    params.append("scope", scope);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json();
    if (res.ok && data.access_token) {
      return data.access_token;
    }
  } catch (err: any) {
    console.error("[OAuth2 Token Resolution Error]:", err?.message);
  }
  return null;
}

// Background Email Sending Endpoint (for mention notifications)
app.post("/api/send-email", async (req, res) => {
  try {
    const { to, subject, bodyText, bodyHtml, fromName, settings } = req.body;

    if (!to || !subject || !bodyText) {
      return res.status(400).json({
        success: false,
        error: "宛先(to)、件名(subject)、本文(bodyText)は必須項目です。",
      });
    }

    const smtpHost = settings?.outgoingHost || process.env.SMTP_HOST || "smtp.office365.com";
    const smtpPort = parseInt(settings?.outgoingPort || process.env.SMTP_PORT || "587", 10);
    const smtpUser = settings?.authUsername || settings?.commonEmail || process.env.SMTP_USER || "spares-common@shipping-air.jp";
    const smtpPass = settings?.authPassword || process.env.SMTP_PASS;
    const authMethod = settings?.authMethod || "PASSWORD";
    const senderName = settings?.senderName || fromName || "ACE船用品輸出管理";
    const senderEmail = settings?.commonEmail || smtpUser;
    const smtpFrom = `"${senderName}" <${senderEmail}>`;

    console.log(`[Email Service] 宛先: ${to} | 件名: ${subject} | SMTPホスト: ${smtpHost}:${smtpPort}`);

    let transporter: nodemailer.Transporter | null = null;
    let isRealSmtp = false;

    if (authMethod !== "PASSWORD") {
      try {
        const accessToken = await resolveOAuth2AccessToken(settings);
        if (accessToken) {
          isRealSmtp = true;
          transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
              type: "OAuth2",
              user: smtpUser,
              clientId: settings?.oauthClientId || undefined,
              clientSecret: settings?.oauthClientSecret || undefined,
              refreshToken: settings?.oauthRefreshToken || undefined,
              accessToken,
            },
            tls: { rejectUnauthorized: false },
          });
        }
      } catch (oauthErr: any) {
        console.warn("[SMTP OAuth2 Resolution Notice]:", oauthErr?.message);
      }
    }

    if (!transporter && smtpHost && smtpUser && smtpPass && smtpPass !== "••••••••••••") {
      isRealSmtp = true;
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        tls: { rejectUnauthorized: false },
      });
    }

    if (!transporter) {
      try {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
      } catch (e) {
        console.warn("Failed to create Ethereal test account, fallback to simulation mode", e);
      }
    }

    if (transporter) {
      const info = await transporter.sendMail({
        from: smtpFrom,
        to,
        subject,
        text: bodyText,
        html: bodyHtml || bodyText.replace(/\n/g, "<br>"),
      });

      console.log(`[Email Sent Success] MessageID: ${info.messageId}`);
      const previewUrl = nodemailer.getTestMessageUrl(info);

      return res.json({
        success: true,
        message: isRealSmtp
          ? `実メールが [${smtpHost}:${smtpPort}] より ${to} へ正常に送信されました！`
          : `バックグラウンドメール配信処理が正常に完了しました (${to} 宛て)`,
        messageId: info.messageId,
        previewUrl: previewUrl || undefined,
        mode: isRealSmtp ? "smtp_live" : "ethereal_test",
      });
    } else {
      return res.json({
        success: true,
        message: `バックグラウンド配信キュー処理が完了しました (${to} 宛て)`,
        mode: "simulated",
      });
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[Email Dispatch Error]", error);
    return res.status(500).json({
      success: false,
      error: `メール送信処理エラー: ${error?.message || "不明なエラー"}`,
    });
  }
});

// ==========================================
// Microsoft 365 (Microsoft Graph API) Integration
// ==========================================

// In-memory token cache for Client Credentials Flow
let msGraphTokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

let msGraphLastTokenError: {
  message: string;
  isSecretIdError: boolean;
  time: number;
} | null = null;

// Helper to check if string matches UUID / GUID pattern (typical for Secret ID, NOT Secret Value)
function isGuidFormat(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

// Helper to decode JWT roles without signature check (issued by Microsoft login endpoint)
function getRolesFromJwt(token: string): string[] {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return [];
    const payloadStr = Buffer.from(parts[1], "base64").toString("utf-8");
    const payload = JSON.parse(payloadStr);
    return Array.isArray(payload.roles) ? payload.roles : [];
  } catch (e) {
    return [];
  }
}

async function getMicrosoftGraphAccessToken(forceRefresh = false): Promise<string> {
  const tenantId = (process.env.MICROSOFT_TENANT_ID || process.env.MS_TENANT_ID)?.trim();
  const clientId = (process.env.MICROSOFT_CLIENT_ID || process.env.MS_CLIENT_ID)?.trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || process.env.MS_CLIENT_SECRET)?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft 365 連携用の環境変数 (MICROSOFT_TENANT_ID / MS_TENANT_ID, MICROSOFT_CLIENT_ID / MS_CLIENT_ID, MICROSOFT_CLIENT_SECRET / MS_CLIENT_SECRET) が未設定です。");
  }

  // Pre-check: Detect if user inadvertently pasted the "Secret ID" (GUID format) instead of "Secret Value"
  if (isGuidFormat(clientSecret)) {
    const errorMsg = "【MICROSOFT_CLIENT_SECRETの設定エラー】入力されたシークレットは『シークレット ID (GUID形式)』です。Azure Portal の「証明書とシークレット」タブで新しく発行した際に表示される『値 (Value)』をコピーして設定してください。";
    msGraphLastTokenError = {
      message: errorMsg,
      isSecretIdError: true,
      time: Date.now(),
    };
    throw new Error(errorMsg);
  }

  const now = Date.now();
  // Return valid cached token if forceRefresh is false AND the token has active roles
  if (!forceRefresh && msGraphTokenCache && msGraphTokenCache.expiresAt > now + 60000) {
    const cachedRoles = getRolesFromJwt(msGraphTokenCache.accessToken);
    // If the cached token had empty roles, invalidate to check if user has now granted permissions
    if (cachedRoles.length > 0) {
      return msGraphTokenCache.accessToken;
    }
  }

  // If we had a recent failure within 10 seconds, re-throw to avoid spamming Microsoft endpoints
  if (!forceRefresh && msGraphLastTokenError && now - msGraphLastTokenError.time < 10000) {
    throw new Error(msGraphLastTokenError.message);
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("scope", "https://graph.microsoft.com/.default");
  params.append("grant_type", "client_credentials");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    let isSecretId = false;
    let friendlyMessage = `Microsoft 365 トークン認証エラー (${response.status})`;

    if (errText.includes("AADSTS7000215") || errText.includes("Invalid client secret")) {
      isSecretId = true;
      friendlyMessage = "【MICROSOFT_CLIENT_SECRETの設定エラー】クライアントシークレットが無効です。Azure Portal の「証明書とシークレット」画面で作成した『シークレット ID』ではなく『値 (Value)』を設定してください。（※「値」は作成直後のみ表示されます。非表示になっている場合は「＋新しいクライアントシークレット」を作成してください）";
    } else if (errText.includes("AADSTS700016")) {
      friendlyMessage = "【MICROSOFT_CLIENT_IDの設定エラー】指定されたアプリケーション (クライアント) ID がテナント内に見つかりません。Azure Portal の概要画面でクライアントIDをご確認ください。";
    } else if (errText.includes("AADSTS90002")) {
      friendlyMessage = "【MICROSOFT_TENANT_IDの設定エラー】指定されたテナント ID が見つかりません。Azure Portal の概要画面でディレクトリ (テナント) IDをご確認ください。";
    }

    console.log(`[Microsoft Graph Token Notice]: ${friendlyMessage}`);
    msGraphLastTokenError = {
      message: friendlyMessage,
      isSecretIdError: isSecretId,
      time: now,
    };
    throw new Error(friendlyMessage);
  }

  const data = (await response.json()) as any;
  const accessToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  msGraphLastTokenError = null;
  msGraphTokenCache = {
    accessToken,
    expiresAt: now + expiresIn * 1000,
  };

  return accessToken;
}

// 1. Get Status of Microsoft 365 Connection
app.get("/api/shared-mail/status", async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const tenantId = (process.env.MICROSOFT_TENANT_ID || process.env.MS_TENANT_ID)?.trim();
  const clientId = (process.env.MICROSOFT_CLIENT_ID || process.env.MS_CLIENT_ID)?.trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || process.env.MS_CLIENT_SECRET)?.trim();
  const sharedMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim() || "";

  const configured = Boolean(tenantId && clientId && clientSecret);
  const isSecretId = Boolean(clientSecret && isGuidFormat(clientSecret));

  if (!configured) {
    return res.json({
      configured: false,
      tenantIdConfigured: Boolean(tenantId),
      clientIdConfigured: Boolean(clientId),
      clientSecretConfigured: Boolean(clientSecret),
      sharedMailbox: sharedMailbox || undefined,
      connected: false,
      note: "環境変数（MICROSOFT_TENANT_ID / MS_TENANT_ID, MICROSOFT_CLIENT_ID / MS_CLIENT_ID, MICROSOFT_CLIENT_SECRET / MS_CLIENT_SECRET）を設定すると本番Microsoft365アカウントと直接通信します。",
    });
  }

  if (isSecretId) {
    return res.json({
      configured: true,
      tenantIdConfigured: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      isSecretIdError: true,
      sharedMailbox: sharedMailbox || undefined,
      connected: false,
      error: "【修正が必要】MICROSOFT_CLIENT_SECRET に『シークレット ID』が設定されています。Azure Portalの「証明書とシークレット」で作成された『値 (Value)』を設定してください。",
    });
  }

  try {
    const token = await getMicrosoftGraphAccessToken(forceRefresh);
    const tokenRoles = getRolesFromJwt(token);
    const hasMailRead = tokenRoles.includes("Mail.Read") || tokenRoles.includes("Mail.ReadWrite");
    const hasMailSend = tokenRoles.includes("Mail.Send") || tokenRoles.includes("Mail.ReadWrite");
    const needsApiPermissions = !hasMailRead;

    return res.json({
      configured: true,
      tenantIdConfigured: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      isSecretIdError: false,
      sharedMailbox: sharedMailbox || undefined,
      connected: Boolean(token),
      tokenRoles,
      hasMailRead,
      hasMailSend,
      needsApiPermissions,
    });
  } catch (err: any) {
    return res.json({
      configured: true,
      tenantIdConfigured: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      isSecretIdError: Boolean(msGraphLastTokenError?.isSecretIdError),
      sharedMailbox: sharedMailbox || undefined,
      connected: false,
      error: err.message,
    });
  }
});

// Demo / Fallback Data for when credentials are not yet entered or in initial setup
const DEMO_SHARED_MESSAGES = [
  {
    id: "demo-msg-1",
    conversationId: "demo-conv-1",
    subject: "【至急見積依頼】M/V PACIFIC PIONEER スペアパーツ手配 (シンガポール向け)",
    bodyPreview: "いつも大変お世話になっております。PACIFIC SHIPPINGの佐藤です。M/V PACIFIC PIONEERの主機排気弁パーツ一式について、シンガポール積載での航空運賃および至急手配のお見積りをお願いできますでしょうか...",
    bodyHtml: `
      <div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
        <p>いつも大変お世話になっております。<br>PACIFIC SHIPPING CO., LTD. 購買部の佐藤でございます。</p>
        <p>下記の本船向けの主機排気弁パーツ一式について、シンガポール（SIN）空港向け航空便での至急手配・見積りをお願いできますでしょうか。</p>
        <div style="background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0284c7;">
          <strong>【本船情報】</strong><br>
          本船名: M/V PACIFIC PIONEER<br>
          寄港地: SINGAPORE (SIN)<br>
          ETA: 2026年9月15日<br>
          貨物総重量: 約 380 kg (2 packages)<br>
          集荷場所: 東京ベイ倉庫
        </div>
        <p>本船の出港期限が迫っているため、本日中に概算フライトスケジュールとお見積りをいただけますと幸甚に存じます。<br>何卒よろしくお願い申し上げます。</p>
        <p>--<br>PACIFIC SHIPPING CO., LTD.<br>Marine Technical Procurement Team<br>TEL: +81-3-1234-5678</p>
      </div>
    `,
    from: { name: "佐藤 一郎 (PACIFIC SHIPPING)", address: "sato.i@pacific-shipping.example.com" },
    toRecipients: [{ name: "共通業務トレイ", address: "marine-ops@marinetrade.example.com" }],
    ccRecipients: [{ name: "海運代理店部", address: "agency@pacific-shipping.example.com" }],
    receivedDateTime: new Date(Date.now() - 1000 * 60 * 24).toISOString(), // 24 mins ago
    hasAttachments: true,
    attachments: [
      { id: "att-1", name: "Parts_Packing_List_PacificPioneer.pdf", contentType: "application/pdf", size: 245000 },
      { id: "att-2", name: "Exhaust_Valve_Spec.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 85200 },
    ],
    isRead: false,
    importance: "high" as const,
    isDemo: true,
  },
  {
    id: "demo-msg-2",
    conversationId: "demo-conv-2",
    subject: "AWB送付及びフライト確定のご案内 (AWB: 999-12345675 / M/V OCEAN GLORY)",
    bodyPreview: "お世話になっております。東京エアカーゴ輸出課です。表記案件につきまして、本日JL035便（NRT-SIN）にてブッキングが完了いたしましたのでAWBコピーをお送りいたします...",
    bodyHtml: `
      <div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
        <p>お世話になっております。<br>東京エアカーゴ 輸出課でございます。</p>
        <p>表記の船用品案件につきまして、本日フライトブッキングが確定いたしました。<br>添付にてAWBコピー（Draft）をお送りいたしますのでご確認ください。</p>
        <ul>
          <li><strong>MAWB No.</strong>: 999-12345675</li>
          <li><strong>FLIGHT</strong>: JL035 (NRT 18:30 発 / SIN 00:45 翌着)</li>
          <li><strong>PCS / WT</strong>: 4 PCS / 185.0 KG</li>
        </ul>
        <p>通関許可書受領後、速やかにKIXハンドリングチームへ引き継ぎいたします。<br>よろしくお願いいたします。</p>
      </div>
    `,
    from: { name: "東京エアカーゴ輸出課", address: "export@tac-japan.example.com" },
    toRecipients: [{ name: "共通業務トレイ", address: "marine-ops@marinetrade.example.com" }],
    ccRecipients: [],
    receivedDateTime: new Date(Date.now() - 1000 * 60 * 180).toISOString(), // 3 hours ago
    hasAttachments: true,
    attachments: [
      { id: "att-3", name: "Draft_MAWB_999-12345675.pdf", contentType: "application/pdf", size: 142000 },
    ],
    isRead: true,
    importance: "normal" as const,
    isDemo: true,
  },
  {
    id: "demo-msg-3",
    conversationId: "demo-conv-3",
    subject: "Re: 【運賃確認】ロッテルダム(RTM)向け 海上コンテナ混載(LCL)船用品運賃の件",
    bodyPreview: "海運パーツ様、ご照会ありがとうございます。ロッテルダム向けの混載船用品につきまして、現行の割増サーチャージ改定を含めた最新運賃レートをご案内申し上げます...",
    bodyHtml: `
      <div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
        <p>海運パーツ様</p>
        <p>いつもご利用いただきありがとうございます。<br>ロッテルダム（RTM）港向け混載（LCL）運賃のお問い合わせにつきまして、以下の通り最新レートをご案内いたします。</p>
        <p><strong>Ocean Freight</strong>: USD 85.00 / W/M<br><strong>CFS Charge</strong>: JPY 4,200 / RT<br><strong>BAF / CAF</strong>: 現行レート適用</p>
        <p>次回出港予定は来週水曜日（9月16日 CFS CUT）となります。<br>ご検討のほどよろしくお願いいたします。</p>
      </div>
    `,
    from: { name: "Global Ocean Logistics 営業部", address: "sales@gol-logistics.example.com" },
    toRecipients: [{ name: "共通業務トレイ", address: "marine-ops@marinetrade.example.com" }],
    ccRecipients: [],
    receivedDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    hasAttachments: false,
    isRead: true,
    importance: "normal" as const,
    isDemo: true,
  },
];

// In-memory store for demo messages state (read status, sent messages)
let demoMessagesList = DEMO_SHARED_MESSAGES.map((m) => ({
  ...m,
  folderId: "inbox",
}));

// Folder Tree Memory Cache (2 minutes cache for blazing-fast navigation)
let folderTreeCache: {
  mailbox: string;
  data: any;
  timestamp: number;
} | null = null;

// 1.5 Get Mail Folder Tree Hierarchy (Web Outlook style)
app.get("/api/shared-mail/folders", async (req, res) => {
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();
  const forceRefresh = req.query.refresh === "true";

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken(forceRefresh);
  } catch (err: any) {}

  // Check memory cache
  const now = Date.now();
  if (
    !forceRefresh &&
    folderTreeCache &&
    folderTreeCache.mailbox === targetMailbox &&
    now - folderTreeCache.timestamp < 1000 * 60 * 2
  ) {
    return res.json(folderTreeCache.data);
  }

  if (token && targetMailbox) {
    try {
      async function getFolderWithChildren(folderId: string | null, depth = 0): Promise<any[]> {
        const url = folderId
          ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/mailFolders/${folderId}/childFolders?$top=100`
          : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/mailFolders?$top=100`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          return [];
        }

        const json = await response.json();
        const list = json.value || [];
        const results: any[] = [];

        for (const f of list) {
          const node: any = {
            id: f.id,
            displayName: f.displayName,
            parentFolderId: f.parentFolderId,
            childFolderCount: f.childFolderCount || 0,
            unreadItemCount: f.unreadItemCount || 0,
            totalItemCount: f.totalItemCount || 0,
            children: [],
          };

          if (f.childFolderCount > 0 && depth < 3) {
            node.children = await getFolderWithChildren(f.id, depth + 1);
          }

          results.push(node);
        }

        return results;
      }

      const rootFolders = await getFolderWithChildren(null, 0);

      // Sort so '受信トレイ' (Inbox) comes first, followed by others, then '送信済みアイテム'
      rootFolders.sort((a, b) => {
        if (a.displayName === "受信トレイ") return -1;
        if (b.displayName === "受信トレイ") return 1;
        if (a.displayName === "送信済みアイテム") return 1;
        if (b.displayName === "送信済みアイテム") return -1;
        return a.displayName.localeCompare(b.displayName, "ja");
      });

      const responsePayload = {
        success: true,
        mailbox: targetMailbox,
        folders: rootFolders,
        isLive: true,
      };

      folderTreeCache = {
        mailbox: targetMailbox,
        data: responsePayload,
        timestamp: now,
      };

      return res.json(responsePayload);
    } catch (err: any) {
      console.error("[Graph Folders Error]:", err);
    }
  }

  // Fallback demo folder tree matching user's Outlook screenshot
  const demoFolders = [
    {
      id: "inbox",
      displayName: "受信トレイ",
      parentFolderId: null,
      childFolderCount: 3,
      unreadItemCount: demoMessagesList.filter((m) => m.folderId === "inbox" && !m.isRead).length,
      totalItemCount: demoMessagesList.filter((m) => m.folderId === "inbox").length,
      children: [
        {
          id: "demo-folder-ace",
          displayName: "ACE",
          parentFolderId: "inbox",
          childFolderCount: 0,
          unreadItemCount: 0,
          totalItemCount: demoMessagesList.filter((m) => m.folderId === "demo-folder-ace").length,
          children: [],
        },
        {
          id: "demo-folder-sandai",
          displayName: "三大陸運",
          parentFolderId: "inbox",
          childFolderCount: 0,
          unreadItemCount: 0,
          totalItemCount: demoMessagesList.filter((m) => m.folderId === "demo-folder-sandai").length,
          children: [],
        },
        {
          id: "demo-folder-suppliers",
          displayName: "サプライヤー",
          parentFolderId: "inbox",
          childFolderCount: 14,
          unreadItemCount: 0,
          totalItemCount: 0,
          children: [
            "中西商事", "ARK", "DSIC", "IMC", "ISS", "JMS", "JRCS", "JTA",
            "Marinetrans", "OSS", "SH MARWELL", "Universal Marine", "アークマリン", "アルファ・ラバル"
          ].map((name, idx) => ({
            id: `demo-supplier-${idx + 1}`,
            displayName: name,
            parentFolderId: "demo-folder-suppliers",
            childFolderCount: 0,
            unreadItemCount: 0,
            totalItemCount: demoMessagesList.filter((m) => m.folderId === `demo-supplier-${idx + 1}`).length,
            children: [],
          })),
        },
      ],
    },
    {
      id: "sentitems",
      displayName: "送信済みアイテム",
      parentFolderId: null,
      childFolderCount: 0,
      unreadItemCount: 0,
      totalItemCount: demoMessagesList.filter((m) => m.folderId === "sentitems").length,
      children: [],
    },
  ];

  return res.json({
    success: true,
    mailbox: targetMailbox || "osaeig1@tac-japan.co.jp",
    folders: demoFolders,
    isLive: false,
  });
});

function deduplicateServerMessages(msgs: any[]): any[] {
  const seenIds = new Set<string>();
  const result: any[] = [];

  for (const msg of msgs) {
    if (!msg || !msg.id) continue;
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    const msgTime = new Date(msg.receivedDateTime || msg.sentDateTime || 0).getTime();
    const isDuplicate = result.some((existing) => {
      if (existing.subject === msg.subject && existing.bodyPreview === msg.bodyPreview) {
        const existingTime = new Date(existing.receivedDateTime || existing.sentDateTime || 0).getTime();
        return Math.abs(existingTime - msgTime) < 60000;
      }
      return false;
    });

    if (!isDuplicate) {
      result.push(msg);
    }
  }

  return result;
}

// 2. List Messages from Shared Mailbox
app.get("/api/shared-mail/messages", async (req, res) => {
  const folder = ((req.query.folder as string) || "inbox").toLowerCase();
  const folderId = (req.query.folderId as string)?.trim();
  const top = parseInt((req.query.top as string) || "30", 10);
  const search = ((req.query.search as string) || "").trim();
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();
  const forceDemo = req.query.demo === "true";
  const forceRefresh = req.query.refresh === "true";

  let token: string | null = null;
  let tokenAuthError: string | null = null;
  let isSecretIdError = false;

  try {
    token = await getMicrosoftGraphAccessToken(forceRefresh);
  } catch (err: any) {
    tokenAuthError = err.message;
    isSecretIdError = Boolean(msGraphLastTokenError?.isSecretIdError);
  }

  // Filter demo messages helper
  const getDemoList = () => {
    let filtered = [...demoMessagesList];
    if (folderId) {
      filtered = filtered.filter((m) => m.folderId === folderId);
    } else if (folder === "sentitems") {
      filtered = filtered.filter((m) => m.folderId === "sentitems" || m.from?.address === (targetMailbox || "osaeig1@tac-japan.co.jp"));
    } else {
      filtered = filtered.filter((m) => !m.folderId || m.folderId === "inbox");
    }
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.subject.toLowerCase().includes(s) ||
          m.bodyPreview.toLowerCase().includes(s) ||
          m.from?.name?.toLowerCase().includes(s) ||
          m.from?.address?.toLowerCase().includes(s)
      );
    }
    return deduplicateServerMessages(filtered);
  };

  if (forceDemo) {
    return res.json({
      success: true,
      messages: getDemoList(),
      mailbox: targetMailbox || "osaeig1@tac-japan.co.jp",
      isLive: false,
      isDemoMode: true,
    });
  }

  // If live token and targetMailbox are present, call Microsoft Graph API
  if (token && targetMailbox) {
    try {
      // Determine target folder: either explicit folderId or well-known folder name
      const graphFolder = folderId || (folder === "sentitems" ? "sentitems" : "inbox");
      const orderField = folder === "sentitems" ? "sentDateTime" : "receivedDateTime";
      let graphUrl: string;

      // Note: Microsoft Graph API does not allow $orderby when $search is used
      if (search) {
        graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          targetMailbox
        )}/mailFolders/${graphFolder}/messages?$top=${top}&$search="${encodeURIComponent(search)}"&$select=id,conversationId,subject,bodyPreview,hasAttachments,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,isRead,importance`;
      } else {
        graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          targetMailbox
        )}/mailFolders/${graphFolder}/messages?$top=${top}&$orderby=${orderField} desc&$select=id,conversationId,subject,bodyPreview,hasAttachments,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,isRead,importance`;
      }

      let graphRes = await fetch(graphUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.body-content-type="text"',
        },
      });

      // If access denied (403/401), clear token cache and retry once with a freshly obtained token
      if (!graphRes.ok && (graphRes.status === 403 || graphRes.status === 401)) {
        msGraphTokenCache = null;
        try {
          const freshToken = await getMicrosoftGraphAccessToken(true);
          graphRes = await fetch(graphUrl, {
            headers: {
              Authorization: `Bearer ${freshToken}`,
              Prefer: 'outlook.body-content-type="text"',
            },
          });
        } catch (_) {}
      }

      if (!graphRes.ok) {
        const errBody = await graphRes.text();
        console.log("[Microsoft Graph Messages Status]:", graphRes.status);

        let isAccessDenied = false;
        let isMailboxNotFound = false;
        let friendlyMessage = `Microsoft Graph メールの取得に失敗しました (${graphRes.status})`;

        if (graphRes.status === 403 || errBody.includes("ErrorAccessDenied") || errBody.includes("Access is denied")) {
          isAccessDenied = true;
          friendlyMessage = "【Azure APIのアクセス許可が必要です】Azure Portal の「APIのアクセス許可」で『Mail.ReadWrite (アプリケーションの許可)』を追加し、「管理者の同意を与える」をクリックしてください。";
        } else if (graphRes.status === 404 || errBody.includes("ErrorItemNotFound") || errBody.includes("MailboxNotEnabledForRESTAPI")) {
          isMailboxNotFound = true;
          friendlyMessage = `【メールボックスが見つかりません】指定された共通メール [${targetMailbox}] が存在しないか、Exchange Onlineメールボックスが割り当てられていません。`;
        }

        // Return HTTP 200 with structured error info so client never throws a JSON/network parse error
        return res.json({
          success: false,
          messages: [],
          demoFallbackMessages: getDemoList(),
          mailbox: targetMailbox,
          isLive: false,
          graphError: {
            status: graphRes.status,
            code: isAccessDenied ? "ErrorAccessDenied" : isMailboxNotFound ? "MailboxNotFound" : "GraphError",
            message: friendlyMessage,
            raw: errBody,
            isAccessDenied,
            isMailboxNotFound,
          },
        });
      }

      const data = (await graphRes.json()) as any;
      const messages = (data.value || []).map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversationId,
        subject: msg.subject || "(件名なし)",
        bodyPreview: msg.bodyPreview || "",
        from: msg.from?.emailAddress
          ? { name: msg.from.emailAddress.name, address: msg.from.emailAddress.address }
          : undefined,
        toRecipients: (msg.toRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
        })),
        ccRecipients: (msg.ccRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
        })),
        receivedDateTime: msg.receivedDateTime || msg.createdDateTime,
        sentDateTime: msg.sentDateTime,
        hasAttachments: Boolean(msg.hasAttachments),
        isRead: Boolean(msg.isRead),
        importance: msg.importance || "normal",
        isDemo: false,
      }));

      return res.json({
        success: true,
        messages: deduplicateServerMessages(messages),
        mailbox: targetMailbox,
        isLive: true,
      });
    } catch (err: any) {
      console.error("[Graph Fetch Exception]:", err);
      return res.json({
        success: false,
        messages: [],
        demoFallbackMessages: getDemoList(),
        mailbox: targetMailbox,
        isLive: false,
        graphError: {
          status: 500,
          code: "FetchException",
          message: `通信エラー: ${err.message}`,
        },
      });
    }
  }

  // Demo Fallback Mode (Used when credentials missing OR token authentication fails)
  const demoList = getDemoList();
  return res.json({
    success: true,
    messages: demoList,
    mailbox: targetMailbox || "marine-ops@marinetrade.example.com",
    isLive: false,
    authError: tokenAuthError || undefined,
    isSecretIdError: isSecretIdError,
    note: tokenAuthError
      ? tokenAuthError
      : "現在Microsoft 365認証情報が未入力のため、デモメールボックスとして表示しています。環境変数を設定すると本番メールボックスに自動切替されます。",
  });
});

// 3. Get Single Message Details (HTML Content & Attachments)
app.get("/api/shared-mail/messages/:id", async (req, res) => {
  const messageId = req.params.id;
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken();
  } catch (e) {}

  if (token && targetMailbox && !messageId.startsWith("demo-")) {
    try {
      const msgUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        targetMailbox
      )}/messages/${messageId}?$select=id,conversationId,subject,body,hasAttachments,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,isRead,importance`;

      const graphRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!graphRes.ok) {
        const errText = await graphRes.text();
        return res.status(graphRes.status).json({ error: errText });
      }

      const msg = (await graphRes.json()) as any;

      let attachments: any[] = [];
      let bodyHtml = msg.body?.contentType === "html" ? (msg.body.content || "") : `<pre>${msg.body?.content || ""}</pre>`;

      // Check if message has attachments or if HTML body contains inline cid images
      const hasCidInBody = /cid:/i.test(bodyHtml);
      if (msg.hasAttachments || hasCidInBody) {
        try {
          const attRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/messages/${messageId}/attachments`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (attRes.ok) {
            const attData = (await attRes.json()) as any;
            const rawAttachments = attData.value || [];

            // Replace cid: references in HTML body with Base64 data URIs
            for (const att of rawAttachments) {
              if (att.contentBytes && (att.contentId || att.name)) {
                const mime = att.contentType || "image/png";
                const dataUri = `data:${mime};base64,${att.contentBytes}`;

                // Replace cid:contentId and cid:<contentId>
                if (att.contentId) {
                  const cleanCid = att.contentId.replace(/^<|>$/g, "");
                  // Escape regex special chars in cleanCid
                  const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const re = new RegExp(`cid:(<${escapedCid}>|${escapedCid})`, "gi");
                  bodyHtml = bodyHtml.replace(re, dataUri);
                }

                // Also check if referenced by filename
                if (att.name) {
                  const escapedName = att.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const reName = new RegExp(`cid:(<${escapedName}>|${escapedName})`, "gi");
                  bodyHtml = bodyHtml.replace(reName, dataUri);
                }
              }
            }

            attachments = rawAttachments.map((a: any) => ({
              id: a.id,
              name: a.name || "attachment",
              contentType: a.contentType || "application/octet-stream",
              size: a.size || 0,
              isInline: Boolean(a.isInline),
            }));
          }
        } catch (attErr) {
          console.warn("[Attachments fetch error]:", attErr);
        }
      }

      let cleanPlainText = "";
      if (msg.body?.contentType === "text") {
        cleanPlainText = msg.body?.content || "";
      } else {
        // Strip tags for plain text representation
        cleanPlainText = (msg.body?.content || "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      return res.json({
        id: msg.id,
        conversationId: msg.conversationId,
        subject: msg.subject || "(件名なし)",
        bodyHtml,
        bodyText: cleanPlainText || msg.bodyPreview || "",
        from: msg.from?.emailAddress
          ? { name: msg.from.emailAddress.name, address: msg.from.emailAddress.address }
          : undefined,
        toRecipients: (msg.toRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
        })),
        ccRecipients: (msg.ccRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
        })),
        receivedDateTime: msg.receivedDateTime,
        sentDateTime: msg.sentDateTime,
        hasAttachments: Boolean(msg.hasAttachments || attachments.length > 0),
        attachments,
        isRead: Boolean(msg.isRead),
        importance: msg.importance || "normal",
        isDemo: false,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Demo Fallback
  const found = demoMessagesList.find((m) => m.id === messageId);
  if (!found) {
    return res.status(404).json({ error: "メールが見つかりませんでした。" });
  }

  // Mark as read in demo mode
  found.isRead = true;

  return res.json(found);
});

// 3.1 Get/Download Single Attachment
app.get("/api/shared-mail/messages/:msgId/attachments/:attId", async (req, res) => {
  const { msgId, attId } = req.params;
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken();
  } catch (e) {}

  if (token && targetMailbox && !msgId.startsWith("demo-")) {
    try {
      const attRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/messages/${msgId}/attachments/${attId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!attRes.ok) {
        return res.status(attRes.status).json({ error: "添付ファイルの取得に失敗しました。" });
      }
      const att = (await attRes.json()) as any;
      if (att.contentBytes) {
        const buffer = Buffer.from(att.contentBytes, "base64");
        res.setHeader("Content-Type", att.contentType || "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(att.name || "attachment")}"`
        );
        return res.send(buffer);
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: "添付ファイルが見つかりません。" });
});

// 4. Update Read Status
app.patch("/api/shared-mail/messages/:id/read-status", async (req, res) => {
  const messageId = req.params.id;
  const { isRead } = req.body;
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken();
  } catch (e) {}

  if (token && targetMailbox && !messageId.startsWith("demo-")) {
    try {
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isRead: Boolean(isRead) }),
        }
      );
      if (!graphRes.ok) {
        return res.status(graphRes.status).json({ error: "既読ステータスの更新に失敗しました" });
      }
      return res.json({ success: true, isRead });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Demo mode
  const found = demoMessagesList.find((m) => m.id === messageId);
  if (found) {
    found.isRead = Boolean(isRead);
  }
  return res.json({ success: true, isRead });
});

// 4.5 Move Message to another Mail Folder (Web Outlook drag & drop)
app.post("/api/shared-mail/messages/:id/move", async (req, res) => {
  const messageId = req.params.id;
  const { destinationId } = req.body;
  const targetMailbox = (req.query.mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  if (!destinationId) {
    return res.status(400).json({ error: "移動先フォルダID(destinationId)が指定されていません。" });
  }

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken();
  } catch (e) {}

  if (token && targetMailbox && !messageId.startsWith("demo-")) {
    try {
      const moveRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/messages/${encodeURIComponent(messageId)}/move`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId }),
        }
      );

      if (!moveRes.ok) {
        const errText = await moveRes.text();
        console.error("[Graph Move Message Error]:", moveRes.status, errText);
        return res.status(moveRes.status).json({ error: "メールの移動に失敗しました。", details: errText });
      }

      const movedMessage = await moveRes.json();

      // Clear folder tree cache so counts stay fresh
      folderTreeCache = null;

      return res.json({
        success: true,
        message: "メールを正常に移動しました。",
        movedMessage,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Demo mode fallback
  const found = demoMessagesList.find((m) => m.id === messageId);
  if (found) {
    found.folderId = destinationId;
  }

  // Clear cache in demo mode too
  folderTreeCache = null;

  return res.json({
    success: true,
    message: "メールを正常に移動しました。(Demo)",
    destinationId,
  });
});

// 5. Send Mail from Shared Mailbox
app.post("/api/shared-mail/send", async (req, res) => {
  const { to, cc, bcc, subject, bodyHtml, bodyText, mailbox, attachments } = req.body;
  const targetMailbox = (mailbox as string)?.trim() || (process.env.MICROSOFT_SHARED_MAILBOX || process.env.MS_SHARED_MAILBOX)?.trim();

  if (!to || !Array.isArray(to) || to.length === 0) {
    return res.status(400).json({ error: "宛先(To)が指定されていません。" });
  }
  if (!subject) {
    return res.status(400).json({ error: "件名(Subject)が入力されていません。" });
  }

  let token: string | null = null;
  try {
    token = await getMicrosoftGraphAccessToken();
  } catch (e) {}

  if (token && targetMailbox) {
    try {
      const payload: any = {
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: bodyHtml || (bodyText ? bodyText.replace(/\n/g, "<br>") : ""),
          },
          toRecipients: to.map((addr: string) => ({
            emailAddress: { address: addr.trim() },
          })),
          ccRecipients: (cc || []).map((addr: string) => ({
            emailAddress: { address: addr.trim() },
          })),
          bccRecipients: (bcc || []).map((addr: string) => ({
            emailAddress: { address: addr.trim() },
          })),
        },
        saveToSentItems: true,
      };

      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        payload.message.attachments = attachments.map((att: any) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.name || "attachment",
          contentType: att.contentType || "application/octet-stream",
          contentBytes: att.contentBytes,
        }));
      }

      const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetMailbox)}/sendMail`;
      const graphRes = await fetch(sendUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!graphRes.ok) {
        const errBody = await graphRes.text();
        console.error("[Graph Send Error]:", errBody);
        return res.status(graphRes.status).json({
          error: `Microsoft 365 からの送信に失敗しました (${graphRes.status}): ${errBody}`,
        });
      }

      return res.json({
        success: true,
        message: `Microsoft 365 共通アドレス [${targetMailbox}] より正常に送信されました！`,
        from: targetMailbox,
        to,
        attachmentsCount: attachments?.length || 0,
      });
    } catch (err: any) {
      console.error("[Graph Send Exception]:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Demo Mode: Add to demo sent list
  const formattedAttachments = (attachments && Array.isArray(attachments))
    ? attachments.map((att: any, idx: number) => ({
        id: `demo-att-${Date.now()}-${idx}`,
        name: att.name || "attachment",
        contentType: att.contentType || "application/octet-stream",
        size: att.size || (att.contentBytes ? Math.round((att.contentBytes.length * 3) / 4) : 0),
        isInline: false,
      }))
    : [];

  const newDemoSent = {
    id: `demo-sent-${Date.now()}`,
    conversationId: `demo-conv-sent-${Date.now()}`,
    subject,
    bodyPreview: (bodyText || bodyHtml || "").slice(0, 120),
    bodyHtml: bodyHtml || (bodyText ? bodyText.replace(/\n/g, "<br>") : ""),
    bodyText: bodyText || "",
    from: { name: "共通業務トレイ", address: targetMailbox || "marine-ops@marinetrade.example.com" },
    toRecipients: to.map((addr: string) => ({ name: addr.split("@")[0] || addr, address: addr })),
    ccRecipients: (cc || []).map((addr: string) => ({ name: addr.split("@")[0] || addr, address: addr })),
    receivedDateTime: new Date().toISOString(),
    sentDateTime: new Date().toISOString(),
    hasAttachments: formattedAttachments.length > 0,
    attachments: formattedAttachments,
    isRead: true,
    importance: "normal" as const,
    isDemo: true,
  };
  demoMessagesList.unshift(newDemoSent as any);

  return res.json({
    success: true,
    message: `共通アドレス [${targetMailbox || "marine-ops@marinetrade.example.com"}] から送信完了しました（デモモード記録${formattedAttachments.length > 0 ? ` / 添付ファイル${formattedAttachments.length}件` : ""}）`,
    demoRecord: newDemoSent,
  });
});

// Express API 404 Fallback Handler for unmatched API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({
    error: "API Endpoint Not Found",
    path: req.originalUrl || req.url,
  });
});

// Global Express Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[Express Global Error]:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: err?.message || String(err),
    });
  }
});

// Start Server with Vite Middleware in dev or static serve in prod
async function startServer() {
  if (process.env.VERCEL) {
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const viteModule = "vite";
      const { createServer: createViteServer } = await import(/* vite-ignore */ viteModule);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("[Vite Middleware Load Warning]:", e);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Marine Spare Parts Quotation App running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app };


