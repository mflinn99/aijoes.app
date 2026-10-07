// Passwords people are known to choose, and passwords built from the person's
// own details. ASVS 2.1.7 asks for a check against breached passwords; this
// list of the most common ones (12+ characters, the minimum here) is the
// offline part of that. A full breached-password check (for example the k-anonymity
// range API at api.pwnedpasswords.com) needs outbound access the host may not
// allow, so it is not called from here.

const COMMON = new Set(
  [
    "123456789012", "1234567890123", "12345678901234", "123456789123", "111111111111",
    "000000000000", "123123123123", "121212121212", "qwertyuiopas", "qwertyuiop12",
    "qwertyuiop123", "qwerty123456", "qwerty12345678", "1q2w3e4r5t6y", "1qaz2wsx3edc",
    "zaq12wsxcde3", "asdfghjkl123", "zxcvbnm12345", "password1234",
    "password12345", "password123456", "passw0rd1234", "p@ssw0rd1234", "p@ssword1234",
    "password!234", "passwordpassword", "mypassword123", "letmein12345", "letmeinletmein",
    "welcome12345", "welcome123456", "welcome2024!", "welcome2025!", "welcome2026!",
    "iloveyou1234", "iloveyou12345", "sunshine1234", "princess1234", "football1234",
    "baseball1234", "superman1234", "trustno11234", "dragon123456", "monkey123456",
    "abc123456789", "abcdefghijkl", "abcd12345678", "aa1234567890", "changeme1234",
    "changemenow1", "administrator", "administrator1", "admin1234567", "adminadmin12",
    "rootroot1234", "secret123456", "starwars1234", "computer1234", "internet1234",
    "summer2024!!", "summer2025!!", "summer2026!!", "winter2024!!", "winter2025!!",
    "winter2026!!", "spring2026!!", "autumn2026!!", "january2026!", "september2026",
    "october2026!", "correcthorsebatterystaple", "correct horse battery staple",
    "1234567890qwerty", "qwertyuiopasdfgh", "qwertyuiopasdfghjkl", "1234qwerasdfzxcv",
    "q1w2e3r4t5y6", "a1b2c3d4e5f6", "11223344556677", "987654321098", "098765432109",
    "1029384756qp", "michael12345", "jennifer1234", "charlie12345", "thomas123456",
    "london123456", "liverpool1234", "chelsea12345", "arsenal12345", "manchester12",
    "sentinel1234", "sentinel8123", "sentinel81234", "boardroom1234", "company12345",
  ].map((p) => p.toLowerCase()),
);

/** Why a password isn't acceptable, or null when it is. */
export function passwordProblem(password: string, details: { email?: string; name?: string } = {}): string | null {
  const lower = password.normalize("NFKC").toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose another.";
  if (/^(.)\1+$/.test(lower) || new Set(lower).size < 4) return "Use a password with more variety.";
  const local = (details.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const parts = [local, ...(details.name ?? "").toLowerCase().split(/\s+/)].filter((p) => p.length >= 4);
  if (parts.some((p) => lower === p || lower.replace(/[^a-z]/g, "") === p.replace(/[^a-z]/g, ""))) {
    return "Don't use your name or email address as your password.";
  }
  return null;
}
