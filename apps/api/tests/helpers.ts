import { createAthlete, login } from "../src/auth/auth.service.js";

export const TEST_PASSWORD = "correct-horse-battery-staple";

/** Creates an athlete the way an operator would (there's no public signup) and logs them in. */
export async function createTestAthlete(email: string, name = "Test Athlete") {
  await createAthlete(email, TEST_PASSWORD, name);
  const { tokens } = await login(email, TEST_PASSWORD);
  return tokens;
}

/** An access token for a freshly created athlete -- what most route tests need. */
export async function signupAndLogin(email: string): Promise<string> {
  return (await createTestAthlete(email)).accessToken;
}
