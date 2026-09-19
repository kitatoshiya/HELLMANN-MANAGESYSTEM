import express from 'express';
import {
  handleM365Users,
  handleM365TestConnection,
  handleM365Sync,
  handleM365Send,
  handleM365Attachment,
  handleM365MessageAttachments,
} from '../src/server/m365Core.ts';

export const m365Router = express.Router();

m365Router.post('/users', async (req, res) => {
  const result = await handleM365Users(req.body);
  return res.status(result.status).json(result.data);
});

m365Router.post('/test-connection', async (req, res) => {
  const result = await handleM365TestConnection(req.body);
  return res.status(result.status).json(result.data);
});

m365Router.post('/sync', async (req, res) => {
  const result = await handleM365Sync(req.body);
  return res.status(result.status).json(result.data);
});

m365Router.post('/send', async (req, res) => {
  const result = await handleM365Send(req.body);
  return res.status(result.status).json(result.data);
});

m365Router.post('/attachment', async (req, res) => {
  const result = await handleM365Attachment(req.body);
  return res.status(result.status).json(result.data);
});

m365Router.post('/message-attachments', async (req, res) => {
  const result = await handleM365MessageAttachments(req.body);
  return res.status(result.status).json(result.data);
});
