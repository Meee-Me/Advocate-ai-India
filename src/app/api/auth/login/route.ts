import { open } from '@/lib/http';
import { login } from '@/lib/auth/routes';

export const POST = open(login);
