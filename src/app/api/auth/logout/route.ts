import { open } from '@/lib/http';
import { signOut } from '@/lib/auth/routes';

export const POST = open(signOut);
