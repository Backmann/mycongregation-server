import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as semver from 'semver';

/**
 * The server accepts no file uploads — and must not start to while multer is
 * vulnerable (3 November 2026).
 *
 * @nestjs/platform-express 11.2.8 pins multer 2.4.0, which carries a high
 * advisory (denial of service through a pending asynchronous fileFilter),
 * fixed in multer 2.5.0. No NestJS release pins a fixed multer yet.
 *
 * It is not reachable today: multer only parses a request on a route with a
 * file interceptor, and there is none — the .epub workbook is parsed in the
 * app and arrives as JSON. Checked on a running server: a multipart upload
 * to every one of the 201 write routes never invoked multer, not even at
 * boot. The Dependabot alert was dismissed on that ground.
 *
 * This test keeps that true. The day a file interceptor appears, it fails
 * unless the installed multer is already fixed — so the alert cannot become
 * real without someone deciding it. Once NestJS ships a fixed multer, this
 * test passes on its own and can be removed.
 */
const FIXED_MULTER = '2.5.0';

const UPLOAD = [
  /\bFileInterceptor\b/,
  /\bFilesInterceptor\b/,
  /\bAnyFilesInterceptor\b/,
  /\bFileFieldsInterceptor\b/,
  /\bNoFilesInterceptor\b/,
  /@UploadedFiles?\(/,
  /\bMulterModule\b/,
  /from ['"]multer['"]/,
  /require\(['"]multer['"]\)/,
];

/** Every non-test source file under a directory. */
export function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Files that would make multer parse a request, with what gave them away. */
export function uploadSites(root: string): string[] {
  return sources(root).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    const hit = UPLOAD.find((re) => re.test(src));
    return hit ? [`${f.slice(root.length + 1)} (${hit.source})`] : [];
  });
}

/** The multer that NestJS actually loads. */
function installedMulter(): string {
  const pe = require.resolve('@nestjs/platform-express/package.json');
  return require(
    require.resolve('multer/package.json', { paths: [join(pe, '..')] }),
  ).version;
}

describe('no file uploads while multer is vulnerable', () => {
  it('finds no file interceptor in the server, or multer is already fixed', () => {
    const multer = installedMulter();
    const sites = uploadSites(join(__dirname, '..'));
    if (sites.length > 0 && semver.lt(multer, FIXED_MULTER)) {
      throw new Error(
        `File uploads found, but multer ${multer} < ${FIXED_MULTER} is vulnerable ` +
          `(DoS via a pending async fileFilter). Update multer first.\n` +
          sites.map((s) => `  ${s}`).join('\n'),
      );
    }
  });

  it('recognises an upload when there is one', () => {
    // The scan itself must work, or the test above proves nothing.
    const re = (s: string) => UPLOAD.some((r) => r.test(s));
    expect(re(`@UseInterceptors(FileInterceptor('file'))`)).toBe(true);
    expect(re(`upload(@UploadedFile() f: Express.Multer.File) {}`)).toBe(true);
    expect(re(`import multer from 'multer';`)).toBe(true);
    expect(re(`@Post('apply') apply(@Body() dto: ApplyParsedDto) {}`)).toBe(
      false,
    );
  });
});
