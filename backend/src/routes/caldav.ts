import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  type CalDavCredentials,
  fetchCalendars,
  fetchAllEvents,
  saveCalDavEvent,
  deleteCalDavEvent,
  updateEventRsvp,
  normalizeMailcowUrl,
  createCalDavCalendar,
  deleteCalDavCalendar
} from '../services/davClient.js';
import {
  type CalendarEventDTO,
  type AttendeeDTO,
  parseIcsToEvents,
  buildCalendarExportIcs,
  normalizeDanishText
} from '../services/icalMapper.js';
import {
  listSharesForUser,
  createShareLink,
  deleteShareLink,
  resolveShareToken
} from '../services/shareStore.js';
import {
  addUserSubscription,
  removeUserSubscription,
  syncUserSubscriptions
} from '../services/subscriptionService.js';
import {
  createRateLimiter,
  getSessionFromCookie,
  requireDavCredentials
} from '../services/sessionAuth.js';

export const caldavRouter = Router();

const publicShareLimiter = createRateLimiter(
  60,
  60 * 1000,
  'For mange forespørgsler. Prøv igen om et øjeblik.'
);

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
 * POST /api/caldav/sync
 */
caldavRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const timeRange = req.body?.timeRange as { start: string; end: string } | undefined;
    const clientSubscriptions = Array.isArray(req.body?.subscriptions)
      ? req.body.subscriptions
      : undefined;

    const [caldavCalendars, subData] = await Promise.all([
      fetchCalendars(creds),
      syncUserSubscriptions(creds, clientSubscriptions)
    ]);
    const caldavEvents = await fetchAllEvents(creds, caldavCalendars, timeRange);

    sendCompressedJson(req, res, {
      ok: true,
      calendars: [...caldavCalendars, ...subData.calendars],
      events: [...caldavEvents, ...subData.events],
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('CalDAV sync fejl:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Synkronisering med CalDAV-serveren mislykkedes.'
    });
  }
});

/**
 * POST /api/caldav/events
 */
caldavRouter.post('/events', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const event = req.body?.event as CalendarEventDTO | undefined;
    if (!event || !event.calendarId || !event.title) {
      res.status(400).json({ ok: false, error: 'Ugyldige begivenhedsdata.' });
      return;
    }

    const saved = await saveCalDavEvent(creds, event);
    res.json({ ok: true, event: saved });
  } catch (err: any) {
    console.error('Fejl ved gem af CalDAV event:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke gemme begivenheden på CalDAV-serveren.'
    });
  }
});

/**
 * DELETE /api/caldav/events
 */
caldavRouter.delete('/events', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const caldavUrl = (req.body?.caldavUrl || req.query?.caldavUrl) as string | undefined;
    const etag = (req.body?.etag || req.query?.etag) as string | undefined;

    if (!caldavUrl) {
      res.status(400).json({ ok: false, error: 'caldavUrl mangler.' });
      return;
    }

    await deleteCalDavEvent(creds, caldavUrl, etag);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved sletning af CalDAV event:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke slette begivenheden på CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/events/bulk-delete
 */
caldavRouter.post('/events/bulk-delete', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as Array<{ caldavUrl?: string; etag?: string }>)
      : [];

    const validItems = items.filter(
      (item) => typeof item?.caldavUrl === 'string' && item.caldavUrl.trim().length > 0
    );
    let deletedCount = 0;
    let failedCount = 0;
    const CONCURRENCY = 8;

    for (let i = 0; i < validItems.length; i += CONCURRENCY) {
      const batch = validItems.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((item) => deleteCalDavEvent(creds, item.caldavUrl!.trim(), item.etag))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          deletedCount++;
        } else {
          failedCount++;
        }
      }
    }

    res.json({
      ok: true,
      deletedCount,
      failedCount
    });
  } catch (err: any) {
    console.error('Fejl ved bulk-sletning af CalDAV events:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke gennemføre bulk-sletning på CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/calendars
 */
caldavRouter.post('/calendars', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#2563eb');
    const calendarUrl = req.body?.calendarUrl ? String(req.body.calendarUrl).trim() : undefined;

    if (!name && !calendarUrl) {
      res.status(400).json({ ok: false, error: 'Kalendernavn eller kalender-URL mangler.' });
      return;
    }
    const calendar = await createCalDavCalendar(creds, name || 'SOGo Kalender', color, calendarUrl);
    res.json({ ok: true, calendar });
  } catch (err: any) {
    console.error('Fejl ved oprettelse/tilføjelse af kalender:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke oprette eller tilføje kalenderen.'
    });
  }
});

/**
 * DELETE /api/caldav/calendars
 */
caldavRouter.delete('/calendars', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const calendarUrl = String(req.body?.calendarUrl || '');
    if (!calendarUrl) {
      res.status(400).json({ ok: false, error: 'calendarUrl mangler.' });
      return;
    }
    await deleteCalDavCalendar(creds, calendarUrl);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved sletning af kalender:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke slette kalenderen.' });
  }
});

function extractSubscriptionContext(req: Request): CalDavCredentials {
  try {
    return requireDavCredentials(req);
  } catch {
    const envHost = process.env.DEFAULT_MAIL_HOST || process.env.DEFAULT_IMAP_HOST;
    const rawServer = String(
      req.body?.serverUrl ||
        process.env.DEFAULT_CALDAV_URL ||
        (envHost ? `https://${envHost}/SOGo/dav/` : 'https://caldav.local')
    ).trim();
    const serverUrl = rawServer ? normalizeMailcowUrl(rawServer) : 'https://caldav.local';
    const username = String(req.body?.username || 'default').trim() || 'default';
    return { serverUrl, username, password: '' };
  }
}

/**
 * POST /api/caldav/subscriptions
 */
caldavRouter.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const creds = extractSubscriptionContext(req);
    const subscriptionUrl = String(req.body?.subscriptionUrl || '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const color = req.body?.color ? String(req.body.color).trim() : undefined;

    if (!subscriptionUrl) {
      res.status(400).json({ ok: false, error: 'Abonnements-URL mangler.' });
      return;
    }

    const result = await addUserSubscription(creds, { name, subscriptionUrl, color });
    res.json({
      ok: true,
      calendar: result.calendar,
      events: result.events
    });
  } catch (err: any) {
    console.error('Fejl ved oprettelse af kalender-abonnement:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke tilføje kalender-abonnement.'
    });
  }
});

/**
 * DELETE /api/caldav/subscriptions
 */
caldavRouter.delete('/subscriptions', async (req: Request, res: Response) => {
  try {
    const creds = extractSubscriptionContext(req);
    const id = String(req.body?.id || '').trim();
    if (!id) {
      res.status(400).json({ ok: false, error: 'Abonnements-ID mangler.' });
      return;
    }
    removeUserSubscription(creds, id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved afmelding af abonnement:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke afmelde kalender-abonnement.'
    });
  }
});

/**
 * POST /api/caldav/rsvp
 */
caldavRouter.post('/rsvp', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const event = req.body?.event as CalendarEventDTO | undefined;
    const partstat = req.body?.partstat as AttendeeDTO['partstat'] | undefined;

    if (!event || !partstat) {
      res.status(400).json({ ok: false, error: 'Manglende event eller RSVP-status.' });
      return;
    }

    const updated = await updateEventRsvp(creds, event, partstat);
    res.json({ ok: true, event: updated });
  } catch (err: any) {
    console.error('Fejl ved RSVP opdatering:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke opdatere mødesvar på CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/import
 */
caldavRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const calendarId = String(req.body?.calendarId || '').trim();
    const rawIcs = normalizeDanishText(String(req.body?.icsContent || ''));

    if (!calendarId || !rawIcs.includes('BEGIN:VCALENDAR')) {
      res.status(400).json({
        ok: false,
        error: 'Ugyldig .ics-fil eller manglende mål-kalender.'
      });
      return;
    }

    const parsedEvents = parseIcsToEvents(rawIcs, calendarId);
    if (parsedEvents.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Ingen gyldige begivenheder (VEVENT) fundet i .ics-filen.'
      });
      return;
    }

    const savedEvents: CalendarEventDTO[] = [];
    for (const ev of parsedEvents) {
      const saved = await saveCalDavEvent(creds, {
        ...ev,
        calendarId,
        uid: crypto.randomUUID(),
        caldavUrl: undefined,
        etag: undefined,
        rawIcs: undefined
      });
      savedEvents.push(saved);
    }

    res.json({
      ok: true,
      importedCount: savedEvents.length,
      events: savedEvents
    });
  } catch (err: any) {
    console.error('Fejl ved ICS import:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke importere .ics-filen til kalenderen.'
    });
  }
});

/**
 * POST /api/caldav/export
 */
caldavRouter.post('/export', async (req: Request, res: Response) => {
  try {
    requireDavCredentials(req);
    const events = Array.isArray(req.body?.events) ? (req.body.events as CalendarEventDTO[]) : [];
    const calendarName = String(req.body?.calendarName || 'Kalender').trim();
    const icsContent = buildCalendarExportIcs(events, calendarName);

    res.json({
      ok: true,
      icsContent
    });
  } catch (err: any) {
    console.error('Fejl ved ICS eksport:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke eksportere kalenderen til .ics.'
    });
  }
});

/**
 * GET /api/caldav/shares
 */
caldavRouter.get('/shares', async (req: Request, res: Response) => {
  try {
    const cookieSession = getSessionFromCookie(req);
    if (!cookieSession) {
      res.status(401).json({ ok: false, error: 'Kræver aktivt login.' });
      return;
    }
    const shares = listSharesForUser(cookieSession.username);
    res.json({ ok: true, shares });
  } catch (err: any) {
    res.status(401).json({ ok: false, error: err?.message || 'Uautoriseret' });
  }
});

/**
 * POST /api/caldav/shares
 */
caldavRouter.post('/shares', async (req: Request, res: Response) => {
  try {
    const creds = requireDavCredentials(req);
    const label = String(req.body?.label || 'Delt kalender').trim();
    const calendarUrls = Array.isArray(req.body?.calendarUrls)
      ? req.body.calendarUrls.map(String)
      : [];
    const calendarNames = Array.isArray(req.body?.calendarNames)
      ? req.body.calendarNames.map(String)
      : [];
    const hideDetails = Boolean(req.body?.hideDetails);

    if (calendarUrls.length === 0) {
      res.status(400).json({ ok: false, error: 'Vælg mindst én kalender at dele.' });
      return;
    }

    const share = createShareLink({
      creds,
      label,
      calendarUrls,
      calendarNames,
      hideDetails
    });

    res.json({ ok: true, share });
  } catch (err: any) {
    console.error('Fejl ved oprettelse af delingslink:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke oprette delingslink.' });
  }
});

/**
 * DELETE /api/caldav/shares/:token
 */
caldavRouter.delete('/shares/:token', async (req: Request, res: Response) => {
  try {
    const cookieSession = getSessionFromCookie(req);
    if (!cookieSession) {
      res.status(401).json({ ok: false, error: 'Kræver aktivt login.' });
      return;
    }
    const rawToken = req.params.token;
    const token = String(Array.isArray(rawToken) ? rawToken[0] : rawToken || '').trim();
    const deleted = deleteShareLink(cookieSession.username, token);
    res.json({ ok: true, deleted });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke slette delingslink.' });
  }
});

/**
 * GET /api/caldav/public/:token
 */
caldavRouter.get('/public/:token', publicShareLimiter, async (req: Request, res: Response) => {
  try {
    const rawToken = req.params.token;
    const token = String(Array.isArray(rawToken) ? rawToken[0] : rawToken || '').trim();
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) {
      res.status(404).json({
        ok: false,
        error: 'Ugyldigt delingslink.'
      });
      return;
    }

    const resolved = resolveShareToken(token);
    if (!resolved) {
      res.status(404).json({
        ok: false,
        error: 'Dette delingslink findes ikke eller er blevet tilbagekaldt af ejeren.'
      });
      return;
    }

    const { record, creds } = resolved;
    const allCalendars = await fetchCalendars(creds);
    const allowedSet = new Set(
      record.calendarUrls.map((u) => decodeURIComponent(u).toLowerCase().replace(/\/+$/, ''))
    );

    const sharedCalendars = allCalendars
      .filter((c) => {
        const normUrl = decodeURIComponent(c.url).toLowerCase().replace(/\/+$/, '');
        const normId = decodeURIComponent(c.id).toLowerCase().replace(/\/+$/, '');
        return allowedSet.has(normUrl) || allowedSet.has(normId);
      })
      .map((c) => ({
        ...c,
        readOnly: true,
        isShared: true,
        owner: record.username
      }));

    const rawEvents = await fetchAllEvents(creds, sharedCalendars);

    const sanitizedEvents: CalendarEventDTO[] = rawEvents.map((ev) => ({
      id: ev.id,
      uid: ev.uid,
      calendarId: ev.calendarId,
      title: record.hideDetails ? 'Optaget' : ev.title,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      description: record.hideDetails ? '' : ev.description,
      location: record.hideDetails ? '' : ev.location,
      videoUrl: record.hideDetails ? undefined : ev.videoUrl,
      timezone: ev.timezone,
      attendees: [],
      organizer: undefined,
      reminderMinutes: null
    }));

    res.json({
      ok: true,
      label: record.label,
      owner: record.username,
      hideDetails: record.hideDetails,
      calendars: sharedCalendars,
      events: sanitizedEvents,
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Fejl ved hentning af offentligt delt kalender:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: 'Kunne ikke hente den delte kalender fra serveren.'
    });
  }
});
