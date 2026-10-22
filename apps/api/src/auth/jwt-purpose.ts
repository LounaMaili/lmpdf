export const ACCESS_TOKEN_PURPOSE = 'access';
export const MFA_CHALLENGE_PURPOSE = 'mfa-challenge';

type SubjectClaims = { sub: string };

function hasSubject(payload: unknown): payload is SubjectClaims & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    && typeof (payload as SubjectClaims).sub === 'string'
    && (payload as SubjectClaims).sub.trim().length > 0;
}

function matchesPurpose(payload: Record<string, unknown>, expected: string): boolean {
  // Untyped legacy tokens remain valid; an explicit, unknown or conflicting use does not.
  return (!Object.prototype.hasOwnProperty.call(payload, 'purpose') || payload.purpose === expected)
    && (!Object.prototype.hasOwnProperty.call(payload, 'type') || payload.type === expected);
}

export function isAccessTokenPayload(payload: unknown): payload is SubjectClaims {
  return hasSubject(payload) && !Object.prototype.hasOwnProperty.call(payload, 'mfaChallenge')
    && matchesPurpose(payload, ACCESS_TOKEN_PURPOSE);
}

export function isMfaChallengePayload(payload: unknown): payload is SubjectClaims {
  return hasSubject(payload) && payload.mfaChallenge === true
    && matchesPurpose(payload, MFA_CHALLENGE_PURPOSE);
}
