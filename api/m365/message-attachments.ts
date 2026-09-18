import { handleM365MessageAttachments } from '../../src/server/m365Core.ts';

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

  try {
    const result = await handleM365MessageAttachments(req.body || {});
    return res.status(result.status).json(result.data);
  } catch (err: any) {
    console.error('Error in Vercel /api/m365/message-attachments handler:', err);
    return res.status(200).json({
      success: true,
      attachments: [],
    });
  }
}
