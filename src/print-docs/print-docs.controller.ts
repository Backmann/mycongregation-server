import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrintDocsService } from './print-docs.service';

/**
 * The page Safari opens: the sheet, a line on top for a second try, and a
 * script that asks for the print sheet once it has loaded.
 *
 * The response carries `Content-Security-Policy: sandbox allow-modals
 * allow-scripts`. Without allow-same-origin the page has an opaque origin: it
 * cannot read the cookies, cannot call the API as the person, and only the
 * one script stamped with this response's nonce runs — whatever the sheet
 * itself contained does not.
 */
export function printPage(html: string, nonce: string): string {
  const head = `<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  .pd-bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px;
    align-items: center; justify-content: space-between; padding: 10px 14px;
    background: #0e7490; color: #fff;
    font: 600 14px -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .pd-bar button { font: 700 14px -apple-system, 'Segoe UI', Roboto, sans-serif;
    border: 0; border-radius: 999px; padding: 8px 16px; background: #fff;
    color: #0e7490; }
  @media print { .pd-bar { display: none !important; } }
</style>
<script nonce="${nonce}">
  (function () {
    function go() { try { window.print(); } catch (e) {} }
    window.addEventListener('load', function () {
      var b = document.getElementById('pd-print');
      if (b) b.addEventListener('click', go);
      var f = document.fonts && document.fonts.ready;
      if (f) { f.then(function () { setTimeout(go, 150); }); }
      else { setTimeout(go, 400); }
    });
  })();
</script>`;
  const bar = `<div class="pd-bar"><span>mycongregation.org</span><button id="pd-print" type="button">Печать / Print</button></div>`;
  let page = html;
  page = /<head[^>]*>/i.test(page)
    ? page.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
    : `<!DOCTYPE html><html><head><meta charset="utf-8">${head}</head><body>${page}</body></html>`;
  page = /<body[^>]*>/i.test(page)
    ? page.replace(/<body[^>]*>/i, (m) => `${m}${bar}`)
    : page;
  return page;
}

const GONE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mycongregation.org</title></head>
<body style="font:16px -apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;padding:32px;line-height:1.5">
<p><b>Ссылка для печати устарела.</b><br>Вернитесь в приложение и нажмите принтер ещё раз.</p>
<p style="color:#64748b"><b>Der Drucklink ist abgelaufen.</b><br>Zurück in die App und erneut auf den Drucker tippen.</p>
<p style="color:#64748b"><b>This print link has expired.</b><br>Go back to the app and tap the printer again.</p>
</body></html>`;

@Controller('print-docs')
export class PrintDocsController {
  constructor(private readonly docs: PrintDocsService) {}

  /** A signed-in person hands over a sheet the app has made (text/html). */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() html: string) {
    const token = this.docs.create(
      user.id,
      typeof html === 'string' ? html : '',
    );
    return { token };
  }

  /** Safari opens this, with no sign-in: the token is the whole key. */
  @Public()
  @Get(':token')
  read(@Param('token') token: string, @Res() res: Response): void {
    const html = /^[A-Za-z0-9_-]{43}$/.test(token)
      ? this.docs.read(token)
      : null;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!html) {
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      );
      res.status(410).send(GONE);
      return;
    }
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      [
        'sandbox allow-modals allow-scripts',
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        'font-src https: data:',
        'img-src https: data:',
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    res.status(200).send(printPage(html, nonce));
  }
}
