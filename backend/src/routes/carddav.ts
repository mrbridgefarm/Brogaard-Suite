import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  type ContactDTO,
  fetchAddressBooks,
  fetchAllContacts,
  saveCardDavContact,
  deleteCardDavContact,
  parseVcardToContacts,
  buildVcardFromContact
} from '../services/carddavClient.js';
import { normalizeDanishText } from '../services/icalMapper.js';
import { requireDavCredentials } from '../services/sessionAuth.js';

export const carddavRouter = Router();

function sendCompressedJson(req: Request, res: Response, payload: unknown) {
  const jsonStr = JSON.stringify(payload);
  const acceptEnc = String(req.headers['accept-encoding'] || '');
  if (jsonStr.length > 2048 && acceptEnc.includes('gzip')) {
    const gz = zlib.gzipSync(jsonStr, { level: 6 });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.send(gz);
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(jsonStr);
}

/**
 * POST /api/carddav/sync
 * Henter alle adressebøger og kontakter fra Mailcow / SOGo CardDAV.
 */
carddavRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const addressBooks = await fetchAddressBooks(creds);
    const contacts = await fetchAllContacts(creds, addressBooks);

    sendCompressedJson(req, res, {
      ok: true,
      addressBooks,
      contacts,
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('CardDAV sync fejl:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Synkronisering med CardDAV-serveren mislykkedes.'
    });
  }
});

/**
 * POST /api/carddav/contacts
 * Opretter eller opdaterer en kontakt på CardDAV-serveren.
 */
carddavRouter.post('/contacts', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const contact = req.body?.contact as ContactDTO | undefined;
    const hasIdentity = Boolean(
      contact?.fullName?.trim() ||
        contact?.firstName?.trim() ||
        contact?.lastName?.trim() ||
        (contact?.emails && contact.emails.length > 0)
    );

    if (!contact || !contact.addressBookId || !hasIdentity) {
      res.status(400).json({ ok: false, error: 'Ugyldige kontaktdata.' });
      return;
    }

    const saved = await saveCardDavContact(creds, contact);
    res.json({ ok: true, contact: saved });
  } catch (err: any) {
    console.error('Fejl ved gem af CardDAV kontakt:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke gemme kontakten på CardDAV-serveren.'
    });
  }
});

/**
 * DELETE /api/carddav/contacts
 */
carddavRouter.delete('/contacts', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const vcardUrl = (req.body?.vcardUrl || req.query?.vcardUrl) as string | undefined;
    const etag = (req.body?.etag || req.query?.etag) as string | undefined;

    if (!vcardUrl) {
      res.status(400).json({ ok: false, error: 'vcardUrl mangler.' });
      return;
    }

    await deleteCardDavContact(creds, vcardUrl, etag);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved sletning af CardDAV kontakt:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke slette kontakten på CardDAV-serveren.'
    });
  }
});

/**
 * POST /api/carddav/import
 * Importerer en .vcf fil (med ét eller flere vCards) ind i en adressebog.
 */
carddavRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const addressBookId = String(req.body?.addressBookId || '').trim();
    const rawVcf = normalizeDanishText(String(req.body?.vcfContent || ''));

    if (!addressBookId || !/BEGIN:VCARD/i.test(rawVcf)) {
      res.status(400).json({
        ok: false,
        error: 'Ugyldig .vcf-fil eller manglende mål-adressebog.'
      });
      return;
    }

    const parsed = parseVcardToContacts(rawVcf, addressBookId);
    if (parsed.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Ingen gyldige kontakter fundet i .vcf-filen.'
      });
      return;
    }

    const savedContacts: ContactDTO[] = [];
    for (const c of parsed) {
      const saved = await saveCardDavContact(creds, {
        ...c,
        addressBookId,
        uid: crypto.randomUUID(),
        vcardUrl: undefined,
        etag: undefined
      });
      savedContacts.push(saved);
    }

    res.json({
      ok: true,
      importedCount: savedContacts.length,
      contacts: savedContacts
    });
  } catch (err: any) {
    console.error('Fejl ved VCF import:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke importere .vcf-filen.'
    });
  }
});

/**
 * POST /api/carddav/export
 * Genererer en samlet .vcf-fil ud fra de valgte kontakter.
 */
carddavRouter.post('/export', async (req: Request, res: Response) => {
  try {
    requireDavCredentials(req);
    const contacts = Array.isArray(req.body?.contacts) ? (req.body.contacts as ContactDTO[]) : [];
    const vcfContent = contacts.map((c) => buildVcardFromContact(c)).join('\r\n');

    res.json({
      ok: true,
      vcfContent
    });
  } catch (err: any) {
    console.error('Fejl ved VCF eksport:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke eksportere kontakter til .vcf.'
    });
  }
});
