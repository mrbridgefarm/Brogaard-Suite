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
  buildVcardFromContact,
  fetchExternalContactPhotoAsDataUrl
} from '../services/carddavClient.js';
import { normalizeDanishText } from '../services/icalMapper.js';
import { updateCalDavCalendarColor } from '../services/davClient.js';
import {
  syncContactBirthdaysToCalDav,
  maybeAutoSyncContactBirthdays
} from '../services/birthdayCaldavSync.js';
import { requireDavCredentials } from '../services/sessionAuth.js';
import {
  canonicalContactPrefKey,
  getUserContactPrefs,
  setUserContactFavorite,
  setUserContactCalendarColor,
  clearUserContactUnstarOverride
} from '../services/contactPrefsStore.js';

export const carddavRouter = Router();

function applyFavoritePrefsToContacts(username: string, contacts: ContactDTO[]): ContactDTO[] {
  const prefs = getUserContactPrefs(username);
  const favSet = new Set(prefs.favoriteContacts);
  const unstarSet = new Set(prefs.unstarredOverrides);

  return contacts.map((c) => {
    const key = canonicalContactPrefKey(c.id);
    const uidKey = c.uid ? canonicalContactPrefKey(c.uid) : '';
    const isUnstarredOverride = unstarSet.has(key) || (Boolean(uidKey) && unstarSet.has(uidKey));
    const isFavPref = favSet.has(key) || (Boolean(uidKey) && favSet.has(uidKey));
    const starred = isFavPref ? true : isUnstarredOverride ? false : Boolean(c.starred);
    return {
      ...c,
      starred
    };
  });
}

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
    const rawContacts = await fetchAllContacts(creds, addressBooks);
    const contacts = applyFavoritePrefsToContacts(creds.username, rawContacts);
    const prefs = getUserContactPrefs(creds.username);
    void maybeAutoSyncContactBirthdays(creds);

    sendCompressedJson(req, res, {
      ok: true,
      addressBooks,
      contacts,
      calendarColor: prefs.calendarColor || null,
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
    if (typeof contact.starred === 'boolean') {
      setUserContactFavorite(creds.username, saved.id, contact.starred);
      if (saved.uid) {
        setUserContactFavorite(creds.username, saved.uid, contact.starred);
      }
      if (contact.starred) {
        clearUserContactUnstarOverride(creds.username, saved.id);
      }
      saved.starred = contact.starred;
    }
    if (getUserContactPrefs(creds.username).birthdayCalendarSyncEnabled) {
      await syncContactBirthdaysToCalDav(creds).catch((e) =>
        console.warn('Kunne ikke auto-synke fødselsdagskalender:', e)
      );
    }
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
 * POST /api/carddav/favorite
 * Markerer eller fjerner en kontakt som favorit (gemmes både i CardDAV Starred-tag hvis skrivbar og i brugerpræferencer).
 */
carddavRouter.post('/favorite', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const contactId = String(req.body?.contactId || '').trim();
    const starred = Boolean(req.body?.starred);
    const contact = req.body?.contact as ContactDTO | undefined;

    if (!contactId && !contact?.id) {
      res.status(400).json({ ok: false, error: 'contactId mangler.' });
      return;
    }

    const effectiveId = contactId || String(contact?.id || '');
    setUserContactFavorite(creds.username, effectiveId, starred);
    if (contact?.uid) {
      setUserContactFavorite(creds.username, contact.uid, starred);
    }

    let updatedContact: ContactDTO | undefined;
    if (contact && contact.addressBookId && contact.vcardUrl) {
      try {
        updatedContact = await saveCardDavContact(creds, {
          ...contact,
          starred
        });
        updatedContact.starred = starred;
      } catch {
        // Skrivebeskyttet adressebog (f.eks. Global Adressebog): brugerpræferencen er allerede gemt
      }
    }

    res.json({
      ok: true,
      starred,
      contact: updatedContact
    });
  } catch (err: any) {
    console.error('Fejl ved opdatering af favorit-kontakt:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke opdatere favorit-status.'
    });
  }
});

/**
 * PUT /api/carddav/prefs
 * Gemmer brugerens valgte kalenderfarve til kontakt-fødselsdage/mærkedage på tværs af enheder.
 */
carddavRouter.put('/prefs', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const rawColor = req.body?.calendarColor;
    const savedColor = setUserContactCalendarColor(
      creds.username,
      typeof rawColor === 'string' ? rawColor : null
    );
    const prefs = getUserContactPrefs(creds.username);
    if (prefs.birthdayCalendarSyncEnabled && prefs.birthdayCalendarUrl) {
      await updateCalDavCalendarColor(
        creds,
        prefs.birthdayCalendarUrl,
        savedColor || '#ec4899'
      ).catch(() => {});
    }
    res.json({
      ok: true,
      calendarColor: savedColor
    });
  } catch (err: any) {
    res.status(400).json({
      ok: false,
      error: err?.message || 'Kunne ikke gemme kontaktpræferencer.'
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
    if (getUserContactPrefs(creds.username).birthdayCalendarSyncEnabled) {
      await syncContactBirthdaysToCalDav(creds).catch((e) =>
        console.warn('Kunne ikke auto-synke fødselsdagskalender:', e)
      );
    }
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

    // Hent evt. eksterne HTTPS PHOTO-links (f.eks. fra Google Kontakter .vcf-eksport) i små batches
    const PHOTO_BATCH_SIZE = 5;
    for (let i = 0; i < parsed.length; i += PHOTO_BATCH_SIZE) {
      const slice = parsed.slice(i, i + PHOTO_BATCH_SIZE);
      await Promise.all(
        slice.map(async (c) => {
          if (!c.photoDataUrl && c.externalPhotoUrl) {
            const downloaded = await fetchExternalContactPhotoAsDataUrl(c.externalPhotoUrl);
            if (downloaded) {
              c.photoDataUrl = downloaded;
            }
          }
        })
      );
    }

    const savedContacts: ContactDTO[] = [];
    for (const c of parsed) {
      const saved = await saveCardDavContact(creds, {
        ...c,
        externalPhotoUrl: undefined,
        addressBookId,
        uid: crypto.randomUUID(),
        vcardUrl: undefined,
        etag: undefined
      });
      if (c.starred) {
        setUserContactFavorite(creds.username, saved.id, true);
        if (saved.uid) {
          setUserContactFavorite(creds.username, saved.uid, true);
        }
        saved.starred = true;
      }
      savedContacts.push(saved);
    }

    if (getUserContactPrefs(creds.username).birthdayCalendarSyncEnabled) {
      await syncContactBirthdaysToCalDav(creds).catch((e) =>
        console.warn('Kunne ikke auto-synke fødselsdagskalender:', e)
      );
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
