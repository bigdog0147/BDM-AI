export interface AuthUser {
  id: string;
  email?: string | null;
  providers?: string[];
}

export async function currentUser(): Promise<AuthUser | null> {
  return null;
}
