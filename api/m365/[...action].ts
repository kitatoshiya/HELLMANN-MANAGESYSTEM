import {
  handleM365Sync,
  handleM365Send,
  handleM365TestConnection,
  handleM365Users,
  handleM365Attachment,
  handleM365MessageAttachments,
} from '../../src/server/m365Core.ts';

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

  const { action } = req.query || {};
  const actionPath = Array.isArray(action) ? action.join('/') : String(action || '');

  try {
    if (actionPath === 'sync') {
      const result = await handleM365Sync(req.body || {});
      return res.status(result.status).json(result.data);
    }
    if (actionPath === 'send') {
      const result = await handleM365Send(req.body || {});
      return res.status(result.status).json(result.data);
    }
    if (actionPath === 'test-connection') {
      const result = await handleM365TestConnection(req.body || {});
      return res.status(result.status).json(result.data);
    }
    if (actionPath === 'users') {
      const result = await handleM365Users(req.body || {});
      return res.status(result.status).json(result.data);
    }
    if (actionPath === 'attachment') {
      const result = await handleM365Attachment(req.body || {});
      return res.status(result.status).json(result.data);
    }
    if (actionPath === 'message-attachments') {
      const result = await handleM365MessageAttachments(req.body || {});
      return res.status(result.status).json(result.data);
    }

    return res.status(404).json({ success: false, error: `Unknown M365 action: ${actionPath}` });
  } catch (err: any) {
    console.error(`Error in /api/m365/${actionPath}:`, err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
