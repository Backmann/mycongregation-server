import { SetMetadata } from '@nestjs/common';

/**
 * THE SCREEN ON THE STAGE MAY READ ONLY WHAT IT SHOWS (20 October 2026).
 *
 * A laptop lies open at the lectern, signed in, in a hall full of children
 * and visitors. Hiding the other screens in the app is not enough: most of
 * the server answers anybody signed in (35 of 52 controllers name no role),
 * so a curious hand in the address bar would read what an ordinary
 * publisher reads. For an account of role STAGE the server therefore says
 * no to EVERYTHING, except the handlers marked with this decorator — the
 * readings the stage screen is made of (auth/jwt-auth.guard.ts).
 *
 * Mark a handler only when the stage screen itself calls it, and only a
 * reading: a stage screen writes nothing but its own unlocking.
 */
export const STAGE_ALLOWED_KEY = 'stageAllowed';

export const StageAllowed = () => SetMetadata(STAGE_ALLOWED_KEY, true);

/** Four to eight digits: what a brother types on the laptop to open its menu. */
export const STAGE_PIN_RE = /^\d{4,8}$/;
