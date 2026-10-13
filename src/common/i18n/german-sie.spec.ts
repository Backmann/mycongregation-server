import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * The server speaks German with «Sie», as the app does (decision of
 * 28 September 2026).
 *
 * The decision reached the app's screens and never the server: pushes and
 * letters still said «Du hast eine Aufgabe», «Dein Vortrag…», «Eure Gruppe
 * reinigt heute…», «Schalte sie … ein» (found 13 October 2026). This reads
 * every string under a `de:` key in the server's source — the one place the
 * German words live — and fails on the familiar forms.
 *
 * Only whole pronouns are matched: «Dutzend» and «Dienst» pass. An
 * imperative without a pronoun («Stimmt einen Tag ab») cannot be told apart
 * by a pattern; that is what the reading on 13 October was for.
 */

const FAMILIAR =
  /(^|[^\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure|euren|eurem|eurer|eures)(?=[^\p{L}]|$)/iu;

const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'migrations' ? [] : sources(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every string literal under a `de:` property, with where it stands. */
function germanStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const file of sources(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (!/\bde\s*:/.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, inDe: boolean): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'de') {
        inDe = true;
      }
      if (
        inDe &&
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node))
      ) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
        out.push({
          where: `${file.slice(ROOT.length + 1)}:${line + 1}`,
          text: node.getText(sf),
        });
        return;
      }
      ts.forEachChild(node, (child) => visit(child, inDe));
    };
    visit(sf, false);
  }
  return out;
}

describe('German speaks with «Sie»', () => {
  it('the rule tells the familiar forms from the polite ones', () => {
    expect(FAMILIAR.test('Du hast eine Aufgabe')).toBe(true);
    expect(FAMILIAR.test('Eure Gruppe reinigt heute den Saal')).toBe(true);
    expect(FAMILIAR.test('auf keinem deiner Geräte')).toBe(true);
    expect(FAMILIAR.test('Sie haben eine Aufgabe')).toBe(false);
    expect(FAMILIAR.test('Ein Dutzend im Dienst')).toBe(false);
  });

  it('finds the German texts at all', () => {
    // A walk that found nothing would pass the next test for nothing.
    expect(germanStrings().length).toBeGreaterThan(150);
  });

  it('no German text the server sends says «du»', () => {
    const familiar = germanStrings()
      .filter((s) => FAMILIAR.test(s.text))
      .map((s) => `${s.where}  ${s.text}`);
    expect(familiar).toEqual([]);
  });
});
