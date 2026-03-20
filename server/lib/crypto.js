import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '../config/env.js';
import { HttpError } from './http.js';

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function getEncryptionKey() {
  const env = getServerEnv();
  if (!env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    throw new HttpError(500, 'Missing GOOGLE_TOKEN_ENCRYPTION_KEY for Google token storage.');
  }

  return createHash('sha256').update(env.GOOGLE_TOKEN_ENCRYPTION_KEY).digest();
}

function getStateSecret() {
  const env = getServerEnv();
  if (!env.GOOGLE_OAUTH_STATE_SECRET) {
    throw new HttpError(500, 'Missing GOOGLE_OAUTH_STATE_SECRET for Google OAuth state signing.');
  }

  return env.GOOGLE_OAUTH_STATE_SECRET;
}

export function encryptSecret(plainText) {
  if (!plainText) return '';

  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => toBase64Url(part)).join('.');
}

export function decryptSecret(cipherText) {
  if (!cipherText) return '';
  const [ivRaw, tagRaw, encryptedRaw] = String(cipherText).split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new HttpError(500, 'Stored Google token payload is malformed.');
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64Url(ivRaw));
  decipher.setAuthTag(fromBase64Url(tagRaw));

  const decrypted = Buffer.concat([
    decipher.update(fromBase64Url(encryptedRaw)),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function signStatePayload(payload) {
  const json = JSON.stringify(payload);
  const encoded = toBase64Url(json);
  const signature = createHmac('sha256', getStateSecret()).update(encoded).digest();
  return `${encoded}.${toBase64Url(signature)}`;
}

export function verifyStatePayload(value) {
  const [encoded, providedSignature] = String(value || '').split('.');
  if (!encoded || !providedSignature) {
    throw new HttpError(400, 'Google OAuth state is missing or malformed.');
  }

  const expectedSignature = createHmac('sha256', getStateSecret()).update(encoded).digest();
  const actualSignature = fromBase64Url(providedSignature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new HttpError(400, 'Google OAuth state signature is invalid.');
  }

  return JSON.parse(fromBase64Url(encoded).toString('utf8'));
}
